import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../../utils/group-memory-storage', () => ({
  GroupMemoryStorageService: {
    getMemory: jest.fn(async () => ({
      groups: {
        'group-1': {
          id: 'group-1',
          name: 'Backlog',
          tabs: [
            { url: 'https://example.com/a', title: 'Card A', originalId: 'tab-a' },
            { url: 'https://example.com/b', title: 'Card B', originalId: 'tab-b' },
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
        text: 'Captured idea for Trello',
        createdAt: 1,
        tabContext: { url: 'https://example.com/idea', title: 'Idea' },
      },
    ]),
  },
}));

jest.mock('../../integration-oauth-service', () => ({
  fetchTrelloApiKey: jest.fn(async () => 'mock-key'),
}));

import { adapter, fetchLists } from '../trello/adapter';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('Trello adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  describe('executeVerb create_card', () => {
    it('POSTs to https://api.trello.com/1/cards?key=&token= (token in QUERY, not Authorization header) with idList+name body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'card-1', url: 'https://trello.com/c/abc/1-card' }),
          { status: 200 }
        )
      );

      const result = await adapter.executeVerb(
        'create_card',
        { idList: 'list-1', name: 'New card', desc: 'desc text' },
        'mock-tok',
        {}
      );

      expect(result).toEqual({
        success: true,
        result: {
          cardId: 'card-1',
          cardUrl: 'https://trello.com/c/abc/1-card',
        },
      });

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('https://api.trello.com/1/cards');
      // BOTH key and token go in the query string (RESEARCH §Pitfall 12)
      expect(calledUrl).toContain('key=mock-key');
      expect(calledUrl).toContain('token=mock-tok');

      // No Authorization header (Trello does not use bearer tokens)
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.idList).toBe('list-1');
      expect(body.name).toBe('New card');
      expect(body.desc).toBe('desc text');
    });
  });

  describe('group + Brain Dump routing', () => {
    it('routes send_group_to_trello through GroupMemoryStorageService and creates one card per tab', async () => {
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ id: 'c', url: 'https://trello.com/c/c' }), { status: 200 })
      );

      const result = await adapter.executeVerb(
        'send_group_to_trello',
        { groupId: 'group-1', idList: 'list-1' },
        'mock-tok',
        {}
      );

      expect(result).toMatchObject({ success: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('routes push_brain_dump_to_trello through BrainDumpService.list', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'bd', url: 'https://trello.com/c/bd' }), { status: 200 })
      );

      const result = await adapter.executeVerb(
        'push_brain_dump_to_trello',
        { entryId: 'entry-1', idList: 'list-1' },
        'mock-tok',
        {}
      );

      expect(result).toMatchObject({ success: true });
    });

    it('uses accountMeta.default_target as idList when args omit idList', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'bd', url: 'https://trello.com/c/bd' }), { status: 200 })
      );

      const result = await adapter.executeVerb(
        'push_brain_dump_to_trello',
        { entryId: 'entry-1' },
        'mock-tok',
        { default_target: 'list-from-settings' }
      );

      expect(result).toMatchObject({ success: true });
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.idList).toBe('list-from-settings');
    });
  });

  describe('fetchLists', () => {
    it('loads open lists from open boards and returns board-qualified names', async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              { id: 'board-1', name: 'Work', closed: false },
              { id: 'board-closed', name: 'Closed', closed: true },
            ]),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              { id: 'list-1', name: 'Todo', closed: false },
              { id: 'list-closed', name: 'Done', closed: true },
            ]),
            { status: 200 }
          )
        );

      const lists = await fetchLists('mock-tok');

      expect(lists).toEqual([
        { id: 'list-1', name: 'Todo', boardId: 'board-1', boardName: 'Work' },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0] as string).toContain('/1/members/me/boards');
      expect(fetchMock.mock.calls[1][0] as string).toContain('/1/boards/board-1/lists');
    });
  });

  describe('error handling', () => {
    it('throws the provider Response on 401 so dispatch can flag reauth', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(
        adapter.executeVerb(
          'create_card',
          { idList: 'l', name: 'n' },
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
          'create_card',
          { idList: 'l', name: 'n' },
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
      const adapterPath = path.resolve(__dirname, '../trello/adapter.ts');
      const source = fs.readFileSync(adapterPath, 'utf-8');
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
      expect(stripped).not.toMatch(/Storage\.set\s*\(/);
    });
  });
});
