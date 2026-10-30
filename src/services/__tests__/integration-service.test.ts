/**
 * integration-service.test.ts — GREEN on landing (Plan 14-01 Task 1).
 *
 * Contract: dispatchVerb resolves adapter via dynamic import; throws if
 * integration_id not in registry; surfaces 401 → reauth banner state;
 * isKillSwitched returns true when kill-switch cache flags integration.
 */

import {
  dispatchVerb,
  getBrainDumpDestinations,
  isKillSwitched,
  routeBrainDumpToNotionDestination,
} from '../../services/integration-service';
import type { IntegrationAccount } from '../../types/integrations';
import { createCloudConnectionCredential } from '../integrations/cloud-operation-client';
import { isolateBidi } from '../../i18n/bidi';

// Mock getValidToken
const mockGetValidToken = jest.fn(async () => 'mock_access_token');
const mockListConnectedAccounts = jest.fn<Promise<IntegrationAccount[]>, []>(async () => []);
jest.mock('../../services/integration-token-storage', () => ({
  getValidToken: () => mockGetValidToken(),
  listConnectedAccounts: () => mockListConnectedAccounts(),
  addAccount: jest.fn(async () => {}),
}));

jest.mock('../../utils/auth-state', () => ({
  getAccessToken: jest.fn(async () => 'extension-session'),
}));

// Mock Storage
const localStore: Record<string, unknown> = {};
jest.mock('../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => localStore[key] ?? null),
    set: jest.fn(async (key: string, value: unknown) => { localStore[key] = value; }),
    remove: jest.fn(async () => {}),
  },
}));

// Mock chrome
(global as unknown as Record<string, unknown>).chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({})),
      set: jest.fn(async () => {}),
    },
    session: {
      get: jest.fn(async () => ({})),
      set: jest.fn(async () => {}),
    },
  },
};

describe('dispatchVerb — registry-driven adapter resolver', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(localStore)) delete localStore[k];
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolves the real Linear adapter when invoked', async () => {
    // Pre-Plan 14-02 this asserted not_implemented because Linear was a
    // placeholder. Now Linear ships a real adapter (Plan 14-02), and
    // create_issue with no team_id surfaces missing_team_id from the
    // adapter's argument validation — proving the real adapter resolved.
    const result = await dispatchVerb('linear', 'create_issue', { title: 'Test' }, 'acc-uuid-123');
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_team_id');
  });

  it('throws / rejects when integrationId is not in registry', async () => {
    await expect(
      // @ts-expect-error intentionally invalid id
      dispatchVerb('spotify', 'play', {}, 'acc-uuid-123')
    ).rejects.toThrow(/not found in registry/i);
  });

  it('rejects the removed Gmail integration before credentials, network or stored state are touched', async () => {
    const storedState = {
      integration_tokens: {
        gmail: [{ cloud_connection_ref: 'preserved-connection' }],
      },
      brain_dump_prefs: {
        destinationOverride: {
          integrationId: 'gmail',
          accountId: 'gmail-account',
        },
      },
    };
    Object.assign(localStore, structuredClone(storedState));
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await expect(
      // @ts-expect-error Gmail was removed from the integration id list
      dispatchVerb('gmail', 'compose_draft', { subject: 'Draft', body: 'Body' }, 'gmail-account'),
    ).rejects.toThrow(/not found in registry/i);
    expect(mockGetValidToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStore).toEqual(storedState);
  });

  describe('reconnect flag for cloud connections', () => {
    const flagKey = 'integration_reauth_required:todoist:acc-1';
    const flagWrites = () => (
      jest.requireMock('../../utils/storage').Storage.set as jest.Mock
    ).mock.calls.filter(([key]: [string]) => key === flagKey);

    beforeEach(() => {
      mockGetValidToken.mockResolvedValue(createCloudConnectionCredential('connection-1'));
    });

    afterEach(() => {
      mockGetValidToken.mockResolvedValue('mock_access_token');
    });

    it('clears a stale flag after a successful call', async () => {
      localStore[flagKey] = true;
      global.fetch = jest.fn(async () => new Response('{"id":"t1"}', { status: 200 })) as typeof fetch;

      const result = await dispatchVerb('todoist', 'create_task', { content: 'Task' }, 'acc-1');

      expect(result.success).toBe(true);
      expect(jest.requireMock('../../utils/storage').Storage.remove).toHaveBeenCalledWith(flagKey);
    });

    it('sets the flag when the cloud says the grant is dead (409)', async () => {
      global.fetch = jest.fn(async () => new Response('{"error":"reauth_required"}', { status: 409 })) as typeof fetch;

      const result = await dispatchVerb('todoist', 'create_task', { content: 'Task' }, 'acc-1');

      expect(result).toEqual({ success: false, error: 'reauth_required' });
      expect(flagWrites()).toHaveLength(1);
    });

    it('does not set the flag when supertry.net rejects the BlueTab session (401)', async () => {
      global.fetch = jest.fn(async () => new Response('{"error":"Session expired"}', { status: 401 })) as typeof fetch;

      const result = await dispatchVerb('todoist', 'create_task', { content: 'Task' }, 'acc-1');

      expect(result.success).toBe(false);
      expect(result.error).not.toBe('reauth_required');
      expect(flagWrites()).toHaveLength(0);
    });
  });
});

