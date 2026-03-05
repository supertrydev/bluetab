/**
 * Flow Types
 *
 * WHY: Define type-safe interfaces for the Flow automation feature
 * WHAT: FlowRule, FlowCondition, FlowAction, FlowSettings, FlowTemplate
 * HOW: Used by FlowService and FlowStorageService for rule processing
 */

// Condition types for URL and title matching
export type FlowConditionType =
    | 'url_contains'        // URL contains substring
    | 'url_starts_with'     // URL starts with pattern
    | 'url_matches_regex'   // Regex match on full URL
    | 'domain_equals'       // Exact domain match
    | 'domain_contains'     // Domain contains substring
    | 'path_contains'       // Path portion contains substring
    | 'title_contains'      // Tab title contains substring
    | 'title_matches_regex'; // Regex match on tab title

// Condition logic operators
export type FlowConditionOperator = 'AND' | 'OR';

// Action types for matched tabs
export type FlowActionType =
    | 'add_to_existing_group'  // Add tab to existing group by ID
    | 'create_group'           // Always create new group
    | 'add_to_or_create';      // Add to existing or create if not exists

/**
 * FlowCondition - Defines a URL/title matching condition
 */
export interface FlowCondition {
    id: string;
    type: FlowConditionType;
    value: string;              // Pattern, domain, or regex
    caseSensitive?: boolean;    // Default: false
    negate?: boolean;           // NOT operator - inverts the match result
}

/**
 * FlowAction - Defines what happens when conditions match
 */
export interface FlowAction {
    type: FlowActionType;
    targetGroupId?: string;     // For 'add_to_existing_group'
    newGroupName?: string;      // For 'create_group' or 'add_to_or_create'
    groupColor?: string;        // Optional color for new groups
    tags?: string[];            // Tag IDs to apply to matched tabs
}

/**
 * FlowRule - A complete automation rule
 */
export interface FlowRule {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    priority: number;           // Lower = higher priority (executed first)
    conditions: FlowCondition[];
    conditionOperator?: FlowConditionOperator; // AND (default) or OR
    action: FlowAction;
    created: number;
    modified: number;
    isTemplate?: boolean;       // True if this was imported from a template
    templateId?: string;        // Reference to original template ID
    lastTriggered?: number;     // Last time this rule matched
    triggerCount?: number;      // How many times this rule has matched
}

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
