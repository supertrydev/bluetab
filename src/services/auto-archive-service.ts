/**
 * @module services/auto-archive-service
 *
 * WHY:  Saved groups pile up. With the opt-in "auto-archive" setting, groups
 *       nobody touched for N days (3, 7, 14 or 30; default 7) move to the
 *       Archive on their own, so the
 *       list stays short without the user doing a cleanup pass.
 *
 * WHAT: - recordGroupActivity(): marks a group as used (open / restore).
 *       - selectInactiveGroups(): pure selection, easy to test.
 *       - runAutoArchive(): called by the service-worker alarm; archives the
 *         selected groups and removes them from the saved list.
 *
 * HOW:  "Last activity" is the newest of created, modified (edits, renames,
 *       tab changes), lastAccessed (archive restore) and the local activity
 *       map below (opening or restoring a group). Activity lives in its own
 *       local-only key instead of on TabGroup, so a stale UI copy of `groups`
 *       cannot overwrite it and opening a group does not create sync traffic.
 *       The window starts no earlier than the moment the setting was
 *       turned on, so enabling it never archives everything at once.
 *
 * NOT:  Never touches locked or pinned groups. Archived groups can be
 *       restored from the Archive page as usual.
 */

import type { Settings, TabGroup } from '@/types/models';
import { ArchiveService } from '@/services/archive-service';
import { Storage } from '@/utils/storage';
import { GROUP_ACTIVITY_KEY, type GroupActivityMap } from '@/utils/group-activity';

export { GROUP_ACTIVITY_KEY, recordGroupActivity, type GroupActivityMap } from '@/utils/group-activity';

import { AUTO_ARCHIVE_DEFAULT_DAYS, resolveAutoArchiveDays } from '@/config/auto-archive';

export { AUTO_ARCHIVE_DAY_OPTIONS, AUTO_ARCHIVE_DEFAULT_DAYS, resolveAutoArchiveDays } from '@/config/auto-archive';

const DAY_MS = 24 * 60 * 60 * 1000;

export function getAutoArchiveReason(days: number): string {
    return `Auto-archived after ${days} days without activity`;
}

export function getLastGroupActivity(group: TabGroup, activity: GroupActivityMap): number {
    return Math.max(
        group.created || 0,
        group.modified || 0,
        group.lastAccessed || 0,
        activity[group.id] || 0,
    );
}

export function selectInactiveGroups(
    groups: TabGroup[],
    activity: GroupActivityMap,
    now: number,
    enabledAt: number = 0,
    days: number = AUTO_ARCHIVE_DEFAULT_DAYS,
): TabGroup[] {
    const inactiveMs = resolveAutoArchiveDays(days) * DAY_MS;
    return groups.filter((group) => {
        if (group.locked || group.isPinned) return false;
        const lastActivity = Math.max(getLastGroupActivity(group, activity), enabledAt);
        return now - lastActivity >= inactiveMs;
    });
}

export interface AutoArchiveResult {
    archivedCount: number;
    archivedNames: string[];
    failedCount: number;
}

export async function runAutoArchive(now: number = Date.now()): Promise<AutoArchiveResult> {
    const empty: AutoArchiveResult = { archivedCount: 0, archivedNames: [], failedCount: 0 };
    const settings = await Storage.get<Settings>('settings');
    if (settings?.autoArchiveInactiveGroups !== true) return empty;

    const [groups, activity] = await Promise.all([
        Storage.get<TabGroup[]>('groups'),
        Storage.get<GroupActivityMap>(GROUP_ACTIVITY_KEY),
    ]);
    const days = resolveAutoArchiveDays(settings.autoArchiveInactiveDays);
    const candidates = selectInactiveGroups(
        groups ?? [],
        activity ?? {},
        now,
        settings.autoArchiveEnabledAt ?? 0,
        days,
    );
    if (candidates.length === 0) return empty;

    const archivedIds = new Set<string>();
    const archivedNames: string[] = [];
    let failedCount = 0;

    for (const group of candidates) {
        const result = await ArchiveService.createArchive(group, {
            groupId: group.id,
            reason: getAutoArchiveReason(days),
        });
        if (result.success) {
            archivedIds.add(group.id);
            archivedNames.push(group.name);
        } else {
            failedCount += 1;
            console.warn('[BlueTab][AutoArchive] Failed to archive group', group.id, result.error);
        }
    }

    if (archivedIds.size > 0) {
        // Re-read right before writing so changes made while archiving survive.
        const latestGroups = (await Storage.get<TabGroup[]>('groups')) ?? [];
        await Storage.set('groups', latestGroups.filter((group) => !archivedIds.has(group.id)));

        const latestActivity = (await Storage.get<GroupActivityMap>(GROUP_ACTIVITY_KEY)) ?? {};
        for (const id of archivedIds) delete latestActivity[id];
        await Storage.set(GROUP_ACTIVITY_KEY, latestActivity);
    }

    return { archivedCount: archivedIds.size, archivedNames, failedCount };
}
