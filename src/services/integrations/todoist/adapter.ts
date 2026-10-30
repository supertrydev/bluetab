import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { TodoistSyncStorage } from '../../todoist-sync-storage';
import { Storage } from '../../../utils/storage';
import { GroupMemoryStorageService } from '../../../utils/group-memory-storage';
import type { TabGroup } from '../../../types/models';
import { executeProviderRequest } from '../cloud-operation-client';

const TODOIST_TASKS_URL = 'https://api.todoist.com/api/v1/tasks';
const TODOIST_PROJECTS_URL = 'https://api.todoist.com/api/v1/projects';

type TodoistTask = {
  id?: string;
  content?: string;
  description?: string;
  due?: unknown;
  priority?: number;
  updated_at?: string;
  url?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  accessToken: string,
  operation: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await executeProviderRequest(
    accessToken,
    operation,
    input,
    () => fetch(url, init),
  );
  if (!response.ok) {
    throw response;
  }
  return (await response.json()) as T;
}

async function createTask(args: Record<string, unknown>, accessToken: string): Promise<{ taskId?: string; taskUrl?: string }> {
  const content = asString(args.content);
  if (!content) {
    throw new Error('missing_content');
  }

  const body = omitUndefined({
    content,
    description: asString(args.description),
    due_date: asString(args.due_date),
    priority: asNumber(args.priority),
    project_id: asString(args.project_id),
    labels: asStringArray(args.labels),
  });

  const task = await requestJson<TodoistTask>(TODOIST_TASKS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, accessToken, 'todoist.task.create', { body });

  return {
    taskId: task.id,
    taskUrl: task.url || (task.id ? `https://todoist.com/showTask?id=${task.id}` : undefined),
  };
}

async function updateTask(args: Record<string, unknown>, accessToken: string): Promise<{ updated: boolean }> {
  const taskId = asString(args.taskId);
  if (!taskId) throw new Error('missing_task_id');

  const body = omitUndefined({
    content: asString(args.content),
    description: asString(args.description),
    due_date: asString(args.due_date),
    priority: asNumber(args.priority),
  });

  await requestJson<TodoistTask>(`${TODOIST_TASKS_URL}/${taskId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, accessToken, 'todoist.task.update', { taskId, body });
  return { updated: true };
}

async function deleteTask(args: Record<string, unknown>, accessToken: string): Promise<{ deleted: boolean }> {
  const taskId = asString(args.taskId);
  if (!taskId) throw new Error('missing_task_id');

  const response = await executeProviderRequest(
    accessToken,
    'todoist.task.delete',
    { taskId },
    () => fetch(`${TODOIST_TASKS_URL}/${taskId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  );
  if (!response.ok && response.status !== 404) throw response;
  return { deleted: true };
}

async function sendGroupToTodoist(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ created: number; errors: number }> {
  const groupId = asString(args.groupId);
  if (!groupId) throw new Error('missing_group_id');

  const projectId = asString(args.project_id) || '';

  const memory = await GroupMemoryStorageService.getMemory();
  const rememberedGroup = memory.groups[groupId];
  let group: TabGroup | undefined = rememberedGroup
    ? {
        id: rememberedGroup.id,
        name: rememberedGroup.name,
        color: rememberedGroup.color,
        tags: rememberedGroup.tags,
        isPinned: rememberedGroup.isPinned,
        pinnedAt: rememberedGroup.pinnedAt,
        projectId: rememberedGroup.projectId,
        tabs: rememberedGroup.tabs.map((tab) => ({
          id: tab.originalId || tab.url,
          url: tab.url,
          title: tab.title,
          favicon: tab.favicon,
          timestamp: rememberedGroup.rememberedAt,
          groupId: rememberedGroup.id,
        })),
        created: rememberedGroup.created,
        modified: rememberedGroup.rememberedAt,
      }
    : undefined;
  if (!group) {
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    group = groups.find((g) => g.id === groupId);
  }
  if (!group) throw new Error('group_not_found');

  // Sequential to stay within Todoist's 4 rps rate limit
  let created = 0;
  let errors = 0;
  for (let i = 0; i < group.tabs.length; i++) {
    const tab = group.tabs[i];
    try {
      const result = await createTask(
        { content: tab.title || tab.url, description: tab.url, project_id: projectId || undefined },
        accessToken,
      );
      if (result.taskId) {
        await TodoistSyncStorage.addTaskMapping({
          tabId: tab.id || `${groupId}-tab-${i}`,
          taskId: result.taskId,
          groupId,
          groupName: group.name,
          tabTitle: tab.title || 'Untitled',
          tabUrl: tab.url,
          projectId,
          accountId: accountMeta.account_id || '',
        });
      }
      created++;
    } catch (err) {
      if (err instanceof Response && [401, 429].includes(err.status)) throw err;
      errors++;
    }
  }

  return { created, errors };
}

async function pushBrainDumpToTodoist(
  args: Record<string, unknown>,
  accessToken: string
): Promise<{ taskId?: string; taskUrl?: string }> {
  const entryId = asString(args.entryId);
  if (!entryId) {
    throw new Error('missing_entry_id');
  }

  const entries = await BrainDumpService.list();
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error('entry_not_found');
  }

  const text = asString(args.text) || entry.text;
  return createTask(
    {
      content: text.slice(0, 500),
      description: entry.tabContext?.url,
      project_id: asString(args.project_id),
    },
    accessToken
  );
}

