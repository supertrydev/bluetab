import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { Storage } from '../../../utils/storage';
import { GroupMemoryStorageService } from '../../../utils/group-memory-storage';
import {
  getIntegrationMirrorState,
  removeIntegrationMirrorState,
  saveIntegrationMirrorState,
} from '../../integration-mirror-storage';
import { executeProviderRequest } from '../cloud-operation-client';

const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_UPDATE_MESSAGE_URL = 'https://slack.com/api/chat.update';
const SLACK_DELETE_MESSAGE_URL = 'https://slack.com/api/chat.delete';
const SLACK_CONVERSATIONS_LIST_URL = 'https://slack.com/api/conversations.list';

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
}

type ConversationsListResponse = {
  ok: boolean;
  error?: string;
  channels?: Array<{ id: string; name: string; is_private: boolean; is_member: boolean }>;
  response_metadata?: { next_cursor?: string };
};

export async function fetchChannels(accessToken: string): Promise<SlackChannel[]> {
  const results: SlackChannel[] = [];
  let cursor = '';

  do {
    const url = new URL(SLACK_CONVERSATIONS_LIST_URL);
    url.searchParams.set('types', 'public_channel');
    url.searchParams.set('exclude_archived', 'true');
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await executeProviderRequest(accessToken, 'slack.channels.list', cursor ? { cursor } : {}, () => fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    }));
    if (!response.ok) throw response;

    const data = (await response.json()) as ConversationsListResponse;
    if (!data.ok) throw new Error(data.error || 'slack_error');

    for (const ch of data.channels ?? []) {
      results.push({ id: ch.id, name: ch.name, is_private: ch.is_private, is_member: ch.is_member });
    }

    cursor = data.response_metadata?.next_cursor ?? '';
  } while (cursor);

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

type SlackPostMessageResponse = {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
};

type SlackUpdateMessageResponse = {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
};

type SlackDeleteMessageResponse = {
  ok: boolean;
  error?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

interface PostMessageBody {
  channel: string;
  text: string;
  blocks?: unknown;
}

async function postMessage(
  body: PostMessageBody,
  accessToken: string
): Promise<{ success: boolean; result?: { messageTs?: string; channelId?: string }; error?: string }> {
  const payload: Record<string, unknown> = { channel: body.channel, text: body.text };
  if (body.blocks !== undefined) {
    payload.blocks = body.blocks;
  }

  const response = await executeProviderRequest(accessToken, 'slack.message.post', { body: payload }, () => fetch(SLACK_POST_MESSAGE_URL, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(payload),
  }));
  if (!response.ok) {
    throw response;
  }
  const data = (await response.json()) as SlackPostMessageResponse;
  if (data.ok !== true) {
    return { success: false, error: data.error || 'slack_error' };
  }
  return {
    success: true,
    result: { messageTs: data.ts, channelId: data.channel },
  };
}

async function updateMessage(
  channel: string,
  ts: string,
  text: string,
  accessToken: string
): Promise<{ success: boolean; error?: string }> {
  const payload = { channel, ts, text };
  const response = await executeProviderRequest(accessToken, 'slack.message.update', { body: payload }, () => fetch(SLACK_UPDATE_MESSAGE_URL, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(payload),
  }));
  if (!response.ok) {
    throw response;
  }
  const data = (await response.json()) as SlackUpdateMessageResponse;
  if (data.ok !== true) {
    return { success: false, error: data.error || 'slack_error' };
  }
  return { success: true };
}

async function deleteMessage(
  channel: string,
  ts: string,
  accessToken: string
): Promise<{ success: boolean; error?: string }> {
  const payload = { channel, ts };
  const response = await executeProviderRequest(accessToken, 'slack.message.delete', { body: payload }, () => fetch(SLACK_DELETE_MESSAGE_URL, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(payload),
  }));
  if (!response.ok) {
    throw response;
  }
  const data = (await response.json()) as SlackDeleteMessageResponse;
  if (data.ok !== true) {
    return { success: false, error: data.error || 'slack_error' };
  }
  return { success: true };
}

