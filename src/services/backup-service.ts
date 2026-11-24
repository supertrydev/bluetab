/**
 * @module services/backup-service
 *
 * WHY:  Users risk losing their entire browsing context if the browser crashes
 *       or they accidentally close windows. Automatic session backup captures
 *       all open windows, tabs, and native Chrome tab groups on a schedule,
 *       allowing full restoration. Without FIFO eviction, backup snapshots
 *       would exhaust the chrome.storage.local quota.
 *
 * WHAT: Static BackupService class managing automatic session backup lifecycle:
 *       capture browser state, restore from snapshots (as new windows or as
 *       Bluetab groups), manage backup scheduling, and FIFO eviction via
 *       RingBuffer(10).
 *
 * HOW:  - capture() queries all windows + tabs + tabGroups, builds BackupSnapshot
 *       - RingBuffer(10) evicts oldest snapshots when at capacity
 *       - Oversized snapshots (>50KB) get favicons stripped to save space
 *       - enable/disable/setFrequency manage the SESSION_BACKUP alarm
 *       - restore() supports 'window' (recreate full window + tab groups) and
 *         'group' (return data for caller to save as Bluetab group)
 *       - Frequency map: hourly=60, daily=1440, weekly=10080, monthly=43200 periodInMinutes
 *
 * NOT:  Does not render UI -- consumed by service-worker alarm handlers and
 *       settings page components. Does not handle the "Save as Bluetab group"
 *       logic directly (returns snapshot data for the caller to handle).
 */

import { createBrowserTabGroup } from '@/platform/create-browser-tab-group';
import { isBrowserInternalUrl } from '@/platform/extension-platform';
import { ALARM_NAMES } from '@/config/alarms';
import { RSSService } from '@/services/rss-service';
import { Storage } from '@/utils/storage';
import { ArchiveStorageService } from '@/utils/archive-storage';
import { RingBuffer } from '@/utils/ring-buffer';
import type {
  BackupSnapshot,
  BackupSavedData,
  BackupWindow,
  BackupTab,
  BackupTabGroup,
  BackupSettings,
} from '@/types/productivity';

const LOG_PREFIX = '[BlueTab][Backup]';
const MAX_SNAPSHOTS = 10;
/** Only the newest snapshots carry a full copy of saved data; older ones keep just the windows. */
export const MAX_SAVED_DATA_SNAPSHOTS = 3;
const OVERSIZED_THRESHOLD = 50 * 1024; // 50KB

const FREQUENCY_MAP: Record<BackupSettings['frequency'], number> = {
  hourly: 60,
  daily: 1440,
  weekly: 10080,
  monthly: 43200,
};

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { enabled: true, frequency: 'monthly' };

export class BackupService {
  private static readonly ringBuffer = new RingBuffer<BackupSnapshot>(MAX_SNAPSHOTS);

