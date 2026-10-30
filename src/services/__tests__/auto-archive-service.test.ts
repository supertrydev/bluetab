import {
  GROUP_ACTIVITY_KEY,
  getAutoArchiveReason,
  resolveAutoArchiveDays,
  recordGroupActivity,
  runAutoArchive,
  selectInactiveGroups,
} from '../auto-archive-service';
import { ArchiveService } from '@/services/archive-service';
import { Storage } from '@/utils/storage';
import { getDefaultSettings } from '@/utils/sorting';
import type { TabGroup } from '@/types/models';

jest.mock('@/utils/storage', () => ({
  Storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
}));

jest.mock('@/services/archive-service', () => ({
  ArchiveService: { createArchive: jest.fn() },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;
const mockedArchive = ArchiveService as jest.Mocked<typeof ArchiveService>;

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

function group(id: string, lastTouched: number, extra: Partial<TabGroup> = {}): TabGroup {
  return { id, name: `Group ${id}`, tabs: [], created: lastTouched, modified: lastTouched, ...extra };
}

function mockStore(store: Record<string, unknown>) {
  mockedStorage.get.mockImplementation(async (key: string) => store[key] as never);
  mockedStorage.set.mockImplementation(async (key: string, value: unknown) => { store[key] = value; });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedArchive.createArchive.mockResolvedValue({ success: true } as never);
});

describe('selectInactiveGroups', () => {
  it('picks groups untouched for 7 days and keeps recent ones', () => {
    const groups = [group('old', NOW - 8 * DAY), group('recent', NOW - 2 * DAY), group('edge', NOW - 7 * DAY)];
    expect(selectInactiveGroups(groups, {}, NOW).map((g) => g.id)).toEqual(['old', 'edge']);
  });

  it('counts opens/restores, lastAccessed and the newest edit as activity', () => {
    const groups = [
      group('opened', NOW - 30 * DAY),
      group('restoredFromArchive', NOW - 30 * DAY, { lastAccessed: NOW - DAY }),
      group('edited', NOW - 30 * DAY, { modified: NOW - DAY }),
    ];
    expect(selectInactiveGroups(groups, { opened: NOW - DAY }, NOW)).toEqual([]);
  });

  it('never selects locked or pinned groups', () => {
    const groups = [group('locked', 0, { locked: true }), group('pinned', 0, { isPinned: true })];
    expect(selectInactiveGroups(groups, {}, NOW)).toEqual([]);
  });

  it('starts the window no earlier than when the setting was turned on', () => {
    const groups = [group('old', NOW - 60 * DAY)];
    expect(selectInactiveGroups(groups, {}, NOW, NOW - 3 * DAY)).toEqual([]);
    expect(selectInactiveGroups(groups, {}, NOW, NOW - 7 * DAY)).toHaveLength(1);
  });
});

describe('inactivity days', () => {
  it('accepts only the offered choices and falls back to 7', () => {
    expect([3, 7, 14, 30].map(resolveAutoArchiveDays)).toEqual([3, 7, 14, 30]);
    expect(resolveAutoArchiveDays(undefined)).toBe(7);
    expect(resolveAutoArchiveDays(1)).toBe(7);
    expect(resolveAutoArchiveDays('14')).toBe(7);
  });

  it('uses the chosen number of days', () => {
    const groups = [group('fourDays', NOW - 4 * DAY), group('tenDays', NOW - 10 * DAY)];
    expect(selectInactiveGroups(groups, {}, NOW, 0, 3).map((g) => g.id)).toEqual(['fourDays', 'tenDays']);
    expect(selectInactiveGroups(groups, {}, NOW, 0, 14)).toEqual([]);
  });
});

describe('runAutoArchive', () => {
  it('does nothing while the setting is off (the default)', async () => {
    expect(getDefaultSettings().autoArchiveInactiveGroups).toBe(false);
    mockStore({ settings: getDefaultSettings(), groups: [group('old', 0)] });

    await expect(runAutoArchive(NOW)).resolves.toMatchObject({ archivedCount: 0 });
    expect(mockedArchive.createArchive).not.toHaveBeenCalled();
    expect(mockedStorage.set).not.toHaveBeenCalled();
  });

  it('archives inactive groups, keeps the rest and prunes their activity', async () => {
    const store: Record<string, unknown> = {
      settings: { ...getDefaultSettings(), autoArchiveInactiveGroups: true, autoArchiveEnabledAt: 0 },
      groups: [group('old', NOW - 10 * DAY), group('fresh', NOW - DAY)],
      [GROUP_ACTIVITY_KEY]: { old: NOW - 9 * DAY, other: NOW },
    };
    mockStore(store);

    const result = await runAutoArchive(NOW);

    expect(result).toEqual({ archivedCount: 1, archivedNames: ['Group old'], failedCount: 0 });
    expect(mockedArchive.createArchive).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'old' }),
      { groupId: 'old', reason: getAutoArchiveReason(7) },
    );
    expect((store.groups as TabGroup[]).map((g) => g.id)).toEqual(['fresh']);
    expect(store[GROUP_ACTIVITY_KEY]).toEqual({ other: NOW });
  });

  it('reads the day count from settings', async () => {
    const store: Record<string, unknown> = {
      settings: { ...getDefaultSettings(), autoArchiveInactiveGroups: true, autoArchiveInactiveDays: 30 },
      groups: [group('tenDays', NOW - 10 * DAY), group('fortyDays', NOW - 40 * DAY)],
    };
    mockStore(store);
    await expect(runAutoArchive(NOW)).resolves.toMatchObject({ archivedCount: 1, archivedNames: ['Group fortyDays'] });
    expect(mockedArchive.createArchive).toHaveBeenCalledWith(expect.anything(), { groupId: 'fortyDays', reason: getAutoArchiveReason(30) });
  });

  it('keeps a group in the list when its archive write fails', async () => {
    const store: Record<string, unknown> = {
      settings: { ...getDefaultSettings(), autoArchiveInactiveGroups: true },
      groups: [group('old', 0)],
    };
    mockStore(store);
    mockedArchive.createArchive.mockResolvedValue({ success: false, error: 'quota' } as never);

    await expect(runAutoArchive(NOW)).resolves.toMatchObject({ archivedCount: 0, failedCount: 1 });
    expect((store.groups as TabGroup[]).map((g) => g.id)).toEqual(['old']);
  });
});

describe('recordGroupActivity', () => {
  it('stores the time for the group without touching others', async () => {
    const store: Record<string, unknown> = { [GROUP_ACTIVITY_KEY]: { a: 1 } };
    mockStore(store);
    await recordGroupActivity('b', 5);
    expect(store[GROUP_ACTIVITY_KEY]).toEqual({ a: 1, b: 5 });
  });
});
