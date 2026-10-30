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

import { DiscordAutoSyncService } from './discord-auto-sync';

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

describe('DiscordAutoSyncService group metadata parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(localStore)) delete localStore[key];
    localStore['discord_mirror:group-1'] = {
      messageId: 'discord-message-1',
      accountId: 'discord-account-1',
    };
  });

  it('updates the existing mapped root once when the group name changes', async () => {
    await DiscordAutoSyncService.handleGroupsChanged(
      [group()],
      [group({ name: 'Renamed research', modified: 2 })],
    );

    expect(mockDispatchVerb).toHaveBeenCalledTimes(1);
    expect(mockDispatchVerb).toHaveBeenCalledWith(
      'discord',
      'sync_group_mirroring',
      { groupId: 'group-1' },
      'discord-account-1',
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
    localStore['discord_mirror:group-2'] = {
      messageId: 'discord-message-2',
      accountId: 'discord-account-2',
    };
    localStore['slack_mirror:group-1'] = {
      channel: 'slack-channel',
      ts: 'slack-message',
      accountId: 'slack-account',
    };

    await DiscordAutoSyncService.handleGroupsChanged(
      [group({ notes: oldNote }), unrelated],
      [group({ notes: newNote, modified: 2 }), unrelated],
    );

    expect(mockDispatchVerb).toHaveBeenCalledTimes(1);
    expect(mockDispatchVerb).toHaveBeenCalledWith(
      'discord',
      'sync_group_mirroring',
      { groupId: 'group-1' },
      'discord-account-1',
    );
  });

  it('does not call Discord when rendered name and note are unchanged', async () => {
    await DiscordAutoSyncService.handleGroupsChanged(
      [group({ notes: 'Same note' })],
      [group({ notes: ' Same note ', modified: 2 })],
    );

    expect(mockDispatchVerb).not.toHaveBeenCalled();
  });
});
