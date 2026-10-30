import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../brain-dump-service', () => ({
  BrainDumpService: {
    list: jest.fn(async () => [
      {
        id: 'entry-1',
        text: 'Captured idea for GitHub',
        createdAt: 1,
        tabContext: { url: 'https://example.com/idea', title: 'Idea' },
      },
    ]),
  },
}));

import { adapter } from '../github/adapter';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('GitHub adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  describe('executeVerb create_issue', () => {
    it('POSTs to /repos/{owner}/{repo}/issues with Bearer token and GitHub Accept header', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 9001,
            number: 42,
            html_url: 'https://github.com/me/mr/issues/42',
          }),
          { status: 201 }
        )
      );

      const result = await adapter.executeVerb(
        'create_issue',
        { owner: 'me', repo: 'mr', title: 'Bug', body: 'Crashes on load', labels: ['bug'] },
        'mock-tok',
        { login: 'me' }
      );

      expect(result).toEqual({
        success: true,
        result: { issueId: 9001, issueNumber: 42, issueUrl: 'https://github.com/me/mr/issues/42' },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/me/mr/issues',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-tok',
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
          }),
        })
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ title: 'Bug', body: 'Crashes on load', labels: ['bug'] });
    });

    it('omits undefined patch fields from the body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, number: 1, html_url: 'https://github.com/me/mr/issues/1' }), { status: 201 })
      );

      await adapter.executeVerb(
        'create_issue',
        { owner: 'me', repo: 'mr', title: 'Title only' },
        'mock-tok',
        { login: 'me' }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ title: 'Title only' });
      expect(JSON.stringify(body)).not.toContain('undefined');
    });
  });

  describe('executeVerb create_gist', () => {
    it('POSTs to /gists with the requested files map', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'g-1', html_url: 'https://gist.github.com/me/g-1' }),
          { status: 201 }
        )
      );

      const result = await adapter.executeVerb(
        'create_gist',
        {
          description: 'snippet',
          files: { 'note.md': { content: 'hello' } },
          public: false,
        },
        'mock-tok',
        { login: 'me' }
      );

      expect(result).toEqual({
        success: true,
        result: { gistId: 'g-1', gistUrl: 'https://gist.github.com/me/g-1' },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/gists',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-tok',
            Accept: 'application/vnd.github+json',
          }),
        })
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({
        description: 'snippet',
        public: false,
        files: { 'note.md': { content: 'hello' } },
      });
    });

    it('defaults public to false when not provided', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'g-2', html_url: 'https://gist.github.com/me/g-2' }), { status: 201 })
      );

      await adapter.executeVerb(
        'create_gist',
        { description: 'snippet', files: { 'note.md': { content: 'hi' } } },
        'mock-tok',
        { login: 'me' }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.public).toBe(false);
    });
  });

  describe('listRecords', () => {
    it('GETs /repos/{owner}/{repo}/issues with since= and state=all when since is provided', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 1,
              number: 11,
              title: 'Old',
              body: 'Body',
              state: 'open',
              updated_at: '2026-04-21T00:00:00.000Z',
            },
          ]),
          { status: 200 }
        )
      );

      const result = await adapter.listRecords?.(
        'mock-tok',
        { login: 'me', default_owner: 'me', default_repo: 'mr' },
        new Date('2026-04-20T00:00:00.000Z')
      );

      expect(result).toEqual([
        {
          id: 1,
          number: 11,
          title: 'Old',
          body: 'Body',
          state: 'open',
          updatedAt: Date.parse('2026-04-21T00:00:00.000Z'),
        },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/me/mr/issues?since=2026-04-20T00%3A00%3A00.000Z&state=all',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-tok',
            Accept: 'application/vnd.github+json',
          }),
        })
      );
    });

    it('omits since param but still requests state=all when since is undefined', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 })
      );

      await adapter.listRecords?.('mock-tok', { login: 'me', default_owner: 'me', default_repo: 'mr' });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/me/mr/issues?state=all',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('error handling', () => {
    it('throws the provider Response on 401 so dispatch can flag reauth', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(
        adapter.executeVerb(
          'create_issue',
          { owner: 'me', repo: 'mr', title: 'Bug' },
          'mock-tok',
          { login: 'me' }
        )
      ).rejects.toMatchObject({ status: 401 });
    });

    it('throws the provider Response on 429 so dispatch can read Retry-After', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
      await expect(
        adapter.executeVerb(
          'create_issue',
          { owner: 'me', repo: 'mr', title: 'Bug' },
          'mock-tok',
          { login: 'me' }
        )
      ).rejects.toMatchObject({ status: 429 });
    });
  });

  describe('Brain Dump routing', () => {
    it('routes push_brain_dump_to_github as an issue when kind=issue', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 5, number: 5, html_url: 'https://github.com/me/mr/issues/5' }), { status: 201 })
      );

      await expect(
        adapter.executeVerb(
          'push_brain_dump_to_github',
          { entryId: 'entry-1', owner: 'me', repo: 'mr', kind: 'issue' },
          'mock-tok',
          { login: 'me' }
        )
      ).resolves.toMatchObject({
        success: true,
        result: { issueId: 5, issueNumber: 5, issueUrl: 'https://github.com/me/mr/issues/5' },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/me/mr/issues',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('routes push_brain_dump_to_github as a gist when kind=gist', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'g-3', html_url: 'https://gist.github.com/me/g-3' }), { status: 201 })
      );

      await expect(
        adapter.executeVerb(
          'push_brain_dump_to_github',
          { entryId: 'entry-1', kind: 'gist' },
          'mock-tok',
          { login: 'me' }
        )
      ).resolves.toMatchObject({
        success: true,
        result: { gistId: 'g-3', gistUrl: 'https://gist.github.com/me/g-3' },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/gists',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('XC-01 contract', () => {
    it('does not write storage directly in the adapter file', () => {
      const adapterPath = path.resolve(__dirname, '../github/adapter.ts');
      const source = fs.readFileSync(adapterPath, 'utf-8');
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
      expect(stripped).not.toMatch(/Storage\.set\s*\(/);
    });
  });
});
