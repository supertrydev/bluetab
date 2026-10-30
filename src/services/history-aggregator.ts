/**
 * history-aggregator.ts — Chrome history 30-day aggregation pipeline (DETECT-02, DETECT-10)
 *
 * WHY: Phase 11 AI Distraction Detector requires on-device aggregation of browsing history
 *      before any data is sent to Supertry. Only domain-level aggregates leave the device.
 * WHAT: Exports aggregateHistory() and hasMinimumHistoryDays() — both are pure async functions
 *       with no side effects beyond reading chrome.history.
 * HOW:  Uses chrome.history.search + chrome.history.getVisits. The 30-minute session gap
 *       heuristic is the industry standard (Google Analytics, Adobe Analytics).
 *       HistoryItem.visitCount is ALL-TIME — use VisitItem.visitTime for window-scoped counts.
 *
 * Performance: Deduplicates URLs before calling getVisits. Batches calls in groups of 50
 * with a zero-timeout yield between batches to avoid UI-thread stutter (Pitfall 6).
 */

import type { DomainAggregate } from '../types/distraction';

const SESSION_GAP_MS = 30 * 60 * 1000;   // 30-minute session gap heuristic
const GETVISITS_BATCH_SIZE = 50;           // URLs per batch to avoid UI stutter

/**
 * Aggregate 30 days of browsing history by domain.
 *
 * @param startTime   Epoch ms — start of the history window (typically Date.now() - 30 days)
 * @returns           Array of DomainAggregate sorted by visitCount descending
 */
export async function aggregateHistory(startTime: number): Promise<DomainAggregate[]> {
    // Step 1: Get all history items in the time window
    const items = await chrome.history.search({
        text: '',
        startTime,
        maxResults: 100_000,
    });

    // Step 2: Deduplicate URLs before calling getVisits
    // (HistoryItem.visitCount is ALL-TIME — we must use VisitItem.visitTime for window counts)
    const uniqueUrls = [...new Set(items.map(item => item.url).filter((url): url is string => Boolean(url)))];

    // domain -> array of visit timestamps within the window
    const domainMap = new Map<string, number[]>();

    // Step 3: Process getVisits in batches to avoid UI-thread stutter
    for (let i = 0; i < uniqueUrls.length; i += GETVISITS_BATCH_SIZE) {
        const batch = uniqueUrls.slice(i, i + GETVISITS_BATCH_SIZE);

        for (const url of batch) {
            let domain: string;
            try {
                domain = new URL(url).hostname.replace(/^www\./, '');
            } catch {
                continue; // Skip malformed URLs
            }

            const visits = await chrome.history.getVisits({ url });
            const windowVisits = visits
                .filter(v => v.visitTime !== undefined && v.visitTime >= startTime)
                .map(v => v.visitTime!);

            if (windowVisits.length === 0) continue;

            const existing = domainMap.get(domain) ?? [];
            existing.push(...windowVisits);
            domainMap.set(domain, existing);
        }

        // Yield between batches to avoid UI stutter (Pitfall 6 from RESEARCH.md)
        if (i + GETVISITS_BATCH_SIZE < uniqueUrls.length) {
            await new Promise<void>(r => setTimeout(r, 0));
        }
    }

    // Step 4: Compute sessionCount + timeOfDay for each domain
    const result: DomainAggregate[] = [];

    for (const [domain, visitTimestamps] of domainMap) {
        visitTimestamps.sort((a, b) => a - b);

        let sessionCount = visitTimestamps.length > 0 ? 1 : 0;
        const timeOfDay = new Array<number>(24).fill(0);

        for (let i = 0; i < visitTimestamps.length; i++) {
            const hour = new Date(visitTimestamps[i]).getHours();
            timeOfDay[hour]++;
            if (i > 0 && visitTimestamps[i] - visitTimestamps[i - 1] > SESSION_GAP_MS) {
                sessionCount++;
            }
        }

        result.push({
            domain,
            visitCount: visitTimestamps.length,
            sessionCount,
            timeOfDay,
        });
    }

    // Step 5: Sort by visitCount descending
    return result.sort((a, b) => b.visitCount - a.visitCount);
}

/**
 * Check whether the user has at least N days of browsing history.
 * Used by DETECT-10 minimum-data gate (7 days required).
 *
 * @param days   Minimum number of days to check for
 * @returns      true if chrome.history has at least 1 result within the last N days
 */
export async function hasMinimumHistoryDays(days: number): Promise<boolean> {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const items = await chrome.history.search({
        text: '',
        startTime,
        maxResults: 1,
    });
    return items.length > 0;
}
