import type { TabGroup } from '../types/models';

const localStore: Record<string, unknown> = {};

jest.mock('../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => localStore[key] ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      localStore[key] = value;
    }),
    remove: jest.fn(async (key: string) => {
      delete localStore[key];
    }),
    getProjects: jest.fn(async () => []),
  },
}));

jest.mock('./integration-token-storage', () => ({
  getValidToken: jest.fn(async () => 'bluetab-cloud-connection:v1:connection-1'),
  listConnectedAccounts: jest.fn(async () => []),
  addAccount: jest.fn(async () => undefined),
}));

jest.mock('../utils/auth-state', () => ({
  getAccessToken: jest.fn(async () => 'extension-session'),
}));

jest.mock('./brain-dump-service', () => ({
  BrainDumpService: { list: jest.fn(async () => []) },
}));

import {
  setupNotionMirror,
  syncNotionMirrors,
} from './integration-service';
import {
  addTabToExistingGroup,
  restoreSavedTabWithBehavior,
} from './saved-tab-actions';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';

const GROUP_ID = 'group-1';
const TARGET_TAB_ID = 'tab-target';
const TARGET_URL = 'https://example.com/target';
const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

function groups(): TabGroup[] {
  return structuredClone(localStore.groups as TabGroup[]);
}

function operationCalls(operation: string) {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith(`/operations/${operation}`),
  );
}

function cloudResponse(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const operation = String(url).split('/operations/')[1];
  const envelope = JSON.parse(String(init?.body)) as {
    input?: { body?: { properties?: { Name?: { title?: Array<{ text?: { content?: string } }> } } } };
  };
  if (operation === 'notion.database.create') {
    return Promise.resolve(new Response(JSON.stringify({
      id: 'database-1',
      url: 'https://notion.so/database-1',
    }), { status: 200 }));
  }
  if (operation === 'notion.page.create') {
    const title = envelope.input?.body?.properties?.Name?.title?.[0]?.text?.content;
    const pageId = title === 'Target' ? 'page-target' : 'page-keeper';
    return Promise.resolve(new Response(JSON.stringify({
      id: pageId,
      url: `https://notion.so/${pageId}`,
    }), { status: 200 }));
  }
  if (operation === 'notion.page.update' || operation === 'notion.database.update') {
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  }
  throw new Error(`unexpected Cloud operation in test: ${operation}`);
}

describe('Notion Group Memory mirror parity', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        tabs: { create: jest.fn(async () => ({ id: 101 })) },
        runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      },
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    fetchMock.mockImplementation(cloudResponse);
    global.fetch = fetchMock;
    for (const key of Object.keys(localStore)) delete localStore[key];
    localStore.settings = {
      duplicateHandling: 'reject',
      groupMemoryAutoRemember: true,
      groupMemoryEnabled: true,
      restoreBehavior: 'removeFromList',
    };
    localStore.groups = [{
      id: GROUP_ID,
      name: 'Research',
      tabs: [
        {
          id: TARGET_TAB_ID,
          url: TARGET_URL,
          title: 'Target',
          groupId: GROUP_ID,
          timestamp: 1,
        },
        {
          id: 'tab-keeper',
          url: 'https://example.com/keeper',
          title: 'Keeper',
          groupId: GROUP_ID,
          timestamp: 1,
        },
      ],
      created: 1,
      modified: 1,
    } satisfies TabGroup];
    localStore.integration_settings = {};
  });

  it('preserves the mapped page across a memory click and re-save, then archives on permanent removal', async () => {
    await setupNotionMirror({
      group: groups()[0],
      accountId: 'notion-account-1',
      parentPageId: 'parent-page-1',
      databaseTitle: 'Research',
    });

    const initialSettings = localStore.integration_settings as {
      auto_sync_groups: Array<{
        groupId: string;
        notionState?: { tabs: Record<string, { pageId: string }> };
      }>;
    };
    expect(initialSettings.auto_sync_groups[0].notionState?.tabs[TARGET_TAB_ID]).toEqual(
      expect.objectContaining({ pageId: 'page-target' }),
    );
    expect(operationCalls('notion.page.create')).toHaveLength(2);

    fetchMock.mockClear();
    const beforeClick = groups();
    const click = await restoreSavedTabWithBehavior({
      url: TARGET_URL,
      tabId: TARGET_TAB_ID,
      groupId: GROUP_ID,
      groups: beforeClick,
      active: false,
    });
    await syncNotionMirrors([GROUP_ID]);

    const memory = await GroupMemoryStorageService.getMemory();
    expect(memory.groups[GROUP_ID].tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalId: TARGET_TAB_ID }),
    ]));
    expect(memory.groups[GROUP_ID].integrationState?.autoSync?.notionState?.tabs[TARGET_TAB_ID]).toEqual(
      expect.objectContaining({ pageId: 'page-target' }),
    );
    expect(operationCalls('notion.page.update')).toHaveLength(0);
    expect(operationCalls('notion.page.create')).toHaveLength(0);

    const saved = await addTabToExistingGroup({
      id: 12,
      title: 'Target',
      url: TARGET_URL,
      pinned: false,
    }, GROUP_ID, 3);
    expect(saved?.addedTab.id).toBe(TARGET_TAB_ID);
    await syncNotionMirrors([GROUP_ID]);

    expect(operationCalls('notion.page.create')).toHaveLength(0);
    const mappingAfterRestore = (localStore.integration_settings as typeof initialSettings)
      .auto_sync_groups[0].notionState?.tabs[TARGET_TAB_ID];
    expect(mappingAfterRestore).toEqual(expect.objectContaining({ pageId: 'page-target' }));

    await GroupMemoryStorageService.forgetGroup(GROUP_ID);
    localStore.groups = click.updatedGroups;
    fetchMock.mockClear();
    await syncNotionMirrors([GROUP_ID]);

    expect(operationCalls('notion.page.update')).toHaveLength(1);
    const [, archiveInit] = operationCalls('notion.page.update')[0] as [string, RequestInit];
    expect(JSON.parse(String(archiveInit.body))).toEqual({
      input: { pageId: 'page-target', body: { archived: true } },
    });
  });
});

