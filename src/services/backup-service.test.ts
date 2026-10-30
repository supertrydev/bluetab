/**
 * Unit tests for BackupService
 *
 * Tests: capture (with URL filtering, favicon stripping for oversized snapshots),
 *        restore (both 'group' and 'window' modes), listSnapshots, enable, disable,
 *        setFrequency, getSettings, and RingBuffer(10) FIFO eviction.
 *
 * All tests mock Storage, chrome APIs, and use chrome mocks from jest-setup.ts.
 */

import { BackupService } from './backup-service';
import { Storage } from '@/utils/storage';
import { ALARM_NAMES } from '@/config/alarms';
import type { BackupSnapshot, BackupSettings } from '@/types/productivity';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;

// Mock crypto.randomUUID
const mockUUID = jest.fn();
Object.defineProperty(global, 'crypto', {
  value: { randomUUID: mockUUID },
  writable: true,
});

function makeWindow(id: number, tabs: Array<{ url: string; title: string; groupId?: number; pinned?: boolean }>, focused = false) {
  return {
    id,
    type: 'normal' as const,
    focused,
    tabs: tabs.map((t, i) => ({
      url: t.url,
      title: t.title,
      favIconUrl: 'https://example.com/favicon.ico',
      pinned: t.pinned || false,
      groupId: t.groupId ?? -1,
      index: i,
    })),
  };
}

