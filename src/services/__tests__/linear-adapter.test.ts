import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../utils/group-memory-storage', () => ({
  GroupMemoryStorageService: {
    getMemory: jest.fn(async () => ({
      groups: {
        'group-1': {
          id: 'group-1',
          name: 'Research',
          tabs: [
            { url: 'https://example.com/a', title: 'Article A', originalId: 'tab-a' },
            { url: 'https://example.com/b', title: 'Article B', originalId: 'tab-b' },
          ],
          created: 1,
          rememberedAt: 2,
        },
      },
      urlIndex: {},
    })),
  },
}));

jest.mock('../../services/brain-dump-service', () => ({
  BrainDumpService: {
    list: jest.fn(async () => [
      {
        id: 'entry-1',
        text: 'Captured idea for Linear',
        createdAt: 1,
        tabContext: { url: 'https://example.com/idea', title: 'Idea' },
      },
    ]),
  },
}));

jest.mock('../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  },
}));

const mockGetAccessToken = jest.fn(async () => 'extension-session');
jest.mock('../../utils/auth-state', () => ({
  getAccessToken: () => mockGetAccessToken(),
}));

import { adapter } from '../integrations/linear/adapter';
import { createCloudConnectionCredential } from '../integrations/cloud-operation-client';
import { LinearSyncStorage } from '../linear-sync-storage';
import { Storage } from '../../utils/storage';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
const mockStorageGet = Storage.get as jest.Mock;
const mockStorageSet = Storage.set as jest.Mock;