async function startGroupMirroring(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ started: boolean; groupId: string; taskCount: number }> {
  const groupId = asString(args.groupId);
  const projectId = asString(args.projectId) || asString(accountMeta.default_target) || '';
  if (!groupId) throw new Error('missing_group_id');

  const groups = await Storage.get<TabGroup[]>('groups') || [];
  const group = groups.find(g => g.id === groupId);
  if (!group) throw new Error('group_not_found');

  await TodoistSyncStorage.startGroupSync(groupId, group.name, projectId, accountMeta.account_id || '');

  const result = await sendGroupToTodoist(
    { groupId, project_id: projectId },
    accessToken,
    accountMeta,
  );

  return { started: true, groupId, taskCount: result.created };
}

async function stopGroupMirroring(
  args: Record<string, unknown>,
  accessToken: string,
): Promise<{ stopped: boolean; groupId: string; deletedTasks: number }> {
  const groupId = asString(args.groupId);
  if (!groupId) throw new Error('missing_group_id');

  const groupTasks = await TodoistSyncStorage.getGroupTasks(groupId);
  const results = await Promise.allSettled(
    groupTasks.map(async (task) => {
      await deleteTask({ taskId: task.taskId }, accessToken);
      await TodoistSyncStorage.removeTaskMapping(task.tabId);
    }),
  );

  await TodoistSyncStorage.stopGroupSync(groupId);
  return {
    stopped: true,
    groupId,
    deletedTasks: results.filter(r => r.status === 'fulfilled').length,
  };
}

