import { Storage } from './storage';
import { normalizeUrl } from './normalize';
import type {
    NotionMirrorState,
    TabGroup,
    RememberedGroup,
    RememberedTab,
    RememberedIntegrationState,
} from '../types/models';

// Local type for integration settings structure
interface IntegrationSettings {
    auto_sync_groups?: Array<{
        groupId: string;
        integrationId: string;
        accountId: string;
        targetId: string;
        mirrorVerb?: string;
        notionState?: NotionMirrorState;
    }>;
}

/**
 * Group Memory Storage Service
 * Manages remembered groups for automatic group restoration
 * when a tab from a previously removed group is saved again
 */

interface GroupMemoryData {
    groups: Record<string, RememberedGroup>;  // groupId -> RememberedGroup
    urlIndex: Record<string, string>;         // normalizedUrl -> groupId (for fast lookup)
}

const MEMORY_KEY = 'groupMemory';

export class GroupMemoryStorageService {
    /**
     * Get all remembered groups and URL index
     */
    static async getMemory(): Promise<GroupMemoryData> {
        const data = await Storage.get<GroupMemoryData>(MEMORY_KEY);
        return data || { groups: {}, urlIndex: {} };
    }

    /**
     * Capture integration states for a group before it goes to memory
     */
    private static async captureIntegrationState(groupId: string): Promise<RememberedIntegrationState | undefined> {
        const state: RememberedIntegrationState = {};

        // Check Slack mirror state
        const slackMirrorKey = `slack_mirror:${groupId}`;
        const slackMirror = await Storage.get<{ channel: string; ts: string; accountId: string } | null>(slackMirrorKey);
        if (slackMirror) {
            state.slackMirror = slackMirror;
        }

        // Check Linear sync state (format: { groups: Record<groupId, LinearSyncGroup> })
        const linearSyncData = await Storage.get<{ groups: Record<string, { accountId: string; teamId: string; issueCount: number; isAutoSync: boolean }> }>('linear_sync_data');
        const linearGroup = linearSyncData?.groups?.[groupId];
        if (linearGroup) {
            state.linearSync = {
                accountId: linearGroup.accountId,
                teamId: linearGroup.teamId,
                issueCount: linearGroup.issueCount,
                isAutoSync: linearGroup.isAutoSync,
            };
        }

        // Check Todoist sync state (format: { groups: Record<groupId, TodoistSyncGroup> })
        const todoistSyncData = await Storage.get<{ groups: Record<string, { accountId: string; projectId: string; taskCount: number; isAutoSync: boolean }> }>('todoist_sync_data');
        const todoistGroup = todoistSyncData?.groups?.[groupId];
        if (todoistGroup) {
            state.todoistSync = {
                accountId: todoistGroup.accountId,
                projectId: todoistGroup.projectId,
                taskCount: todoistGroup.taskCount,
                isAutoSync: todoistGroup.isAutoSync,
            };
        }

        // Check auto_sync_groups (Notion and others)
        const integrationSettings = await Storage.get<IntegrationSettings>('integration_settings');
        const groupAutoSync = integrationSettings?.auto_sync_groups?.filter(
            (entry: { groupId: string }) => entry.groupId === groupId,
        ) ?? [];
        const autoSync = groupAutoSync.find((entry) => entry.integrationId === 'notion')
            ?? groupAutoSync[0];
        if (autoSync) {
            state.autoSync = {
                integrationId: autoSync.integrationId,
                accountId: autoSync.accountId,
                targetId: autoSync.targetId,
                mirrorVerb: autoSync.mirrorVerb,
                notionState: autoSync.notionState
                    ? structuredClone(autoSync.notionState)
                    : undefined,
            };
        }

        // Only return if we found any integration state
        if (Object.keys(state).length > 0) {
            return state;
        }
        return undefined;
    }

