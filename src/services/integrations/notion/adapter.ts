import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { GroupMemoryStorageService } from '../../../utils/group-memory-storage';
import { Storage } from '../../../utils/storage';
import { executeProviderRequest } from '../cloud-operation-client';
import type { NotionMirrorState } from '../../../types/models';

interface GroupTabLike {
  id?: string;
  url?: string;
  title?: string;
  notes?: string;
}

interface GroupShape {
  id: string;
  name: string;
  tabs?: GroupTabLike[];
}

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

type NotionPageResponse = {
  id?: string;
  url?: string;
};

type NotionDatabaseQueryResponse = {
  results?: Array<{
    id: string;
    properties?: unknown;
    last_edited_time?: string;
    url?: string;
  }>;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function notionHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function notionOperation(
  url: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
): { operation: string; input: Record<string, unknown> } {
  const pathname = new URL(url).pathname;
  if (method === 'POST' && pathname === '/v1/search') {
    return { operation: 'notion.pages.list', input: { body } };
  }
  if (method === 'POST' && pathname === '/v1/pages') {
    return { operation: 'notion.page.create', input: { body } };
  }
  if (method === 'POST' && pathname === '/v1/databases') {
    return { operation: 'notion.database.create', input: { body } };
  }
  const queryMatch = pathname.match(/^\/v1\/databases\/([^/]+)\/query$/);
  if (method === 'POST' && queryMatch) {
    return {
      operation: 'notion.database.query',
      input: { databaseId: decodeURIComponent(queryMatch[1]), body },
    };
  }
  const pageMatch = pathname.match(/^\/v1\/pages\/([^/]+)$/);
  if (method === 'PATCH' && pageMatch) {
    return {
      operation: 'notion.page.update',
      input: { pageId: decodeURIComponent(pageMatch[1]), body },
    };
  }
  const databaseMatch = pathname.match(/^\/v1\/databases\/([^/]+)$/);
  if (method === 'PATCH' && databaseMatch) {
    return {
      operation: 'notion.database.update',
      input: { databaseId: decodeURIComponent(databaseMatch[1]), body },
    };
  }
  throw new Error('unknown_notion_request');
}

async function notionRequest(
  url: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
  accessToken: string,
): Promise<Response> {
  const { operation, input } = notionOperation(url, method, body);
  return executeProviderRequest(accessToken, operation, input, () => fetch(url, {
    method,
    headers: notionHeaders(accessToken),
    body: JSON.stringify(body),
  }));
}

async function postJson<T>(url: string, body: Record<string, unknown>, accessToken: string): Promise<T> {
  const response = await notionRequest(url, 'POST', body, accessToken);
  if (!response.ok) {
    throw response;
  }
  return (await response.json()) as T;
}

async function patchJson(url: string, body: Record<string, unknown>, accessToken: string): Promise<Response> {
  const response = await notionRequest(url, 'PATCH', body, accessToken);
  if (!response.ok) {
    throw response;
  }
  return response;
}

// ============================================================================
// Public utilities used by integration-service for the "Save to Notion"
// auto-mirror flow (Batch 3): list pages the user has granted access to and
// create a new database under a chosen parent page.
// ============================================================================

export interface NotionPage {
  id: string;
  title: string;
  url: string;
}

interface NotionSearchResponse {
  results?: Array<{
    id?: string;
    object?: string;
    url?: string;
    properties?: Record<string, unknown>;
    parent?: { type?: string };
    archived?: boolean;
  }>;
}

function extractTitleFromProperties(properties: Record<string, unknown> | undefined): string | undefined {
  if (!properties) return undefined;
  for (const value of Object.values(properties)) {
    const obj = asObject(value);
    if (obj?.type === 'title' && Array.isArray(obj.title)) {
      const first = (obj.title as Array<{ plain_text?: string }>)[0];
      if (first?.plain_text) return first.plain_text;
    }
  }
  return undefined;
}

/**
 * List pages the integration has access to. Used by the page picker the
 * group context menu opens before creating a mirror database.
 */
export async function listAccessiblePages(accessToken: string): Promise<NotionPage[]> {
  const data = await postJson<NotionSearchResponse>(
    `${NOTION_API_BASE}/search`,
    { filter: { value: 'page', property: 'object' }, page_size: 100 },
    accessToken
  );
  return (data.results || [])
    .filter((item) => item.object === 'page' && item.id && !item.archived)
    .map((item) => ({
      id: item.id as string,
      title: extractTitleFromProperties(item.properties) ?? 'Untitled',
      url: item.url ?? '',
    }));
}

/**
 * Archive every row of a database. Used by the auto-mirror sync flow
 * (Batch 6) — before pushing the current group state we wipe the previous
 * snapshot, so the database always reflects "what's in the group right
 * now". Notion has no bulk archive; we PATCH each row individually.
 */
export async function purgeDatabaseRows(
  accessToken: string,
  databaseId: string
): Promise<{ archived: number }> {
  const data = await postJson<NotionDatabaseQueryResponse>(
    `${NOTION_API_BASE}/databases/${databaseId}/query`,
    { page_size: 100 },
    accessToken
  );
  let archived = 0;
  for (const row of data.results || []) {
    if (!row.id) continue;
    try {
      const resp = await patchJson(
        `${NOTION_API_BASE}/pages/${row.id}`, { archived: true }, accessToken,
      );
      if (resp.ok) archived++;
    } catch {
      /* tolerate individual row failures */
    }
  }
  return { archived };
}

/**
 * Incremental sync: compare database rows with local tabs and only update what's changed.
 * More efficient than purge + recreate for large groups.
 */
export async function syncDatabaseIncrementally(
  accessToken: string,
  databaseId: string,
  tabs: GroupTabLike[],
  _groupName: string,
  previousState?: NotionMirrorState,
): Promise<{ created: number; updated: number; deleted: number; state: NotionMirrorState }> {
  if (previousState?.version === 1) {
    const nextState: NotionMirrorState = structuredClone(previousState);
    const currentTabIds = new Set<string>();
    let created = 0, updated = 0, deleted = 0;

    for (const tab of tabs) {
      const tabId = asString(tab.id);
      if (!tabId) throw new Error('missing_tab_id');

      currentTabIds.add(tabId);
      const title = deriveTabTitle(tab);
      const url = tab.url ?? '';
      const existing = nextState.tabs[tabId];
      const properties: Record<string, unknown> = {
        Name: { title: [{ text: { content: title } }] },
      };
      if (url) properties.URL = { url };

      if (existing) {
        if (existing.title === title && existing.url === url) continue;
        try {
          await patchJson(
            `${NOTION_API_BASE}/pages/${existing.pageId}`,
            { properties },
            accessToken,
          );
          nextState.tabs[tabId] = { pageId: existing.pageId, title, url };
          updated++;
        } catch {
          // Keep the old snapshot so the same update is retried next sync.
        }
        continue;
      }

      const description = [url, tab.notes].filter(Boolean).join('\n\n');
      try {
        const page = await postJson<NotionPageResponse>(
          `${NOTION_API_BASE}/pages`,
          {
            parent: { database_id: databaseId },
            properties,
            children: description
              ? [{
                  object: 'block',
                  type: 'paragraph',
                  paragraph: {
                    rich_text: [{ type: 'text', text: { content: description } }],
                  },
                }]
              : [],
          },
          accessToken,
        );
        const pageId = asString(page.id);
        if (!pageId) throw new Error('notion_page_create_no_id');
        nextState.tabs[tabId] = { pageId, title, url };
        created++;
      } catch {
        // An absent mapping causes a safe retry; no duplicate state is invented.
      }
    }

    for (const [tabId, item] of Object.entries(previousState.tabs)) {
      if (currentTabIds.has(tabId)) continue;
      try {
        await patchJson(
          `${NOTION_API_BASE}/pages/${item.pageId}`, { archived: true }, accessToken,
        );
        delete nextState.tabs[tabId];
        deleted++;
      } catch {
        // Keep the mapping so archive is retried rather than losing ownership.
      }
    }

    return { created, updated, deleted, state: nextState };
  }

  // Get existing rows from database
  const data = await postJson<NotionDatabaseQueryResponse>(
    `${NOTION_API_BASE}/databases/${databaseId}/query`,
    { page_size: 100 },
    accessToken
  );

  const existingRows = data.results || [];
  const existingTabs = new Map<string, NonNullable<NotionDatabaseQueryResponse['results']>[number]>();

  // Build map of existing rows by URL
  for (const row of existingRows) {
    try {
      const urlProp = asString(asObject(asObject(row.properties)?.URL)?.url);
      if (urlProp) {
        existingTabs.set(urlProp, row);
      }
    } catch {}
  }

  let created = 0, updated = 0, deleted = 0;
  const processedUrls = new Set<string>();
  const nextState: NotionMirrorState = { version: 1, mirroredNote: '', tabs: {} };

  // Process each local tab
  for (const tab of tabs) {
    if (!tab.url) continue;

    processedUrls.add(tab.url);
    const existingRow = existingTabs.get(tab.url);
    const tabTitle = deriveTabTitle(tab);
    const description = [tab.url, tab.notes].filter(Boolean).join('\n\n');
    const tabId = asString(tab.id);

    if (existingRow) {
      // Update existing row if content changed
      const nameProperty = asObject(asObject(existingRow.properties)?.Name);
      const titleItems = Array.isArray(nameProperty?.title) ? nameProperty.title : [];
      const firstTitle = asObject(titleItems[0]);
      const existingTitle = asString(asObject(firstTitle?.text)?.content)
        ?? asString(firstTitle?.plain_text);
      let updateSucceeded = true;
      if (existingTitle !== tabTitle) {
        try {
          const properties: Record<string, unknown> = {
            Name: { title: [{ text: { content: tabTitle } }] },
          };
          if (tab.url) {
            properties.URL = { url: tab.url };
          }

          await patchJson(
            `${NOTION_API_BASE}/pages/${existingRow.id}`, { properties }, accessToken,
          );
          updated++;
        } catch {
          updateSucceeded = false;
        }
      }
      if (tabId) {
        nextState.tabs[tabId] = {
          pageId: existingRow.id,
          title: updateSucceeded ? tabTitle : (existingTitle ?? ''),
          url: tab.url,
        };
      }
    } else {
      // Create new row using same format as original sendGroupToNotion
      try {
        const properties: Record<string, unknown> = {
          Name: { title: [{ text: { content: tabTitle } }] },
        };
        if (tab.url) {
          properties.URL = { url: tab.url };
        }

        const children = description
          ? [
              {
                object: 'block',
                type: 'paragraph',
                paragraph: {
                  rich_text: [{ type: 'text', text: { content: description } }],
                },
              },
            ]
          : [];

        const page = await postJson<NotionPageResponse>(
          `${NOTION_API_BASE}/pages`,
          {
            parent: { database_id: databaseId },
            properties,
            children,
          },
          accessToken
        );
        const pageId = asString(page.id);
        if (!pageId) throw new Error('notion_page_create_no_id');
        if (tabId) nextState.tabs[tabId] = { pageId, title: tabTitle, url: tab.url };
        created++;
      } catch {}
    }
  }

  // Delete rows for tabs that no longer exist locally
  for (const [url, row] of existingTabs) {
    if (!processedUrls.has(url)) {
      try {
        await patchJson(
          `${NOTION_API_BASE}/pages/${row.id}`, { archived: true }, accessToken,
        );
        deleted++;
      } catch {}
    }
  }

  return { created, updated, deleted, state: nextState };
}

export async function updateDatabaseDescription(
  accessToken: string,
  databaseId: string,
  note: string,
): Promise<void> {
  const description = note
    ? [{ type: 'text', text: { content: note } }]
    : [];
  await patchJson(
    `${NOTION_API_BASE}/databases/${databaseId}`, { description }, accessToken,
  );
}

/**
 * Archive an entire database (PATCH /v1/databases/{id} {archived:true}).
 * Used when the user stops mirroring and chooses to clean up the database
 * Bluetab created. The database appears in Notion's trash for 30 days.
 */
export async function archiveDatabase(
  accessToken: string,
  databaseId: string
): Promise<void> {
  await patchJson(
    `${NOTION_API_BASE}/databases/${databaseId}`, { archived: true }, accessToken,
  );
}

/**
 * Create a new database under the given parent page. Bluetab uses this for
 * the Save-to-auto-mirror flow: one database per mirrored group, with two
 * columns ("Name" title + "URL" url) so subsequent rows fit.
 */
export async function createMirrorDatabase(
  accessToken: string,
  parentPageId: string,
  title: string
): Promise<{ database_id: string; url?: string }> {
  const data = await postJson<{ id?: string; url?: string }>(
    `${NOTION_API_BASE}/databases`,
    {
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: title } }],
      properties: {
        Name: { title: {} },
        URL: { url: {} },
      },
    },
    accessToken
  );
  if (!data.id) {
    throw new Error('notion_database_create_no_id');
  }
  return { database_id: data.id, url: data.url };
}

