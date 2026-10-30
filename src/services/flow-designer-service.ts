/**
 * flow-designer-service.ts — AI Flow Rule Designer service (DESIGN-01..07, DESIGN-10)
 *
 * WHY: Phase 11 AI Flow Rule Designer requires a proposal pipeline that gathers browsing
 *      context, calls the Supertry AI proxy, validates the response via Zod, and persists
 *      accepted rules through the same FlowStorageService write path as manual rules.
 * WHAT: Exports FlowDesignerService (static class) + ProposedFlowRuleSchema (Zod schema).
 * HOW:  Static class pattern consistent with other Phase 11 services.
 *       Storage key: 'flow_proposal_cache' (ProposalCache | null)
 *       DESIGN-05: Max 3 proposals enforced via Zod .max(3) on response schema.
 *       DESIGN-07: FlowRuleSchema.safeParse gate on accept path.
 *       DESIGN-08 (refined): No undo-snapshot primitive — accept is non-destructive.
 *       DESIGN-09 (refined): No auto-apply on accept — rule applies on next save/Organize.
 *
 * PROCESS-03: Does NOT modify FlowStorageService or FlowService — only calls existing API.
 */

import { z } from 'zod';
import { Storage } from '../utils/storage';
import { config } from '../config/config';
import {
    FlowRuleSchema,
    FlowConditionSchema,
    FlowActionSchema,
    FlowConditionOperatorSchema,
} from '../types/flow';
import type { FlowRule } from '../types/flow';
import type { ProposedFlowRule, ProposalCache } from '../types/distraction';
import { FlowStorageService } from '../utils/flow-storage';
import { AIAllowanceService } from './ai-allowance-service';
import { KillSwitchService } from './kill-switch-service';
import { aggregateHistory, hasMinimumHistoryDays } from './history-aggregator';

const PROPOSAL_CACHE_KEY = 'flow_proposal_cache';

/**
 * ProposedFlowRuleSchema — Zod schema for the shape returned by Supertry.
 * Exported for test reuse and DESIGN-07 validation.
 *
 * Note: Does NOT include id, created, modified — those are added by accept().
 */
export const ProposedFlowRuleSchema = z.object({
    name: z.string().min(1),
    description: z.string(),
    rationale: z.string(),
    conditions: z.array(FlowConditionSchema),
    conditionOperator: FlowConditionOperatorSchema.optional(),
    action: FlowActionSchema,
    // Accept either boolean; we force enabled:true at accept() time so a
    // proposal that arrives with enabled:false doesn't fail validation here.
    // Proposals are pre-persistence — "enabled" only matters once saved.
    enabled: z.boolean(),
    priority: z.number(),
});

/**
 * Response schema for the Supertry /ai/propose-flow-rules endpoint.
 * DESIGN-05: proposals array capped at max 3 via Zod .max(3).
 */
const ProposeResponseSchema = z.object({
    proposals: z.array(ProposedFlowRuleSchema).max(3),
    tokensUsed: z.number(),
});

/** Block reasons returned by propose() */
export type ProposeBlockReason =
    | 'kill_switch'
    | 'backend_error'
    | 'budget'
    | 'rate_limit'
    | 'no_permission'
    | 'insufficient_history';

