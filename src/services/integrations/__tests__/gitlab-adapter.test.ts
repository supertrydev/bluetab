import * as fs from 'fs';
import * as path from 'path';

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
        text: 'Captured idea for GitLab',
        createdAt: 1,
        tabContext: { url: 'https://example.com/idea', title: 'Idea' },
      },
    ]),
  },
}));

import { adapter } from '../gitlab/adapter';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('GitLab adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  describe('executeVerb create_issue', () => {
    it('POSTs to /api/v4/projects/{id}/issues with Bearer token and labels comma-joined', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            iid: 42,
            id: 9001,
            web_url: 'https://gitlab.com/me/mr/-/issues/42',
          }),
          { status: 201 }
        )
      );

      const result = await adapter.executeVerb(
        'create_issue',
        {
          project_id: '42',
          title: 'Bug',
          description: 'Crashes on load',
          labels: ['bug', 'p1'],
        },
        'mock-tok',
        {}
      );

      expect(result).toEqual({
        success: true,
        result: {
          issueIid: 42,
          issueUrl: 'https://gitlab.com/me/mr/-/issues/42',
        },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/42/issues',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-tok',
            'Content-Type': 'application/json',
          }),
        })
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.title).toBe('Bug');
      expect(body.description).toBe('Crashes on load');
      // Labels MUST be comma-joined per GitLab API spec
      expect(body.labels).toBe('bug,p1');
    });

    it('omits undefined optional fields from the body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ iid: 1, web_url: 'https://gitlab.com/me/mr/-/issues/1' }), { status: 201 })
      );

      await adapter.executeVerb(
        'create_issue',
        { project_id: '42', title: 'Title only' },
        'mock-tok',
        {}
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ title: 'Title only' });
      expect(JSON.stringify(body)).not.toContain('undefined');
    });
  });

  describe('group + Brain Dump routing', () => {
    it('routes send_group_to_gitlab through GroupMemoryStorageService and creates one issue for the group', async () => {
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ iid: 1, web_url: 'https://gitlab.com/me/mr/-/issues/1' }), { status: 201 })
      );

      const result = await adapter.executeVerb(
        'send_group_to_gitlab',
        { groupId: 'group-1', project_id: '42' },
        'mock-tok',
        {}
      );

      expect(result).toMatchObject({ success: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.title).toBe('[Bluetab] Bug triage');
      expect(body.description).toContain('Tabs from Bluetab group: Bug triage');
      expect(body.description).toContain('- [Crash report A](https://example.com/a)');
      expect(body.description).toContain('- [Crash report B](https://example.com/b)');
    });

    it('routes push_brain_dump_to_gitlab through BrainDumpService.list', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ iid: 5, web_url: 'https://gitlab.com/me/mr/-/issues/5' }), { status: 201 })
      );

      const result = await adapter.executeVerb(
        'push_brain_dump_to_gitlab',
        { entryId: 'entry-1', project_id: '42' },
        'mock-tok',
        {}
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
          { project_id: '42', title: 'Bug' },
          'mock-tok',
          {}
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
          { project_id: '42', title: 'Bug' },
          'mock-tok',
          {}
        )
      ).rejects.toMatchObject({ status: 429 });
    });

    it('returns unknown_verb for unrecognized verbs', async () => {
      const result = await adapter.executeVerb('mystery_verb', {}, 'mock-tok', {});
      expect(result).toEqual({ success: false, error: 'unknown_verb' });
    });
  });

  describe('XC-01 contract', () => {
    it('does not write storage directly in the adapter file', () => {
      const adapterPath = path.resolve(__dirname, '../gitlab/adapter.ts');
      const source = fs.readFileSync(adapterPath, 'utf-8');
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
      expect(stripped).not.toMatch(/Storage\.set\s*\(/);
    });
  });
});
