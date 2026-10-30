import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async () => null),
  },
}));

jest.mock('../../../utils/group-memory-storage', () => ({
  GroupMemoryStorageService: {
    getMemory: jest.fn(async () => ({
      groups: {
        'group-1': {
          id: 'group-1',
          name: 'Bug triage',
          tabs: [
            { url: 'https://example.com/a', title: 'Crash report A', originalId: 'tab-a' },
            { url: 'https://example.com/b', title: 'Crash report B', originalId: 'tab-b' },
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
        text: 'Captured idea for Jira',
        createdAt: 1,
        tabContext: { url: 'https://example.com/idea', title: 'Idea' },
      },
    ]),
  },
}));

import { adapter } from '../jira/adapter';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('Jira adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
    const storageMock = jest.requireMock('../../../utils/storage');
    storageMock.Storage.get.mockImplementation(async () => null);
  });

  describe('executeVerb create_issue', () => {
    it('POSTs to https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/issue with Bearer auth and ADF description shape', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ key: 'BTAB-12', id: '10001' }),
          { status: 201 }
        )
      );

      const result = await adapter.executeVerb(
        'create_issue',
        {
          project_key: 'BTAB',
          summary: 'Bug',
          description: 'Crashes on load',
          issuetype: 'Task',
        },
        'mock-tok',
        { cloud_id: 'cid-1', site_url: 'https://acme.atlassian.net' }
      );

      expect(result).toEqual({
        success: true,
        result: {
          issueKey: 'BTAB-12',
          issueUrl: 'https://acme.atlassian.net/browse/BTAB-12',
        },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.atlassian.com/ex/jira/cid-1/rest/api/3/issue',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-tok',
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        })
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.fields.project).toEqual({ key: 'BTAB' });
      expect(body.fields.summary).toBe('Bug');
      expect(body.fields.issuetype).toEqual({ name: 'Task' });
      // ADF doc shape per RESEARCH §Pitfall — Jira API v3 demands ADF, not plain text
      expect(body.fields.description).toEqual({
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Crashes on load' }],
          },
        ],
      });
    });

    it("defaults issuetype to 'Task' when omitted", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ key: 'BTAB-13' }), { status: 201 })
      );

      await adapter.executeVerb(
        'create_issue',
        { project_key: 'BTAB', summary: 'Title only' },
        'mock-tok',
        { cloud_id: 'cid-1', site_url: 'https://acme.atlassian.net' }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.fields.issuetype).toEqual({ name: 'Task' });
    });

    it('uses accountMeta.project_key when args.project_key is missing', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ key: 'BTAB-14' }), { status: 201 })
      );

      const result = await adapter.executeVerb(
        'create_issue',
        { summary: 'Default project target' },
        'mock-tok',
        {
          cloud_id: 'cid-1',
          site_url: 'https://acme.atlassian.net',
          project_key: 'BTAB',
        }
      );

      expect(result).toMatchObject({ success: true });
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.fields.project).toEqual({ key: 'BTAB' });
    });
  });

  describe('group + Brain Dump routing', () => {
    it('routes send_group_to_jira through GroupMemoryStorageService and creates one issue for the whole group', async () => {
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ key: 'BTAB-99' }), { status: 201 })
      );

      const result = await adapter.executeVerb(
        'send_group_to_jira',
        { groupId: 'group-1', project_key: 'BTAB' },
        'mock-tok',
        { cloud_id: 'cid-1', site_url: 'https://acme.atlassian.net' }
      );

      expect(result).toMatchObject({ success: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.fields.summary).toBe('Bug triage');
      expect(body.fields.description.content[0].content[0].text).toContain('1. Crash report A');
      expect(body.fields.description.content[0].content[0].text).toContain('https://example.com/a');
      expect(body.fields.description.content[0].content[0].text).toContain('2. Crash report B');
      expect(body.fields.description.content[0].content[0].text).toContain('https://example.com/b');
    });

    it('reads groups from live storage when not found in group memory', async () => {
      const storageMock = jest.requireMock('../../../utils/storage');
      storageMock.Storage.get.mockImplementation(async (key: string) => {
        if (key === 'groups') {
          return [
            {
              id: 'live-group',
              name: 'Live Jira group',
              tabs: [{ url: 'https://example.com/live', title: 'Live tab' }],
            },
          ];
        }
        return null;
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ key: 'BTAB-100' }), { status: 201 })
      );

      const result = await adapter.executeVerb(
        'send_group_to_jira',
        { groupId: 'live-group', project_key: 'BTAB' },
        'mock-tok',
        { cloud_id: 'cid-1', site_url: 'https://acme.atlassian.net' }
      );

      expect(result).toMatchObject({ success: true });
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.fields.summary).toBe('Live Jira group');
      expect(body.fields.description.content[0].content[0].text).toContain('Live tab');
      expect(body.fields.description.content[0].content[0].text).toContain('https://example.com/live');
    });

    it('routes push_brain_dump_to_jira through BrainDumpService.list', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ key: 'BTAB-77' }), { status: 201 })
      );

      const result = await adapter.executeVerb(
        'push_brain_dump_to_jira',
        { entryId: 'entry-1', project_key: 'BTAB' },
        'mock-tok',
        { cloud_id: 'cid-1', site_url: 'https://acme.atlassian.net' }
      );

      expect(result).toMatchObject({ success: true });
    });
  });

  describe('error handling', () => {
    it('throws the provider Response on 401 so dispatch can flag reauth', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(
        adapter.executeVerb(
          'create_issue',
          { project_key: 'BTAB', summary: 'Bug' },
          'mock-tok',
          { cloud_id: 'cid-1', site_url: 'https://acme.atlassian.net' }
        )
      ).rejects.toMatchObject({ status: 401 });
    });

    it('throws the provider Response on 429 so dispatch can read Retry-After', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '2' } })
      );
      await expect(
        adapter.executeVerb(
          'create_issue',
          { project_key: 'BTAB', summary: 'Bug' },
          'mock-tok',
          { cloud_id: 'cid-1', site_url: 'https://acme.atlassian.net' }
        )
      ).rejects.toMatchObject({ status: 429 });
    });

    it('returns unknown_verb for unrecognized verbs', async () => {
      const result = await adapter.executeVerb('mystery_verb', {}, 'mock-tok', {
        cloud_id: 'cid-1',
        site_url: 'https://acme.atlassian.net',
      });
      expect(result).toEqual({ success: false, error: 'unknown_verb' });
    });
  });

  describe('XC-01 contract', () => {
    it('does not write storage directly in the adapter file', () => {
      const adapterPath = path.resolve(__dirname, '../jira/adapter.ts');
      const source = fs.readFileSync(adapterPath, 'utf-8');
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
      expect(stripped).not.toMatch(/Storage\.set\s*\(/);
    });
  });
});
