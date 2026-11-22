import { BackupService } from './backup-service';
import { Storage } from '@/utils/storage';
import { ALARM_NAMES } from '@/config/alarms';
import type { BackupSnapshot, BackupSavedData } from '@/types/productivity';

let data: Record<string, unknown>;
const savedData: BackupSavedData = {
    groups: [{ id: 'g', name: 'Saved work', tabs: [], created: 1, modified: 1 }],
    tags: [{ id: 'tag', name: 'Work', color: 'blue', created: 1 }],
    projects: [{ id: 'project', name: 'Work', color: 'blue', icon: 'folder', searchScope: 'project', created: 1, modified: 1 }],
    brain_dump_inbox: [],
    archivedGroups: {
        archives: {
            secret: {
                id: 'secret', originalGroup: 'stored-ciphertext-do-not-decrypt',
                protection: { passwordProtected: true, encryptionIv: 'iv', encryptionSalt: 'salt', passwordHash: 'hash' },
                metadata: { archivedDate: 1, accessCount: 0, restoredCount: 0 },
                version: '1.0.0', checksum: 'checksum',
            },
        },
        metadata: { totalArchives: 1, totalSizeBytes: 100, version: '1.0.0' },
    },
};

beforeEach(() => {
    jest.clearAllMocks();
    data = JSON.parse(JSON.stringify(savedData));
    data.brain_dump_inbox = [{ id: 'thought', text: 'Remember this', createdAt: 1 }];
    jest.spyOn(Storage, 'get').mockImplementation(async key => JSON.parse(JSON.stringify(data[key] ?? null)));
    jest.spyOn(Storage, 'set').mockImplementation(async (key, value) => { data[key] = JSON.parse(JSON.stringify(value)); });
    (chrome.windows.getAll as jest.Mock).mockResolvedValue([]);
    (chrome.alarms.get as jest.Mock).mockResolvedValue(undefined);
    (chrome.windows.create as jest.Mock).mockResolvedValue({ id: 50 });
    (chrome.tabs.create as jest.Mock).mockResolvedValue({ id: 51 });
    if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'snapshot-id' }, configurable: true });
});
afterEach(() => jest.restoreAllMocks());

it('defaults untouched users to enabled monthly and installs the monthly alarm', async () => {
    expect(await BackupService.getSettings()).toEqual({ enabled: true, frequency: 'monthly' });
    await BackupService.ensureScheduled();
    expect(chrome.alarms.create).toHaveBeenCalledWith(ALARM_NAMES.SESSION_BACKUP, { periodInMinutes: 43200 });
    expect(data.backupSettings).toBeUndefined();
});

it('respects explicit choices, including disabled with the former default frequency', async () => {
    data.backupSettings = { enabled: false, frequency: 'daily' };
    expect(await BackupService.getSettings()).toEqual(data.backupSettings);
    await BackupService.ensureScheduled();
    expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAMES.SESSION_BACKUP);
    expect(chrome.alarms.create).not.toHaveBeenCalled();
});

it('does not postpone the backup on every worker wake', async () => {
    (chrome.alarms.get as jest.Mock).mockResolvedValue({ periodInMinutes: 43200 });
    await BackupService.ensureScheduled();
    expect(chrome.alarms.create).not.toHaveBeenCalled();
});

it('captures saved data even with no open windows, preserving encrypted archives exactly', async () => {
    await BackupService.capture();
    const snapshot = (data.sessionBackups as BackupSnapshot[])[0];
    expect(snapshot.savedData).toEqual({ ...savedData, brain_dump_inbox: data.brain_dump_inbox });
    expect(snapshot.savedData?.archivedGroups?.archives.secret.originalGroup).toBe('stored-ciphertext-do-not-decrypt');
});

it('keeps a full saved-data copy only in the newest snapshots', async () => {
    for (let i = 0; i < 5; i++) await BackupService.capture();
    const snapshots = data.sessionBackups as BackupSnapshot[];
    expect(snapshots).toHaveLength(5);
    expect(snapshots.map(snapshot => Boolean(snapshot.savedData))).toEqual([false, false, true, true, true]);
});

it.each(['group', 'window'] as const)('restores all saved data in %s mode without removing newer unrelated records', async mode => {
    await BackupService.capture();
    const snapshot = (data.sessionBackups as BackupSnapshot[])[0];
    data.groups = [{ id: 'later', name: 'New work' }, { id: 'g', name: 'Changed' }];
    data.tags = [];
    data.projects = [];
    data.brain_dump_inbox = [];
    data.archivedGroups = null;
    await BackupService.restore(snapshot.id, mode);
    expect(data.groups).toEqual([...savedData.groups, { id: 'later', name: 'New work' }]);
    expect(data.tags).toEqual(savedData.tags);
    expect(data.projects).toEqual(savedData.projects);
    expect(data.brain_dump_inbox).toEqual(snapshot.savedData?.brain_dump_inbox);
    expect((data.archivedGroups as BackupSavedData['archivedGroups'])?.archives).toEqual(savedData.archivedGroups?.archives);
    expect(data.archiveSearchIndex).toEqual([expect.objectContaining({ archiveId: 'secret', isProtected: true, tabTitles: [], tabUrls: [] })]);
});

it('still opens a legacy snapshot and leaves saved data untouched', async () => {
    const before = JSON.parse(JSON.stringify(data));
    data.sessionBackups = [{
        id: 'legacy', timestamp: 1, totalTabs: 1, totalGroups: 0, sizeBytes: 100,
        windows: [{ id: 1, focused: false, tabGroups: [], tabs: [{ url: 'https://example.com', title: 'Example', pinned: true, groupId: -1, index: 0 }] }],
    }];
    await BackupService.restore('legacy', 'window');
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com', pinned: true, windowId: 50 });
    for (const [key, value] of Object.entries(before)) expect(data[key]).toEqual(value);
});
