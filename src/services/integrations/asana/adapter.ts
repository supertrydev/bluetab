import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { GroupMemoryStorageService } from '../../../utils/group-memory-storage';
import { executeProviderRequest } from '../cloud-operation-client';

const ASANA_TASKS_URL = 'https://app.asana.com/api/1.0/tasks';

type AsanaTaskResponse = {
  data?: {
    gid?: string;
    name?: string;
  };
};

export type AsanaProject = {
  gid: string;
  name: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

interface CreateTaskInput {
  name: string;
  notes?: string;
  workspace: string;
  project?: string;
  assignee?: string;
  due_on?: string;
}

async function postTask(
  input: CreateTaskInput,
  accessToken: string
): Promise<{ success: boolean; result?: { taskGid?: string; taskUrl?: string }; error?: string }> {
  // Asana wraps every body and every response in { data: ... }.
  const body = {
    data: {
      name: input.name,
      notes: input.notes,
      workspace: input.workspace,
      projects: input.project ? [input.project] : [],
      ...(input.assignee ? { assignee: input.assignee } : {}),
      ...(input.due_on ? { due_on: input.due_on } : {}),
    },
  };

  const response = await executeProviderRequest(accessToken, 'asana.task.create', { body }, () => fetch(ASANA_TASKS_URL, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  }));
  if (!response.ok) {
    throw response;
  }
  const data = (await response.json()) as AsanaTaskResponse;
  const gid = data.data?.gid;
  return {
    success: true,
    result: {
      taskGid: gid,
      taskUrl: gid ? `https://app.asana.com/0/${input.project || 0}/${gid}` : undefined,
    },
  };
}

async function createTask(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<ReturnType<typeof postTask>> {
  const name = asString(args.name);
  if (!name) {
    throw new Error('missing_name');
  }
  const workspace =
    asString(args.workspace) ?? asString(accountMeta.workspace_gid);
  if (!workspace) {
    throw new Error('missing_workspace');
  }
  return postTask(
    {
      name,
      notes: asString(args.notes),
      workspace,
      project: asString(args.project),
      assignee: asString(args.assignee),
      due_on: asString(args.due_on),
    },
    accessToken
  );
}

async function sendGroupToAsana(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<ReturnType<typeof postTask>> {
  const groupId = asString(args.groupId);
  if (!groupId) {
    throw new Error('missing_group_id');
  }
  const workspace =
    asString(args.workspace) ?? asString(accountMeta.workspace_gid);
  if (!workspace) {
    throw new Error('missing_workspace');
  }

  const memory = await GroupMemoryStorageService.getMemory();
  const group = memory.groups[groupId];
  if (!group) {
    throw new Error('group_not_found');
  }

  const project = asString(args.project) ?? asString(accountMeta.project);
  const notes = group.tabs
    .map((tab, index) => {
      const tabTitle = tab.title?.trim() || tab.url || 'Untitled tab';
      const tabNotes = (tab as { notes?: string }).notes;
      return tabNotes
        ? `${index + 1}. ${tabTitle}\n${tab.url}\n${tabNotes}`
        : `${index + 1}. ${tabTitle}\n${tab.url}`;
    })
    .join('\n\n');

  return postTask(
    {
      name: group.name || 'Bluetab group',
      notes,
      workspace,
      project,
    },
    accessToken
  );
}

async function pushBrainDumpToAsana(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<ReturnType<typeof postTask>> {
  const entryId = asString(args.entryId);
  if (!entryId) {
    throw new Error('missing_entry_id');
  }
  const workspace =
    asString(args.workspace) ?? asString(accountMeta.workspace_gid);
  if (!workspace) {
    throw new Error('missing_workspace');
  }

  const entries = await BrainDumpService.list();
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error('entry_not_found');
  }

  const text = asString(args.text) || entry.text;
  const tabUrl = entry.tabContext?.url;
  const notes = tabUrl ? `${text}\n\n${tabUrl}` : text;
  const name = text.slice(0, 100) || 'Brain dump';

  return postTask(
    {
      name,
      notes,
      workspace,
      project: asString(args.project) ?? asString(accountMeta.project),
    },
    accessToken
  );
}

export async function fetchProjects(
  workspaceGid: string,
  accessToken: string
): Promise<AsanaProject[]> {
  const response = await executeProviderRequest(accessToken, 'asana.projects.list', { workspace: workspaceGid }, () => fetch(
    `https://app.asana.com/api/1.0/projects?workspace=${encodeURIComponent(workspaceGid)}&archived=false&opt_fields=gid,name`,
    {
      method: 'GET',
      headers: authHeaders(accessToken),
    }
  ));
  if (!response.ok) {
    throw response;
  }
  const data = (await response.json()) as { data?: AsanaProject[] };
  return data.data ?? [];
}

export const adapter: IntegrationAdapter = {
  async executeVerb(
    verb: string,
    args: Record<string, unknown>,
    accessToken: string,
    accountMeta: Record<string, string>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    try {
      switch (verb) {
        case 'create_task':
          return await createTask(args, accessToken, accountMeta);
        case 'send_group_to_asana':
          return await sendGroupToAsana(args, accessToken, accountMeta);
        case 'push_brain_dump_to_asana':
          return await pushBrainDumpToAsana(args, accessToken, accountMeta);
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
};