function buildPageBody(args: Record<string, unknown>): Record<string, unknown> {
  const parent = asObject(args.parent);
  if (!parent) {
    throw new Error('missing_parent');
  }
  const title = asString(args.title);
  if (!title) {
    throw new Error('missing_title');
  }
  const content = asString(args.content);

  return {
    parent,
    properties: {
      title: [{ text: { content: title } }],
    },
    children: content
      ? [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content } }],
            },
          },
        ]
      : [],
  };
}

async function createPage(
  args: Record<string, unknown>,
  accessToken: string
): Promise<{ pageId?: string; pageUrl?: string }> {
  const body = buildPageBody(args);
  const page = await postJson<NotionPageResponse>(`${NOTION_API_BASE}/pages`, body, accessToken);
  return { pageId: page.id, pageUrl: page.url };
}

async function appendToDatabase(
  args: Record<string, unknown>,
  accessToken: string
): Promise<{ pageId?: string; pageUrl?: string }> {
  const databaseId = asString(args.database_id);
  if (!databaseId) {
    throw new Error('missing_database_id');
  }
  const properties = asObject(args.properties);
  if (!properties) {
    throw new Error('missing_properties');
  }
  const children = Array.isArray(args.children) ? args.children : undefined;

  const body: Record<string, unknown> = {
    parent: { database_id: databaseId },
    properties,
  };
  if (children) {
    body.children = children;
  }

  const page = await postJson<NotionPageResponse>(`${NOTION_API_BASE}/pages`, body, accessToken);
  return { pageId: page.id, pageUrl: page.url };
}

