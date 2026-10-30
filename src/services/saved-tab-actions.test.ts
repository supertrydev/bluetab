import {
    restoreSavedTabWithBehavior,
    saveTabsToBlueTab,
} from './saved-tab-actions';
import { Storage } from '../utils/storage';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import { FlowStorageService } from '../utils/flow-storage';
import { FlowService } from './flow-service';
import { autoRenameSavedGroupIfUntitled } from './smart-group-naming';
import type { RememberedGroup, TabGroup } from '../types/models';

jest.mock('../utils/storage', () => ({
    Storage: {
        get: jest.fn(),
        set: jest.fn(),
        getProjects: jest.fn(),
    },
}));

jest.mock('../utils/group-memory-storage', () => ({
    GroupMemoryStorageService: {
        rememberGroup: jest.fn(),
        partitionTabsByMemory: jest.fn(),
        restoreIntegrationState: jest.fn(),
    },
}));

jest.mock('../utils/flow-storage', () => ({
    FlowStorageService: {
        getFlowSettings: jest.fn(),
    },
}));

const mockRecordGroupActivity = jest.fn();
jest.mock('../utils/group-activity', () => ({
    recordGroupActivity: (...args: unknown[]) => mockRecordGroupActivity(...args),
}));

jest.mock('./flow-service', () => ({
    FlowService: {
        processTabs: jest.fn(),
    },
}));

jest.mock('./smart-group-naming', () => ({
    autoRenameSavedGroupIfUntitled: jest.fn(),
}));

const mockGet = Storage.get as jest.Mock;
const mockSet = Storage.set as jest.Mock;
const mockGetProjects = Storage.getProjects as jest.Mock;
const mockRememberGroup = GroupMemoryStorageService.rememberGroup as jest.Mock;
const mockPartitionTabsByMemory = GroupMemoryStorageService.partitionTabsByMemory as jest.Mock;
const mockRestoreIntegrationState = GroupMemoryStorageService.restoreIntegrationState as jest.Mock;
const mockGetFlowSettings = FlowStorageService.getFlowSettings as jest.Mock;
const mockProcessTabs = FlowService.processTabs as jest.Mock;
const mockAutoRenameSavedGroupIfUntitled = autoRenameSavedGroupIfUntitled as jest.MockedFunction<typeof autoRenameSavedGroupIfUntitled>;
const mockTabsCreate = chrome.tabs.create as jest.Mock;
const mockTabsQuery = chrome.tabs.query as jest.Mock;
const mockTabsRemove = chrome.tabs.remove as jest.Mock;

const NOW = 1_700_000_000_000;

function savedGroup(overrides: Partial<TabGroup> = {}): TabGroup {
    return {
        id: 'group-1',
        name: 'Work',
        tabs: [
            { id: 'tab-1', url: 'https://example.com/a', title: 'A', groupId: 'group-1', timestamp: 1 },
            { id: 'tab-2', url: 'https://example.com/b', title: 'B', groupId: 'group-1', timestamp: 1 },
        ],
        created: 1,
        modified: 1,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockSet.mockResolvedValue(undefined);
    mockGetProjects.mockResolvedValue([]);
    mockRestoreIntegrationState.mockResolvedValue(undefined);
    mockTabsCreate.mockResolvedValue({ id: 99 });
    mockTabsQuery.mockResolvedValue([]);
    mockTabsRemove.mockResolvedValue(undefined);
    mockPartitionTabsByMemory.mockResolvedValue({ buckets: new Map(), remainingTabs: [] });
    mockGetFlowSettings.mockResolvedValue({ enabled: false, rules: [] });
    mockProcessTabs.mockResolvedValue({
        success: true,
        processed: 0,
        matched: 0,
        results: [],
        groupsCreated: [],
        groupsModified: [],
    });
    mockAutoRenameSavedGroupIfUntitled.mockResolvedValue(undefined);

    if (!(globalThis.crypto as Crypto | undefined)?.randomUUID) {
        (globalThis as unknown as { crypto: Partial<Crypto> }).crypto = {
            ...(globalThis.crypto ?? {}),
            randomUUID: () => 'test-uuid-0000-0000-0000-000000000000',
        };
    }
});