    /**
     * Remember a group (called when group is restored/removed with removeFromList)
     * Stores group properties and creates URL index for fast lookup
     */
    static async rememberGroup(group: TabGroup): Promise<void> {
        const memory = await this.getMemory();

        // Convert TabItems to RememberedTabs
        const rememberedTabs: RememberedTab[] = group.tabs.map(tab => ({
            url: normalizeUrl(tab.url),
            title: tab.title,
            favicon: tab.favicon,
            originalId: tab.id
        }));

        // Capture integration states before the group goes to memory
        const integrationState = await this.captureIntegrationState(group.id);

        // Create remembered group
        const rememberedGroup: RememberedGroup = {
            id: group.id,
            name: group.name,
            color: group.color,
            tags: group.tags,
            isPinned: group.isPinned,
            pinnedAt: group.pinnedAt,
            projectId: group.projectId,
            notes: group.notes,
            tabs: rememberedTabs,
            created: group.created,
            rememberedAt: Date.now(),
            integrationState,
        };

        // Add to groups
        memory.groups[group.id] = rememberedGroup;

        // Update URL index - map each tab URL to this group
        for (const tab of rememberedTabs) {
            // If URL already exists in index, update to the newer group
            memory.urlIndex[tab.url] = group.id;
        }

        await Storage.set(MEMORY_KEY, memory);
        console.log(`[BlueTab][Memory] Remembered group "${group.name}" with ${rememberedTabs.length} URLs` + (integrationState ? ' (with integration state)' : ''));
    }

    /**
     * Reconcile remembered groups after an explicit, permanent tab move/removal.
     * Temporary removeFromList clicks must not call this method: they intentionally
     * retain the pre-click logical membership in Group Memory.
     */
    static async reconcilePermanentGroupChanges(
        updatedGroups: TabGroup[],
        affectedGroupIds: Iterable<string>,
    ): Promise<void> {
        const groupIds = [...new Set(affectedGroupIds)];
        if (groupIds.length === 0) return;

        const updatedById = new Map(updatedGroups.map((group) => [group.id, group]));
        await Storage.atomicUpdate<GroupMemoryData>(MEMORY_KEY, async (current) => {
            const memory = current || { groups: {}, urlIndex: {} };

            for (const groupId of groupIds) {
                const existing = memory.groups[groupId];
                if (!existing) continue;

                for (const [url, indexedGroupId] of Object.entries(memory.urlIndex)) {
                    if (indexedGroupId === groupId) {
                        delete memory.urlIndex[url];
                    }
                }

                const updatedGroup = updatedById.get(groupId);
                if (!updatedGroup) {
                    delete memory.groups[groupId];
                    continue;
                }

                const rememberedTabs: RememberedTab[] = updatedGroup.tabs.map((tab) => ({
                    url: normalizeUrl(tab.url),
                    title: tab.title,
                    favicon: tab.favicon,
                    originalId: tab.id,
                }));
                const integrationState = await this.captureIntegrationState(groupId)
                    ?? existing.integrationState;

                memory.groups[groupId] = {
                    id: updatedGroup.id,
                    name: updatedGroup.name,
                    color: updatedGroup.color,
                    tags: updatedGroup.tags,
                    isPinned: updatedGroup.isPinned,
                    pinnedAt: updatedGroup.pinnedAt,
                    projectId: updatedGroup.projectId,
                    notes: updatedGroup.notes,
                    tabs: rememberedTabs,
                    created: updatedGroup.created,
                    rememberedAt: existing.rememberedAt,
                    integrationState,
                };

                for (const tab of rememberedTabs) {
                    memory.urlIndex[tab.url] = groupId;
                }
            }

            return memory;
        }, { groups: {}, urlIndex: {} });
    }

