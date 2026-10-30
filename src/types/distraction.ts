/**
 * Distraction Detector Types
 *
 * WHY: Phase 11 AI Distraction Detector requires dedicated types for candidates,
 *      suppression state, scan caching, and AI Flow proposal caching.
 * WHAT: DistractionCandidate, SuppressionList, ScanCache, DomainAggregate, ProposedFlowRule, ProposalCache
 * HOW: Used by DistractionDetectorService, FlowDesignerService, and their respective modals.
 */

import type { FlowCondition, FlowConditionOperator, FlowAction } from './flow';

/**
 * DomainAggregate — on-device 30-day aggregated visit data for a single domain.
 * Built by history-aggregator.ts from chrome.history API data.
 * Sent to Supertry AI proxy as input (never raw URLs).
 */
export interface DomainAggregate {
    domain: string;
    visitCount: number;      // visits in the 30-day window (from VisitItem.visitTime, NOT HistoryItem.visitCount)
    sessionCount: number;    // sessions where this domain was visited (30-min gap heuristic)
    timeOfDay: number[];     // 24 buckets, each = visit count in that hour (0-23); sum === visitCount
}

/**
 * DistractionCandidate — a domain proposed by the AI for user review.
 * Never surfaced as "distraction" in the UI — always "for review" (DETECT-06).
 */
export interface DistractionCandidate {
    domain: string;
    rationale: string;       // Neutral explanation anchored in concrete numbers (DETECT-05)
    confidence: number;      // 0.0-1.0 AI confidence score
    aggregate: DomainAggregate;
}

/**
 * SuppressionList — domains the user declined, suppressed for 30 days.
 * Storage key: 'distraction_suppression_list'
 * Value: domain -> suppressUntilMs (epoch timestamp when suppression expires)
 */
export type SuppressionList = Record<string, number>;

/**
 * ScanCache — persisted scan result so the modal can "come back later".
 * Storage key: 'distraction_scan_cache'
 */
export interface ScanCache {
    scannedAt: number;
    candidates: DistractionCandidate[];
}

/**
 * ProposedFlowRule — a flow rule proposed by AI (before accept adds id/created/modified).
 * Does NOT include id, created, modified — those are added by the accept handler.
 */
export interface ProposedFlowRule {
    name: string;
    description: string;
    rationale: string;       // AI reasoning for why this rule is useful
    conditions: FlowCondition[];
    conditionOperator?: FlowConditionOperator;
    action: FlowAction;
    // boolean (not literal true) — the AI may propose disabled rules; accept()
    // forces enabled:true at persist time since the user explicitly accepted it.
    enabled: boolean;
    priority: number;
}

/**
 * ProposalCache — persisted proposal result so the Flow Designer modal persists across close.
 * Storage key: 'flow_proposal_cache'
 */
export interface ProposalCache {
    generatedAt: number;
    proposals: ProposedFlowRule[];
}