describe('restoreSavedTabWithBehavior', () => {
    it('keeps the tab in the list when restoreBehavior is keepInList', async () => {
        const groups = [savedGroup()];
        mockGet.mockResolvedValue({ restoreBehavior: 'keepInList' });

        const result = await restoreSavedTabWithBehavior({
            url: 'https://example.com/a',
            tabId: 'tab-1',
            groupId: 'group-1',
            groups,
            active: false,
        });

        expect(mockTabsCreate).toHaveBeenCalledWith({ url: 'https://example.com/a', active: false });
        expect(mockRememberGroup).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
        // Opening a tab from a kept group counts as activity for auto-archive.
        expect(mockRecordGroupActivity).toHaveBeenCalledWith('group-1');
        expect(result.removedFromList).toBe(false);
        expect(result.updatedGroups).toEqual(groups);
    });

    it('remembers the group and removes the restored tab when restoreBehavior is removeFromList', async () => {
        const groups = [savedGroup()];
        mockGet.mockResolvedValue({
            restoreBehavior: 'removeFromList',
            groupMemoryEnabled: true,
            groupMemoryAutoRemember: true,
        });

        const result = await restoreSavedTabWithBehavior({
            url: 'https://example.com/a',
            tabId: 'tab-1',
            groupId: 'group-1',
            groups,
            active: false,
        });

        expect(mockRememberGroup).toHaveBeenCalledWith(groups[0]);
        expect(mockSet).toHaveBeenCalledTimes(1);
        const [, updatedGroups] = mockSet.mock.calls[0];
        expect(updatedGroups).toHaveLength(1);
        expect(updatedGroups[0].tabs.map((tab: { id: string }) => tab.id)).toEqual(['tab-2']);
        expect(result.removedFromList).toBe(true);
        expect(result.updatedGroups[0].tabs.map((tab) => tab.id)).toEqual(['tab-2']);
    });
});

