/**
 * FlowService
 *
 * WHY: Process tabs through Flow automation rules
 * WHAT: URL matching, rule execution, group assignment
 * HOW: Called when tabs are saved, matches conditions and executes actions
 * NOT: Does not handle storage (use FlowStorageService), does not handle UI
 */

import {
    FlowRule,
    FlowCondition,
    FlowExecutionResult,
    FlowProcessResult,
    FlowSettings
} from '../types/flow';
import type { TabItem, TabGroup } from '../types/models';
import { FlowStorageService } from '../utils/flow-storage';
import { Storage } from '../utils/storage';
import * as AuthState from '../utils/auth-state';

export class FlowService {
    /**
     * Process tabs through Flow rules
     * Main entry point - called when user saves tabs
     */
    static async processTabs(
        tabs: TabItem[],
        existingGroups: TabGroup[]
    ): Promise<FlowProcessResult> {
        const results: FlowExecutionResult[] = [];
        const groupsCreated: string[] = [];
        const groupsModified: string[] = [];
        const warnings: string[] = [];

        try {
            // Check if user has Pro subscription
            const authState = await AuthState.getAuthState();
            if (!authState.isPro) {
                return {
                    success: true,
                    processed: 0,
                    matched: 0,
                    results: [],
                    groupsCreated: [],
                    groupsModified: [],
                    warnings: ['Flow requires Pro subscription']
                };
            }

            // Get Flow settings
            const settings = await FlowStorageService.getFlowSettings();

            // Check if Flow is enabled
            if (!settings.enabled) {
                return {
                    success: true,
                    processed: 0,
                    matched: 0,
                    results: [],
                    groupsCreated: [],
                    groupsModified: [],
                    warnings: ['Flow is disabled']
                };
            }

            // Get enabled rules sorted by priority
            const rules = await FlowStorageService.getEnabledRules();

            if (rules.length === 0) {
                return {
                    success: true,
                    processed: tabs.length,
                    matched: 0,
                    results: tabs.map(tab => ({
                        success: true,
                        tabId: tab.id,
                        tabUrl: tab.url,
                        actionTaken: 'no_match' as const
                    })),
                    groupsCreated: [],
                    groupsModified: [],
                    warnings: ['No enabled rules']
                };
            }

            // Track groups that will be modified/created
            const groupUpdates: Map<string, TabItem[]> = new Map();
            const newGroups: Map<string, { name: string; color?: string; tabs: TabItem[] }> = new Map();

            // Process each tab
            for (const tab of tabs) {
                const result = await this.processTab(tab, rules, existingGroups, groupUpdates, newGroups);
                results.push(result);
            }

            // Apply group updates to storage
            const groups = await Storage.get<TabGroup[]>('groups') || [];

            // Update existing groups
            for (const [groupId, tabsToAdd] of groupUpdates) {
                const group = groups.find(g => g.id === groupId);
                if (group) {
                    group.tabs.push(...tabsToAdd);
                    group.modified = Date.now();
                    groupsModified.push(groupId);
                }
            }

            // Create new groups
            for (const [groupName, groupData] of newGroups) {
                const newGroup: TabGroup = {
                    id: crypto.randomUUID(),
                    name: groupData.name,
                    tabs: groupData.tabs,
                    created: Date.now(),
                    modified: Date.now(),
                    color: groupData.color
                };
                groups.push(newGroup);
                groupsCreated.push(newGroup.id);
            }

            // Save updated groups
            if (groupsCreated.length > 0 || groupsModified.length > 0) {
                await Storage.set('groups', groups);
            }

            // Update stats
            const matchedCount = results.filter(r => r.actionTaken !== 'no_match' && r.actionTaken !== 'skipped').length;
            await FlowStorageService.updateStats(tabs.length);

            return {
                success: true,
                processed: tabs.length,
                matched: matchedCount,
                results,
                groupsCreated,
                groupsModified,
                warnings: warnings.length > 0 ? warnings : undefined
            };
        } catch (error) {
            console.error('[BlueTab][FlowService] Failed to process tabs:', error);
            return {
                success: false,
                processed: 0,
                matched: 0,
                results,
                groupsCreated: [],
                groupsModified: [],
                error: error instanceof Error ? error.message : 'Failed to process tabs'
            };
        }
    }

