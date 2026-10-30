/**
 * Simple Collapsed State Management
 * Replaces the complex persistent-state system
 */

import { Storage } from './storage';

const STORAGE_KEY = 'collapsedGroups';
const LEGACY_PERSISTENT_KEY = 'persistentGroupState';

export interface CollapsedState {
    [groupId: string]: boolean;
}

/**
 * Migrate from old persistent state format if needed
 */
export async function migrateFromPersistentState(): Promise<void> {
    try {
        // Check if migration already done
        const existing = await Storage.get<CollapsedState>(STORAGE_KEY);
        if (existing && Object.keys(existing).length > 0) {
            return; // Already migrated
        }

        // Try to load old persistent state
        const persistentState = await Storage.get<any>(LEGACY_PERSISTENT_KEY);
        if (persistentState?.states) {
            const collapsed: CollapsedState = {};
            for (const [groupId, entry] of Object.entries(persistentState.states)) {
                collapsed[groupId] = (entry as any).collapsed;
            }
            await Storage.set(STORAGE_KEY, collapsed);
            console.log('Migrated collapsed state from persistent format');
        }
    } catch (error) {
        console.error('Migration failed (non-critical):', error);
    }
}

/**
 * Load all collapsed states
 */
export async function loadCollapsedStates(): Promise<Map<string, boolean>> {
    try {
        const data = await Storage.get<CollapsedState>(STORAGE_KEY);
        return new Map(Object.entries(data || {}));
    } catch (error) {
        console.error('Failed to load collapsed states:', error);
        return new Map();
    }
}

/**
 * Save a single group's collapsed state
 */
export async function saveGroupState(groupId: string, collapsed: boolean): Promise<void> {
    try {
        const current = await Storage.get<CollapsedState>(STORAGE_KEY) || {};
        current[groupId] = collapsed;
        await Storage.set(STORAGE_KEY, current);
    } catch (error) {
        console.error('Failed to save group state:', error);
        throw new Error('Failed to save group state');
    }
}

/**
 * Save multiple group states at once
 */
export async function saveMultipleStates(states: Map<string, boolean>): Promise<void> {
    try {
        const current = await Storage.get<CollapsedState>(STORAGE_KEY) || {};
        for (const [groupId, collapsed] of states) {
            current[groupId] = collapsed;
        }
        await Storage.set(STORAGE_KEY, current);
    } catch (error) {
        console.error('Failed to save multiple states:', error);
        throw new Error('Failed to save group states');
    }
}

/**
 * Remove a group's state (when group is deleted)
 */
export async function removeGroupState(groupId: string): Promise<void> {
    try {
        const current = await Storage.get<CollapsedState>(STORAGE_KEY) || {};
        delete current[groupId];
        await Storage.set(STORAGE_KEY, current);
    } catch (error) {
        console.error('Failed to remove group state:', error);
    }
}

/**
 * Clean up orphaned states for deleted groups
 */
export async function cleanupOrphanedStates(validGroupIds: Set<string>): Promise<void> {
    try {
        const current = await Storage.get<CollapsedState>(STORAGE_KEY) || {};
        const orphanedIds = Object.keys(current).filter(id => !validGroupIds.has(id));

        if (orphanedIds.length > 0) {
            for (const id of orphanedIds) {
                delete current[id];
            }
            await Storage.set(STORAGE_KEY, current);
            console.log(`Cleaned up ${orphanedIds.length} orphaned states`);
        }
    } catch (error) {
        console.error('Failed to cleanup orphaned states:', error);
    }
}