async function shareToChannel(
  args: Record<string, unknown>,
  accessToken: string
): Promise<ReturnType<typeof postMessage>> {
  const channel = asString(args.channel);
  const text = asString(args.text);
  if (!channel) {
    throw new Error('missing_channel');
  }
  if (!text) {
    throw new Error('missing_text');
  }
  return postMessage({ channel, text, blocks: args.blocks }, accessToken);
}

async function sendDm(
  args: Record<string, unknown>,
  accessToken: string
): Promise<ReturnType<typeof postMessage>> {
  // Slack accepts a user_id as the channel field on chat.postMessage and
  // auto-resolves it to the user's IM (DM) channel — no extra conversations.open
  // round-trip is needed.
  const userId = asString(args.user_id);
  const text = asString(args.text);
  if (!userId) {
    throw new Error('missing_user_id');
  }
  if (!text) {
    throw new Error('missing_text');
  }
  return postMessage({ channel: userId, text }, accessToken);
}

function formatGroupAsSlackMrkdwn(
  groupName: string,
  tabs: ReadonlyArray<{ url: string; title?: string }>,
  groupNote?: string,
): string {
  const header = `*${groupName}*`;
  const note = groupNote?.trim();
  const bullets = tabs.map((tab) => {
    const title = tab.title?.trim() || tab.url || 'Untitled tab';
    return `• <${tab.url}|${title}>`;
  });
  return note
    ? [header, '', note, '', ...bullets].join('\n')
    : [header, '', ...bullets].join('\n');
}

async function sendGroupToSlack(
  args: Record<string, unknown>,
  accessToken: string
): Promise<ReturnType<typeof postMessage>> {
  const groupId = asString(args.groupId);
  const channel = asString(args.channel);
  if (!groupId) {
    throw new Error('missing_group_id');
  }
  if (!channel) {
    throw new Error('missing_channel');
  }

  const memory = await GroupMemoryStorageService.getMemory();
  const rememberedGroup = memory.groups[groupId];
  const group = rememberedGroup
    ? {
        name: rememberedGroup.name,
        tabs: rememberedGroup.tabs.map(tab => ({
          url: tab.url,
          title: tab.title,
        })),
      }
    : (await Storage.get<Array<{ id: string; name: string; tabs: Array<{ url: string; title?: string }> }>>('groups'))
        ?.find(g => g.id === groupId);
  if (!group) {
    throw new Error('group_not_found');
  }

  const text = formatGroupAsSlackMrkdwn(group.name, group.tabs);
  return postMessage({ channel, text }, accessToken);
}

async function pushBrainDumpToSlack(
  args: Record<string, unknown>,
  accessToken: string
): Promise<ReturnType<typeof postMessage>> {
  const entryId = asString(args.entryId);
  const channel = asString(args.channel);
  if (!entryId) {
    throw new Error('missing_entry_id');
  }
  if (!channel) {
    throw new Error('missing_channel');
  }

  const entries = await BrainDumpService.list();
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error('entry_not_found');
  }

  const entryText = (typeof args.text === 'string' && args.text) || entry.text;
  const tabContext = entry.tabContext;
  const contextSuffix = tabContext?.url
    ? `\n\n_From <${tabContext.url}|${tabContext.title || tabContext.url}>_`
    : '';
  const text = `${entryText}${contextSuffix}`;

  return postMessage({ channel, text }, accessToken);
}

// ============================================================================
// Group Mirroring (Plan 14-07 extension)
// ============================================================================

interface SlackMirrorState {
  channel: string;
  ts: string;
  accountId: string;
}

function mirrorKey(groupId: string): string {
  return `slack_mirror:${groupId}`;
}

