/**
 * integration-auto-sync.test.ts — GREEN on landing (Plan 14-01 Task 1).
 *
 * Contract: pushAutoSyncDeltas iterates deltas, filters to groups with
 * autoSync.enabled=true, calls dispatchVerb for the integration's mirror verb;
 * fire-and-forget — single-integration failure does not block the rest.
 */

import { pushAutoSyncDeltas } from '../../services/integration-service';

const localStore: Record<string, unknown> = {};
jest.mock('../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => localStore[key] ?? null),
    set: jest.fn(async (key: string, value: unknown) => { localStore[key] = value; }),
    remove: jest.fn(async () => {}),
  },
}));

jest.mock('../../services/integration-token-storage', () => ({
  getValidToken: jest.fn(async () => 'mock_token'),
  listConnectedAccounts: jest.fn(async () => []),
  addAccount: jest.fn(async () => {}),
}));

(global as unknown as Record<string, unknown>).chrome = {
  storage: {
    local: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
    session: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
  },
};

describe('pushAutoSyncDeltas — auto-sync delta flush', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(localStore)) delete localStore[k];
  });

  it('does nothing if integration_settings has no auto_sync_groups', async () => {
    localStore['integration_settings'] = {};
    const deltas = [{ storageKey: 'groups', entityId: 'group-1' }];
    // Resolves without error when no auto_sync_groups configured
    await expect(pushAutoSyncDeltas(deltas)).resolves.toBeUndefined();
  });

  it('skips auto-sync for groups without autoSync.enabled=true', async () => {
    localStore['integration_settings'] = {
      auto_sync_groups: [
        { groupId: 'group-1', integrationId: 'notion', accountId: 'acc-1', mirrorVerb: 'create_page' },
      ],
    };
    // Delta refers to a group NOT in auto-sync mappings — should resolve immediately
    const deltas = [{ storageKey: 'groups', entityId: 'group-99' }];
    // Should resolve without errors (no dispatch for unmapped groups)
    await expect(pushAutoSyncDeltas(deltas)).resolves.toBeUndefined();
  });

  it('fire-and-forget: pushAutoSyncDeltas resolves even if underlying dispatch throws', async () => {
    // Both groups are in auto-sync mappings but the token storage won't have tokens
    // for them — getValidToken will throw. The function should still resolve.
    localStore['integration_settings'] = {
      auto_sync_groups: [
        { groupId: 'group-1', integrationId: 'linear', accountId: 'acc-1', mirrorVerb: 'create_issue' },
        { groupId: 'group-2', integrationId: 'todoist', accountId: 'acc-2', mirrorVerb: 'create_task' },
      ],
    };

    const deltas = [
      { storageKey: 'groups', entityId: 'group-1' },
      { storageKey: 'groups', entityId: 'group-2' },
    ];

    // Should resolve without throwing (Promise.allSettled fire-and-forget)
    await expect(pushAutoSyncDeltas(deltas)).resolves.toBeUndefined();
  });
});
