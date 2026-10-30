import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { GroupMemoryStorageService } from '../../../utils/group-memory-storage';
import { Storage } from '../../../utils/storage';
import type { TabGroup } from '../../../types/models';
import { LinearSyncStorage } from '../../linear-sync-storage';
import {
  executeCloudOperation,
  isCloudConnectionCredential,
} from '../cloud-operation-client';

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

const ISSUE_CREATE_MUTATION = `
  mutation issueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        title
        url
      }
    }
  }
`;

const ISSUE_UPDATE_MUTATION = `
  mutation issueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
    }
  }
`;

const ISSUES_QUERY = `
  query issues($filter: IssueFilter) {
    issues(filter: $filter) {
      nodes {
        id
        title
        description
        state {
          name
        }
        updatedAt
      }
    }
  }
`;

const ISSUE_DELETE_MUTATION = `
  mutation issueDelete($id: String!) {
    issueDelete(id: $id) {
      success
    }
  }
`;

const TEAMS_QUERY = `
  query teams {
    teams {
      nodes {
        id
        name
        description
      }
    }
    viewer {
      id
      name
      email
    }
  }
`;

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type LinearIssueNode = {
  id: string;
  title?: string;
  description?: string | null;
  state?: { name?: string } | null;
  updatedAt?: string;
  url?: string;
};

type LinearTeam = {
  id: string;
  name: string;
  description?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

async function gql<T>(query: string, variables: Record<string, unknown>, accessToken: string): Promise<T> {
  console.log('[Linear] Making GraphQL request');

  let response: Response;
  if (isCloudConnectionCredential(accessToken)) {
    const operation = query === ISSUE_CREATE_MUTATION
      ? 'linear.issue.create'
      : query === ISSUE_UPDATE_MUTATION
        ? 'linear.issue.update'
        : query === ISSUE_DELETE_MUTATION
          ? 'linear.issue.delete'
          : query === TEAMS_QUERY
            ? 'linear.teams.list'
            : null;
    if (!operation) throw new Error('cloud_operation_not_supported');
    response = await executeCloudOperation(accessToken, operation, { variables });
  } else {
    response = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  }

  if (!response.ok) {
    console.error(`[Linear] GraphQL request failed: ${response.status} ${response.statusText}`);
    throw response;
  }

  const payload = (await response.json()) as GraphQLResponse<T>;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message || 'GraphQL error').join('; '));
  }
  if (!payload.data) {
    throw new Error('Linear response did not include data.');
  }
  return payload.data;
}

async function createIssue(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ issueId?: string; issueUrl?: string }> {
  const title = asString(args.title);
  const teamId = asString(args.teamId) || accountMeta.team_id;

  if (!title) {
    throw new Error('missing_title');
  }
  if (!teamId) {
    throw new Error('missing_team_id');
  }

  const input = omitUndefined({
    title,
    description: asString(args.description),
    teamId,
    priority: asNumber(args.priority),
    assigneeId: asString(args.assigneeId),
  });

  const data = await gql<{
    issueCreate: { success: boolean; issue?: LinearIssueNode | null };
  }>(ISSUE_CREATE_MUTATION, { input }, accessToken);

  return {
    issueId: data.issueCreate.issue?.id,
    issueUrl: data.issueCreate.issue?.url,
  };
}

async function updateIssue(args: Record<string, unknown>, accessToken: string): Promise<{ updated: boolean }> {
  const issueId = asString(args.issueId);
  if (!issueId) {
    throw new Error('missing_issue_id');
  }

  const input = omitUndefined({
    title: asString(args.title),
    description: asString(args.description),
    priority: asNumber(args.priority),
    stateId: asString(args.stateId),
  });

  const data = await gql<{
    issueUpdate: { success: boolean };
  }>(ISSUE_UPDATE_MUTATION, { id: issueId, input }, accessToken);

  return { updated: data.issueUpdate.success };
}

async function deleteIssue(args: Record<string, unknown>, accessToken: string): Promise<{ deleted: boolean }> {
  const issueId = asString(args.issueId);
  if (!issueId) {
    throw new Error('missing_issue_id');
  }

  const data = await gql<{
    issueDelete: { success: boolean };
  }>(ISSUE_DELETE_MUTATION, { id: issueId }, accessToken);

  return { deleted: data.issueDelete.success };
}

async function startGroupMirroring(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ started: boolean; groupId: string; issueCount: number }> {
  const groupId = asString(args.groupId);
  const teamId = asString(args.teamId) || accountMeta.team_id;

  if (!groupId || !teamId) {
    throw new Error('missing_group_id_or_team_id');
  }

  // Find the group
  const activeGroups = await Storage.get<TabGroup[]>('groups') || [];
  const group = activeGroups.find(g => g.id === groupId);

  if (!group) {
    throw new Error('group_not_found');
  }

  console.log(`[Linear] Starting mirroring for group: ${group.name}`);

  // Send group to Linear (this will enable auto-sync)
  const result = await sendGroupToLinear(
    { groupId, teamId },
    accessToken,
    { ...accountMeta, team_id: teamId }
  );

  return {
    started: true,
    groupId,
    issueCount: result.created
  };
}