    /**
     * Process a single tab through rules
     */
    private static async processTab(
        tab: TabItem,
        rules: FlowRule[],
        existingGroups: TabGroup[],
        groupUpdates: Map<string, TabItem[]>,
        newGroups: Map<string, { name: string; color?: string; tabs: TabItem[] }>
    ): Promise<FlowExecutionResult> {
        // Find first matching rule (rules are already sorted by priority)
        const matchedRule = rules.find(rule => this.matchesRule(tab.url, rule, tab.title || ''));

        if (!matchedRule) {
            return {
                success: true,
                tabId: tab.id,
                tabUrl: tab.url,
                actionTaken: 'no_match'
            };
        }

        // Execute the action
        try {
            const result = await this.executeAction(
                tab,
                matchedRule,
                existingGroups,
                groupUpdates,
                newGroups
            );

            // Increment trigger count (async, don't wait)
            FlowStorageService.incrementRuleTrigger(matchedRule.id).catch(() => {});

            return result;
        } catch (error) {
            return {
                success: false,
                tabId: tab.id,
                tabUrl: tab.url,
                matchedRuleId: matchedRule.id,
                matchedRuleName: matchedRule.name,
                error: error instanceof Error ? error.message : 'Action execution failed'
            };
        }
    }

    /**
     * Execute action for a matched rule
     */
    private static async executeAction(
        tab: TabItem,
        rule: FlowRule,
        existingGroups: TabGroup[],
        groupUpdates: Map<string, TabItem[]>,
        newGroups: Map<string, { name: string; color?: string; tabs: TabItem[] }>
    ): Promise<FlowExecutionResult> {
        const { action } = rule;

        switch (action.type) {
            case 'add_to_existing_group': {
                if (!action.targetGroupId) {
                    return {
                        success: false,
                        tabId: tab.id,
                        tabUrl: tab.url,
                        matchedRuleId: rule.id,
                        matchedRuleName: rule.name,
                        error: 'No target group specified'
                    };
                }

                const targetGroup = existingGroups.find(g => g.id === action.targetGroupId);
                if (!targetGroup) {
                    return {
                        success: false,
                        tabId: tab.id,
                        tabUrl: tab.url,
                        matchedRuleId: rule.id,
                        matchedRuleName: rule.name,
                        error: 'Target group not found'
                    };
                }

                // Queue tab for addition
                const existing = groupUpdates.get(targetGroup.id) || [];
                existing.push({ ...tab, groupId: targetGroup.id });
                groupUpdates.set(targetGroup.id, existing);

                return {
                    success: true,
                    tabId: tab.id,
                    tabUrl: tab.url,
                    matchedRuleId: rule.id,
                    matchedRuleName: rule.name,
                    actionTaken: 'added_to_group',
                    targetGroupId: targetGroup.id,
                    targetGroupName: targetGroup.name
                };
            }

            case 'create_group': {
                const groupName = action.newGroupName || rule.name;

                // Add to new groups map
                const existing = newGroups.get(groupName);
                if (existing) {
                    existing.tabs.push({ ...tab, groupId: '' });
                } else {
                    newGroups.set(groupName, {
                        name: groupName,
                        color: action.groupColor,
                        tabs: [{ ...tab, groupId: '' }]
                    });
                }

                return {
                    success: true,
                    tabId: tab.id,
                    tabUrl: tab.url,
                    matchedRuleId: rule.id,
                    matchedRuleName: rule.name,
                    actionTaken: 'created_group',
                    targetGroupName: groupName
                };
            }

            case 'add_to_or_create': {
                const groupName = action.newGroupName || rule.name;

                // Check if group exists
                const existingGroup = existingGroups.find(
                    g => g.name.toLowerCase() === groupName.toLowerCase()
                );

                if (existingGroup) {
                    // Add to existing
                    const existing = groupUpdates.get(existingGroup.id) || [];
                    existing.push({ ...tab, groupId: existingGroup.id });
                    groupUpdates.set(existingGroup.id, existing);

                    return {
                        success: true,
                        tabId: tab.id,
                        tabUrl: tab.url,
                        matchedRuleId: rule.id,
                        matchedRuleName: rule.name,
                        actionTaken: 'added_to_group',
                        targetGroupId: existingGroup.id,
                        targetGroupName: existingGroup.name
                    };
                } else {
                    // Create new or add to pending new group
                    const pendingGroup = newGroups.get(groupName);
                    if (pendingGroup) {
                        pendingGroup.tabs.push({ ...tab, groupId: '' });
                    } else {
                        newGroups.set(groupName, {
                            name: groupName,
                            color: action.groupColor,
                            tabs: [{ ...tab, groupId: '' }]
                        });
                    }

                    return {
                        success: true,
                        tabId: tab.id,
                        tabUrl: tab.url,
                        matchedRuleId: rule.id,
                        matchedRuleName: rule.name,
                        actionTaken: 'created_group',
                        targetGroupName: groupName
                    };
                }
            }

            default:
                return {
                    success: false,
                    tabId: tab.id,
                    tabUrl: tab.url,
                    matchedRuleId: rule.id,
                    matchedRuleName: rule.name,
                    error: `Unknown action type: ${action.type}`
                };
        }
    }