function deriveTabTitle(tab: { title?: string; url?: string }): string {
  return tab.title?.trim() || tab.url || 'Untitled tab';
}

async function sendGroupToNotion(
  args: Record<string, unknown>,
  accessToken: string
): Promise<{
  created: number;
  errors: number;
  items: Array<{ tabId: string; pageId: string; title: string; url: string }>;
}> {
  const groupId = asString(args.groupId);
  if (!groupId) {
    throw new Error('missing_group_id');
  }
  const parent = asObject(args.parent);
  if (!parent) {
    throw new Error('missing_parent');
  }

  // Look up the group by id. Bluetab keeps two independent stores —
  // chrome.storage.local 'groups' is the live tab-group list (what users
  // see in the sidepanel and Manager), and GroupMemoryStorageService is
  // the "remembered groups" feature. Save-to is always operating on the
  // live list, with a fallback to memory for AI calls referencing a
  // remembered-only group id.
  const liveGroups = (await Storage.get<GroupShape[]>('groups')) ?? [];
  let group: GroupShape | undefined = liveGroups.find((g) => g.id === groupId);
  if (!group) {
    const memory = await GroupMemoryStorageService.getMemory();
    const memoryGroup = memory.groups[groupId];
    if (memoryGroup) {
      group = {
        id: memoryGroup.id,
        name: memoryGroup.name,
        tabs: memoryGroup.tabs.map((tab) => ({
          id: tab.originalId,
          url: tab.url,
          title: tab.title,
        })),
      };
    }
  }
  if (!group || !Array.isArray(group.tabs)) {
    throw new Error('group_not_found');
  }

  const settled = await Promise.allSettled(
    group.tabs.map((tab) => {
      const tabTitle = deriveTabTitle(tab);
      const description = [tab.url, (tab as { notes?: string }).notes].filter(Boolean).join('\n\n');
      if ('database_id' in parent) {
        // The Save-to auto-mirror database has a URL column (Batch 3).
        // Populate it when the tab has one so rows are clickable in Notion.
        const properties: Record<string, unknown> = {
          Name: { title: [{ text: { content: tabTitle } }] },
        };
        if (tab.url) {
          properties.URL = { url: tab.url };
        }
        return appendToDatabase(
          {
            database_id: parent.database_id,
            properties,
            children: description
              ? [
                  {
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                      rich_text: [{ type: 'text', text: { content: description } }],
                    },
                  },
                ]
              : undefined,
          },
          accessToken
        );
      }
      return createPage(
        {
          parent,
          title: tabTitle,
          content: description,
        },
        accessToken
      );
    })
  );

  const retryable = settled.find(
    (result) =>
      result.status === 'rejected' &&
      result.reason instanceof Response &&
      [401, 429].includes(result.reason.status)
  );
  if (retryable?.status === 'rejected') {
    throw retryable.reason;
  }

  return {
    created: settled.filter((result) => result.status === 'fulfilled').length,
    errors: settled.filter((result) => result.status === 'rejected').length,
    items: settled.flatMap((result, index) => {
      if (result.status !== 'fulfilled') return [];
      const tab = group.tabs?.[index];
      const tabId = asString(tab?.id);
      const pageId = asString(result.value.pageId);
      if (!tab || !tabId || !pageId) return [];
      return [{
        tabId,
        pageId,
        title: deriveTabTitle(tab),
        url: tab.url ?? '',
      }];
    }),
  };
}