async function stopGroupMirroring(
  args: Record<string, unknown>,
  accessToken: string,
  _accountMeta: Record<string, string>
): Promise<{ stopped: boolean; groupId: string; deletedIssues: number }> {
  const groupId = asString(args.groupId);

  if (!groupId) {
    throw new Error('missing_group_id');
  }

  console.log(`[Linear] Stopping mirroring for group: ${groupId}`);

  // Get all issues for this group
  const groupIssues = await LinearSyncStorage.getGroupIssues(groupId);

  // Delete all Linear issues for this group
  const deleteResults = await Promise.allSettled(
    groupIssues.map(async (issue) => {
      const result = await deleteIssue({ issueId: issue.issueId }, accessToken);
      if (result.deleted) {
        await LinearSyncStorage.removeIssueMapping(issue.tabId);
      }
      return result;
    })
  );

  // Stop sync for the group
  await LinearSyncStorage.stopGroupSync(groupId);

  const deletedCount = deleteResults.filter(r => r.status === 'fulfilled').length;

  return {
    stopped: true,
    groupId,
    deletedIssues: deletedCount
  };
}

async function syncGroupChangesToLinear(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ synced: boolean; actions: string[] }> {
  const groupId = asString(args.groupId);
  const action = asString(args.action); // 'update', 'delete', 'add_tab', 'remove_tab', 'update_tab'

  if (!groupId || !action) {
    throw new Error('missing_group_id_or_action');
  }

  console.log(`[Linear] Auto-syncing ${action} for group ${groupId}`);

  // Check if group is being synced
  const isSync = await LinearSyncStorage.isGroupSyncing(groupId);
  if (!isSync) {
    console.log(`[Linear] Group ${groupId} is not being synced, skipping`);
    return { synced: false, actions: ['Group not being synced'] };
  }

  const actions: string[] = [];

  try {
    switch (action) {
      case 'add_tab': {
        const tabData = args.tabData as any;
        const teamId = asString(args.teamId) || accountMeta.team_id;

        if (tabData && teamId) {
          const tabId = asString(tabData.id);
          const existingMapping = tabId
            ? await LinearSyncStorage.getIssueMapping(tabId)
            : null;
          if (existingMapping?.groupId === groupId) {
            actions.push(`Reused issue ${existingMapping.issueId} for remembered tab`);
            break;
          }

          const activeGroups = await Storage.get<TabGroup[]>('groups') || [];
          const group = activeGroups.find(g => g.id === groupId);

          if (group) {
            const result = await createIssue({
              title: `${group.name} - ${tabData.title || tabData.url}`,
              description: `Group: ${group.name}\nTab: ${tabData.title || 'Untitled'}\nURL: ${tabData.url}`,
              teamId
            }, accessToken, accountMeta);

            if (result.issueId) {
              await LinearSyncStorage.addIssueMapping({
                tabId: tabData.id,
                issueId: result.issueId,
                groupId,
                groupName: group.name,
                tabTitle: tabData.title || 'Untitled',
                tabUrl: tabData.url,
                teamId,
                accountId: accountMeta.account_id || ''
              });
              actions.push(`Created issue ${result.issueId} for new tab`);
            }
          }
        }
        break;
      }

      case 'remove_tab': {
        const tabId = asString(args.tabId);
        if (tabId) {
          const mapping = await LinearSyncStorage.getIssueMapping(tabId);
          if (mapping) {
            const result = await deleteIssue({ issueId: mapping.issueId }, accessToken);
            if (result.deleted) {
              await LinearSyncStorage.removeIssueMapping(tabId);
              actions.push(`Deleted issue ${mapping.issueId} for removed tab`);
            }
          }
        }
        break;
      }

      case 'update_tab': {
        const tabId = asString(args.tabId);
        const tabData = args.tabData as any;

        if (tabId && tabData) {
          const mapping = await LinearSyncStorage.getIssueMapping(tabId);
          if (mapping) {
            const activeGroups = await Storage.get<TabGroup[]>('groups') || [];
            const group = activeGroups.find(g => g.id === groupId);

            if (group) {
              const result = await updateIssue({
                issueId: mapping.issueId,
                title: `${group.name} - ${tabData.title || tabData.url}`,
                description: `Group: ${group.name}\nTab: ${tabData.title || 'Untitled'}\nURL: ${tabData.url}`
              }, accessToken);

              if (result.updated) {
                actions.push(`Updated issue ${mapping.issueId} for tab changes`);
              }
            }
          }
        }
        break;
      }

      case 'delete': {
        // Group deleted - stop mirroring
        const result = await stopGroupMirroring({ groupId }, accessToken, accountMeta);
        actions.push(`Stopped mirroring and deleted ${result.deletedIssues} issues`);
        break;
      }

      default:
        actions.push(`Unknown action: ${action}`);
    }

    await LinearSyncStorage.updateSyncStatus(groupId, 'active');

    return { synced: true, actions };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await LinearSyncStorage.updateSyncStatus(groupId, 'error', errorMessage);
    console.error(`[Linear] Sync error for group ${groupId}:`, error);

    return {
      synced: false,
      actions: [`Error: ${errorMessage}`]
    };
  }
}