async function syncGroupChanges(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ synced: boolean; action: string }> {
  const groupId = asString(args.groupId);
  const action = asString(args.action);
  if (!groupId || !action) throw new Error('missing_group_id_or_action');

  console.log(`[Todoist] syncGroupChanges: action=${action}, groupId=${groupId}`);

  const isSyncing = await TodoistSyncStorage.isGroupSyncing(groupId);
  if (!isSyncing) {
    console.log(`[Todoist] Group ${groupId} not syncing, skipping`);
    return { synced: false, action: 'not_syncing' };
  }

  const syncGroups = await TodoistSyncStorage.getAllSyncGroups();
  const syncGroup = syncGroups.find(g => g.groupId === groupId);
  const projectId = syncGroup?.projectId || asString(accountMeta.default_target) || '';

  switch (action) {
    case 'add_tab': {
      const tabData = args.tabData as any;
      if (!tabData) {
        console.log('[Todoist] add_tab: no tabData');
        break;
      }
      const tabId = asString(tabData.id);
      const existingMapping = tabId
        ? await TodoistSyncStorage.getTaskMapping(tabId)
        : null;
      if (existingMapping?.groupId === groupId) {
        break;
      }

      const groups = await Storage.get<TabGroup[]>('groups') || [];
      let group: TabGroup | undefined = groups.find(g => g.id === groupId);
      if (!group) {
        const mem = await GroupMemoryStorageService.getMemory();
        group = mem.groups[groupId] as unknown as TabGroup | undefined;
      }
      if (!group) {
        console.log(`[Todoist] add_tab: group ${groupId} not found`);
        break;
      }

      console.log(`[Todoist] Creating task for new tab: ${tabData.title || tabData.url}`);
      const result = await createTask(
        { content: `${group.name} — ${tabData.title || tabData.url}`, description: tabData.url, project_id: projectId || undefined },
        accessToken,
      );
      console.log(`[Todoist] Task created:`, result);
      if (result.taskId) {
        await TodoistSyncStorage.addTaskMapping({
          tabId: tabData.id,
          taskId: result.taskId,
          groupId,
          groupName: group.name,
          tabTitle: tabData.title || 'Untitled',
          tabUrl: tabData.url,
          projectId,
          accountId: accountMeta.account_id || '',
        });
      }
      break;
    }
    case 'remove_tab': {
      const tabId = asString(args.tabId);
      if (!tabId) break;
      const mapping = await TodoistSyncStorage.getTaskMapping(tabId);
      if (mapping) {
        await deleteTask({ taskId: mapping.taskId }, accessToken);
        await TodoistSyncStorage.removeTaskMapping(tabId);
      }
      break;
    }
    case 'update_tab': {
      const tabId = asString(args.tabId);
      const tabData = args.tabData as any;
      if (!tabId || !tabData) break;
      const mapping = await TodoistSyncStorage.getTaskMapping(tabId);
      if (mapping) {
        const groups = await Storage.get<TabGroup[]>('groups') || [];
        const group = groups.find(g => g.id === groupId);
        const groupName = asString(args.groupName) || group?.name || mapping.groupName;
        await updateTask({
          taskId: mapping.taskId,
          content: `${groupName} — ${tabData.title || tabData.url}`,
          description: tabData.url,
        }, accessToken);
      }
      break;
    }
    case 'delete': {
      const groupTasks = await TodoistSyncStorage.getGroupTasks(groupId);
      await Promise.allSettled(
        groupTasks.map(async (task) => {
          await deleteTask({ taskId: task.taskId }, accessToken);
          await TodoistSyncStorage.removeTaskMapping(task.tabId);
        }),
      );
      await TodoistSyncStorage.stopGroupSync(groupId);
      break;
    }
  }

  return { synced: true, action };
}

export const adapter: IntegrationAdapter = {
  async executeVerb(
    verb: string,
    args: Record<string, unknown>,
    accessToken: string,
    accountMeta: Record<string, string>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const mergedArgs = { ...args, project_id: asString(args.project_id) || asString(accountMeta.default_target) };
    try {
      switch (verb) {
        case 'create_task':
          return { success: true, result: await createTask(mergedArgs, accessToken) };
        case 'send_group_to_todoist':
          return { success: true, result: await sendGroupToTodoist(mergedArgs, accessToken, accountMeta) };
        case 'push_brain_dump_to_todoist':
          return { success: true, result: await pushBrainDumpToTodoist(mergedArgs, accessToken) };
        case 'start_group_mirroring':
          return { success: true, result: await startGroupMirroring(mergedArgs, accessToken, accountMeta) };
        case 'stop_group_mirroring':
          return { success: true, result: await stopGroupMirroring(mergedArgs, accessToken) };
        case 'sync_group_changes_to_todoist':
          return { success: true, result: await syncGroupChanges(mergedArgs, accessToken, accountMeta) };
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
    _accountMeta: Record<string, string>,
    since?: Date
  ): Promise<unknown[]> {
    const url = since ? `${TODOIST_TASKS_URL}?since=${encodeURIComponent(since.toISOString())}` : TODOIST_TASKS_URL;
    const tasks = await requestJson<TodoistTask[]>(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }, accessToken, 'todoist.tasks.list', since ? { since: since.toISOString() } : {});

    return tasks.map((task) => ({
      id: task.id || '',
      content: task.content || '',
      due: task.due,
      priority: task.priority,
      updatedAt: task.updated_at ? Date.parse(task.updated_at) : 0,
    }));
  },
};

type TodoistProject = { id?: string; name?: string; color?: string; is_archived?: boolean };

export async function fetchProjects(accessToken: string): Promise<{ id: string; name: string }[]> {
  const raw = await requestJson<TodoistProject[] | { results: TodoistProject[] }>(TODOIST_PROJECTS_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  }, accessToken, 'todoist.projects.list', {});
  const projects = Array.isArray(raw) ? raw : (raw.results ?? []);
  return projects
    .filter((p) => p.id && p.name && !p.is_archived)
    .map((p) => ({ id: p.id!, name: p.name! }));
}
