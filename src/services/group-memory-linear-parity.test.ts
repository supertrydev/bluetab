import type { TabGroup } from '../types/models';

const mockLocalStore: Record<string, unknown> = {};
const mockDispatchVerb = jest.fn();

jest.mock('../utils/storage', () => ({
    Storage: {
        get: jest.fn(async (key: string) => mockLocalStore[key] ?? null),
        set: jest.fn(async (key: string, value: unknown) => {
            mockLocalStore[key] = value;
        }),
        getProjects: jest.fn(async () => []),
    },
}));

jest.mock('./integration-service', () => ({
    dispatchVerb: (...args: unknown[]) => mockDispatchVerb(...args),
}));

jest.mock('./integration-token-storage', () => ({
    listConnectedAccounts: jest.fn(async () => []),
}));

jest.mock('../utils/auth-state', () => ({
    getAccessToken: jest.fn(async () => 'extension-session'),
}));

import {
    addTabToExistingGroup,
    restoreSavedTabWithBehavior,
} from './saved-tab-actions';
import { LinearAutoSyncService } from './linear-auto-sync';
import { LinearSyncStorage } from './linear-sync-storage';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import { adapter as linearAdapter } from './integrations/linear/adapter';
import { createCloudConnectionCredential } from './integrations/cloud-operation-client';

const GROUP_ID = 'group-1';
const TARGET_URL = 'https://duckduckgo.com/?ia=web&q=google';
const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

function cloneGroups(): TabGroup[] {
    return structuredClone(mockLocalStore.groups as TabGroup[]);
}

describe('Group Memory Linear runtime parity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        for (const key of Object.keys(mockLocalStore)) delete mockLocalStore[key];

        mockLocalStore.settings = {
            duplicateHandling: 'reject',
            groupMemoryAutoRemember: true,
            groupMemoryEnabled: true,
            restoreBehavior: 'removeFromList',
        };
        mockLocalStore.groups = [{
            id: GROUP_ID,
            name: 'Research',
            tabs: [{
                id: 'keeper-tab',
                url: 'https://supertry.net/',
                title: 'Supertry',
                groupId: GROUP_ID,
                timestamp: 1,
            }],
            created: 1,
            modified: 1,
        } satisfies TabGroup];

        (chrome.tabs.create as jest.Mock).mockResolvedValue({ id: 101 });
        fetchMock.mockReset();
        global.fetch = fetchMock;
        mockDispatchVerb.mockImplementation(async (
            integrationId: string,
            verb: string,
            args: Record<string, unknown>,
        ) => {
            if (integrationId !== 'linear') throw new Error('unexpected_integration');
            return linearAdapter.executeVerb(
                verb,
                args,
                createCloudConnectionCredential('connection-1'),
                { account_id: 'account-1', team_id: 'team-1' },
            );
        });
    });

    it('does not create a second Linear issue when a memory-preserved tab is saved back to its group', async () => {
        await LinearSyncStorage.startGroupSync(GROUP_ID, 'Research', 'team-1', 'account-1');
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({
                data: {
                    issueCreate: {
                        success: true,
                        issue: { id: 'issue-existing', url: 'https://linear.app/issue/issue-existing' },
                    },
                },
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                data: {
                    issueCreate: {
                        success: true,
                        issue: { id: 'issue-duplicate', url: 'https://linear.app/issue/issue-duplicate' },
                    },
                },
            }), { status: 200 }));

        const beforeFirstSave = cloneGroups();
        const firstSave = await addTabToExistingGroup({
            id: 11,
            title: 'google at DuckDuckGo',
            url: TARGET_URL,
            favIconUrl: 'https://duckduckgo.com/favicon.ico',
            pinned: false,
        }, GROUP_ID, 2);
        const afterFirstSave = cloneGroups();
        await LinearAutoSyncService.handleGroupsChanged(beforeFirstSave, afterFirstSave);

        const originalTabId = firstSave?.addedTab.id;
        expect(originalTabId).toEqual(expect.any(String));
        await expect(LinearSyncStorage.getIssueMapping(originalTabId!)).resolves.toMatchObject({
            issueId: 'issue-existing',
            groupId: GROUP_ID,
        });

        const beforeMemoryClick = cloneGroups();
        const clickResult = await restoreSavedTabWithBehavior({
            url: TARGET_URL,
            tabId: originalTabId!,
            groupId: GROUP_ID,
            groups: beforeMemoryClick,
            active: false,
        });
        await LinearAutoSyncService.handleGroupsChanged(beforeMemoryClick, clickResult.updatedGroups);

        const memory = await GroupMemoryStorageService.getMemory();
        expect(memory.groups[GROUP_ID].tabs).toEqual(expect.arrayContaining([
            expect.objectContaining({ url: TARGET_URL, originalId: originalTabId }),
        ]));
        await expect(LinearSyncStorage.getIssueMapping(originalTabId!)).resolves.toMatchObject({
            issueId: 'issue-existing',
        });

        const beforeSecondSave = cloneGroups();
        const secondSave = await addTabToExistingGroup({
            id: 12,
            title: 'google at DuckDuckGo',
            url: TARGET_URL,
            favIconUrl: 'https://duckduckgo.com/favicon.ico',
            pinned: false,
        }, GROUP_ID, 3);
        const afterSecondSave = cloneGroups();
        await LinearAutoSyncService.handleGroupsChanged(beforeSecondSave, afterSecondSave);

        const createCalls = fetchMock.mock.calls.filter(([url]) => (
            String(url).endsWith('/operations/linear.issue.create')
        ));
        expect(createCalls).toHaveLength(1);
        expect(secondSave?.addedTab.id).toBe(originalTabId);
        await expect(LinearSyncStorage.getGroupIssues(GROUP_ID)).resolves.toEqual([
            expect.objectContaining({
                tabId: originalTabId,
                issueId: 'issue-existing',
            }),
        ]);
    });
});
