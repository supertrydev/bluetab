import * as fs from 'fs';
import * as path from 'path';
import type { RememberedGroup } from '../../../types/models';

const localStore: Record<string, unknown> = {};
let memoryStore: { groups: Record<string, RememberedGroup>; urlIndex: Record<string, string> } = {
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
};

jest.mock('../../../utils/group-memory-storage', () => ({
  GroupMemoryStorageService: {
    getMemory: jest.fn(async () => memoryStore),
  },
}));

jest.mock('../../brain-dump-service', () => ({
  BrainDumpService: {
    list: jest.fn(async () => [
      {
        id: 'entry-1',
        text: 'Captured idea for Slack',
        createdAt: 1,
        tabContext: { url: 'https://example.com/idea', title: 'Idea' },
      },
      {
        id: 'entry-2',
        text: 'Linkless thought',
        createdAt: 2,
      },
    ]),
  },
}));

jest.mock('../../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => localStore[key] ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      localStore[key] = value;
    }),
    remove: jest.fn(async (key: string) => {
      delete localStore[key];
    }),
  },
}));

import { adapter } from '../slack/adapter';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('Slack adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    global.fetch = fetchMock;
    for (const key of Object.keys(localStore)) delete localStore[key];
    memoryStore = {
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
    };
  });

  describe('executeVerb share_to_channel', () => {
    it('POSTs to https://slack.com/api/chat.postMessage with Bearer user token and {channel, text} body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, ts: '1715000000.000100', channel: 'C01ABCD' }),
          { status: 200 }
        )
      );

      const result = await adapter.executeVerb(
        'share_to_channel',
        { channel: 'C01ABCD', text: 'Hello' },
        'mock-tok',
        { team_id: 'T01ABCD' }
      );

      expect(result).toEqual({
        success: true,
        result: { messageTs: '1715000000.000100', channelId: 'C01ABCD' },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-tok',
            'Content-Type': 'application/json; charset=utf-8',
          }),
        })
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.channel).toBe('C01ABCD');
      expect(body.text).toBe('Hello');
    });

    it('forwards optional blocks payload when provided', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, ts: '1715000000.000200', channel: 'C01ABCD' }),
          { status: 200 }
        )
      );

      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Hi' } }];
      await adapter.executeVerb(
        'share_to_channel',
        { channel: 'C01ABCD', text: 'Hello', blocks },
        'mock-tok',
        {}
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.blocks).toEqual(blocks);
    });

    it('surfaces Slack ok:false response as {success:false, error}', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: false, error: 'channel_not_found' }),
          { status: 200 }
        )
      );

      const result = await adapter.executeVerb(
        'share_to_channel',
        { channel: 'C-bogus', text: 'Hello' },
        'mock-tok',
        {}
      );

      expect(result).toEqual({ success: false, error: 'channel_not_found' });
    });

    it('treats ok:false without an error string as slack_error', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false }), { status: 200 })
      );

      const result = await adapter.executeVerb(
        'share_to_channel',
        { channel: 'C01ABCD', text: 'Hello' },
        'mock-tok',
        {}
      );

      expect(result).toEqual({ success: false, error: 'slack_error' });
    });
  });

  describe('executeVerb send_dm', () => {
    it('POSTs to chat.postMessage with the user_id used as the channel field (Slack auto-resolves to im channel)', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, ts: '1715000000.000300', channel: 'D01USERIM' }),
          { status: 200 }
        )
      );

      const result = await adapter.executeVerb(
        'send_dm',
        { user_id: 'U01ABCD', text: 'hi' },
        'mock-tok',
        {}
      );

      expect(result).toEqual({
        success: true,
        result: { messageTs: '1715000000.000300', channelId: 'D01USERIM' },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.any(Object)
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.channel).toBe('U01ABCD');
      expect(body.text).toBe('hi');
    });
  });

  describe('executeVerb send_group_to_slack', () => {
    it('reads the group via GroupMemoryStorageService and formats tabs as a bulleted list with mrkdwn links', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, ts: '1715000000.000400', channel: 'C01ABCD' }),
          { status: 200 }
        )
      );

      const result = await adapter.executeVerb(
        'send_group_to_slack',
        { groupId: 'group-1', channel: 'C01ABCD' },
        'mock-tok',
        {}
      );

      expect(result).toEqual({
        success: true,
        result: { messageTs: '1715000000.000400', channelId: 'C01ABCD' },
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.channel).toBe('C01ABCD');
      expect(body.text).toContain('*Reading list*');
      expect(body.text).toContain('<https://example.com/a|Article A>');
      expect(body.text).toContain('<https://example.com/b|Article B>');
    });

    it('returns an adapter error when the group cannot be found', async () => {
      const result = await adapter.executeVerb(
        'send_group_to_slack',
        { groupId: 'missing-group', channel: 'C01ABCD' },
        'mock-tok',
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('group_not_found');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('executeVerb push_brain_dump_to_slack', () => {
    it('reads the entry via BrainDumpService and includes its tabContext URL when present', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, ts: '1715000000.000500', channel: 'C01ABCD' }),
          { status: 200 }
        )
      );

      await adapter.executeVerb(
        'push_brain_dump_to_slack',
        { entryId: 'entry-1', channel: 'C01ABCD' },
        'mock-tok',
        {}
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.text).toContain('Captured idea for Slack');
      expect(body.text).toContain('https://example.com/idea');
    });

    it('omits the context line for linkless entries', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, ts: '1715000000.000600', channel: 'C01ABCD' }),
          { status: 200 }
        )
      );

      await adapter.executeVerb(
        'push_brain_dump_to_slack',
        { entryId: 'entry-2', channel: 'C01ABCD' },
        'mock-tok',
        {}
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.text).toContain('Linkless thought');
      expect(body.text).not.toContain('From <');
    });

    it('returns an adapter error when the brain dump entry cannot be found', async () => {
      const result = await adapter.executeVerb(
        'push_brain_dump_to_slack',
        { entryId: 'missing-entry', channel: 'C01ABCD' },
        'mock-tok',
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('entry_not_found');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('executeVerb sync_group_mirroring', () => {
    beforeEach(() => {
      localStore['slack_mirror:group-1'] = {
        channel: 'C01GROUP',
        ts: '1715000000.000700',
        accountId: 'slack-account-1',
      };
      localStore.groups = [{
        id: 'group-1',
        name: 'Renamed research',
        notes: 'Current group note',
        tabs: [{
          id: 'tab-live',
          url: 'https://example.com/live',
          title: 'Live tab',
          groupId: 'group-1',
          timestamp: 3,
        }],
        created: 1,
        modified: 3,
      }];
      memoryStore.groups['group-1'] = {
        ...memoryStore.groups['group-1'],
        name: 'Stale remembered name',
        notes: 'Stale remembered note',
      };
    });

    it('updates the existing root message with live name/note and remembered plus live tabs', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      const result = await adapter.executeVerb(
        'sync_group_mirroring',
        { groupId: 'group-1' },
        'mock-tok',
        {}
      );

      expect(result).toEqual({ success: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://slack.com/api/chat.update',
        expect.objectContaining({ method: 'POST' })
      );
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({
        channel: 'C01GROUP',
        ts: '1715000000.000700',
        text: [
          '*Renamed research*',
          '',
          'Current group note',
          '',
          '• <https://example.com/a|Article A>',
          '• <https://example.com/b|Article B>',
          '• <https://example.com/live|Live tab>',
        ].join('\n'),
      });
    });

    it('clears a remembered note when the live group note is deleted', async () => {
      (localStore.groups as Array<{ notes?: string }>)[0].notes = undefined;
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      await adapter.executeVerb(
        'sync_group_mirroring',
        { groupId: 'group-1' },
        'mock-tok',
        {}
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.text).toBe([
        '*Renamed research*',
        '',
        '• <https://example.com/a|Article A>',
        '• <https://example.com/b|Article B>',
        '• <https://example.com/live|Live tab>',
      ].join('\n'));
      expect(body.text).not.toContain('Stale remembered note');
    });
  });

  describe('error handling', () => {
    it('throws the provider Response on 401 so dispatch can flag reauth', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(
        adapter.executeVerb(
          'share_to_channel',
          { channel: 'C01ABCD', text: 'Hello' },
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
          'share_to_channel',
          { channel: 'C01ABCD', text: 'Hello' },
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
      const adapterPath = path.resolve(__dirname, '../slack/adapter.ts');
      const source = fs.readFileSync(adapterPath, 'utf-8');
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
      expect(stripped).not.toMatch(/Storage\.set\s*\(/);
    });
  });
});