function makeSnapshot(overrides: Partial<BackupSnapshot> = {}): BackupSnapshot {
  return {
    id: 'snap-1',
    timestamp: Date.now(),
    windows: [],
    totalTabs: 0,
    totalGroups: 0,
    sizeBytes: 100,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(1000000);
  mockedStorage.set.mockResolvedValue(undefined);
  mockUUID.mockReturnValue('snap-uuid-1');
  (chrome.tabGroups.query as jest.Mock).mockResolvedValue([]);
  (chrome.windows.create as jest.Mock).mockResolvedValue({ id: 999 });
  (chrome.tabs.create as jest.Mock).mockResolvedValue({ id: 1001 });
  (chrome.tabs.group as jest.Mock).mockResolvedValue(100);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('BackupService', () => {
  describe('capture', () => {
    it('captures all normal windows with tabs', async () => {
      const windows = [
        makeWindow(1, [
          { url: 'https://example.com', title: 'Example' },
          { url: 'https://google.com', title: 'Google' },
        ]),
      ];
      (chrome.windows.getAll as jest.Mock).mockResolvedValue(windows);
      mockedStorage.get.mockResolvedValue(null);

      await BackupService.capture();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'sessionBackups',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'snap-uuid-1',
            totalTabs: 2,
          }),
        ]),
      );
    });

    it('filters out chrome:// and chrome-extension:// URLs', async () => {
      const windows = [
        makeWindow(1, [
          { url: 'https://example.com', title: 'Example' },
          { url: 'chrome://extensions', title: 'Extensions' },
          { url: 'chrome-extension://abc/popup.html', title: 'Popup' },
        ]),
      ];
      (chrome.windows.getAll as jest.Mock).mockResolvedValue(windows);
      mockedStorage.get.mockResolvedValue(null);

      await BackupService.capture();

      const snapshots = mockedStorage.set.mock.calls.find(c => c[0] === 'sessionBackups')![1] as BackupSnapshot[];
      expect(snapshots[0].totalTabs).toBe(1);
    });

    it('skips non-normal windows (popup, devtools)', async () => {
      const windows = [
        makeWindow(1, [{ url: 'https://example.com', title: 'Example' }]),
        { id: 2, type: 'popup', focused: false, tabs: [{ url: 'https://popup.com', title: 'Popup' }] },
      ];
      (chrome.windows.getAll as jest.Mock).mockResolvedValue(windows);
      mockedStorage.get.mockResolvedValue(null);

      await BackupService.capture();

      const snapshots = mockedStorage.set.mock.calls.find(c => c[0] === 'sessionBackups')![1] as BackupSnapshot[];
      expect(snapshots[0].windows).toHaveLength(1);
    });

    it('captures native tab groups for each window', async () => {
      const windows = [
        makeWindow(1, [
          { url: 'https://a.com', title: 'A', groupId: 10 },
          { url: 'https://b.com', title: 'B', groupId: 10 },
        ]),
      ];
      const groups = [{ id: 10, title: 'My Group', color: 'blue', collapsed: false }];
      (chrome.windows.getAll as jest.Mock).mockResolvedValue(windows);
      (chrome.tabGroups.query as jest.Mock).mockResolvedValue(groups);
      mockedStorage.get.mockResolvedValue(null);

      await BackupService.capture();

      const snapshots = mockedStorage.set.mock.calls.find(c => c[0] === 'sessionBackups')![1] as BackupSnapshot[];
      expect(snapshots[0].windows[0].tabGroups).toEqual([
        expect.objectContaining({ id: 10, title: 'My Group', color: 'blue' }),
      ]);
      expect(snapshots[0].totalGroups).toBe(1);
    });

    it('uses RingBuffer(10) for FIFO eviction at capacity', async () => {
      const existingSnapshots = Array.from({ length: 10 }, (_, i) =>
        makeSnapshot({ id: `old-${i}`, timestamp: 100000 + i }),
      );
      const windows = [
        makeWindow(1, [{ url: 'https://new.com', title: 'New' }]),
      ];
      (chrome.windows.getAll as jest.Mock).mockResolvedValue(windows);
      mockedStorage.get.mockResolvedValue(existingSnapshots);

      await BackupService.capture();

      const savedSnapshots = mockedStorage.set.mock.calls.find(c => c[0] === 'sessionBackups')![1] as BackupSnapshot[];
      // Should still be 10 (oldest evicted, new one added)
      expect(savedSnapshots).toHaveLength(10);
      // Oldest should be evicted
      expect(savedSnapshots.find(s => s.id === 'old-0')).toBeUndefined();
      // Newest should be present
      expect(savedSnapshots.find(s => s.id === 'snap-uuid-1')).toBeDefined();
    });

    it('calculates sizeBytes from JSON.stringify length', async () => {
      const windows = [
        makeWindow(1, [{ url: 'https://example.com', title: 'Example' }]),
      ];
      (chrome.windows.getAll as jest.Mock).mockResolvedValue(windows);
      mockedStorage.get.mockResolvedValue(null);

      await BackupService.capture();

      const snapshots = mockedStorage.set.mock.calls.find(c => c[0] === 'sessionBackups')![1] as BackupSnapshot[];
      expect(snapshots[0].sizeBytes).toBeGreaterThan(0);
    });

    it('strips favicons when snapshot > 50KB', async () => {
      // Create a window with many tabs to produce a large snapshot
      const manyTabs = Array.from({ length: 200 }, (_, i) => ({
        url: `https://example-${i}.com/very/long/path/to/make/the/url/bigger`,
        title: `Tab ${i} with a reasonably long title to increase size`,
        groupId: -1,
        pinned: false,
      }));

      const windows = [makeWindow(1, manyTabs)];
      // Give each tab a large favicon
      windows[0].tabs = windows[0].tabs!.map(t => ({
        ...t,
        favIconUrl: 'data:image/png;base64,' + 'A'.repeat(500),
      }));

      (chrome.windows.getAll as jest.Mock).mockResolvedValue(windows);
      mockedStorage.get.mockResolvedValue(null);

      await BackupService.capture();

      const snapshots = mockedStorage.set.mock.calls.find(c => c[0] === 'sessionBackups')![1] as BackupSnapshot[];
      const snap = snapshots[0];

      // If original was > 50KB, favicons should be stripped
      const allFavicons = snap.windows.flatMap(w => w.tabs.map(t => t.favicon));
      // Either all favicons are empty/undefined OR the snapshot was under 50KB
      const hasFavicons = allFavicons.some(f => f && f.length > 0);
      // The point is: if oversized, favicons get stripped
      if (snap.sizeBytes > 0) {
        // At 200 tabs with 500-char favicons, this should be > 50KB
        expect(hasFavicons).toBe(false);
      }
    });
  });

  describe('restore', () => {
    it('opens tabs in a new window when mode is "window"', async () => {
      const snapshot = makeSnapshot({
        id: 'restore-win',
        windows: [{
          id: 1,
          focused: true,
          tabs: [
            { url: 'https://a.com', title: 'A', pinned: false, groupId: -1, index: 0 },
            { url: 'https://b.com', title: 'B', pinned: false, groupId: -1, index: 1 },
          ],
          tabGroups: [],
        }],
      });
      mockedStorage.get.mockResolvedValue([snapshot]);

      await BackupService.restore('restore-win', 'window');

      expect(chrome.windows.create).toHaveBeenCalledWith(
        expect.objectContaining({ focused: true }),
      );
      expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
    });

    it('recreates tab groups in window restore mode', async () => {
      const snapshot = makeSnapshot({
        id: 'restore-groups',
        windows: [{
          id: 1,
          focused: true,
          tabs: [
            { url: 'https://a.com', title: 'A', pinned: false, groupId: 10, index: 0 },
            { url: 'https://b.com', title: 'B', pinned: false, groupId: 10, index: 1 },
            { url: 'https://c.com', title: 'C', pinned: false, groupId: -1, index: 2 },
          ],
          tabGroups: [
            { id: 10, title: 'Group A', color: 'blue', collapsed: false },
          ],
        }],
      });
      mockedStorage.get.mockResolvedValue([snapshot]);

      // chrome.tabs.create returns tab objects with ids
      let tabIdCounter = 2000;
      (chrome.tabs.create as jest.Mock).mockImplementation(async () => ({
        id: tabIdCounter++,
      }));
      (chrome.tabs.group as jest.Mock).mockResolvedValue(500);

      await BackupService.restore('restore-groups', 'window');

      // Should group the first two tabs
      expect(chrome.tabs.group).toHaveBeenCalledWith(
        expect.objectContaining({
          tabIds: [2000, 2001],
          createProperties: { windowId: 999 },
        }),
      );
      // Should update the group with title/color/collapsed
      expect(chrome.tabGroups.update).toHaveBeenCalledWith(
        500,
        expect.objectContaining({
          title: 'Group A',
          color: 'blue',
          collapsed: false,
        }),
      );
    });

    it('handles "group" mode by calling restore callback (saves as Bluetab group)', async () => {
      const snapshot = makeSnapshot({
        id: 'restore-group-mode',
        windows: [{
          id: 1,
          focused: false,
          tabs: [
            { url: 'https://a.com', title: 'A', pinned: false, groupId: -1, index: 0 },
          ],
          tabGroups: [],
        }],
      });
      mockedStorage.get.mockResolvedValue([snapshot]);

      // group mode returns the snapshot data for the caller to handle
      const result = await BackupService.restore('restore-group-mode', 'group');

      // In group mode, should NOT open windows
      expect(chrome.windows.create).not.toHaveBeenCalled();
      // Should return the snapshot for the caller to create a Bluetab group
      expect(result).toEqual(expect.objectContaining({ id: 'restore-group-mode' }));
    });
  });

  describe('listSnapshots', () => {
    it('returns snapshots sorted by timestamp descending', async () => {
      const snapshots = [
        makeSnapshot({ id: 'old', timestamp: 100000 }),
        makeSnapshot({ id: 'new', timestamp: 300000 }),
        makeSnapshot({ id: 'mid', timestamp: 200000 }),
      ];
      mockedStorage.get.mockResolvedValue(snapshots);

      const result = await BackupService.listSnapshots();

      expect(result.map(s => s.id)).toEqual(['new', 'mid', 'old']);
    });

    it('returns empty array when no backups exist', async () => {
      mockedStorage.get.mockResolvedValue(null);

      const result = await BackupService.listSnapshots();

      expect(result).toEqual([]);
    });
  });

  describe('enable', () => {
    it('creates SESSION_BACKUP alarm with correct periodInMinutes for daily', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'backupSettings') return { enabled: false, frequency: 'daily' };
        return null;
      });

      await BackupService.enable();

      expect(chrome.alarms.create).toHaveBeenCalledWith(
        ALARM_NAMES.SESSION_BACKUP,
        { periodInMinutes: 1440 },
      );
    });

    it('creates SESSION_BACKUP alarm with 60 min period for hourly', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'backupSettings') return { enabled: false, frequency: 'hourly' };
        return null;
      });

      await BackupService.enable();

      expect(chrome.alarms.create).toHaveBeenCalledWith(
        ALARM_NAMES.SESSION_BACKUP,
        { periodInMinutes: 60 },
      );
    });

    it('creates SESSION_BACKUP alarm with 10080 min period for weekly', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'backupSettings') return { enabled: false, frequency: 'weekly' };
        return null;
      });

      await BackupService.enable();

      expect(chrome.alarms.create).toHaveBeenCalledWith(
        ALARM_NAMES.SESSION_BACKUP,
        { periodInMinutes: 10080 },
      );
    });

    it('stores backupSettings.enabled=true', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'backupSettings') return { enabled: false, frequency: 'daily' };
        return null;
      });

      await BackupService.enable();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'backupSettings',
        expect.objectContaining({ enabled: true }),
      );
    });
  });

  describe('disable', () => {
    it('clears the SESSION_BACKUP alarm', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'backupSettings') return { enabled: true, frequency: 'daily' };
        return null;
      });

      await BackupService.disable();

      expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAMES.SESSION_BACKUP);
    });

    it('stores backupSettings.enabled=false', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'backupSettings') return { enabled: true, frequency: 'daily' };
        return null;
      });

      await BackupService.disable();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'backupSettings',
        expect.objectContaining({ enabled: false }),
      );
    });
  });

  describe('setFrequency', () => {
    it('updates backupSettings.frequency', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'backupSettings') return { enabled: true, frequency: 'daily' };
        return null;
      });

      await BackupService.setFrequency('hourly');

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'backupSettings',
        expect.objectContaining({ frequency: 'hourly' }),
      );
    });

    it('re-creates alarm with new period when enabled', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'backupSettings') return { enabled: true, frequency: 'daily' };
        return null;
      });

      await BackupService.setFrequency('hourly');

      expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAMES.SESSION_BACKUP);
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        ALARM_NAMES.SESSION_BACKUP,
        { periodInMinutes: 60 },
      );
    });

    it('does not create alarm when disabled', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'backupSettings') return { enabled: false, frequency: 'daily' };
        return null;
      });

      await BackupService.setFrequency('weekly');

      expect(chrome.alarms.create).not.toHaveBeenCalled();
    });
  });

  describe('getSettings', () => {
    it('returns settings from storage', async () => {
      const settings: BackupSettings = { enabled: true, frequency: 'hourly' };
      mockedStorage.get.mockResolvedValue(settings);

      const result = await BackupService.getSettings();

      expect(result).toEqual(settings);
    });

    it('returns default settings when nothing stored', async () => {
      mockedStorage.get.mockResolvedValue(null);

      const result = await BackupService.getSettings();

      expect(result).toEqual({ enabled: false, frequency: 'daily' });
    });
  });
});
