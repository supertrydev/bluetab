/**
 * @module utils/group-activity
 *
 * WHY:  Auto-archive needs to know when a saved group was last opened or
 *       restored. Normal restores do not update any TabGroup timestamp, and
 *       writing one into `groups` from a UI page risks being overwritten by
 *       that page's stale copy (and adds sync traffic).
 *
 * WHAT: A local-only map of groupId -> last open/restore time, kept under its
 *       own storage key. Not part of SYNCABLE_KEYS.
 */

import { Storage } from '@/utils/storage';

export const GROUP_ACTIVITY_KEY = 'group_activity';

export type GroupActivityMap = Record<string, number>;

export async function recordGroupActivity(groupId: string, now: number = Date.now()): Promise<void> {
    if (!groupId) return;
    try {
        const activity = (await Storage.get<GroupActivityMap>(GROUP_ACTIVITY_KEY)) ?? {};
        activity[groupId] = now;
        await Storage.set(GROUP_ACTIVITY_KEY, activity);
    } catch (error) {
        // Activity tracking must never break a restore.
        console.warn('[BlueTab][GroupActivity] Failed to record group activity', error);
    }
}