describe('Linear adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    global.fetch = fetchMock;
    mockStorageGet.mockImplementation(async () => null);
    mockStorageSet.mockImplementation(async () => undefined);
  });

  it('creates an issue via Linear GraphQL', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            issueCreate: {
              success: true,
              issue: { id: 'i-1', title: 'Bug', url: 'https://linear.app/issue/i-1' },
            },
          },
        }),
        { status: 200 }
      )
    );

    const result = await adapter.executeVerb(
      'create_issue',
      { title: 'Bug', teamId: 'team-123', priority: 2 },
      'mock-tok',
      {}
    );

    expect(result).toEqual({
      success: true,
      result: { issueId: 'i-1', issueUrl: 'https://linear.app/issue/i-1' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer mock-tok' }),
      })
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.query).toContain('mutation issueCreate');
    expect(body.variables.input).toEqual({ title: 'Bug', teamId: 'team-123', priority: 2 });
  });

  it('routes a Cloud connection through Web without calling Linear directly', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            issueCreate: {
              success: true,
              issue: { id: 'i-cloud', url: 'https://linear.app/issue/i-cloud' },
            },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await adapter.executeVerb(
      'create_issue',
      { title: 'Cloud bug', teamId: 'team-123' },
      createCloudConnectionCredential('connection-1'),
      {},
    );

    expect(result).toEqual({
      success: true,
      result: { issueId: 'i-cloud', issueUrl: 'https://linear.app/issue/i-cloud' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'https://supertry.net/api/v1/integrations/connection-1/operations/linear.issue.create',
    );
    expect(String(url)).not.toContain('api.linear.app');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer extension-session');
    expect(JSON.parse(String(init?.body))).toEqual({
      input: { variables: { input: { title: 'Cloud bug', teamId: 'team-123' } } },
    });
  });

  it('updates an issue and omits undefined patch fields', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { issueUpdate: { success: true } } }), { status: 200 })
    );

    const result = await adapter.executeVerb(
      'update_issue',
      { issueId: 'i-1', priority: 3, title: undefined },
      'mock-tok',
      {}
    );

    expect(result).toEqual({ success: true, result: { updated: true } });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.query).toContain('mutation issueUpdate');
    expect(body.variables).toEqual({ id: 'i-1', input: { priority: 3 } });
    expect(JSON.stringify(body)).not.toContain('undefined');
  });

  it('lists updated issues for manual pull', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  id: 'i-1',
                  title: 'Issue',
                  description: 'Details',
                  state: { name: 'Open' },
                  updatedAt: '2026-04-20T00:00:00.000Z',
                },
              ],
            },
          },
        }),
        { status: 200 }
      )
    );

    const result = await adapter.listRecords?.('mock-tok', {}, new Date('2026-04-20T00:00:00.000Z'));

    expect(result).toEqual([
      {
        id: 'i-1',
        title: 'Issue',
        description: 'Details',
        state: 'Open',
        updatedAt: Date.parse('2026-04-20T00:00:00.000Z'),
      },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.query).toContain('query issues');
    expect(body.variables.filter).toEqual({ updatedAt: { gt: '2026-04-20T00:00:00.000Z' } });
  });

  it('throws provider Response for 401 and 429 so dispatch handles cross-cutting state', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(adapter.executeVerb('create_issue', { title: 'Bug', teamId: 'team-123' }, 'mock-tok', {})).rejects.toMatchObject({ status: 401 });

    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
    await expect(adapter.executeVerb('create_issue', { title: 'Bug', teamId: 'team-123' }, 'mock-tok', {})).rejects.toMatchObject({ status: 429 });
  });

  it('routes group and Brain Dump reads through services', async () => {
    fetchMock.mockImplementation(async () =>
      new Response(
        JSON.stringify({ data: { issueCreate: { success: true, issue: { id: 'i-1', url: 'https://linear.app/issue/i-1' } } } }),
        { status: 200 }
      )
    );

    await expect(adapter.executeVerb('send_group_to_linear', { groupId: 'group-1', teamId: 'team-123' }, 'mock-tok', {})).resolves.toMatchObject({
      success: true,
      result: { created: 2, errors: 0 },
    });
    await expect(adapter.executeVerb('push_brain_dump_to_linear', { entryId: 'entry-1', teamId: 'team-123' }, 'mock-tok', {})).resolves.toMatchObject({
      success: true,
    });
  });

  it('reuses the stored issue mapping when a remembered tab rejoins its group', async () => {
    let syncData = {
      groups: {
        'group-1': {
          groupId: 'group-1',
          groupName: 'Research',
          teamId: 'team-123',
          accountId: 'account-1',
          isAutoSync: true,
          createdAt: 1,
          lastSyncAt: 1,
          syncStatus: 'active' as const,
          issueCount: 1,
        },
      },
      issues: {
        'tab-a': {
          tabId: 'tab-a',
          issueId: 'issue-existing',
          groupId: 'group-1',
          groupName: 'Research',
          tabTitle: 'Article A',
          tabUrl: 'https://example.com/a',
          teamId: 'team-123',
          accountId: 'account-1',
          createdAt: 1,
          lastSyncAt: 1,
          syncStatus: 'active' as const,
        },
      },
      groupToIssues: { 'group-1': ['issue-existing'] },
    };
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === 'linear_sync_data') return syncData;
      if (key === 'groups') {
        return [{
          id: 'group-1',
          name: 'Research',
          tabs: [{
            id: 'tab-a',
            url: 'https://example.com/a',
            title: 'Article A',
            groupId: 'group-1',
            timestamp: 2,
          }],
          created: 1,
          modified: 2,
        }];
      }
      return null;
    });
    mockStorageSet.mockImplementation(async (key: string, value: typeof syncData) => {
      if (key === 'linear_sync_data') syncData = value;
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            issueCreate: {
              success: true,
              issue: { id: 'issue-duplicate', url: 'https://linear.app/issue/issue-duplicate' },
            },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await adapter.executeVerb(
      'sync_group_changes_to_linear',
      {
        groupId: 'group-1',
        action: 'add_tab',
        teamId: 'team-123',
        tabData: {
          id: 'tab-a',
          url: 'https://example.com/a',
          title: 'Article A',
        },
      },
      createCloudConnectionCredential('connection-1'),
      { account_id: 'account-1', team_id: 'team-123' },
    );

    expect(result).toEqual({
      success: true,
      result: {
        synced: true,
        actions: ['Reused issue issue-existing for remembered tab'],
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(LinearSyncStorage.getIssueMapping('tab-a')).resolves.toMatchObject({
      issueId: 'issue-existing',
      groupId: 'group-1',
    });
  });

  it('does not write storage directly in the adapter file', () => {
    const adapterPath = path.resolve(__dirname, '../integrations/linear/adapter.ts');
    const source = fs.readFileSync(adapterPath, 'utf-8');
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
    expect(stripped).not.toMatch(/Storage\.set\s*\(/);
  });
});