async function startGroupMirroring(
  args: Record<string, unknown>,
  accessToken: string,
  accountId: string
): Promise<{ success: boolean; result?: { ts: string }; error?: string }> {
  const groupId = asString(args.groupId);
  const channel = asString(args.channel);
  if (!groupId) {
    throw new Error('missing_group_id');
  }
  if (!channel) {
    throw new Error('missing_channel');
  }

  const groups = await Storage.get<Array<{
    id: string;
    name: string;
    notes?: string;
    tabs: Array<{ id: string; url: string; title?: string }>;
  }>>('groups');
  const group = groups?.find(g => g.id === groupId);
  if (!group) {
    throw new Error('group_not_found');
  }

  // Send initial message
  const text = formatGroupAsSlackMrkdwn(group.name, group.tabs, group.notes);
  const result = await postMessage({ channel, text }, accessToken);
  if (!result.success || !result.result?.messageTs) {
    return { success: false, error: result.error || 'failed_to_post' };
  }

  // Save mirror state
  const state: SlackMirrorState = { channel, ts: result.result.messageTs, accountId };
  await saveIntegrationMirrorState(mirrorKey(groupId), state);

  return { success: true, result: { ts: result.result.messageTs } };
}

async function syncGroupMirroring(
  args: Record<string, unknown>,
  accessToken: string
): Promise<{ success: boolean; error?: string }> {
  const groupId = asString(args.groupId);
  if (!groupId) {
    throw new Error('missing_group_id');
  }

  const state = await getIntegrationMirrorState<SlackMirrorState>(mirrorKey(groupId));
  if (!state) {
    return { success: false, error: 'mirror_not_found' };
  }

  const memory = await GroupMemoryStorageService.getMemory();
  const rememberedGroup = memory.groups[groupId];
  const liveGroup = (await Storage.get<Array<{
    id: string;
    name: string;
    notes?: string;
    tabs: Array<{ id: string; url: string; title?: string }>;
  }>>('groups'))?.find(g => g.id === groupId);
  const group = rememberedGroup
    ? {
        name: liveGroup?.name ?? rememberedGroup.name,
        notes: liveGroup ? liveGroup.notes : rememberedGroup.notes,
        tabs: (() => {
          const tabsByStableId = new Map<string, { url: string; title?: string }>(
            rememberedGroup.tabs.map((tab) => [
              tab.originalId,
              { url: tab.url, title: tab.title },
            ]),
          );
          for (const tab of liveGroup?.tabs ?? []) {
            tabsByStableId.set(tab.id, { url: tab.url, title: tab.title });
          }
          return [...tabsByStableId.values()];
        })(),
      }
    : liveGroup;

  if (!group) {
    await stopGroupMirroring({ groupId }, accessToken);
    return { success: false, error: 'group_deleted' };
  }

  const text = formatGroupAsSlackMrkdwn(group.name, group.tabs, group.notes);
  return updateMessage(state.channel, state.ts, text, accessToken);
}

async function stopGroupMirroring(
  args: Record<string, unknown>,
  accessToken: string
): Promise<{ success: boolean; error?: string }> {
  const groupId = asString(args.groupId);
  if (!groupId) {
    throw new Error('missing_group_id');
  }

  const state = await getIntegrationMirrorState<SlackMirrorState>(mirrorKey(groupId));
  if (state) {
    // Delete the Slack message
    await deleteMessage(state.channel, state.ts, accessToken);
    // Clear mirror state
    await removeIntegrationMirrorState(mirrorKey(groupId));
  }

  return { success: true };
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
        case 'share_to_channel':
          return await shareToChannel(args, accessToken);
        case 'send_dm':
          return await sendDm(args, accessToken);
        case 'send_group_to_slack':
          return await sendGroupToSlack(args, accessToken);
        case 'push_brain_dump_to_slack':
          return await pushBrainDumpToSlack(args, accessToken);
        case 'start_group_mirroring':
          return await startGroupMirroring(args, accessToken, _accountMeta.account_id);
        case 'sync_group_mirroring':
          return await syncGroupMirroring(args, accessToken);
        case 'stop_group_mirroring':
          return await stopGroupMirroring(args, accessToken);
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
