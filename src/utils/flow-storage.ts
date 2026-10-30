/**
 * FlowStorageService
 *
 * WHY: Manage Flow rules persistence in chrome.storage.local
 * WHAT: CRUD operations for FlowSettings and FlowRules
 * HOW: Uses Storage utility class, follows ArchiveStorageService pattern
 */

import {
    FlowSettings,
    FlowRule,
    FlowTemplate,
    getDefaultFlowSettings
} from '../types/flow';
import { Storage } from './storage';

export interface FlowOperationResult {
    success: boolean;
    error?: string;
}

export interface FlowRuleCreateResult extends FlowOperationResult {
    ruleId?: string;
    rule?: FlowRule;
}

export interface FlowTemplateImportResult extends FlowOperationResult {
    rulesCreated: number;
    ruleIds: string[];
}

export class FlowStorageService {
    private static readonly STORAGE_KEY = 'flowSettings';

    /**
     * Get current Flow settings
     */
    static async getFlowSettings(): Promise<FlowSettings> {
        try {
            const settings = await Storage.get<FlowSettings>(this.STORAGE_KEY);
            if (!settings) {
                return getDefaultFlowSettings();
            }
            // Ensure all fields exist (migration support)
            return {
                ...getDefaultFlowSettings(),
                ...settings
            };
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to get settings:', error);
            return getDefaultFlowSettings();
        }
    }

