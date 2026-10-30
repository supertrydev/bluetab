import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
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
        'group-long': {
          id: 'group-long',
          name: 'Long list',
          tabs: Array.from({ length: 50 }, (_, i) => ({
            url: `https://example.com/very-long-article-${i}-with-padding-text-to-bloat-the-description-line`,
            title: `Article number ${i} with a fairly long title that pads out the description payload size`,
            originalId: `tab-${i}`,
          })),
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
        text: 'Captured idea for Discord',
        createdAt: 1,
        tabContext: { url: 'https://example.com/idea', title: 'Idea' },
      },
      {
        id: 'entry-long',
        text: 'X'.repeat(5000),
        createdAt: 2,
      },
    ]),
  },
}));

import { adapter } from '../discord/adapter';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';

describe('Discord adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
    const storageMock = jest.requireMock('../../../utils/storage');
    storageMock.Storage.get.mockImplementation(async () => null);
    storageMock.Storage.set.mockImplementation(async () => {});
    storageMock.Storage.remove.mockImplementation(async () => {});
  });

  describe('executeVerb share_to_channel', () => {
    it('POSTs to the webhook_url from accountMeta with NO Authorization header and {content} body', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const result = await adapter.executeVerb(
        'share_to_channel',
        { content: 'Hello' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      expect(result).toEqual({ success: true, result: { delivered: true } });

      expect(fetchMock).toHaveBeenCalledWith(
        WEBHOOK_URL,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();

      const body = JSON.parse(init.body as string);
      expect(body.content).toBe('Hello');
    });

    it('forwards optional embeds payload when provided', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const embeds = [{ title: 'Title', description: 'Body' }];
      await adapter.executeVerb(
        'share_to_channel',
        { content: '', embeds },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.embeds).toEqual(embeds);
    });

    it('returns an adapter error when accountMeta.webhook_url is missing', async () => {
      const result = await adapter.executeVerb(
        'share_to_channel',
        { content: 'Hello' },
        'mock-tok',
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('missing_webhook_url');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('executeVerb send_group_to_discord', () => {
    it('reads the group via GroupMemoryStorageService (memory fallback) and builds a single embed with linked titles', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const result = await adapter.executeVerb(
        'send_group_to_discord',
        { groupId: 'group-1' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      expect(result).toEqual({ success: true, result: { delivered: true } });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(Array.isArray(body.embeds)).toBe(true);
      expect(body.embeds).toHaveLength(1);
      const embed = body.embeds[0];
      expect(embed.title).toBe('Reading list');
      expect(embed.description).toContain('[Article A](https://example.com/a)');
      expect(embed.description).toContain('[Article B](https://example.com/b)');
      expect(embed.color).toBe(0x3b82f6);
    });

    it('reads the group from live storage when not in memory', async () => {
      const storageMock = jest.requireMock('../../../utils/storage');
      storageMock.Storage.get.mockImplementation(async (key: string) => {
        if (key === 'groups') {
          return [{ id: 'live-group', name: 'Live group', tabs: [{ url: 'https://example.com/live', title: 'Live tab' }] }];
        }
        return null;
      });
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const result = await adapter.executeVerb(
        'send_group_to_discord',
        { groupId: 'live-group' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      expect(result.success).toBe(true);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.embeds[0].title).toBe('Live group');
      expect(body.embeds[0].description).toContain('[Live tab](https://example.com/live)');
    });

    it('truncates embed description to 4096 chars to honor Discord limits', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await adapter.executeVerb(
        'send_group_to_discord',
        { groupId: 'group-long' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      const embed = body.embeds[0];
      expect(embed.description.length).toBeLessThanOrEqual(4096);
    });

    it('returns an adapter error when the group cannot be found', async () => {
      const result = await adapter.executeVerb(
        'send_group_to_discord',
        { groupId: 'missing-group' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('group_not_found');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('executeVerb push_brain_dump_to_discord', () => {
    it('builds a Brain Dump embed with the entry text', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await adapter.executeVerb(
        'push_brain_dump_to_discord',
        { entryId: 'entry-1' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      const embed = body.embeds[0];
      expect(embed.title).toBe('Brain dump');
      expect(embed.description).toContain('Captured idea for Discord');
      expect(embed.color).toBe(0x3b82f6);
    });

    it('includes tabContext link in description and sets embed.url when entry has a source URL', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await adapter.executeVerb(
        'push_brain_dump_to_discord',
        { entryId: 'entry-1' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      const embed = body.embeds[0];
      expect(embed.url).toBe('https://example.com/idea');
      expect(embed.description).toContain('[Idea](https://example.com/idea)');
    });

    it('truncates entry description to 4096 chars', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await adapter.executeVerb(
        'push_brain_dump_to_discord',
        { entryId: 'entry-long' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.embeds[0].description.length).toBeLessThanOrEqual(4096);
    });

    it('returns an adapter error when the entry cannot be found', async () => {
      const result = await adapter.executeVerb(
        'push_brain_dump_to_discord',
        { entryId: 'missing-entry' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('entry_not_found');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('throws the provider Response on 401 so dispatch can flag reauth (webhook revoked)', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(
        adapter.executeVerb(
          'share_to_channel',
          { content: 'Hello' },
          'mock-tok',
          { webhook_url: WEBHOOK_URL }
        )
      ).rejects.toMatchObject({ status: 401 });
    });

    it('throws the provider Response on 429 so dispatch can read Retry-After', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '1' } })
      );
      await expect(
        adapter.executeVerb(
          'share_to_channel',
          { content: 'Hello' },
          'mock-tok',
          { webhook_url: WEBHOOK_URL }
        )
      ).rejects.toMatchObject({ status: 429 });
    });

    it('returns unknown_verb for unrecognized verbs', async () => {
      const result = await adapter.executeVerb('mystery_verb', {}, 'mock-tok', {
        webhook_url: WEBHOOK_URL,
      });
      expect(result).toEqual({ success: false, error: 'unknown_verb' });
    });
  });

  describe('group mirroring', () => {
    it('start_group_mirroring POSTs with ?wait=true and saves mirror state', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg-123' }), { status: 200 })
      );

      const result = await adapter.executeVerb(
        'start_group_mirroring',
        { groupId: 'group-1' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL, account_id: 'acc-1' }
      );

      expect(result.success).toBe(true);
      expect((result.result as any)?.messageId).toBe('msg-123');
      const callUrl = fetchMock.mock.calls[0][0] as string;
      expect(callUrl).toContain('?wait=true');
    });

    it('sync_group_mirroring PATCHes the existing message', async () => {
      const storageMock = jest.requireMock('../../../utils/storage');
      storageMock.Storage.get.mockImplementation(async (key: string) => {
        if (key === 'discord_mirror:group-1') {
          return { webhookUrl: WEBHOOK_URL, messageId: 'msg-123', accountId: 'acc-1' };
        }
        return null;
      });
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

      const result = await adapter.executeVerb(
        'sync_group_mirroring',
        { groupId: 'group-1' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      expect(result.success).toBe(true);
      const call = fetchMock.mock.calls[0];
      expect((call[0] as string)).toContain(`/messages/msg-123`);
      expect((call[1] as RequestInit).method).toBe('PATCH');
    });

    it('updates the same root with the live group name, note, and merged memory tabs', async () => {
      const storageMock = jest.requireMock('../../../utils/storage');
      storageMock.Storage.get.mockImplementation(async (key: string) => {
        if (key === 'discord_mirror:group-1') {
          return { webhookUrl: WEBHOOK_URL, messageId: 'msg-123', accountId: 'acc-1' };
        }
        if (key === 'groups') {
          return [{
            id: 'group-1',
            name: 'Renamed research',
            notes: 'Current group note',
            tabs: [{ id: 'tab-live', url: 'https://example.com/live', title: 'Live tab' }],
          }];
        }
        return null;
      });
      const memoryMock = jest.requireMock('../../../utils/group-memory-storage');
      memoryMock.GroupMemoryStorageService.getMemory.mockResolvedValue({
        groups: {
          'group-1': {
            id: 'group-1',
            name: 'Stale remembered name',
            notes: 'Stale remembered note',
            tabs: [
              { url: 'https://example.com/a', title: 'Article A', originalId: 'tab-a' },
              { url: 'https://example.com/b', title: 'Article B', originalId: 'tab-b' },
            ],
          },
        },
        urlIndex: {},
      });
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

      const result = await adapter.executeVerb(
        'sync_group_mirroring',
        { groupId: 'group-1' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      expect(result).toEqual({ success: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(`${WEBHOOK_URL}/messages/msg-123`);
      expect((init as RequestInit).method).toBe('PATCH');
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body.embeds).toEqual([{
        title: 'Renamed research',
        description: [
          'Note:',
          'Current group note',
          '',
          '[Article A](https://example.com/a)',
          '[Article B](https://example.com/b)',
          '[Live tab](https://example.com/live)',
        ].join('\n'),
        color: 0x3b82f6,
      }]);
    });

    it('removes only the note section when a live group note is deleted', async () => {
      const storageMock = jest.requireMock('../../../utils/storage');
      storageMock.Storage.get.mockImplementation(async (key: string) => {
        if (key === 'discord_mirror:group-1') {
          return { webhookUrl: WEBHOOK_URL, messageId: 'msg-123', accountId: 'acc-1' };
        }
        if (key === 'groups') {
          return [{
            id: 'group-1',
            name: 'Research',
            notes: undefined,
            tabs: [{ id: 'tab-a', url: 'https://example.com/a', title: 'Article A' }],
          }];
        }
        return null;
      });
      const memoryMock = jest.requireMock('../../../utils/group-memory-storage');
      memoryMock.GroupMemoryStorageService.getMemory.mockResolvedValue({
        groups: {
          'group-1': {
            id: 'group-1',
            name: 'Research',
            notes: 'Stale remembered note',
            tabs: [{ url: 'https://example.com/a', title: 'Article A', originalId: 'tab-a' }],
          },
        },
        urlIndex: {},
      });
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

      await adapter.executeVerb(
        'sync_group_mirroring',
        { groupId: 'group-1' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
      expect(body.embeds[0].description).toBe('[Article A](https://example.com/a)');
      expect(body.embeds[0].description).not.toContain('Note:');
      expect(body.embeds[0].description).not.toContain('Stale remembered note');
    });

    it('stop_group_mirroring DELETEs the message when mirror state exists', async () => {
      const storageMock = jest.requireMock('../../../utils/storage');
      storageMock.Storage.get.mockImplementation(async (key: string) => {
        if (key === 'discord_mirror:group-1') {
          return { webhookUrl: WEBHOOK_URL, messageId: 'msg-123', accountId: 'acc-1' };
        }
        return null;
      });
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const result = await adapter.executeVerb(
        'stop_group_mirroring',
        { groupId: 'group-1' },
        'mock-tok',
        { webhook_url: WEBHOOK_URL }
      );

      expect(result.success).toBe(true);
      const call = fetchMock.mock.calls[0];
      expect((call[0] as string)).toContain(`/messages/msg-123`);
      expect((call[1] as RequestInit).method).toBe('DELETE');
    });

    it('sync_group_mirroring returns mirror_not_found when no state exists', async () => {
      const storageMock = jest.requireMock('../../../utils/storage');
      storageMock.Storage.get.mockImplementation(async () => null);

      const result = await adapter.executeVerb(
        'sync_group_mirroring',
        { groupId: 'group-1' },
        'mock-tok',
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('mirror_not_found');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('XC-01 contract', () => {
    it('does not call chrome.storage.local.set directly in the adapter file', () => {
      const adapterPath = path.resolve(__dirname, '../discord/adapter.ts');
      const source = fs.readFileSync(adapterPath, 'utf-8');
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
    });
  });
});