  /**
   * Capture saved groups, tags, projects, Brain Dump entries, encrypted archives,
   * and all normal browser windows with their tabs and native tab groups. Filters out chrome:// and chrome-extension:// URLs.
   * Strips favicons if the snapshot exceeds 50KB.
   * Uses RingBuffer(10) for FIFO eviction.
   */
  static async capture(): Promise<void> {
    const windows = await chrome.windows.getAll({ populate: true });
    const backupWindows: BackupWindow[] = [];

    for (const win of windows) {
      if (win.type !== 'normal') continue;

      const tabs: BackupTab[] = (win.tabs || [])
        .filter(
          (t: chrome.tabs.Tab) =>
            t.url &&
            !isBrowserInternalUrl(t.url),
        )
        .map((t: chrome.tabs.Tab) => ({
          url: t.url!,
          title: t.title || '',
          favicon: t.favIconUrl,
          pinned: t.pinned || false,
          groupId: t.groupId ?? -1,
          index: t.index,
        }));

      // Capture native tab groups for this window
      const groups = await chrome.tabGroups.query({ windowId: win.id });
      const tabGroups: BackupTabGroup[] = groups.map((g: chrome.tabGroups.TabGroup) => ({
        id: g.id,
        title: g.title,
        color: g.color,
        collapsed: g.collapsed,
      }));

      backupWindows.push({
        id: win.id!,
        focused: win.focused || false,
        tabs,
        tabGroups,
      });
    }

    // Copy the persisted representation. In particular, never decrypt archives.
    const [groups, tags, projects, brainDump, archives, rss] = await Promise.all([
      Storage.get<BackupSavedData['groups']>('groups'),
      Storage.get<BackupSavedData['tags']>('tags'),
      Storage.get<BackupSavedData['projects']>('projects'),
      Storage.get<BackupSavedData['brain_dump_inbox']>('brain_dump_inbox'),
      Storage.get<BackupSavedData['archivedGroups']>('archivedGroups'),
      // Feeds must never keep the rest from being backed up.
      RSSService.exportBackup().catch((): undefined => undefined),
    ]);
    const snapshot: BackupSnapshot = {
      savedData: { groups: groups || [], tags: tags || [], projects: projects || [], brain_dump_inbox: brainDump || [], archivedGroups: archives, rss },
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      windows: backupWindows,
      totalTabs: backupWindows.reduce((sum, w) => sum + w.tabs.length, 0),
      totalGroups: backupWindows.reduce((sum, w) => sum + w.tabGroups.length, 0),
      sizeBytes: 0,
    };

    // Calculate size and strip favicons if oversized
    let serialized = JSON.stringify(snapshot);
    snapshot.sizeBytes = serialized.length;

    if (snapshot.sizeBytes > OVERSIZED_THRESHOLD) {
      console.log(
        `${LOG_PREFIX} Snapshot ${snapshot.sizeBytes} bytes exceeds ${OVERSIZED_THRESHOLD}B threshold, stripping favicons`,
      );
      for (const win of snapshot.windows) {
        for (const tab of win.tabs) {
          tab.favicon = '';
        }
      }
      // Recalculate size after stripping
      serialized = JSON.stringify(snapshot);
      snapshot.sizeBytes = serialized.length;
    }

    const existing =
      (await Storage.get<BackupSnapshot[]>('sessionBackups')) || [];
    const updated = BackupService.ringBuffer.push(existing, snapshot).map((item, index, all) => {
      if (index >= all.length - MAX_SAVED_DATA_SNAPSHOTS || !item.savedData) return item;
      const { savedData: _savedData, ...windowsOnly } = item;
      return windowsOnly;
    });
    await Storage.set('sessionBackups', updated);

    console.log(
      `${LOG_PREFIX} Captured snapshot: ${snapshot.totalTabs} tabs, ${snapshot.totalGroups} groups, ${snapshot.sizeBytes} bytes`,
    );
  }

  /**
   * Restore a backup snapshot.
   *
   * @param snapshotId - The snapshot's UUID
   * @param mode - 'window' opens in new browser windows, 'group' returns snapshot data
   *               for the caller to save as a Bluetab TabGroup
   * @returns The snapshot when mode is 'group', undefined for 'window'
   */
  static async restore(
    snapshotId: string,
    mode: 'window' | 'group',
  ): Promise<BackupSnapshot | undefined> {
    const snapshots =
      (await Storage.get<BackupSnapshot[]>('sessionBackups')) || [];
    const snapshot = snapshots.find((s) => s.id === snapshotId);

    if (!snapshot) {
      console.warn(`${LOG_PREFIX} Snapshot ${snapshotId} not found`);
      return undefined;
    }

    if (snapshot.savedData) {
      // Recover snapshot records while preserving unrelated data saved since the backup.
      for (const key of ['groups', 'tags', 'projects', 'brain_dump_inbox'] as const) {
        const records = snapshot.savedData[key];
        await Storage.atomicUpdate<Array<{ id: string }>>(key, current => {
          const restoredIds = new Set(records.map(record => record.id));
          return [...records, ...(current || []).filter(record => !restoredIds.has(record.id))];
        }, []);
      }
      if (snapshot.savedData.rss) await RSSService.importBackup(snapshot.savedData.rss);
      const savedArchives = snapshot.savedData.archivedGroups;
      if (savedArchives) {
        await Storage.atomicUpdate<NonNullable<BackupSavedData['archivedGroups']>>('archivedGroups', current => {
          const archives = { ...current?.archives, ...savedArchives.archives };
          return {
            archives,
            metadata: {
              ...savedArchives.metadata,
              totalArchives: Object.keys(archives).length,
              totalSizeBytes: new TextEncoder().encode(JSON.stringify(archives)).length,
            },
          };
        });
        await ArchiveStorageService.rebuildSearchIndex();
      }
    }

    if (mode === 'group') {
      // Return the snapshot data for the caller to create a Bluetab group
      console.log(
        `${LOG_PREFIX} Returning snapshot "${snapshotId}" for group creation`,
      );
      return snapshot;
    }

    // mode === 'window': recreate windows with tabs and tab groups
    for (const win of snapshot.windows) {
      const newWindow = await chrome.windows.create({ focused: win.focused });
      const newWindowId = newWindow.id!;

      // Track mapping from old groupId -> new tab IDs
      const groupTabMap = new Map<number, number[]>();
      const tabIdMap: number[] = [];

      for (const tab of win.tabs) {
        const createdTab = await chrome.tabs.create({
          url: tab.url,
          pinned: tab.pinned,
          windowId: newWindowId,
        });

        tabIdMap.push(createdTab.id!);

        if (tab.groupId !== -1) {
          const existing = groupTabMap.get(tab.groupId) || [];
          existing.push(createdTab.id!);
          groupTabMap.set(tab.groupId, existing);
        }
      }

      // Recreate tab groups
      for (const [oldGroupId, tabIds] of groupTabMap.entries()) {
        const groupMeta = win.tabGroups.find((g) => g.id === oldGroupId);
        if (!groupMeta) continue;

        await createBrowserTabGroup({
          tabIds,
          createProperties: { windowId: newWindowId },
        }, {
          title: groupMeta.title,
          color: groupMeta.color,
          collapsed: groupMeta.collapsed,
        });
      }
    }

    console.log(
      `${LOG_PREFIX} Restored snapshot "${snapshotId}" in ${snapshot.windows.length} window(s)`,
    );
    return undefined;
  }