async function pushBrainDumpToNotion(
  args: Record<string, unknown>,
  accessToken: string
): Promise<{ pageId?: string; pageUrl?: string }> {
  const entryId = asString(args.entryId);
  if (!entryId) {
    throw new Error('missing_entry_id');
  }
  const parent = asObject(args.parent);
  if (!parent) {
    throw new Error('missing_parent');
  }

  const entries = await BrainDumpService.list();
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error('entry_not_found');
  }

  const text = asString(args.text) || entry.text;
  const tabUrl = entry.tabContext?.url;
  const content = tabUrl ? `${text} [${tabUrl}]` : text;
  const title = text.slice(0, 100);

  return createPage(
    {
      parent,
      title,
      content,
    },
    accessToken
  );
}

export const adapter: IntegrationAdapter = {
  async executeVerb(
    verb: string,
    args: Record<string, unknown>,
    accessToken: string,
    _accountMeta: Record<string, string>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    try {
      switch (verb) {
        case 'create_page':
          return { success: true, result: await createPage(args, accessToken) };
        case 'append_to_database':
          return { success: true, result: await appendToDatabase(args, accessToken) };
        case 'send_group_to_notion':
          return { success: true, result: await sendGroupToNotion(args, accessToken) };
        case 'push_brain_dump_to_notion':
          return { success: true, result: await pushBrainDumpToNotion(args, accessToken) };
        default:
          return { success: false, error: 'unknown_verb' };
      }
    } catch (error) {
      if (error instanceof Response) {
        throw error;
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async listRecords(
    accessToken: string,
    accountMeta: Record<string, string>,
    since?: Date
  ): Promise<unknown[]> {
    const databaseId = accountMeta.default_database_id;
    if (!databaseId) {
      throw new Error('missing_default_database_id');
    }

    const body = since
      ? {
          filter: {
            timestamp: 'last_edited_time',
            last_edited_time: { after: since.toISOString() },
          },
        }
      : {};

    const data = await postJson<NotionDatabaseQueryResponse>(
      `${NOTION_API_BASE}/databases/${databaseId}/query`,
      body,
      accessToken
    );

    return (data.results || []).map((page) => ({
      id: page.id,
      properties: page.properties,
      last_edited_time: page.last_edited_time ? Date.parse(page.last_edited_time) : 0,
      url: page.url,
    }));
  },
};