    /**
     * Restore integration states when a group is restored from memory
     */
    static async restoreIntegrationState(groupId: string, state: RememberedIntegrationState | undefined): Promise<void> {
        if (!state) return;

        // Restore Slack mirror state
        if (state.slackMirror) {
            const slackMirrorKey = `slack_mirror:${groupId}`;
            await Storage.set(slackMirrorKey, state.slackMirror);
            console.log(`[BlueTab][Memory] Restored Slack mirror state for group "${groupId}"`);
        }

        // Restore Linear sync state (format: { groups: Record<groupId, LinearSyncGroup> })
        if (state.linearSync) {
            const linearSyncData = await Storage.get<{ groups: Record<string, { accountId: string; teamId: string; issueCount: number; isAutoSync: boolean }> }>('linear_sync_data') || { groups: {} };
            if (!linearSyncData.groups) {
                linearSyncData.groups = {};
            }
            linearSyncData.groups[groupId] = {
                accountId: state.linearSync.accountId,
                teamId: state.linearSync.teamId,
                issueCount: state.linearSync.issueCount,
                isAutoSync: state.linearSync.isAutoSync,
            };
            await Storage.set('linear_sync_data', linearSyncData);
            console.log(`[BlueTab][Memory] Restored Linear sync state for group "${groupId}"`);
        }

        // Restore Todoist sync state (format: { groups: Record<groupId, TodoistSyncGroup> })
        if (state.todoistSync) {
            const todoistSyncData = await Storage.get<{ groups: Record<string, { accountId: string; projectId: string; taskCount: number; isAutoSync: boolean }> }>('todoist_sync_data') || { groups: {} };
            if (!todoistSyncData.groups) {
                todoistSyncData.groups = {};
            }
            todoistSyncData.groups[groupId] = {
                accountId: state.todoistSync.accountId,
                projectId: state.todoistSync.projectId,
                taskCount: state.todoistSync.taskCount,
                isAutoSync: state.todoistSync.isAutoSync,
            };
            await Storage.set('todoist_sync_data', todoistSyncData);
            console.log(`[BlueTab][Memory] Restored Todoist sync state for group "${groupId}"`);
        }

        // Restore auto_sync_groups (Notion and others)
        if (state.autoSync) {
            const integrationSettings = await Storage.get<IntegrationSettings>('integration_settings') || { auto_sync_groups: [] };
            const existingIndex = integrationSettings.auto_sync_groups?.findIndex((entry) => (
                entry.groupId === groupId
                && entry.integrationId === state.autoSync?.integrationId
            )) ?? -1;
            const autoSyncEntry = {
                groupId,
                integrationId: state.autoSync.integrationId,
                accountId: state.autoSync.accountId,
                targetId: state.autoSync.targetId,
                mirrorVerb: state.autoSync.mirrorVerb,
                notionState: state.autoSync.notionState
                    ? structuredClone(state.autoSync.notionState)
                    : undefined,
            };
            if (!integrationSettings.auto_sync_groups) {
                integrationSettings.auto_sync_groups = [];
            }
            if (existingIndex >= 0) {
                integrationSettings.auto_sync_groups[existingIndex] = autoSyncEntry;
            } else {
                integrationSettings.auto_sync_groups.push(autoSyncEntry);
            }
            await Storage.set('integration_settings', integrationSettings);
            console.log(`[BlueTab][Memory] Restored auto-sync state for group "${groupId}" (${state.autoSync.integrationId})`);
        }
    }

    /**
     * Forget a group (called when user manually deletes a group)
     * Removes group and its URL mappings from memory AND cleans up integration states
     */
    static async forgetGroup(groupId: string): Promise<void> {
        const memory = await this.getMemory();

        const group = memory.groups[groupId];
        if (!group) {
            return; // Group not in memory, nothing to do
        }

        // Remove URL index entries for this group
        for (const tab of group.tabs) {
            if (memory.urlIndex[tab.url] === groupId) {
                delete memory.urlIndex[tab.url];
            }
        }

        // Remove the group
        delete memory.groups[groupId];

        await Storage.set(MEMORY_KEY, memory);

        // Clean up integration states (this is permanent delete, not memory restore)
        // Note: Integration states are NOT restored when permanently deleting
        // The integration cleanup happens via the integration's stop verbs
        console.log(`[BlueTab][Memory] Forgot group "${group.name}" (integration states preserved until stop-mirroring is called)`);
    }