export async function fetchTeams(accessToken: string): Promise<LinearTeam[]> {
  const data = await gql<{
    teams: { nodes: LinearTeam[] };
    viewer: { id: string; name: string; email: string };
  }>(TEAMS_QUERY, {}, accessToken);

  console.log(`[Linear] Authenticated as: ${data.viewer.name} (${data.viewer.email})`);
  console.log(`[Linear] Found ${data.teams.nodes.length} accessible teams`);

  return data.teams.nodes;
}

async function sendGroupToLinear(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ created: number; errors: number }> {
  const groupId = asString(args.groupId);
  const teamId = asString(args.teamId) || accountMeta.team_id;

  console.log(`[Linear] sendGroupToLinear called with groupId: ${groupId}, teamId: ${teamId}`);

  if (!groupId) {
    throw new Error('missing_group_id');
  }
  if (!teamId) {
    throw new Error('missing_team_id');
  }

  const memory = await GroupMemoryStorageService.getMemory();
  console.log(`[Linear] Available remembered groups:`, Object.keys(memory.groups));

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
        created: rememberedGroup.created,
        modified: rememberedGroup.rememberedAt,
        tabs: rememberedGroup.tabs.map(tab => ({
          id: tab.originalId || tab.url,
          url: tab.url,
          title: tab.title,
          favicon: tab.favicon,
          timestamp: rememberedGroup.rememberedAt,
          groupId: rememberedGroup.id,
        })),
      }
    : undefined;

  if (!group) {
    const activeGroups = await Storage.get<TabGroup[]>('groups') || [];
    console.log(`[Linear] Available active groups:`, activeGroups.map(g => g.id));
    group = activeGroups.find(g => g.id === groupId);
    if (group) {
      console.log(`[Linear] Found group in active storage: ${group.name} with ${group.tabs.length} tabs`);
    }
  } else {
    console.log(`[Linear] Found group in memory: ${group.name} with ${group.tabs.length} tabs`);
  }

  if (!group) {
    console.error(`[Linear] Group ${groupId} not found in active groups or memory.`);
    throw new Error(`Group not found. Please try refreshing the page and try again.`);
  }

  // Enable auto-sync for this group
  await LinearSyncStorage.startGroupSync(group.id, group.name, teamId, accountMeta.account_id || '');

  const settled = await Promise.allSettled(
    group.tabs.map(async (tab, index) => {
      const result = await createIssue(
        {
          title: `${group.name} - ${tab.title || tab.url}`,
          description: `Group: ${group.name}\nTab: ${tab.title || 'Untitled'}\nURL: ${tab.url}`,
          teamId,
          priority: asNumber(args.priority),
        },
        accessToken,
        accountMeta
      );

      // Save issue mapping for auto-sync
      if (result.issueId) {
        await LinearSyncStorage.addIssueMapping({
          tabId: tab.id || `${group.id}-tab-${index}`,
          issueId: result.issueId,
          groupId: group.id,
          groupName: group.name,
          tabTitle: tab.title || 'Untitled',
          tabUrl: tab.url,
          teamId,
          accountId: accountMeta.account_id || ''
        });
      }

      return result;
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
  };
}

async function pushBrainDumpToLinear(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ issueId?: string; issueUrl?: string }> {
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
  const tabUrl = entry.tabContext?.url;
  return createIssue(
    {
      title: text.slice(0, 100),
      description: tabUrl ? `${text}\n\n${tabUrl}` : text,
      teamId: asString(args.teamId) || accountMeta.team_id,
    },
    accessToken,
    accountMeta
  );
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
          return { success: true, result: await createIssue(args, accessToken, accountMeta) };
        case 'update_issue':
          return { success: true, result: await updateIssue(args, accessToken) };
        case 'delete_issue':
          return { success: true, result: await deleteIssue(args, accessToken) };
        case 'send_group_to_linear':
          return { success: true, result: await sendGroupToLinear(args, accessToken, accountMeta) };
        case 'start_group_mirroring':
          return { success: true, result: await startGroupMirroring(args, accessToken, accountMeta) };
        case 'stop_group_mirroring':
          return { success: true, result: await stopGroupMirroring(args, accessToken, accountMeta) };
        case 'sync_group_changes_to_linear':
          return { success: true, result: await syncGroupChangesToLinear(args, accessToken, accountMeta) };
        case 'push_brain_dump_to_linear':
          return { success: true, result: await pushBrainDumpToLinear(args, accessToken, accountMeta) };
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
    const filter = since ? { updatedAt: { gt: since.toISOString() } } : undefined;
    const data = await gql<{
      issues: { nodes: LinearIssueNode[] };
    }>(ISSUES_QUERY, { filter }, accessToken);

    return data.issues.nodes.map((issue) => ({
      id: issue.id,
      title: issue.title || '',
      description: issue.description || '',
      state: issue.state?.name || '',
      updatedAt: issue.updatedAt ? Date.parse(issue.updatedAt) : 0,
    }));
  },
};
