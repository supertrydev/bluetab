import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../../utils/group-memory-storage', () => ({
  GroupMemoryStorageService: {
    getMemory: jest.fn(async () => ({ groups: {}, urlIndex: {} })),
  },
}));

// Live tab-group store. send_group_to_notion now reads here first
// (chrome.storage.local 'groups') and falls back to the memory store
// only if the id is not found.
jest.mock('../../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => {
      if (key === 'groups') {
        return [
          {
            id: 'group-1',
            name: 'Research',
            tabs: [
              { url: 'https://example.com/a', title: 'Article A' },
              { url: 'https://example.com/b', title: 'Article B' },
            ],
          },
        ];
      }
      return null;
    }),
    set: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
  },
}));

jest.mock('../../brain-dump-service', () => ({
  BrainDumpService: {
    list: jest.fn(async () => [
      {
        id: 'entry-1',
        text: 'Captured idea for Notion',
        createdAt: 1,
        tabContext: { url: 'https://example.com/idea', title: 'Idea' },
      },
    ]),
  },
}));

import { adapter, syncDatabaseIncrementally } from '../notion/adapter';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('Notion adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  describe('executeVerb create_page', () => {
    it('POSTs to /v1/pages with Notion-Version header and a Bearer token', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'page-1',
            url: 'https://notion.so/page-1',
          }),
          { status: 200 }
        )
      );

      const result = await adapter.executeVerb(
        'create_page',
        { parent: { page_id: 'p1' }, title: 'My page', content: 'hello' },
        'mock-tok',
        { workspace_id: 'w1' }
      );

      expect(result).toEqual({
        success: true,
        result: { pageId: 'page-1', pageUrl: 'https://notion.so/page-1' },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.notion.com/v1/pages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-tok',
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          }),
        })
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.parent).toEqual({ page_id: 'p1' });
      expect(body.properties.title).toEqual([{ text: { content: 'My page' } }]);
      expect(body.children).toHaveLength(1);
      expect(body.children[0]).toMatchObject({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: 'hello' } }],
        },
      });
    });

    it('omits children when content is missing', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'page-2', url: 'https://notion.so/page-2' }), { status: 200 })
      );

      await adapter.executeVerb(
        'create_page',
        { parent: { database_id: 'd1' }, title: 'Just title' },
        'mock-tok',
        { workspace_id: 'w1' }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.children).toEqual([]);
    });
  });

  describe('executeVerb append_to_database', () => {
    it('threads parent.database_id and properties through to /v1/pages', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'page-3', url: 'https://notion.so/page-3' }), { status: 200 })
      );

      const properties = { Name: { title: [{ text: { content: 'Tab title' } }] } };
      const result = await adapter.executeVerb(
        'append_to_database',
        { database_id: 'd1', properties },
        'mock-tok',
        { workspace_id: 'w1' }
      );

      expect(result).toEqual({
        success: true,
        result: { pageId: 'page-3', pageUrl: 'https://notion.so/page-3' },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.notion.com/v1/pages',
        expect.objectContaining({ method: 'POST' })
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.parent).toEqual({ database_id: 'd1' });
      expect(body.properties).toEqual(properties);
    });
  });

  describe('listRecords', () => {
    it('queries the configured database with a last_edited_time filter when since is provided', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                id: 'page-9',
                properties: { Name: { title: [{ text: { content: 'Hi' } }] } },
                last_edited_time: '2026-04-21T00:00:00.000Z',
                url: 'https://notion.so/page-9',
              },
            ],
          }),
          { status: 200 }
        )
      );

      const result = await adapter.listRecords?.(
        'mock-tok',
        { workspace_id: 'w1', default_database_id: 'd1' },
        new Date('2026-04-20T00:00:00.000Z')
      );

      expect(result).toEqual([
        {
          id: 'page-9',
          properties: { Name: { title: [{ text: { content: 'Hi' } }] } },
          last_edited_time: Date.parse('2026-04-21T00:00:00.000Z'),
          url: 'https://notion.so/page-9',
        },
      ]);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.notion.com/v1/databases/d1/query',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-tok',
            'Notion-Version': '2022-06-28',
          }),
        })
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({
        filter: {
          timestamp: 'last_edited_time',
          last_edited_time: { after: '2026-04-20T00:00:00.000Z' },
        },
      });
    });

    it('sends an empty body when since is not provided', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 })
      );

      await adapter.listRecords?.('mock-tok', { workspace_id: 'w1', default_database_id: 'd1' });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({});
    });
  });

  describe('error handling', () => {
    it('throws the provider Response on 401 so dispatch can flag reauth', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(
        adapter.executeVerb(
          'create_page',
          { parent: { page_id: 'p1' }, title: 'My page' },
          'mock-tok',
          { workspace_id: 'w1' }
        )
      ).rejects.toMatchObject({ status: 401 });
    });

    it('throws the provider Response on 429 so dispatch can read Retry-After', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
      await expect(
        adapter.executeVerb(
          'create_page',
          { parent: { page_id: 'p1' }, title: 'My page' },
          'mock-tok',
          { workspace_id: 'w1' }
        )
      ).rejects.toMatchObject({ status: 429 });
    });
  });

  describe('group and Brain Dump routing', () => {
    it('routes send_group_to_notion through the live groups store and creates one page per tab', async () => {
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ id: 'page-x', url: 'https://notion.so/page-x' }), { status: 200 })
      );

      await expect(
        adapter.executeVerb(
          'send_group_to_notion',
          { groupId: 'group-1', parent: { database_id: 'd1' } },
          'mock-tok',
          { workspace_id: 'w1' }
        )
      ).resolves.toMatchObject({
        success: true,
        result: { created: 2, errors: 0 },
      });
    });

    it('routes push_brain_dump_to_notion through BrainDumpService.list', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'page-bd', url: 'https://notion.so/page-bd' }), { status: 200 })
      );

      await expect(
        adapter.executeVerb(
          'push_brain_dump_to_notion',
          { entryId: 'entry-1', parent: { page_id: 'p1' } },
          'mock-tok',
          { workspace_id: 'w1' }
        )
      ).resolves.toMatchObject({
        success: true,
        result: { pageId: 'page-bd', pageUrl: 'https://notion.so/page-bd' },
      });
    });
  });

  describe('mirror mapping migration', () => {
    it('backfills a stable tab id mapping from the existing exact-URL legacy row', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{
          id: 'page-existing',
          properties: {
            Name: { title: [{ text: { content: 'Article A' } }] },
            URL: { url: 'https://example.com/a' },
          },
        }],
      }), { status: 200 }));

      const result = await syncDatabaseIncrementally(
        'mock-tok',
        'database-1',
        [{ id: 'tab-stable-a', url: 'https://example.com/a', title: 'Article A' }],
        'Research',
      );

      expect(result).toEqual({
        created: 0,
        updated: 0,
        deleted: 0,
        state: {
          version: 1,
          mirroredNote: '',
          tabs: {
            'tab-stable-a': {
              pageId: 'page-existing',
              title: 'Article A',
              url: 'https://example.com/a',
            },
          },
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.notion.com/v1/databases/database-1/query',
      );
    });
  });

  describe('XC-01 contract', () => {
    it('does not write storage directly in the adapter file', () => {
      const adapterPath = path.resolve(__dirname, '../notion/adapter.ts');
      const source = fs.readFileSync(adapterPath, 'utf-8');
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
      expect(stripped).not.toMatch(/Storage\.set\s*\(/);
    });
  });
});
