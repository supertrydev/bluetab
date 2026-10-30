import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { GroupMemoryStorageService } from '../../../utils/group-memory-storage';
import { executeProviderRequest } from '../cloud-operation-client';

const GITLAB_API_BASE = 'https://gitlab.com/api/v4';

type GitLabIssueResponse = {
  iid?: number;
  id?: number;
  web_url?: string;
};

export type GitLabProject = {
  id: number;
  name: string;
  name_with_namespace?: string;
  path_with_namespace?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

function asNumberArray(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
    ? value
    : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

function resolveProjectId(
  args: Record<string, unknown>,
  accountMeta?: Record<string, string>
): string | undefined {
  return (
    asString(args.project_id) ||
    asString(args.project) ||
    accountMeta?.project ||
    accountMeta?.default_target
  );
}

export async function fetchProjects(accessToken: string): Promise<GitLabProject[]> {
  const response = await executeProviderRequest(accessToken, 'gitlab.projects.list', {}, () => fetch(
    `${GITLAB_API_BASE}/projects?membership=true&simple=true&order_by=last_activity_at&sort=desc&per_page=100`,
    {
      headers: authHeaders(accessToken),
    }
  ));
  if (!response.ok) {
    throw response;
  }
  return (await response.json()) as GitLabProject[];
}

interface IssueInput {
  project_id: string;
  title: string;
  description?: string;
  labels?: string[];
  assignee_ids?: number[];
}

async function postIssue(
  input: IssueInput,
  accessToken: string
): Promise<{ success: boolean; result?: { issueIid?: number; issueUrl?: string }; error?: string }> {
  // GitLab API expects labels as a comma-separated string, not an array.
  const body = omitUndefined({
    title: input.title,
    description: input.description,
    labels: input.labels && input.labels.length > 0 ? input.labels.join(',') : undefined,
    assignee_ids: input.assignee_ids,
  });

  const response = await executeProviderRequest(accessToken, 'gitlab.issue.create', {
    projectId: input.project_id,
    body,
  }, () => fetch(
    `${GITLAB_API_BASE}/projects/${encodeURIComponent(input.project_id)}/issues`,
    {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(body),
    }
  ));
  if (!response.ok) {
    throw response;
  }
  const data = (await response.json()) as GitLabIssueResponse;
  return { success: true, result: { issueIid: data.iid, issueUrl: data.web_url } };
}

async function createIssue(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta?: Record<string, string>
): Promise<ReturnType<typeof postIssue>> {
  const projectId = resolveProjectId(args, accountMeta);
  const title = asString(args.title);
  if (!projectId) {
    throw new Error('missing_project_id');
  }
  if (!title) {
    throw new Error('missing_title');
  }
  return postIssue(
    {
      project_id: projectId,
      title,
      description: asString(args.description),
      labels: asStringArray(args.labels),
      assignee_ids: asNumberArray(args.assignee_ids),
    },
    accessToken
  );
}

async function sendGroupToGitLab(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta?: Record<string, string>
): Promise<ReturnType<typeof postIssue>> {
  const groupId = asString(args.groupId);
  const projectId = resolveProjectId(args, accountMeta);
  if (!groupId) {
    throw new Error('missing_group_id');
  }
  if (!projectId) {
    throw new Error('missing_project_id');
  }

  const memory = await GroupMemoryStorageService.getMemory();
  const group = memory.groups[groupId];
  if (!group) {
    throw new Error('group_not_found');
  }

  const groupName = group.name?.trim() || 'Bluetab group';
  const tabLines = group.tabs.map((tab, index) => {
    const tabTitle = tab.title?.trim() || tab.url || `Tab ${index + 1}`;
    const notes = (tab as { notes?: string }).notes?.trim();
    return notes
      ? `- [${tabTitle}](${tab.url})\n  ${notes}`
      : `- [${tabTitle}](${tab.url})`;
  });
  const groupNotes = (group as { notes?: string }).notes?.trim();
  const description = [
    `Tabs from Bluetab group: ${groupName}`,
    '',
    ...tabLines,
    ...(groupNotes ? ['', 'Group notes:', groupNotes] : []),
  ].join('\n');

  return postIssue(
    {
      project_id: projectId,
      title: `[Bluetab] ${groupName}`,
      description,
    },
    accessToken
  );
}

async function pushBrainDumpToGitLab(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta?: Record<string, string>
): Promise<ReturnType<typeof postIssue>> {
  const entryId = asString(args.entryId);
  const projectId = resolveProjectId(args, accountMeta);
  if (!entryId) {
    throw new Error('missing_entry_id');
  }
  if (!projectId) {
    throw new Error('missing_project_id');
  }

  const entries = await BrainDumpService.list();
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error('entry_not_found');
  }

  const text = asString(args.text) || entry.text;
  const tabUrl = entry.tabContext?.url;
  const description = tabUrl ? `${text}\n\n${tabUrl}` : text;
  const title = text.slice(0, 100) || 'Brain dump';
  return postIssue({ project_id: projectId, title, description }, accessToken);
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
        case 'create_issue':
          return await createIssue(args, accessToken, accountMeta);
        case 'send_group_to_gitlab':
          return await sendGroupToGitLab(args, accessToken, accountMeta);
        case 'push_brain_dump_to_gitlab':
          return await pushBrainDumpToGitLab(args, accessToken, accountMeta);
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