    /**
     * Check if a URL/title matches a rule
     * Supports AND/OR logic via conditionOperator
     */
    static matchesRule(url: string, rule: FlowRule, title: string = ''): boolean {
        if (rule.conditions.length === 0) return false;

        const operator = rule.conditionOperator || 'AND';

        if (operator === 'OR') {
            // At least one condition must match
            return rule.conditions.some(condition => this.matchesCondition(url, title, condition));
        } else {
            // All conditions must match (AND logic - default)
            return rule.conditions.every(condition => this.matchesCondition(url, title, condition));
        }
    }

    /**
     * Check if a URL/title matches a single condition
     * Supports negate flag (NOT operator)
     */
    static matchesCondition(url: string, title: string, condition: FlowCondition): boolean {
        let result = false;

        try {
            const parsedUrl = new URL(url);
            const testValue = condition.caseSensitive ? condition.value : condition.value.toLowerCase();

            switch (condition.type) {
                case 'url_contains': {
                    const testUrl = condition.caseSensitive ? url : url.toLowerCase();
                    result = testUrl.includes(testValue);
                    break;
                }

                case 'url_starts_with': {
                    const testUrl = condition.caseSensitive ? url : url.toLowerCase();
                    result = testUrl.startsWith(testValue);
                    break;
                }

                case 'url_matches_regex': {
                    try {
                        const flags = condition.caseSensitive ? '' : 'i';
                        const regex = new RegExp(condition.value, flags);
                        result = regex.test(url);
                    } catch {
                        console.warn('[BlueTab][FlowService] Invalid regex:', condition.value);
                        result = false;
                    }
                    break;
                }

                case 'domain_equals': {
                    const domain = parsedUrl.hostname.toLowerCase();
                    const testDomain = testValue.toLowerCase();
                    // Handle www prefix
                    const normalizedDomain = domain.replace(/^www\./, '');
                    const normalizedTest = testDomain.replace(/^www\./, '');
                    result = normalizedDomain === normalizedTest;
                    break;
                }

                case 'domain_contains': {
                    // Secure domain matching:
                    // - "youtube.com" matches: youtube.com, www.youtube.com, m.youtube.com
                    // - "youtube.com" does NOT match: fakeyoutube.com, youtube.malicious.com
                    const domain = parsedUrl.hostname.toLowerCase();
                    const searchDomain = testValue.toLowerCase().replace(/^www\./, '');

                    // Domain must either:
                    // 1. Equal the search domain exactly (youtube.com === youtube.com)
                    // 2. End with .searchDomain (m.youtube.com ends with .youtube.com)
                    const normalizedDomain = domain.replace(/^www\./, '');
                    result = normalizedDomain === searchDomain ||
                             normalizedDomain.endsWith('.' + searchDomain);
                    break;
                }

                case 'path_contains': {
                    const path = condition.caseSensitive ? parsedUrl.pathname : parsedUrl.pathname.toLowerCase();
                    result = path.includes(testValue);
                    break;
                }

                case 'title_contains': {
                    const testTitle = condition.caseSensitive ? title : title.toLowerCase();
                    result = testTitle.includes(testValue);
                    break;
                }

                case 'title_matches_regex': {
                    try {
                        const flags = condition.caseSensitive ? '' : 'i';
                        const regex = new RegExp(condition.value, flags);
                        result = regex.test(title);
                    } catch {
                        console.warn('[BlueTab][FlowService] Invalid regex:', condition.value);
                        result = false;
                    }
                    break;
                }

                default:
                    console.warn('[BlueTab][FlowService] Unknown condition type:', condition.type);
                    result = false;
            }
        } catch (error) {
            // Invalid URL
            console.warn('[BlueTab][FlowService] Invalid URL:', url);
            result = false;
        }

        // Apply negate (NOT) operator
        return condition.negate ? !result : result;
    }

