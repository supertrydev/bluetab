import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../../utils/group-memory-storage', () => ({
  GroupMemoryStorageService: {
    getMemory: jest.fn(async () => ({
      groups: {
        'group-1': {
          id: 'group-1',
          name: 'Reading list',
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

jest.mock('../../brain-dump-service', () => ({
  BrainDumpService: {
    list: jest.fn(async () => [
      {
        id: 'entry-1',
        text: 'Captured idea for Asana',
        createdAt: 1,
        tabContext: { url: 'https://example.com/idea', title: 'Idea' },
      },
    ]),
  },
}));

import { adapter } from '../asana/adapter';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('Asana adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  describe('executeVerb create_task', () => {
    it('POSTs to https://app.asana.com/api/1.0/tasks with Bearer token and a {data: ...} body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { gid: '12345' } }),
          { status: 201 }
        )
      );

      const result = await adapter.executeVerb(
        'create_task',
        { name: 'Ship Asana', notes: 'first task', project: 'proj-gid' },
        'mock-tok',
        { workspace_gid: 'wgid' }
      );

      expect(result).toEqual({
        success: true,
        result: {
          taskGid: '12345',
          taskUrl: 'https://app.asana.com/0/proj-gid/12345',
        },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://app.asana.com/api/1.0/tasks',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-tok',
            'Content-Type': 'application/json',
          }),
        })
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      // Asana wraps every body in { data: ... }
      expect(body.data).toBeDefined();
      expect(body.data.name).toBe('Ship Asana');
      expect(body.data.notes).toBe('first task');
      expect(body.data.workspace).toBe('wgid');
      expect(body.data.projects).toEqual(['proj-gid']);
    });

    it('omits projects array when no project is supplied', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { gid: '999' } }), { status: 201 })
      );

      await adapter.executeVerb(
        'create_task',
        { name: 'Loose task' },
        'mock-tok',
        { workspace_gid: 'wgid' }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.data.projects).toEqual([]);
      expect(body.data.workspace).toBe('wgid');
    });

    it('uses args.workspace when provided in preference to accountMeta.workspace_gid', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { gid: '888' } }), { status: 201 })
      );

      await adapter.executeVerb(
        'create_task',
        { name: 'Cross workspace', workspace: 'override-wgid' },
        'mock-tok',
        { workspace_gid: 'wgid' }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.data.workspace).toBe('override-wgid');
    });
  });

  describe('group + Brain Dump routing', () => {
    it('routes send_group_to_asana through GroupMemoryStorageService and creates one task for the group', async () => {
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ data: { gid: 'g' } }), { status: 201 })
      );

      const result = await adapter.executeVerb(
        'send_group_to_asana',
        { groupId: 'group-1' },
        'mock-tok',
        { workspace_gid: 'wgid' }
      );

      expect(result).toMatchObject({ success: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.data.name).toBe('Reading list');
      expect(body.data.notes).toContain('1. Article A');
      expect(body.data.notes).toContain('2. Article B');
    });

    it('routes push_brain_dump_to_asana through BrainDumpService.list', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { gid: 'bd' } }), { status: 201 })
      );

      const result = await adapter.executeVerb(
        'push_brain_dump_to_asana',
        { entryId: 'entry-1' },
        'mock-tok',
        { workspace_gid: 'wgid' }
      );

      expect(result).toMatchObject({ success: true });
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.data.notes).toContain('Captured idea for Asana');
    });
  });

  describe('error handling', () => {
    it('throws the provider Response on 401 so dispatch can flag reauth', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(
        adapter.executeVerb('create_task', { name: 'X' }, 'mock-tok', { workspace_gid: 'wgid' })
      ).rejects.toMatchObject({ status: 401 });
    });

    it('throws the provider Response on 429 so dispatch can read Retry-After', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '2' } })
      );
      await expect(
        adapter.executeVerb('create_task', { name: 'X' }, 'mock-tok', { workspace_gid: 'wgid' })
      ).rejects.toMatchObject({ status: 429 });
    });

    it('returns unknown_verb for unrecognized verbs', async () => {
      const result = await adapter.executeVerb('mystery_verb', {}, 'mock-tok', {
        workspace_gid: 'wgid',
      });
      expect(result).toEqual({ success: false, error: 'unknown_verb' });
    });
  });

  describe('XC-01 contract', () => {
    it('does not write storage directly in the adapter file', () => {
      const adapterPath = path.resolve(__dirname, '../asana/adapter.ts');
      const source = fs.readFileSync(adapterPath, 'utf-8');
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
      expect(stripped).not.toMatch(/Storage\.set\s*\(/);
    });
  });
});
