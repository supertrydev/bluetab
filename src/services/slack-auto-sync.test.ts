import type { TabGroup } from '../types/models';

const localStore: Record<string, unknown> = {};
const mockDispatchVerb = jest.fn(async () => ({ success: true }));

jest.mock('../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => localStore[key] ?? null),
  },
}));

jest.mock('../utils/group-memory-storage', () => ({
  GroupMemoryStorageService: {
    getMemory: jest.fn(async () => ({ groups: {}, urlIndex: {} })),
  },
}));

jest.mock('./integration-service', () => ({
  dispatchVerb: mockDispatchVerb,
}));

import { SlackAutoSyncService } from './slack-auto-sync';

function group(overrides: Partial<TabGroup> = {}): TabGroup {
  return {
    id: 'group-1',
    name: 'Research',
    notes: undefined,
    tabs: [{
      id: 'tab-1',
      url: 'https://example.com/a',
      title: 'A',
      groupId: 'group-1',
      timestamp: 1,
    }],
    created: 1,
    modified: 1,
    ...overrides,
  };
}

describe('SlackAutoSyncService group metadata parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(localStore)) delete localStore[key];
    localStore['slack_mirror:group-1'] = {
      channel: 'C01GROUP',
      ts: '1715000000.000700',
      accountId: 'slack-account-1',
    };
  });

  it('updates the existing mapped root once when the group name changes', async () => {
    await SlackAutoSyncService.handleGroupsChanged(
      [group()],
      [group({ name: 'Renamed research', modified: 2 })],
    );

    expect(mockDispatchVerb).toHaveBeenCalledTimes(1);
    expect(mockDispatchVerb).toHaveBeenCalledWith(
      'slack',
      'sync_group_mirroring',
      { groupId: 'group-1' },
      'slack-account-1',
    );
  });

  it.each([
    ['create', undefined, 'First note'],
    ['update', 'First note', 'Changed note'],
    ['delete', 'First note', undefined],
  ])('updates only the same mapped root on note %s', async (_case, oldNote, newNote) => {
    const unrelated = group({
      id: 'group-2',
      name: 'Unrelated',
      notes: 'Leave me alone',
      tabs: [],
    });
    localStore['slack_mirror:group-2'] = {
      channel: 'C02OTHER',
      ts: '1715000000.000800',
      accountId: 'slack-account-2',
    };

    await SlackAutoSyncService.handleGroupsChanged(
      [group({ notes: oldNote }), unrelated],
      [group({ notes: newNote, modified: 2 }), unrelated],
    );

    expect(mockDispatchVerb).toHaveBeenCalledTimes(1);
    expect(mockDispatchVerb).toHaveBeenCalledWith(
      'slack',
      'sync_group_mirroring',
      { groupId: 'group-1' },
      'slack-account-1',
    );
  });

  it('does not call Slack when rendered name and note are unchanged', async () => {
    await SlackAutoSyncService.handleGroupsChanged(
      [group({ notes: 'Same note' })],
      [group({ notes: 'Same note', modified: 2 })],
    );

    expect(mockDispatchVerb).not.toHaveBeenCalled();
  });
});