describe('Notion group note description parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    fetchMock.mockImplementation(cloudResponse);
    global.fetch = fetchMock;
    for (const key of Object.keys(localStore)) delete localStore[key];
    localStore.groups = [{
      id: GROUP_ID,
      name: 'Research',
      notes: 'Initial note',
      tabs: [{
        id: TARGET_TAB_ID,
        url: TARGET_URL,
        title: 'Target',
        groupId: GROUP_ID,
        timestamp: 1,
      }],
      created: 1,
      modified: 2,
    } satisfies TabGroup];
    localStore.integration_settings = {
      auto_sync_groups: [
        {
          groupId: GROUP_ID,
          integrationId: 'notion',
          accountId: 'notion-account-1',
          targetId: 'database-1',
          notionState: {
            version: 1,
            mirroredNote: '',
            tabs: {
              [TARGET_TAB_ID]: {
                pageId: 'page-target',
                title: 'Target',
                url: TARGET_URL,
              },
            },
          },
        },
        {
          groupId: 'unrelated-group',
          integrationId: 'notion',
          accountId: 'notion-account-2',
          targetId: 'database-unrelated',
        },
        {
          groupId: GROUP_ID,
          integrationId: 'linear',
          accountId: 'linear-account-1',
          targetId: 'team-1',
        },
      ],
    };
  });

  it('creates, updates, skips unchanged, and clears only the mapped database description', async () => {
    await syncNotionMirrors([GROUP_ID]);
    expect(operationCalls('notion.database.update')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    let [, init] = operationCalls('notion.database.update')[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      input: {
        databaseId: 'database-1',
        body: {
          description: [{
            type: 'text',
            text: { content: 'Initial note' },
          }],
        },
      },
    });

    fetchMock.mockClear();
    await syncNotionMirrors([GROUP_ID]);
    expect(fetchMock).not.toHaveBeenCalled();

    (localStore.groups as TabGroup[])[0].notes = 'Changed note';
    await syncNotionMirrors([GROUP_ID]);
    expect(operationCalls('notion.database.update')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    [, init] = operationCalls('notion.database.update')[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).input.body.description).toEqual([{
      type: 'text',
      text: { content: 'Changed note' },
    }]);

    fetchMock.mockClear();
    delete (localStore.groups as TabGroup[])[0].notes;
    await syncNotionMirrors([GROUP_ID]);
    expect(operationCalls('notion.database.update')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    [, init] = operationCalls('notion.database.update')[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).input.body.description).toEqual([]);
    expect(String(init.body)).not.toContain('database-unrelated');

    const settings = localStore.integration_settings as {
      auto_sync_groups: Array<{ integrationId: string; targetId: string }>;
    };
    expect(settings.auto_sync_groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ integrationId: 'linear', targetId: 'team-1' }),
      expect.objectContaining({ targetId: 'database-unrelated' }),
    ]));
  });
});