    /**
     * Test a URL against all rules (for UI preview)
     */
    static async testUrl(url: string, title: string = ''): Promise<{
        success: boolean;
        matchedRule?: FlowRule;
        wouldCreateGroup?: string;
        wouldAddToGroup?: string;
        error?: string;
    }> {
        try {
            const rules = await FlowStorageService.getEnabledRules();
            const matchedRule = rules.find(rule => this.matchesRule(url, rule, title));

            if (!matchedRule) {
                return { success: true };
            }

            const result: {
                success: boolean;
                matchedRule?: FlowRule;
                wouldCreateGroup?: string;
                wouldAddToGroup?: string;
            } = {
                success: true,
                matchedRule
            };

            // Determine what would happen
            const { action } = matchedRule;
            if (action.type === 'create_group') {
                result.wouldCreateGroup = action.newGroupName || matchedRule.name;
            } else if (action.type === 'add_to_existing_group' && action.targetGroupId) {
                const groups = await Storage.get<TabGroup[]>('groups') || [];
                const targetGroup = groups.find(g => g.id === action.targetGroupId);
                if (targetGroup) {
                    result.wouldAddToGroup = targetGroup.name;
                }
            } else if (action.type === 'add_to_or_create') {
                const groupName = action.newGroupName || matchedRule.name;
                const groups = await Storage.get<TabGroup[]>('groups') || [];
                const existingGroup = groups.find(g => g.name.toLowerCase() === groupName.toLowerCase());
                if (existingGroup) {
                    result.wouldAddToGroup = existingGroup.name;
                } else {
                    result.wouldCreateGroup = groupName;
                }
            }

            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Test failed'
            };
        }
    }

    /**
     * Get matching rule for a URL (first match by priority)
     */
    static async getMatchingRule(url: string, title: string = ''): Promise<FlowRule | null> {
        const rules = await FlowStorageService.getEnabledRules();
        return rules.find(rule => this.matchesRule(url, rule, title)) || null;
    }

    /**
     * Validate a condition value (for UI validation)
     */
    static validateCondition(condition: FlowCondition): { valid: boolean; error?: string } {
        if (!condition.value || condition.value.trim() === '') {
            return { valid: false, error: 'Value cannot be empty' };
        }

        if (condition.type === 'url_matches_regex' || condition.type === 'title_matches_regex') {
            try {
                new RegExp(condition.value);
            } catch {
                return { valid: false, error: 'Invalid regular expression' };
            }
        }

        if (condition.type === 'domain_equals' || condition.type === 'domain_contains') {
            // Basic domain validation
            const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-_.]*[a-zA-Z0-9]$/;
            if (!domainRegex.test(condition.value.replace(/^www\./, ''))) {
                return { valid: false, error: 'Invalid domain format' };
            }
        }

        return { valid: true };
    }
}