describe('isKillSwitched', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(localStore)) delete localStore[k];
  });

  it('returns false when kill-switch cache is absent', async () => {
    const result = await isKillSwitched('notion');
    expect(result).toBe(false);
  });

  it('returns true when integrationsDisabled=true in cache', async () => {
    localStore['ai_kill_switch_cache'] = {
      enabled: true,
      fetchedAt: Date.now(),
      integrationsDisabled: true,
    };
    const result = await isKillSwitched('notion');
    expect(result).toBe(true);
  });

  it('returns true when integrationDisabled includes the id', async () => {
    localStore['ai_kill_switch_cache'] = {
      enabled: true,
      fetchedAt: Date.now(),
      integrationDisabled: ['notion'],
    };
    const result = await isKillSwitched('notion');
    expect(result).toBe(true);
  });

  it('returns false when integrationDisabled includes a different id', async () => {
    localStore['ai_kill_switch_cache'] = {
      enabled: true,
      fetchedAt: Date.now(),
      integrationDisabled: ['linear'],
    };
    const result = await isKillSwitched('notion');
    expect(result).toBe(false);
  });
});

describe('dispatchVerb — kill-switch precheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(localStore)) delete localStore[k];
  });

  it('returns kill_switched error without calling adapter when kill-switch active', async () => {
    localStore['ai_kill_switch_cache'] = {
      enabled: true,
      fetchedAt: Date.now(),
      integrationDisabled: ['linear'],
    };

    const result = await dispatchVerb('linear', 'create_issue', {}, 'acc-uuid-123');
    expect(result.success).toBe(false);
    expect(result.error).toBe('kill_switched');
  });
});

describe('getBrainDumpDestinations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(localStore)) delete localStore[k];
    mockListConnectedAccounts.mockResolvedValue([]);
  });

  it('uses real workspace/channel labels instead of generic Personal labels', async () => {
    mockListConnectedAccounts.mockResolvedValue([
      {
        integrationId: 'notion',
        accountId: 'notion-1',
        accountLabel: 'Personal',
        metadata: { workspace_name: 'Design Ops' },
        lastUsedAt: 0,
      },
      {
        integrationId: 'slack',
        accountId: 'slack-1',
        accountLabel: 'Personal',
        metadata: {},
        lastUsedAt: 0,
      },
      {
        integrationId: 'readwise',
        accountId: 'readwise-1',
        accountLabel: 'Personal',
        metadata: {},
        lastUsedAt: 0,
      },
    ]);
    localStore.integration_settings = {
      default_sync_target_labels: {
        slack: '#social',
      },
    };

    await expect(getBrainDumpDestinations()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'notion:notion-1',
          label: `${isolateBidi('Notion', 'ltr')} (${isolateBidi('Design Ops', 'auto')})`,
        }),
        expect.objectContaining({
          key: 'slack:slack-1',
          label: `${isolateBidi('Slack', 'ltr')} (${isolateBidi('#social', 'auto')})`,
        }),
        expect.objectContaining({ key: 'readwise:readwise-1', label: isolateBidi('Readwise', 'ltr') }),
      ]),
    );
  });

  it('skips destinations of the removed Gmail integration and keeps Google Calendar', async () => {
    mockListConnectedAccounts.mockResolvedValue([
      {
        integrationId: 'gmail',
        accountId: 'gmail-1',
        accountLabel: 'Personal',
        metadata: {},
        lastUsedAt: 0,
      },
      {
        integrationId: 'google-calendar',
        accountId: 'calendar-1',
        accountLabel: 'Personal',
        metadata: {},
        lastUsedAt: 0,
      },
    ]);
    localStore.brain_dump_prefs = {
      destinationOverride: {
        integrationId: 'gmail',
        accountId: 'gmail-1',
      },
    };

    const destinations = await getBrainDumpDestinations();

    expect(destinations.map((destination) => destination.integrationId)).toEqual([
      'google-calendar',
    ]);
    expect(localStore.brain_dump_prefs).toEqual({
      destinationOverride: {
        integrationId: 'gmail',
        accountId: 'gmail-1',
      },
    });
  });

  it('routes explicit Notion Brain Dump through one mapped append operation', async () => {
    localStore.integration_settings = {
      brain_dump_destination: {
        integrationId: 'notion',
        accountId: 'notion-1',
        parentPageId: 'parent-page-1',
        databaseId: 'brain-dump-database-1',
      },
    };
    mockGetValidToken.mockResolvedValueOnce(
      createCloudConnectionCredential('connection-1'),
    );
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({
      id: 'notion-page-1',
      url: 'https://notion.so/notion-page-1',
    }), { status: 200 }));
    global.fetch = fetchMock;

    const result = await routeBrainDumpToNotionDestination({
      accountId: 'notion-1',
      text: 'Captured thought',
    });

    expect(result).toEqual({
      success: true,
      result: {
        pageId: 'notion-page-1',
        pageUrl: 'https://notion.so/notion-page-1',
      },
    });
    expect(result.error).not.toBe('missing_parent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://supertry.net/api/v1/integrations/connection-1/operations/notion.page.create',
    );
    expect(JSON.parse(String(init.body))).toEqual({
      input: {
        body: {
          parent: { database_id: 'brain-dump-database-1' },
          properties: {
            Name: { title: [{ text: { content: 'Captured thought' } }] },
          },
          children: [{
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: 'Captured thought' } }],
            },
          }],
        },
      },
    });
  });
});