export class FlowDesignerService {
    /**
     * Propose up to 3 Flow rules via the Supertry AI proxy.
     *
     * Pipeline:
     * 1. Kill-switch check
     * 2. History permission check
     * 3. Minimum history gate (7 days)
     * 4. Gather open tabs + recent groups + history aggregates + existing rules
     * 5. POST to Supertry
     * 6. Zod validate response (DESIGN-05 max-3 enforcement)
     * 7. Refresh allowance summary
     * 8. Write to flow_proposal_cache
     *
     * @param token  User's Supertry Bearer token
     */
    static async propose(
        token: string
    ): Promise<
        | { status: 'ok'; cache: ProposalCache }
        | { status: 'blocked'; reason: ProposeBlockReason }
    > {
        // Step 1: Kill-switch check
        const killSwitchEnabled = await KillSwitchService.isEnabled();
        if (!killSwitchEnabled) {
            return { status: 'blocked', reason: 'kill_switch' };
        }

        // Step 2: History permission check
        const hasHistoryPermission = await new Promise<boolean>((resolve) => {
            chrome.permissions.contains({ permissions: ['history'] }, resolve);
        });
        if (!hasHistoryPermission) {
            return { status: 'blocked', reason: 'no_permission' };
        }

        // Step 3: Minimum history gate (7 days)
        const hasEnoughHistory = await hasMinimumHistoryDays(7);
        if (!hasEnoughHistory) {
            return { status: 'blocked', reason: 'insufficient_history' };
        }

        // Step 5a: Gather open tabs (skip browser-internal URLs)
        const allTabs = await chrome.tabs.query({});
        const openTabs = allTabs
            .filter((tab) => {
                const url = tab.url || '';
                return (
                    !url.startsWith('chrome://') &&
                    !url.startsWith('edge://') &&
                    !url.startsWith('chrome-extension://')
                );
            })
            .map((tab) => ({ url: tab.url || '', title: tab.title || '' }));

        // Step 4b: Recent groups — take 10 most recently modified
        const tabGroups = (await Storage.get<Array<{
            id: string;
            name: string;
            modified?: number;
            tabs?: Array<{ url?: string }>;
        }>>('tabGroups')) || [];
        const recentGroups = [...tabGroups]
            .sort((a, b) => (b.modified || 0) - (a.modified || 0))
            .slice(0, 10)
            .map((g) => ({
                name: g.name,
                tabUrls: (g.tabs || []).map((t) => t.url || '').filter(Boolean),
            }));

        // Step 4c: History aggregates — last 30 days, top 50 by visitCount
        const startTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const allAggregates = await aggregateHistory(startTime);
        const historyAggregates = allAggregates.slice(0, 50);

        // Step 4d: Existing rules (so AI avoids duplicates)
        const flowSettings = await FlowStorageService.getFlowSettings();
        const existingRules: FlowRule[] = flowSettings.rules;

        // Step 5: POST to Supertry
        let jsonResponse: unknown;
        try {
            const response = await fetch(
                `${config.supertry.apiUrl}/ai/propose-flow-rules`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        openTabs,
                        recentGroups,
                        historyAggregates,
                        existingRules,
                    }),
                    signal: AbortSignal.timeout(25000),
                }
            );

            if (!response.ok) {
                console.error(
                    `[BlueTab][FlowDesigner] Supertry returned ${response.status}`
                );
                if (response.status === 429) {
                    const payload = await response.clone().json().catch(() => null) as { error?: string } | null;
                    if (payload?.error === 'token_cap_exceeded') {
                        await AIAllowanceService.syncFromAIResponse(response);
                        return { status: 'blocked', reason: 'budget' };
                    }
                    return { status: 'blocked', reason: 'rate_limit' };
                }
                // Everything else (400 schema mismatch, 5xx, 503) is a backend
                // issue — NOT the remote kill-switch. The kill-switch only
                // fires via /api/config.ai_history_features_enabled === false,
                // which KillSwitchService.isEnabled() already checked in Step 1.
                return { status: 'blocked', reason: 'backend_error' };
            }

            await AIAllowanceService.syncFromAIResponse(response);
            jsonResponse = await response.json();
        } catch (error) {
            console.error('[BlueTab][FlowDesigner] Network error during propose:', error);
            return { status: 'blocked', reason: 'backend_error' };
        }

        // Step 6: Zod validate (DESIGN-05 max-3 enforced here)
        const parse = ProposeResponseSchema.safeParse(jsonResponse);
        if (!parse.success) {
            console.error(
                '[BlueTab][FlowDesigner] Response schema validation failed:',
                parse.error
            );
            return { status: 'blocked', reason: 'backend_error' };
        }

        const { proposals } = parse.data;

        // Step 7: Write to proposal cache
        const cache: ProposalCache = {
            generatedAt: Date.now(),
            proposals,
        };
        await Storage.set(PROPOSAL_CACHE_KEY, cache);

        return { status: 'ok', cache };
    }

    /**
     * Accept a proposed rule: validate via FlowRuleSchema, then persist via FlowStorageService.
     *
     * DESIGN-07: FlowRuleSchema.safeParse gate prevents malformed proposals from landing.
     * DESIGN-08 (refined): No undo snapshot — accept is non-destructive.
     * DESIGN-03: Receives the (possibly edited) proposal shape from the UI layer.
     *
     * @param proposal  The ProposedFlowRule to accept (may have been edited by the user)
     * @returns         Success + ruleId, or failure + error message
     */
    static async accept(
        proposal: ProposedFlowRule
    ): Promise<{ success: true; ruleId: string } | { success: false; error: string }> {
        const now = Date.now();
        const id = crypto.randomUUID();

        const ruleCandidate: FlowRule = {
            ...proposal,
            id,
            created: now,
            modified: now,
            // Force enabled:true at accept time — a proposal arriving with
            // enabled:false is treated as "propose, but let the user enable".
            // Since the user explicitly accepted it, they clearly want it on.
            enabled: true,
        };

        // DESIGN-07: Zod validation gate
        const parse = FlowRuleSchema.safeParse(ruleCandidate);
        if (!parse.success) {
            return { success: false, error: parse.error.message };
        }

        // Persist via FlowStorageService (same path as manual rules)
        await FlowStorageService.createRule({
            name: parse.data.name,
            description: parse.data.description,
            enabled: parse.data.enabled,
            priority: parse.data.priority,
            conditions: parse.data.conditions,
            conditionOperator: parse.data.conditionOperator,
            action: parse.data.action,
            isTemplate: parse.data.isTemplate,
            templateId: parse.data.templateId,
        });

        // Remove the accepted proposal from the cache
        const cache = await FlowDesignerService.loadCache();
        if (cache) {
            const updatedProposals = cache.proposals.filter(
                (p) => p.name !== proposal.name || p.rationale !== proposal.rationale
            );
            await Storage.set(PROPOSAL_CACHE_KEY, {
                ...cache,
                proposals: updatedProposals,
            });
        }

        return { success: true, ruleId: id };
    }

    /**
     * Dismiss a proposal by index — removes it from the cache.
     * No 30-day suppression for design proposals (CONTEXT.md decision).
     *
     * @param proposalIndex  Zero-based index in the cached proposals array
     */
    static async dismiss(proposalIndex: number): Promise<void> {
        const cache = await FlowDesignerService.loadCache();
        if (!cache) return;

        const updatedProposals = cache.proposals.filter((_, i) => i !== proposalIndex);
        await Storage.set(PROPOSAL_CACHE_KEY, {
            ...cache,
            proposals: updatedProposals,
        });
    }

    /**
     * Load the current proposal cache from storage.
     *
     * @returns ProposalCache if a cache exists, null otherwise
     */
    static async loadCache(): Promise<ProposalCache | null> {
        return Storage.get<ProposalCache>(PROPOSAL_CACHE_KEY);
    }

    /**
     * Clear the proposal cache entirely.
     */
    static async clearCache(): Promise<void> {
        await Storage.set(PROPOSAL_CACHE_KEY, null);
    }
}