describe('saveTabsToBlueTab', () => {
    it('reuses the remembered tab identity when a removed tab rejoins the same group', async () => {
        let storedGroups = [savedGroup()];
        let rememberedGroup: RememberedGroup | undefined;

        mockGet.mockImplementation(async (key: string) => {
            if (key === 'groups') return storedGroups;
            if (key === 'settings') {
                return {
                    restoreBehavior: 'removeFromList',
                    groupMemoryEnabled: true,
                    groupMemoryAutoRemember: true,
                };
            }
            return null;
        });
        mockSet.mockImplementation(async (key: string, value: TabGroup[]) => {
            if (key === 'groups') storedGroups = value;
        });
        mockRememberGroup.mockImplementation(async (group: TabGroup) => {
            rememberedGroup = {
                id: group.id,
                name: group.name,
                tabs: group.tabs.map((tab) => ({
                    url: tab.url,
                    title: tab.title,
                    favicon: tab.favicon,
                    originalId: tab.id,
                })),
                created: group.created,
                rememberedAt: NOW,
            };
        });
        mockPartitionTabsByMemory.mockImplementation(async (tabs) => ({
            buckets: new Map([[
                'group-1',
                { group: rememberedGroup as RememberedGroup, tabs },
            ]]),
            remainingTabs: [],
        }));

        await restoreSavedTabWithBehavior({
            url: 'https://example.com/a',
            tabId: 'tab-1',
            groupId: 'group-1',
            groups: storedGroups,
            active: false,
        });
        await saveTabsToBlueTab(
            [{ id: 11, title: 'A', url: 'https://example.com/a', pinned: false }],
            'Saved Tabs',
            { closeSourceTabs: false, now: NOW },
        );

        const restoredTab = storedGroups[0].tabs.find((tab) => tab.url === 'https://example.com/a');
        expect(restoredTab?.id).toBe('tab-1');
        expect(storedGroups[0].tabs.map((tab) => tab.id)).toEqual(['tab-2', 'tab-1']);
    });

    it('routes remembered tabs back into group memory without closing source tabs', async () => {
        const rememberedGroup: RememberedGroup = {
            id: 'remembered-1',
            name: 'Remembered',
            tabs: [],
            created: 123,
            rememberedAt: 456,
        };
        mockGet.mockImplementation(async (key: string) => {
            if (key === 'groups') return [];
            if (key === 'settings') return { groupMemoryEnabled: true };
            return null;
        });
        mockPartitionTabsByMemory.mockImplementation(async (tabs) => ({
            buckets: new Map([[rememberedGroup.id, { group: rememberedGroup, tabs }]]),
            remainingTabs: [],
        }));

        const result = await saveTabsToBlueTab(
            [{ id: 11, title: 'Remember me', url: 'https://example.com/remember', pinned: false }],
            'Saved Tabs',
            { closeSourceTabs: false, now: NOW },
        );

        expect(mockSet).toHaveBeenCalledTimes(1);
        const [, savedGroups] = mockSet.mock.calls[0];
        expect(savedGroups).toHaveLength(1);
        expect(savedGroups[0].id).toBe('remembered-1');
        expect(savedGroups[0].tabs[0].groupId).toBe('remembered-1');
        expect(mockTabsRemove).not.toHaveBeenCalled();
        expect(mockProcessTabs).not.toHaveBeenCalled();
        expect(result.memoryRestoredCount).toBe(1);
        expect(result.defaultGroupedCount).toBe(0);
        expect(result.closedCount).toBe(0);
    });

    it('creates a new group and closes source tabs when nothing hits memory or flow', async () => {
        mockGet.mockImplementation(async (key: string) => {
            if (key === 'groups') return [];
            if (key === 'settings') return {};
            return null;
        });
        mockPartitionTabsByMemory.mockImplementation(async (tabs) => ({ buckets: new Map(), remainingTabs: tabs }));
        mockGetFlowSettings.mockResolvedValue({ enabled: false, rules: [] });

        const result = await saveTabsToBlueTab(
            [{ id: 21, title: 'Fresh', url: 'https://example.com/fresh', pinned: false }],
            'Fresh Save',
            { closeSourceTabs: true, now: NOW },
        );

        expect(mockSet).toHaveBeenCalledTimes(1);
        const [, savedGroups] = mockSet.mock.calls[0];
        expect(savedGroups).toHaveLength(1);
        expect(savedGroups[0].name).toBe('Fresh Save');
        expect(savedGroups[0].tabs).toHaveLength(1);
        expect(savedGroups[0].tabs[0].groupId).toBe(savedGroups[0].id);
        expect(mockTabsRemove).toHaveBeenCalledWith([21]);
        expect(result.memoryRestoredCount).toBe(0);
        expect(result.defaultGroupedCount).toBe(1);
        expect(result.closedCount).toBe(1);
    });

    it('preserve_set mode keeps cross-domain tabs together in one explicit group', async () => {
        mockGet.mockImplementation(async (key: string) => {
            if (key === 'groups') return [];
            if (key === 'settings') return {};
            return null;
        });

        const result = await saveTabsToBlueTab(
            [
                { id: 51, title: 'Patika', url: 'https://www.patika.dev/blog/gpt-4o', pinned: false },
                { id: 52, title: 'Webrazzi', url: 'https://webrazzi.com/2025/04/07/ai-models', pinned: false },
            ],
            'AI Modelleri 2025',
            { closeSourceTabs: true, now: NOW, mode: 'preserve_set' as const },
        );

        expect(mockPartitionTabsByMemory).not.toHaveBeenCalled();
        expect(mockProcessTabs).not.toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalledTimes(1);
        const [, savedGroups] = mockSet.mock.calls[0];
        expect(savedGroups).toHaveLength(1);
        expect(savedGroups[0].name).toBe('AI Modelleri 2025');
        expect(savedGroups[0].tabs.map((tab: { title: string }) => tab.title)).toEqual([
            'Patika',
            'Webrazzi',
        ]);
        expect(mockTabsRemove).toHaveBeenCalledWith([51, 52]);
        expect(result.defaultGroupedCount).toBe(2);
        expect(result.memoryRestoredCount).toBe(0);
        expect(result.flowMatchedCount).toBe(0);
    });

    it('passes projectId into the default-created group and triggers auto-rename for untitled saves', async () => {
        mockGet.mockImplementation(async (key: string) => {
            if (key === 'groups') return [];
            if (key === 'settings') return {};
            return null;
        });
        mockPartitionTabsByMemory.mockImplementation(async (tabs) => ({ buckets: new Map(), remainingTabs: tabs }));
        mockGetFlowSettings.mockResolvedValue({ enabled: false, rules: [] });

        const result = await saveTabsToBlueTab(
            [{ id: 31, title: 'Fresh', url: 'https://example.com/fresh', pinned: false }],
            'Session 10:30:00 PM',
            { closeSourceTabs: false, now: NOW, projectId: 'project-1', isPro: true },
        );

        expect(mockSet).toHaveBeenCalledWith(
            'groups',
            expect.arrayContaining([
                expect.objectContaining({ projectId: 'project-1', name: 'Session 10:30:00 PM' }),
            ]),
        );
        expect(mockAutoRenameSavedGroupIfUntitled).toHaveBeenCalledWith(
            expect.objectContaining({
                initialName: 'Session 10:30:00 PM',
                isPro: true,
            }),
        );
        expect(result.defaultGroupedCount).toBe(1);
    });

    it('does not trigger auto-rename when all tabs are handled by memory restore', async () => {
        const rememberedGroup: RememberedGroup = {
            id: 'remembered-2',
            name: 'Remembered Two',
            tabs: [],
            created: 123,
            rememberedAt: 456,
        };
        mockGet.mockImplementation(async (key: string) => {
            if (key === 'groups') return [];
            if (key === 'settings') return { groupMemoryEnabled: true };
            return null;
        });
        mockPartitionTabsByMemory.mockImplementation(async (tabs) => ({
            buckets: new Map([[rememberedGroup.id, { group: rememberedGroup, tabs }]]),
            remainingTabs: [],
        }));

        await saveTabsToBlueTab(
            [{ id: 41, title: 'Remember me', url: 'https://example.com/remember', pinned: false }],
            'Session 11:00:00 PM',
            { closeSourceTabs: false, now: NOW, isPro: true },
        );

        expect(mockAutoRenameSavedGroupIfUntitled).not.toHaveBeenCalled();
    });
});
