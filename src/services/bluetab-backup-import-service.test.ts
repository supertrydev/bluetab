import { importBlueTabBackup } from './bluetab-backup-import-service';
import { Storage } from '@/utils/storage';
import { ThemeManager } from '@/utils/theme';
import { textSizeService } from '@/utils/TextSizeService';
import type { Settings, TabGroup, Tag } from '@/types/models';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
    getPinSettings: jest.fn(),
    getProjects: jest.fn(),
  },
}));

jest.mock('@/utils/theme', () => ({
  ThemeManager: {
    applyTheme: jest.fn(),
  },
}));

jest.mock('@/utils/TextSizeService', () => ({
  textSizeService: {
    applyTextSize: jest.fn(),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;
const mockedTheme = ThemeManager as jest.Mocked<typeof ThemeManager>;
const mockedTextSize = textSizeService as jest.Mocked<typeof textSizeService>;

let uuidCounter = 0;

Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: jest.fn(() => `new-id-${++uuidCounter}`),
  },
  writable: true,
});

const now = 1_800_000_000_000;

const baseSettings: Settings = {
  maxGroups: 100,
  theme: 'system',
  sortOrder: 'newest',
  restoreMode: 'smart',
  pinnedTabsMode: 'include',
  startupBehavior: 'show',
  restoreBehavior: 'removeFromList',
  duplicateHandling: 'allow',
};

beforeEach(() => {
  uuidCounter = 0;
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  mockedStorage.set.mockResolvedValue(undefined);
  mockedStorage.getPinSettings.mockResolvedValue({ pinnedGroups: {} });
  mockedStorage.getProjects.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('importBlueTabBackup', () => {
  it('imports groups, maps tags by name, applies settings, and keeps tab groupIds aligned', async () => {
    const existingTag: Tag = {
      id: 'tag-existing',
      name: 'Work',
      color: '#000000',
      created: now - 10,
    };
    const existingGroup: TabGroup = {
      id: 'existing-group',
      name: 'Existing',
      tabs: [],
      created: now - 10,
      modified: now - 10,
    };

    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === 'tags') return [existingTag];
      if (key === 'groups') return [existingGroup];
      if (key === 'collapsedGroups') return { 'old-group': true };
      return null;
    });

    const backup = {
      version: '2.3.0',
      exportedAt: now - 1,
      groups: [
        {
          id: 'old-group',
          name: 'Imported',
          tags: ['tag-old'],
          tabs: [
            {
              id: 'old-tab',
              url: 'https://example.com',
              title: 'Example',
              timestamp: now - 1,
              groupId: 'old-group',
              tags: ['tag-old'],
            },
          ],
          created: now - 1,
          modified: now - 1,
        },
      ],
      tags: [
        {
          id: 'tag-old',
          name: 'Work',
          color: '#ffffff',
          created: now - 1,
        },
      ],
      settings: {
        ...baseSettings,
        theme: 'dark',
        autoBackup: true,
        backupInterval: 'daily',
      },
      textSettings: {
        textSize: 'large',
      },
      layoutMode: 'list',
      collapsedGroups: {
        'old-group': true,
      },
    };

    const result = await importBlueTabBackup(backup);

    expect(result.groupsImported).toBe(1);
    expect(result.tabCount).toBe(1);
    expect(result.updatedSettings).toMatchObject({ theme: 'dark' });
    expect(result.updatedSettings).not.toHaveProperty('autoBackup');
    expect(result.updatedSettings).not.toHaveProperty('backupInterval');

    const savedGroupsCall = mockedStorage.set.mock.calls.find(([key]) => key === 'groups');
    const savedGroups = savedGroupsCall?.[1] as TabGroup[];
    expect(savedGroups).toHaveLength(2);
    expect(savedGroups[1].id).not.toBe('old-group');
    expect(savedGroups[1].tabs[0].groupId).toBe(savedGroups[1].id);
    expect(savedGroups[1].tags).toEqual(['tag-existing']);
    expect(savedGroups[1].tabs[0].tags).toEqual(['tag-existing']);

    expect(mockedStorage.set).toHaveBeenCalledWith('collapsedGroups', {
      [savedGroups[1].id]: true,
    });
    expect(mockedStorage.set).toHaveBeenCalledWith('layoutMode', 'list');
    expect(mockedTheme.applyTheme).toHaveBeenCalledWith('dark');
    expect(mockedTextSize.applyTextSize).toHaveBeenCalledWith('large');
  });

  it('rejects files without BlueTab group backup data', async () => {
    await expect(importBlueTabBackup({ tabs: [] })).rejects.toThrow('Invalid backup file');
  });
});
