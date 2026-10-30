import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
  },
}));

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
        text: 'Captured idea for Readwise',
        createdAt: 1,
        tabContext: { url: 'https://example.com/idea', title: 'Idea' },
      },
    ]),
  },
}));

import { adapter } from '../readwise/adapter';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('Readwise adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  describe('executeVerb save_article', () => {
    it('POSTs to /api/v2/highlights/ with Authorization Token (NOT Bearer) and a highlights array body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 1 }]), { status: 200 })
      );

      const result = await adapter.executeVerb(
        'save_article',
        { title: 'A', source_url: 'https://example.com/a', text: 'highlight' },
        'mock-tok',
        {}
      );

      expect(result).toMatchObject({ success: true });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://readwise.io/api/v2/highlights/',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Token mock-tok',
            'Content-Type': 'application/json',
          }),
        })
      );

      // Authorization scheme MUST be "Token", not "Bearer"
      const sentHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(sentHeaders.Authorization).toBe('Token mock-tok');
      expect(sentHeaders.Authorization).not.toContain('Bearer');

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(Array.isArray(body.highlights)).toBe(true);
      expect(body.highlights[0]).toMatchObject({
        title: 'A',
        source_url: 'https://example.com/a',
        text: 'highlight',
        source_type: 'web',
        category: 'articles',
      });
    });
  });

  describe('group + Brain Dump routing', () => {
    it('routes send_group_to_readwise to Reader API v3 — one save per tab', async () => {
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ id: 'doc-1' }), { status: 201 })
      );

      const result = await adapter.executeVerb(
        'send_group_to_readwise',
        { groupId: 'group-1' },
        'mock-tok',
        {}
      );

      expect(result).toMatchObject({ success: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Must use Reader API v3, NOT Highlights API
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toBe('https://readwise.io/api/v3/save/');
      expect(calledUrl).not.toContain('/api/v2/highlights');

      // Body must contain url field
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.url).toBeDefined();
      expect(body.highlights).toBeUndefined();
    });

    it('routes push_brain_dump_to_readwise through BrainDumpService.list', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 1 }]), { status: 200 })
      );

      const result = await adapter.executeVerb(
        'push_brain_dump_to_readwise',
        { entryId: 'entry-1' },
        'mock-tok',
        {}
      );

      expect(result).toMatchObject({ success: true });
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.highlights[0].text).toContain('Captured idea for Readwise');
      expect(body.highlights[0].source_url).toBe('https://example.com/idea');
    });
  });

  describe('validateToken', () => {
    it('GETs /api/v2/auth/ with Authorization Token; returns true on 204', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      const ok = await adapter.validateToken?.('mock-tok');
      expect(ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://readwise.io/api/v2/auth/',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Token mock-tok',
          }),
        })
      );
    });

    it('returns false on 401', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      const ok = await adapter.validateToken?.('bad-tok');
      expect(ok).toBe(false);
    });
  });

  describe('error handling', () => {
    it('throws the provider Response on 401 so dispatch can flag reauth', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(
        adapter.executeVerb(
          'save_article',
          { title: 'A', source_url: 'https://example.com/a', text: 'x' },
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
          'save_article',
          { title: 'A', source_url: 'https://example.com/a', text: 'x' },
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
      const adapterPath = path.resolve(__dirname, '../readwise/adapter.ts');
      const source = fs.readFileSync(adapterPath, 'utf-8');
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
      expect(stripped).not.toMatch(/Storage\.set\s*\(/);
    });
  });
});
