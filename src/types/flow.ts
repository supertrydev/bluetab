/**
 * Flow Types
 *
 * WHY: Define type-safe interfaces for the Flow automation feature
 * WHAT: FlowRule, FlowCondition, FlowAction, FlowSettings, FlowTemplate
 * HOW: Used by FlowService and FlowStorageService for rule processing
 *
 * DESIGN-07: FlowCondition, FlowAction, and FlowRule are now Zod-schema-backed.
 * Downstream consumers import the same type names — no breaking changes.
 */

import { z } from 'zod';

// --- Literal/enum schemas (Zod v4: use z.enum, NOT z.nativeEnum) ---

export const FlowConditionTypeSchema = z.enum([
    'url_contains',
    'url_starts_with',
    'url_matches_regex',
    'domain_equals',
    'domain_contains',
    'path_contains',
    'title_contains',
    'title_matches_regex',
]);

export const FlowConditionOperatorSchema = z.enum(['AND', 'OR']);

export const FlowActionTypeSchema = z.enum([
    'add_to_existing_group',
    'create_group',
    'add_to_or_create',
]);

// --- Object schemas (Zod v4: use z.object, NOT .strict()) ---

/**
 * FlowConditionSchema - Defines a URL/title matching condition
 */
export const FlowConditionSchema = z.object({
    id: z.string(),
    type: FlowConditionTypeSchema,
    value: z.string(),
    caseSensitive: z.boolean().optional(),  // Default: false
    negate: z.boolean().optional(),          // NOT operator - inverts the match result
});

/**
 * FlowActionSchema - Defines what happens when conditions match
 */
export const FlowActionSchema = z.object({
    type: FlowActionTypeSchema,
    targetGroupId: z.string().optional(),   // For 'add_to_existing_group'
    newGroupName: z.string().optional(),    // For 'create_group' or 'add_to_or_create'
    groupColor: z.string().optional(),      // Optional color for new groups
    tags: z.array(z.string()).optional(),   // Tag IDs to apply to matched tabs
});

/**
 * FlowRuleSchema - A complete automation rule
 */
export const FlowRuleSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    enabled: z.boolean(),
    priority: z.number(),                   // Lower = higher priority (executed first)
    conditions: z.array(FlowConditionSchema),
    conditionOperator: FlowConditionOperatorSchema.optional(), // AND (default) or OR
    action: FlowActionSchema,
    created: z.number(),
    modified: z.number(),
    isTemplate: z.boolean().optional(),     // True if this was imported from a template
    templateId: z.string().optional(),      // Reference to original template ID
    lastTriggered: z.number().optional(),   // Last time this rule matched
    triggerCount: z.number().optional(),    // How many times this rule has matched
});

// --- Type re-exports (drop-in replacements for prior TS interfaces) ---

/** Condition types for URL and title matching */
export type FlowConditionType = z.infer<typeof FlowConditionTypeSchema>;

/** Condition logic operators */
export type FlowConditionOperator = z.infer<typeof FlowConditionOperatorSchema>;

/** Action types for matched tabs */
export type FlowActionType = z.infer<typeof FlowActionTypeSchema>;

/** FlowCondition — same shape as the prior interface; TS consumers compile unchanged */
export type FlowCondition = z.infer<typeof FlowConditionSchema>;

/** FlowAction — same shape as the prior interface; TS consumers compile unchanged */
export type FlowAction = z.infer<typeof FlowActionSchema>;

/** FlowRule — same shape as the prior interface; TS consumers compile unchanged */
export type FlowRule = z.infer<typeof FlowRuleSchema>;

/**
 * FlowSettings - Top-level Flow configuration stored in chrome.storage
 */
export interface FlowSettings {
    enabled: boolean;           // Master switch for Flow
    rules: FlowRule[];
    executionCount: number;     // Total tabs processed by Flow
    lastExecuted?: number;      // Last time Flow was executed
    version: string;            // For future migrations
    showRuleTest?: boolean;     // Show Rule Test panel (default: false)
}

/**
 * FlowTemplate - Pre-built template for social media platforms
 */
export interface FlowTemplate {
    id: string;
    name: string;
    description: string;
    platform: string;           // e.g., 'youtube', 'twitter', 'github'
    icon: string;               // Lucide icon name
    color: string;              // Brand color
    rules: Omit<FlowRule, 'id' | 'created' | 'modified'>[];
}

/**
 * FlowExecutionResult - Result of processing a single tab through Flow
 */
export interface FlowExecutionResult {
    success: boolean;
    tabId: string;
    tabUrl: string;
    matchedRuleId?: string;
    matchedRuleName?: string;
    actionTaken?: 'added_to_group' | 'created_group' | 'no_match' | 'skipped';
    targetGroupId?: string;
    targetGroupName?: string;
    error?: string;
}

/**
 * FlowProcessResult - Result of processing multiple tabs
 */
export interface FlowProcessResult {
    success: boolean;
    processed: number;
    matched: number;
    results: FlowExecutionResult[];
    groupsCreated: string[];    // IDs of newly created groups
    groupsModified: string[];   // IDs of modified groups
    warnings?: string[];
    error?: string;
}

/**
 * Default Flow settings factory
 */
export function getDefaultFlowSettings(): FlowSettings {
    return {
        enabled: true,
        rules: [],
        executionCount: 0,
        version: '1.0.0'
    };
}
