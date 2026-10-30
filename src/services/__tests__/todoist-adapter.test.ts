import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../utils/group-memory-storage', () => ({
  GroupMemoryStorageService: {
    getMemory: jest.fn(async () => ({
      groups: {
        'group-1': {
          id: 'group-1',
          name: 'Reading',
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
        text: 'Captured Todoist task',
        createdAt: 1,
        tabContext: { url: 'https://example.com/task', title: 'Task' },
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

import { adapter } from '../integrations/todoist/adapter';
import { TodoistSyncStorage } from '../todoist-sync-storage';
import { Storage } from '../../utils/storage';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
const mockStorageGet = Storage.get as jest.Mock;
const mockStorageSet = Storage.set as jest.Mock;

describe('Todoist adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    global.fetch = fetchMock;
    mockStorageGet.mockImplementation(async () => null);
    mockStorageSet.mockImplementation(async () => undefined);
  });

  it('creates a task via Todoist REST API', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'task-1', content: 'Read article', url: 'https://todoist.com/showTask?id=task-1' }), {
        status: 200,
      })
    );

    const result = await adapter.executeVerb(
      'create_task',
      { content: 'Read article', due_date: '2026-05-01', priority: 3 },
      'mock-tok',
      {}
    );

    expect(result).toEqual({
      success: true,
      result: { taskId: 'task-1', taskUrl: 'https://todoist.com/showTask?id=task-1' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/tasks',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer mock-tok' }),
      })
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ content: 'Read article', due_date: '2026-05-01', priority: 3 });
  });

  it('lists tasks with a since query for manual pull', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 'task-1',
            content: 'Read article',
            due: { date: '2026-05-01' },
            priority: 3,
            updated_at: '2026-04-20T00:00:00.000Z',
          },
        ]),
        { status: 200 }
      )
    );

    const result = await adapter.listRecords?.('mock-tok', {}, new Date('2026-04-20T00:00:00.000Z'));

    expect(result).toEqual([
      {
        id: 'task-1',
        content: 'Read article',
        due: { date: '2026-05-01' },
        priority: 3,
        updatedAt: Date.parse('2026-04-20T00:00:00.000Z'),
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/tasks?since=2026-04-20T00%3A00%3A00.000Z',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('throws provider Response for 401 and 429 so dispatch handles cross-cutting state', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(adapter.executeVerb('create_task', { content: 'Read article' }, 'mock-tok', {})).rejects.toMatchObject({ status: 401 });

    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
    await expect(adapter.executeVerb('create_task', { content: 'Read article' }, 'mock-tok', {})).rejects.toMatchObject({ status: 429 });
  });

  it('routes group and Brain Dump reads through services', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: 'task-1' }), { status: 200 }));

    await expect(adapter.executeVerb('send_group_to_todoist', { groupId: 'group-1' }, 'mock-tok', {})).resolves.toMatchObject({
      success: true,
      result: { created: 2, errors: 0 },
    });
    await expect(adapter.executeVerb('push_brain_dump_to_todoist', { entryId: 'entry-1' }, 'mock-tok', {})).resolves.toMatchObject({
      success: true,
    });
  });

  it('reuses the stored task mapping when a remembered tab rejoins its group', async () => {
    let syncData = {
      groups: {
        'group-1': {
          groupId: 'group-1',
          groupName: 'Reading',
          projectId: 'project-1',
          accountId: 'account-1',
          isAutoSync: true,
          createdAt: 1,
          lastSyncAt: 1,
          syncStatus: 'active' as const,
          taskCount: 1,
        },
      },
      tasks: {
        'tab-a': {
          tabId: 'tab-a',
          taskId: 'task-existing',
          groupId: 'group-1',
          groupName: 'Reading',
          tabTitle: 'Article A',
          tabUrl: 'https://example.com/a',
          projectId: 'project-1',
          accountId: 'account-1',
          createdAt: 1,
          lastSyncAt: 1,
          syncStatus: 'active' as const,
        },
      },
      groupToTasks: { 'group-1': ['task-existing'] },
    };
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === 'todoist_sync_data') return syncData;
      if (key === 'groups') {
        return [{
          id: 'group-1',
          name: 'Reading',
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
      if (key === 'todoist_sync_data') syncData = value;
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'task-duplicate' }), { status: 200 }),
    );

    const result = await adapter.executeVerb(
      'sync_group_changes_to_todoist',
      {
        groupId: 'group-1',
        action: 'add_tab',
        tabData: {
          id: 'tab-a',
          url: 'https://example.com/a',
          title: 'Article A',
        },
      },
      'mock-tok',
      { account_id: 'account-1', default_target: 'project-1' },
    );

    expect(result).toEqual({
      success: true,
      result: { synced: true, action: 'add_tab' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(TodoistSyncStorage.getTaskMapping('tab-a')).resolves.toMatchObject({
      taskId: 'task-existing',
      groupId: 'group-1',
    });
  });

  it('does not write storage directly or cache refresh tokens in the adapter file', () => {
    const adapterPath = path.resolve(__dirname, '../integrations/todoist/adapter.ts');
    const source = fs.readFileSync(adapterPath, 'utf-8');
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
    expect(stripped).not.toMatch(/Storage\.set\s*\(/);
    expect(stripped).not.toContain('refresh_token');
  });
});
