/**
 * @module services/distraction-detector-service
 *
 * WHY:  Pro users need a way to identify domains they may want to add to their Focus
 *       blocklist. This service orchestrates the full DETECT pipeline: local history
 *       aggregation, suppression/blocklist filtering, Supertry AI classification,
 *       and cache persistence so the modal can "come back later".
 *
 * WHAT: Static DistractionDetectorService class with scan(), approve(), decline(),
 *       loadCachedResults(), and clearCache() methods.
 *
 * HOW:  scan() pipeline:
 *         1. KillSwitch check  — fail if kill switch active
 *         2. Permissions check — fail if chrome.history not granted
 *         3. History gate      — fail if < 7 days of history (DETECT-10)
 *         4. Server allowance  — backend enforces allowance / rate limits
 *         5. aggregateHistory  — 30-day rolling window
 *         6. Suppression filter — prune expired + filter suppressed domains (DETECT-08)
 *         7. Focus-blocklist filter — exclude domains in FocusService.resolveBlockedDomains (DETECT-11)
 *         8. Top-50 cap         — keeps Supertry payload bounded
 *         9. Supertry POST      — classify-distraction-candidates endpoint
 *        10. Merge aggregates   — join candidates with their aggregate for heatmap data
 *        11. Refresh allowance   — mirror latest server allowance summary
 *        12. Persist cache       — distraction_scan_cache in chrome.storage.local
 *
 * DETECT-11 NOTE: "Domains visited during successful Focus sessions cannot be flagged"
 *   There is no persistent Focus session log in the current codebase — FocusService
 *   only writes { isActive, activatedAt } and aggregates minutes to StatsService.
 *   The practical proxy used here: exclude all domains currently in
 *   FocusService.resolveBlockedDomains(settings). These are the domains the user
 *   consciously chose to block, and they are the closest available signal.
 *   (See Phase 11 RESEARCH.md Open Question #1 for full rationale.)
 *
 * NOT:  Does not expose raw URLs to Supertry (DETECT-03). Only domain-level aggregates
 *       are sent unless the caller explicitly opts in via options.sendRawUrls.
 *       Does not provide a local heuristic fallback for Free users (DETECT-09 refined).
 */

import { aggregateHistory, hasMinimumHistoryDays } from './history-aggregator';
import { KillSwitchService } from './kill-switch-service';
import { FocusService } from './focus-service';
import { AIAllowanceService } from './ai-allowance-service';
import { Storage } from '../utils/storage';
import { config } from '../config/config';
import type { DomainAggregate, DistractionCandidate, ScanCache, SuppressionList } from '../types/distraction';
import type { FocusSettings } from '../types/productivity';

const LOG_PREFIX = '[BlueTab][DistractionDetector]';
const SUPPRESS_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const SCAN_CACHE_KEY = 'distraction_scan_cache';
const SUPPRESSION_KEY = 'distraction_suppression_list';

/** Maximum number of aggregates sent to Supertry to keep payload bounded. */
const TOP_N = 50;

/** Supertry response shape from classify-distraction-candidates. */
interface SupertryClassifyResponse {
    candidates: { domain: string; rationale: string; confidence: number }[];
    tokensUsed: number;
}

/** Prune expired entries from the suppression list (mutates the object in place). */
function pruneSuppression(list: SuppressionList): SuppressionList {
    const now = Date.now();
    return Object.fromEntries(
        Object.entries(list).filter(([, exp]) => exp > now)
    );
}

/** Returns true if the domain is suppressed (has a future expiry in the list). */
function isSuppressed(domain: string, list: SuppressionList): boolean {
    return (list[domain] ?? 0) > Date.now();
}

export type ScanBlockReason =
    | 'kill_switch'
    | 'backend_error'
    | 'no_permission'
    | 'insufficient_history'
    | 'budget'
    | 'rate_limit';

export type ScanResult =
    | { status: 'ok'; scanCache: ScanCache }
    | { status: 'blocked'; reason: ScanBlockReason };

