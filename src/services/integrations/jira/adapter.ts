import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { Storage } from '../../../utils/storage';
import { GroupMemoryStorageService } from '../../../utils/group-memory-storage';
import { executeProviderRequest } from '../cloud-operation-client';

const JIRA_API_BASE = 'https://api.atlassian.com/ex/jira';

type JiraIssueResponse = {
  id?: string;
  key?: string;
  self?: string;
};

type JiraProject = {
  id: string;
  key: string;
  name: string;
  avatarUrls?: Record<string, string>;
};

type JiraAccessibleResource = {
  id: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Jira API v3 expects descriptions in Atlassian Document Format (ADF), not
 * plain text. We wrap the user's description string in a single-paragraph
 * ADF doc — sufficient for the verb taxonomy Bluetab exposes.
 */
function asAdfDoc(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

async function postIssue(
  cloudId: string,
  body: Record<string, unknown>,
  accessToken: string
): Promise<JiraIssueResponse> {
  const url = `${JIRA_API_BASE}/${cloudId}/rest/api/3/issue`;
  const response = await executeProviderRequest(accessToken, 'jira.issue.create', { cloudId, body }, () => fetch(url, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  }));
  if (!response.ok) {
    throw response;
  }
  return (await response.json()) as JiraIssueResponse;
}

async function createIssue(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ success: boolean; result?: { issueKey?: string; issueUrl?: string }; error?: string }> {
  const projectKey = asString(args.project_key) || accountMeta.project_key;
  const summary = asString(args.summary);
  if (!projectKey) {
    throw new Error('missing_project_key');
  }
  if (!summary) {
    throw new Error('missing_summary');
  }
  const cloudId = asString(accountMeta.cloud_id);
  if (!cloudId) {
    throw new Error('missing_cloud_id');
  }
  const description = asString(args.description) ?? '';
  const issuetype = asString(args.issuetype) ?? 'Task';

  const body = {
    fields: {
      project: { key: projectKey },
      summary,
      issuetype: { name: issuetype },
      description: asAdfDoc(description),
    },
  };

  const issue = await postIssue(cloudId, body, accessToken);
  const siteUrl = asString(accountMeta.site_url);
  const issueUrl = issue.key && siteUrl ? `${siteUrl}/browse/${issue.key}` : undefined;
  return {
    success: true,
    result: { issueKey: issue.key, issueUrl },
  };
}

async function sendGroupToJira(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ success: boolean; result?: { issueKey?: string; issueUrl?: string }; error?: string }> {
  const groupId = asString(args.groupId);
  const projectKey = asString(args.project_key) || accountMeta.project_key;
  if (!groupId) {
    throw new Error('missing_group_id');
  }
  if (!projectKey) {
    throw new Error('missing_project_key');
  }

  const liveGroups = await Storage.get<Array<{
    id: string;
    name: string;
    tabs: Array<{ url: string; title?: string; notes?: string }>;
  }>>('groups');
  const liveGroup = liveGroups?.find((item) => item.id === groupId);
  const memory = await GroupMemoryStorageService.getMemory();
  const rememberedGroup = memory.groups[groupId];
  const group = liveGroup ?? rememberedGroup;
  if (!group) {
    throw new Error('group_not_found');
  }

  const description = group.tabs
    .map((tab, index) => {
      const tabTitle = tab.title?.trim() || tab.url || 'Untitled tab';
      const notes = (tab as { notes?: string }).notes;
      return notes
        ? `${index + 1}. ${tabTitle}\n${tab.url}\n${notes}`
        : `${index + 1}. ${tabTitle}\n${tab.url}`;
    })
    .join('\n\n');

  return createIssue(
    {
      project_key: projectKey,
      summary: group.name || 'Bluetab group',
      description,
    },
    accessToken,
    accountMeta
  );
}

async function pushBrainDumpToJira(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<ReturnType<typeof createIssue>> {
  const entryId = asString(args.entryId);
  const projectKey = asString(args.project_key) || accountMeta.project_key;
  if (!entryId) {
    throw new Error('missing_entry_id');
  }
  if (!projectKey) {
    throw new Error('missing_project_key');
  }

  const entries = await BrainDumpService.list();
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error('entry_not_found');
  }

  const text = asString(args.text) || entry.text;
  const tabUrl = entry.tabContext?.url;
  const description = tabUrl ? `${text}\n\n${tabUrl}` : text;
  const summary = text.slice(0, 100) || 'Brain dump';

  return createIssue(
    {
      project_key: projectKey,
      summary,
      description,
    },
    accessToken,
    accountMeta
  );
}

/**
 * Fetch Jira projects for the given cloud instance.
 * Used by the settings UI to populate the project selector dropdown.
 */
export async function fetchProjects(
  cloudId: string,
  accessToken: string
): Promise<JiraProject[]> {
  const url = `${JIRA_API_BASE}/${cloudId}/rest/api/3/project`;
  const response = await executeProviderRequest(accessToken, 'jira.projects.list', { cloudId }, () => fetch(url, {
    method: 'GET',
    headers: authHeaders(accessToken),
  }));
  if (!response.ok) {
    throw response;
  }
  return (await response.json()) as JiraProject[];
}

export async function fetchAccessibleResources(accessToken: string): Promise<JiraAccessibleResource[]> {
  const response = await executeProviderRequest(accessToken, 'jira.resources.list', {}, () => fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    method: 'GET',
    headers: authHeaders(accessToken),
  }));
  if (!response.ok) {
    throw response;
  }
  return (await response.json()) as JiraAccessibleResource[];
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
        case 'send_group_to_jira':
          return await sendGroupToJira(args, accessToken, accountMeta);
        case 'push_brain_dump_to_jira':
          return await pushBrainDumpToJira(args, accessToken, accountMeta);
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
