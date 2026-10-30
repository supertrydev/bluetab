jest.mock('../../../utils/auth-state', () => ({
  getAccessToken: jest.fn(async () => 'extension-session'),
}));

jest.mock('../../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  },
}));

jest.mock('../../../utils/group-memory-storage', () => ({
  GroupMemoryStorageService: {
    getMemory: jest.fn(async () => ({ groups: {}, urlIndex: {} })),
  },
}));

jest.mock('../../brain-dump-service', () => ({
  BrainDumpService: { list: jest.fn(async () => []) },
}));

import { adapter as todoist } from '../todoist/adapter';
import { adapter as notion } from '../notion/adapter';
import { adapter as github } from '../github/adapter';
import { adapter as googleCalendar } from '../google-calendar/adapter';
import { adapter as outlookCalendar } from '../outlook-calendar/adapter';
import { adapter as slack } from '../slack/adapter';
import { adapter as discord } from '../discord/adapter';
import { adapter as readwise } from '../readwise/adapter';
import { adapter as jira } from '../jira/adapter';
import { adapter as trello } from '../trello/adapter';
import { adapter as asana } from '../asana/adapter';
import { adapter as gitlab } from '../gitlab/adapter';
import {
  createCloudConnectionCredential,
  executeCloudOperation,
} from '../cloud-operation-client';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
const credential = createCloudConnectionCredential('connection-1');

type Case = {
  provider: string;
  operation: string;
  response: unknown;
  execute: () => Promise<unknown>;
};

const cases: Case[] = [
  {
    provider: 'todoist', operation: 'todoist.task.create', response: { id: 't1' },
    execute: () => todoist.executeVerb('create_task', { content: 'Task' }, credential, {}),
  },
  {
    provider: 'notion', operation: 'notion.page.create', response: { id: 'p1' },
    execute: () => notion.executeVerb('create_page', {
      parent: { page_id: 'parent-1' }, title: 'Page', content: 'Body',
    }, credential, {}),
  },
  {
    provider: 'github', operation: 'github.issue.create', response: { id: 1, number: 2 },
    execute: () => github.executeVerb('create_issue', {
      owner: 'owner', repo: 'repo', title: 'Issue',
    }, credential, {}),
  },
  {
    provider: 'google-calendar', operation: 'google-calendar.event.create', response: { id: 'e1' },
    execute: () => googleCalendar.executeVerb('create_event', {
      summary: 'Event', start: '2026-08-03T10:00:00Z', end: '2026-08-03T11:00:00Z',
    }, credential, {}),
  },
  {
    provider: 'outlook-calendar', operation: 'outlook-calendar.event.create', response: { id: 'e2' },
    execute: () => outlookCalendar.executeVerb('create_event', {
      subject: 'Event', start: '2026-08-03T10:00:00Z', end: '2026-08-03T11:00:00Z',
    }, credential, {}),
  },
  {
    provider: 'slack', operation: 'slack.message.post', response: { ok: true, ts: '1', channel: 'C1' },
    execute: () => slack.executeVerb('share_to_channel', { channel: 'C1', text: 'Message' }, credential, {}),
  },
  {
    provider: 'discord', operation: 'discord.webhook.post', response: {},
    execute: () => discord.executeVerb('share_to_channel', { content: 'Message' }, credential, {}),
  },
  {
    provider: 'readwise', operation: 'readwise.highlight.create', response: [],
    execute: () => readwise.executeVerb('save_article', {
      title: 'Article', source_url: 'https://example.com', text: 'Text',
    }, credential, {}),
  },
  {
    provider: 'jira', operation: 'jira.issue.create', response: { key: 'PROJ-1' },
    execute: () => jira.executeVerb('create_issue', { summary: 'Issue' }, credential, {
      cloud_id: 'cloud-1', project_key: 'PROJ', site_url: 'https://example.atlassian.net',
    }),
  },
  {
    provider: 'trello', operation: 'trello.card.create', response: { id: 'c1' },
    execute: () => trello.executeVerb('create_card', { idList: 'l1', name: 'Card' }, credential, {}),
  },
  {
    provider: 'asana', operation: 'asana.task.create', response: { data: { gid: 'a1' } },
    execute: () => asana.executeVerb('create_task', { name: 'Task' }, credential, { workspace_gid: 'w1' }),
  },
  {
    provider: 'gitlab', operation: 'gitlab.issue.create', response: { iid: 1 },
    execute: () => gitlab.executeVerb('create_issue', { project_id: 'group/project', title: 'Issue' }, credential, {}),
  },
];

describe('Cloud provider operation parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it.each(cases)('routes $provider through its explicit Web operation', async ({ operation, response, execute }) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));

    await expect(execute()).resolves.toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `https://supertry.net/api/v1/integrations/connection-1/operations/${operation}`,
    );
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer extension-session');
    expect(JSON.parse(String(init?.body))).toHaveProperty('input');
  });

  it('maps Cloud reauthorization to the existing Extension 401 retry signal', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"reauth_required"}', { status: 409 }));

    const response = await executeCloudOperation(credential, 'linear.teams.list', {});

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe('');
  });

  it('preserves Cloud rate-limit status and Retry-After for existing backoff behavior', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"provider_rate_limited"}', {
      status: 429,
      headers: { 'Retry-After': '7' },
    }));

    const response = await executeCloudOperation(credential, 'linear.teams.list', {});

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('7');
  });

  it('does not persist a Cloud Discord connection reference in mirror state', async () => {
    const groupMemory = jest.requireMock('../../../utils/group-memory-storage');
    groupMemory.GroupMemoryStorageService.getMemory.mockResolvedValueOnce({
      groups: {
        'group-1': {
          id: 'group-1',
          name: 'Group',
          tabs: [{ url: 'https://example.com', title: 'Example' }],
        },
      },
      urlIndex: {},
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'message-1' }), { status: 200 }));

    await discord.executeVerb('start_group_mirroring', { groupId: 'group-1' }, credential, {
      account_id: 'account-1',
    });

    const storage = jest.requireMock('../../../utils/storage');
    expect(storage.Storage.set).toHaveBeenCalledWith(
      'discord_mirror:group-1',
      { messageId: 'message-1', accountId: 'account-1' },
    );
    expect(JSON.stringify(storage.Storage.set.mock.calls)).not.toContain('connection-1');
  });

  it('routes an existing Discord mirror update through the Cloud operation transport', async () => {
    const storage = jest.requireMock('../../../utils/storage');
    storage.Storage.get.mockImplementation(async (key: string) => {
      if (key === 'discord_mirror:group-1') {
        return { messageId: 'message-1', accountId: 'account-1' };
      }
      if (key === 'groups') {
        return [{
          id: 'group-1',
          name: 'Renamed group',
          notes: 'Cloud mirrored note',
          tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example' }],
        }];
      }
      return null;
    });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await expect(discord.executeVerb(
      'sync_group_mirroring',
      { groupId: 'group-1' },
      credential,
      {},
    )).resolves.toEqual({ success: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'https://supertry.net/api/v1/integrations/connection-1/operations/discord.webhook.update',
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      input: {
        messageId: 'message-1',
        body: {
          embeds: [{
            title: 'Renamed group',
            description: [
              'Note:',
              'Cloud mirrored note',
              '',
              '[Example](https://example.com)',
            ].join('\n'),
            color: 0x3b82f6,
          }],
        },
      },
    });
  });
});