export class DistractionDetectorService {
    /**
     * Run the full DETECT scan pipeline.
     *
     * @param token          Supertry Bearer auth token (from useAuth)
     * @param options.sendRawUrls  Opt-in to include raw URLs in payload (default: false)
     */
    static async scan(
        token: string,
        options?: { sendRawUrls?: boolean }
    ): Promise<ScanResult> {
        // Step 1: Kill switch
        const killSwitchEnabled = await KillSwitchService.isEnabled();
        if (!killSwitchEnabled) {
            console.log(`${LOG_PREFIX} Blocked: kill switch active`);
            return { status: 'blocked', reason: 'kill_switch' };
        }

        // Step 2: History permission
        const hasPermission = await chrome.permissions.contains({ permissions: ['history'] });
        if (!hasPermission) {
            console.log(`${LOG_PREFIX} Blocked: history permission not granted`);
            return { status: 'blocked', reason: 'no_permission' };
        }

        // Step 3: Minimum history gate (DETECT-10)
        const hasHistory = await hasMinimumHistoryDays(7);
        if (!hasHistory) {
            console.log(`${LOG_PREFIX} Blocked: insufficient history (< 7 days)`);
            return { status: 'blocked', reason: 'insufficient_history' };
        }

        // Step 5: Aggregate history (30-day rolling window)
        const startTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
        let aggregates = await aggregateHistory(startTime);

        // Step 5: Suppression filter (DETECT-08)
        let suppression = await Storage.get<SuppressionList>(SUPPRESSION_KEY) ?? {};
        suppression = pruneSuppression(suppression);
        await Storage.set(SUPPRESSION_KEY, suppression);
        aggregates = aggregates.filter(a => !isSuppressed(a.domain, suppression));

        // Step 6: Focus-blocklist filter (DETECT-11 proxy)
        // Exclude domains currently in FocusService.resolveBlockedDomains(settings).
        // This is the practical proxy for "domains visited during successful Focus sessions
        // cannot be flagged" — see module JSDoc for full rationale.
        const focusSettings = await Storage.get<FocusSettings>('focusSettings');
        if (focusSettings) {
            const blocked = new Set(FocusService.resolveBlockedDomains(focusSettings));
            aggregates = aggregates.filter(a => !blocked.has(a.domain));
        }

        // Step 7: Top-N cap to keep Supertry payload bounded
        const topAggregates = aggregates.slice(0, TOP_N);

        if (topAggregates.length === 0) {
            // No candidates to classify — write empty cache and return ok
            const emptyCache: ScanCache = { scannedAt: Date.now(), candidates: [] };
            await Storage.set(SCAN_CACHE_KEY, emptyCache);
            return { status: 'ok', scanCache: emptyCache };
        }

        // Step 8: POST to Supertry classify-distraction-candidates
        const endpoint = `${config.supertry.apiUrl}/ai/classify-distraction-candidates`;
        let response: Response;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    aggregates: topAggregates,
                    sendRawUrls: options?.sendRawUrls ?? false,
                }),
                signal: AbortSignal.timeout(25_000),
            });
        } catch (err) {
            console.error(`${LOG_PREFIX} Network error during scan:`, err);
            return { status: 'blocked', reason: 'backend_error' };
        }

        if (!response.ok) {
            console.error(`${LOG_PREFIX} Supertry returned ${response.status}`);
            if (response.status === 429) {
                const payload = await response.clone().json().catch(() => null) as { error?: string } | null;
                if (payload?.error === 'token_cap_exceeded') {
                    await AIAllowanceService.syncFromAIResponse(response);
                    return { status: 'blocked', reason: 'budget' };
                }
                return { status: 'blocked', reason: 'rate_limit' };
            }
            // Everything else (400 schema mismatch, 5xx, 503) is a backend
            // issue — NOT the remote kill-switch. The kill-switch only fires
            // via /api/config.ai_history_features_enabled === false, which
            // KillSwitchService.isEnabled() already checked in Step 1.
            return { status: 'blocked', reason: 'backend_error' };
        }

        await AIAllowanceService.syncFromAIResponse(response);
        const data = await response.json() as SupertryClassifyResponse;

        // Step 9: Join candidates with their aggregate for per-card heatmap data
        const aggregateByDomain = new Map<string, DomainAggregate>(
            topAggregates.map(a => [a.domain, a])
        );
        const candidates: DistractionCandidate[] = data.candidates
            .map(c => {
                const aggregate = aggregateByDomain.get(c.domain);
                if (!aggregate) return null;
                return {
                    domain: c.domain,
                    rationale: c.rationale,
                    confidence: c.confidence,
                    aggregate,
                };
            })
            .filter((c): c is DistractionCandidate => c !== null);

        // Step 10: Write scan cache
        const scanCache: ScanCache = { scannedAt: Date.now(), candidates };
        await Storage.set(SCAN_CACHE_KEY, scanCache);

        console.log(`${LOG_PREFIX} Scan complete — ${candidates.length} candidates`);
        return { status: 'ok', scanCache };
    }

    /**
     * Approve selected candidates: add to Focus blocklist + remove from cache.
     *
     * @param domains   Domain names to approve (from user checkbox selection)
     */
    static async approve(domains: string[]): Promise<void> {
        if (domains.length === 0) return;

        await FocusService.addCustomDomains(domains, { source: 'ai' });

        // Remove approved domains from cached scan results
        const cache = await Storage.get<ScanCache>(SCAN_CACHE_KEY);
        if (cache) {
            const approvedSet = new Set(domains);
            const updated: ScanCache = {
                ...cache,
                candidates: cache.candidates.filter(c => !approvedSet.has(c.domain)),
            };
            await Storage.set(SCAN_CACHE_KEY, updated);
        }

        console.log(`${LOG_PREFIX} Approved ${domains.length} domains → Focus blocklist`);
    }

    /**
     * Decline selected candidates: add to 30-day suppression list + remove from cache.
     *
     * @param domains   Domain names to decline (from user checkbox selection)
     */
    static async decline(domains: string[]): Promise<void> {
        if (domains.length === 0) return;

        const now = Date.now();
        let suppression = await Storage.get<SuppressionList>(SUPPRESSION_KEY) ?? {};

        // Prune expired entries first
        suppression = pruneSuppression(suppression);

        // Add 30-day TTL for each declined domain
        for (const domain of domains) {
            suppression[domain] = now + SUPPRESS_DURATION_MS;
        }

        await Storage.set(SUPPRESSION_KEY, suppression);

        // Remove declined domains from cached scan results
        const cache = await Storage.get<ScanCache>(SCAN_CACHE_KEY);
        if (cache) {
            const declinedSet = new Set(domains);
            const updated: ScanCache = {
                ...cache,
                candidates: cache.candidates.filter(c => !declinedSet.has(c.domain)),
            };
            await Storage.set(SCAN_CACHE_KEY, updated);
        }

        console.log(`${LOG_PREFIX} Declined ${domains.length} domains → 30-day suppression`);
    }

    /**
     * Load the last cached scan result without triggering a new scan.
     * Returns null if no cache exists.
     */
    static async loadCachedResults(): Promise<ScanCache | null> {
        return Storage.get<ScanCache>(SCAN_CACHE_KEY);
    }

    /**
     * Clear the scan cache (used by the "Clear list" action in the modal).
     */
    static async clearCache(): Promise<void> {
        await Storage.set(SCAN_CACHE_KEY, null);
        console.log(`${LOG_PREFIX} Scan cache cleared`);
    }
}
