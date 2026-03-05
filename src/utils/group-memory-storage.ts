import { Storage } from './storage';
import { normalizeUrl } from './normalize';
import type { TabGroup, RememberedGroup, RememberedTab } from '../types/models';

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

        // Create remembered group
        const rememberedGroup: RememberedGroup = {
            id: group.id,
            name: group.name,
            color: group.color,
            tags: group.tags,
            isPinned: group.isPinned,
            pinnedAt: group.pinnedAt,
            projectId: group.projectId,
            tabs: rememberedTabs,
            created: group.created,
            rememberedAt: Date.now()
        };

        // Add to groups
        memory.groups[group.id] = rememberedGroup;

        // Update URL index - map each tab URL to this group
        for (const tab of rememberedTabs) {
            // If URL already exists in index, update to the newer group
            memory.urlIndex[tab.url] = group.id;
        }

        await Storage.set(MEMORY_KEY, memory);
        console.log(`[BlueTab][Memory] Remembered group "${group.name}" with ${rememberedTabs.length} URLs`);
    }

    /**
     * Forget a group (called when user manually deletes a group)
     * Removes group and its URL mappings from memory
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
        console.log(`[BlueTab][Memory] Forgot group "${group.name}"`);
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