    /**
     * Find a remembered group by URL
     * Returns the group if URL matches any tab in remembered groups
     */
    static async findGroupByUrl(url: string): Promise<RememberedGroup | null> {
        const normalizedUrl = normalizeUrl(url);
        const memory = await this.getMemory();

        const groupId = memory.urlIndex[normalizedUrl];
        if (!groupId) {
            return null;
        }

        const group = memory.groups[groupId];
        if (!group) {
            // Orphaned index entry, clean it up
            delete memory.urlIndex[normalizedUrl];
            await Storage.set(MEMORY_KEY, memory);
            return null;
        }

        return group;
    }

    /**
     * Partition a batch of tabs into buckets by remembered group.
     * Each tab whose normalized URL is in urlIndex is placed in the bucket
     * for its remembered group. Tabs with no memory match land in remainingTabs.
     * Orphaned urlIndex entries (pointing at deleted groups) are swept.
     */
    static async partitionTabsByMemory<T extends { url: string }>(
        tabs: T[]
    ): Promise<{
        buckets: Map<string, { group: RememberedGroup; tabs: T[] }>;
        remainingTabs: T[];
    }> {
        const buckets = new Map<string, { group: RememberedGroup; tabs: T[] }>();
        const remainingTabs: T[] = [];
        if (tabs.length === 0) return { buckets, remainingTabs };

        const memory = await this.getMemory();
        const orphanedUrls: string[] = [];

        for (const tab of tabs) {
            const normalizedUrl = normalizeUrl(tab.url);
            const groupId = memory.urlIndex[normalizedUrl];
            if (!groupId) {
                remainingTabs.push(tab);
                continue;
            }
            const group = memory.groups[groupId];
            if (!group) {
                orphanedUrls.push(normalizedUrl);
                remainingTabs.push(tab);
                continue;
            }
            let bucket = buckets.get(groupId);
            if (!bucket) {
                bucket = { group, tabs: [] };
                buckets.set(groupId, bucket);
            }
            bucket.tabs.push(tab);
        }

        if (orphanedUrls.length > 0) {
            for (const url of orphanedUrls) delete memory.urlIndex[url];
            await Storage.set(MEMORY_KEY, memory);
        }

        return { buckets, remainingTabs };
    }

    /**
     * Check if a group is remembered
     */
    static async isGroupRemembered(groupId: string): Promise<boolean> {
        const memory = await this.getMemory();
        return !!memory.groups[groupId];
    }

    /**
     * Get all remembered groups (for debugging/UI)
     */
    static async getAllRememberedGroups(): Promise<RememberedGroup[]> {
        const memory = await this.getMemory();
        return Object.values(memory.groups);
    }

    /**
     * Clear all memory (for settings/debugging)
     */
    static async clearAllMemory(): Promise<void> {
        await Storage.set(MEMORY_KEY, { groups: {}, urlIndex: {} });
        console.log('[BlueTab][Memory] Cleared all group memory');
    }

    /**
     * Get memory statistics
     */
    static async getStats(): Promise<{
        groupCount: number;
        urlCount: number;
        oldestGroup?: Date;
        newestGroup?: Date;
    }> {
        const memory = await this.getMemory();
        const groups = Object.values(memory.groups);

        if (groups.length === 0) {
            return { groupCount: 0, urlCount: 0 };
        }

        const timestamps = groups.map(g => g.rememberedAt);
        return {
            groupCount: groups.length,
            urlCount: Object.keys(memory.urlIndex).length,
            oldestGroup: new Date(Math.min(...timestamps)),
            newestGroup: new Date(Math.max(...timestamps))
        };
    }
}