  /**
   * List all backup snapshots, sorted by timestamp descending (newest first).
   */
  static async listSnapshots(): Promise<BackupSnapshot[]> {
    const snapshots =
      (await Storage.get<BackupSnapshot[]>('sessionBackups')) || [];
    return snapshots.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Enable automatic backups by creating the SESSION_BACKUP alarm.
   * Uses the current frequency setting to determine the period.
   */
  static async enable(): Promise<void> {
    const settings = await BackupService.getSettings();
    const periodInMinutes = FREQUENCY_MAP[settings.frequency];

    await chrome.alarms.create(ALARM_NAMES.SESSION_BACKUP, { periodInMinutes });
    await Storage.set('backupSettings', { ...settings, enabled: true });

    console.log(
      `${LOG_PREFIX} Enabled backups (${settings.frequency}, every ${periodInMinutes} min)`,
    );
  }

  /**
   * Disable automatic backups by clearing the SESSION_BACKUP alarm.
   */
  static async disable(): Promise<void> {
    const settings = await BackupService.getSettings();

    await chrome.alarms.clear(ALARM_NAMES.SESSION_BACKUP);
    await Storage.set('backupSettings', { ...settings, enabled: false });

    console.log(`${LOG_PREFIX} Disabled backups`);
  }

  /**
   * Set the backup frequency and re-create the alarm if backups are enabled.
   */
  static async setFrequency(
    frequency: BackupSettings['frequency'],
  ): Promise<void> {
    const settings = await BackupService.getSettings();
    const updatedSettings: BackupSettings = { ...settings, frequency };

    await Storage.set('backupSettings', updatedSettings);

    if (settings.enabled) {
      await chrome.alarms.clear(ALARM_NAMES.SESSION_BACKUP);
      const periodInMinutes = FREQUENCY_MAP[frequency];
      await chrome.alarms.create(ALARM_NAMES.SESSION_BACKUP, {
        periodInMinutes,
      });
      console.log(
        `${LOG_PREFIX} Frequency changed to ${frequency} (${periodInMinutes} min)`,
      );
    } else {
      console.log(
        `${LOG_PREFIX} Frequency changed to ${frequency} (backups disabled, no alarm created)`,
      );
    }
  }

  /**
   * Get backup settings from storage, with defaults.
   */
  static async getSettings(): Promise<BackupSettings> {
    // Earlier versions only persisted this key after a user changed a setting.
    // An existing value is therefore an explicit choice, even enabled: false.
    return { ...DEFAULT_BACKUP_SETTINGS, ...(await Storage.get<Partial<BackupSettings>>('backupSettings')) };
  }

  /** Ensure scheduling on install, startup and worker wake without postponing an existing alarm. */
  static async ensureScheduled(): Promise<void> {
    const settings = await BackupService.getSettings();
    if (!settings.enabled) {
      await chrome.alarms.clear(ALARM_NAMES.SESSION_BACKUP);
      return;
    }
    const periodInMinutes = FREQUENCY_MAP[settings.frequency];
    const alarm = await chrome.alarms.get(ALARM_NAMES.SESSION_BACKUP);
    if (!alarm || alarm.periodInMinutes !== periodInMinutes) {
      await chrome.alarms.create(ALARM_NAMES.SESSION_BACKUP, { periodInMinutes });
    }
  }
}