    /**
     * Save Flow settings
     */
    static async setFlowSettings(settings: FlowSettings): Promise<FlowOperationResult> {
        try {
            await Storage.set(this.STORAGE_KEY, settings);
            return { success: true };
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to save settings:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to save settings'
            };
        }
    }

    /**
     * Get all Flow rules
     */
    static async getRules(): Promise<FlowRule[]> {
        const settings = await this.getFlowSettings();
        return settings.rules;
    }

    /**
     * Get enabled Flow rules, sorted by priority
     */
    static async getEnabledRules(): Promise<FlowRule[]> {
        const rules = await this.getRules();
        return rules
            .filter(rule => rule.enabled)
            .sort((a, b) => a.priority - b.priority);
    }

    /**
     * Get a single rule by ID
     */
    static async getRule(ruleId: string): Promise<FlowRule | null> {
        const rules = await this.getRules();
        return rules.find(rule => rule.id === ruleId) || null;
    }

    /**
     * Create a new Flow rule
     */
    static async createRule(
        ruleData: Omit<FlowRule, 'id' | 'created' | 'modified'>
    ): Promise<FlowRuleCreateResult> {
        try {
            const settings = await this.getFlowSettings();
            const now = Date.now();

            const newRule: FlowRule = {
                ...ruleData,
                id: crypto.randomUUID(),
                created: now,
                modified: now,
                triggerCount: 0
            };

            settings.rules.push(newRule);
            await this.setFlowSettings(settings);

            return { success: true, ruleId: newRule.id, rule: newRule };
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to create rule:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to create rule'
            };
        }
    }

    /**
     * Update an existing Flow rule
     */
    static async updateRule(
        ruleId: string,
        updates: Partial<Omit<FlowRule, 'id' | 'created'>>
    ): Promise<FlowOperationResult> {
        try {
            const settings = await this.getFlowSettings();
            const ruleIndex = settings.rules.findIndex(rule => rule.id === ruleId);

            if (ruleIndex === -1) {
                return { success: false, error: 'Rule not found' };
            }

            settings.rules[ruleIndex] = {
                ...settings.rules[ruleIndex],
                ...updates,
                modified: Date.now()
            };

            await this.setFlowSettings(settings);
            return { success: true };
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to update rule:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to update rule'
            };
        }
    }

    /**
     * Delete a Flow rule
     */
    static async deleteRule(ruleId: string): Promise<FlowOperationResult> {
        try {
            const settings = await this.getFlowSettings();
            const initialLength = settings.rules.length;

            settings.rules = settings.rules.filter(rule => rule.id !== ruleId);

            if (settings.rules.length === initialLength) {
                return { success: false, error: 'Rule not found' };
            }

            await this.setFlowSettings(settings);
            return { success: true };
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to delete rule:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete rule'
            };
        }
    }

    /**
     * Toggle rule enabled state
     */
    static async toggleRule(ruleId: string, enabled: boolean): Promise<FlowOperationResult> {
        return this.updateRule(ruleId, { enabled });
    }

    /**
     * Reorder rules by setting priorities
     */
    static async reorderRules(ruleIds: string[]): Promise<FlowOperationResult> {
        try {
            const settings = await this.getFlowSettings();

            // Update priorities based on new order
            ruleIds.forEach((ruleId, index) => {
                const rule = settings.rules.find(r => r.id === ruleId);
                if (rule) {
                    rule.priority = index;
                    rule.modified = Date.now();
                }
            });

            // Sort by priority
            settings.rules.sort((a, b) => a.priority - b.priority);

            await this.setFlowSettings(settings);
            return { success: true };
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to reorder rules:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to reorder rules'
            };
        }
    }

    /**
     * Import rules from a template
     */
    static async importTemplate(template: FlowTemplate): Promise<FlowTemplateImportResult> {
        try {
            const settings = await this.getFlowSettings();
            const now = Date.now();
            const ruleIds: string[] = [];

            // Get highest current priority
            const maxPriority = settings.rules.length > 0
                ? Math.max(...settings.rules.map(r => r.priority))
                : -1;

            template.rules.forEach((ruleData, index) => {
                const newRule: FlowRule = {
                    ...ruleData,
                    id: crypto.randomUUID(),
                    created: now,
                    modified: now,
                    isTemplate: true,
                    templateId: template.id,
                    priority: maxPriority + 1 + index,
                    triggerCount: 0
                };
                settings.rules.push(newRule);
                ruleIds.push(newRule.id);
            });

            await this.setFlowSettings(settings);

            return {
                success: true,
                rulesCreated: template.rules.length,
                ruleIds
            };
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to import template:', error);
            return {
                success: false,
                rulesCreated: 0,
                ruleIds: [],
                error: error instanceof Error ? error.message : 'Failed to import template'
            };
        }
    }

    /**
     * Check if a template is already imported
     */
    static async isTemplateImported(templateId: string): Promise<boolean> {
        const rules = await this.getRules();
        return rules.some(rule => rule.templateId === templateId);
    }

    /**
     * Remove all rules from a template
     */
    static async removeTemplateRules(templateId: string): Promise<FlowOperationResult> {
        try {
            const settings = await this.getFlowSettings();
            settings.rules = settings.rules.filter(rule => rule.templateId !== templateId);
            await this.setFlowSettings(settings);
            return { success: true };
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to remove template rules:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to remove template rules'
            };
        }
    }

    /**
     * Toggle Flow master switch
     */
    static async toggleFlow(enabled: boolean): Promise<FlowOperationResult> {
        try {
            const settings = await this.getFlowSettings();
            settings.enabled = enabled;
            await this.setFlowSettings(settings);
            return { success: true };
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to toggle Flow:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to toggle Flow'
            };
        }
    }

    /**
     * Update execution statistics
     */
    static async updateStats(processedCount: number): Promise<void> {
        try {
            const settings = await this.getFlowSettings();
            settings.executionCount += processedCount;
            settings.lastExecuted = Date.now();
            await this.setFlowSettings(settings);
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to update stats:', error);
        }
    }

    /**
     * Increment trigger count for a rule
     */
    static async incrementRuleTrigger(ruleId: string): Promise<void> {
        try {
            const settings = await this.getFlowSettings();
            const rule = settings.rules.find(r => r.id === ruleId);
            if (rule) {
                rule.triggerCount = (rule.triggerCount || 0) + 1;
                rule.lastTriggered = Date.now();
                await this.setFlowSettings(settings);
            }
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to increment trigger:', error);
        }
    }

    /**
     * Clear all Flow data
     */
    static async clearAll(): Promise<FlowOperationResult> {
        try {
            await Storage.remove(this.STORAGE_KEY);
            return { success: true };
        } catch (error) {
            console.error('[BlueTab][FlowStorage] Failed to clear all:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to clear Flow data'
            };
        }
    }
}
