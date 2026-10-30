import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { Storage } from '../../../utils/storage';
import { GroupMemoryStorageService } from '../../../utils/group-memory-storage';
import {
  getIntegrationMirrorState,
  removeIntegrationMirrorState,
  saveIntegrationMirrorState,
} from '../../integration-mirror-storage';
import {
  executeProviderRequest,
  isCloudConnectionCredential,
} from '../cloud-operation-client';

const BLUETAB_BLUE = 0x3b82f6;
const EMBED_TITLE_LIMIT = 256;
const EMBED_DESCRIPTION_LIMIT = 4096;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
}

interface PostWebhookBody {
  content?: string;
  embeds?: DiscordEmbed[];
}

// ============================================================================
// Mirror state — stored per group under discord_mirror:{groupId}
// ============================================================================

interface DiscordMirrorState {
  webhookUrl?: string;
  messageId: string;
  accountId: string;
}

function mirrorKey(groupId: string): string {
  return `discord_mirror:${groupId}`;
}

// ============================================================================
// Low-level helpers
// ============================================================================

/**
 * POST to a Discord webhook.
 * When `waitForResponse` is true adds ?wait=true so Discord returns the message
 * object (including id) needed for later edits.
 */
async function postWebhook(
  webhookUrl: string,
  body: PostWebhookBody,
  waitForResponse = false
): Promise<{ success: boolean; result?: { delivered: boolean; messageId?: string }; error?: string }> {
  const payload: Record<string, unknown> = {};
  if (body.content !== undefined) payload.content = body.content;
  if (body.embeds !== undefined) payload.embeds = body.embeds;

  const url = waitForResponse ? `${webhookUrl}?wait=true` : webhookUrl;

  const response = await executeProviderRequest(webhookUrl, 'discord.webhook.post', {
    wait: waitForResponse,
    body: payload,
  }, () => fetch(url, {
    method: 'POST',
    // No Authorization header — Discord webhook URLs are their own auth
    // (RESEARCH §Pitfall 7). The {webhook_id}/{webhook_token} path segments
    // grant posting permission to the channel chosen during OAuth consent.
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  if (!response.ok) {
    throw response;
  }

  if (waitForResponse && response.status !== 204) {
    const data = (await response.json().catch(() => ({}))) as { id?: string };
    return { success: true, result: { delivered: true, messageId: data.id } };
  }

  return { success: true, result: { delivered: true } };
}

/**
 * Edit an existing webhook message via PATCH
 * /webhooks/{webhook.id}/{webhook.token}/messages/{message_id}
 */
async function editWebhookMessage(
  webhookUrl: string,
  messageId: string,
  body: PostWebhookBody
): Promise<{ success: boolean; error?: string }> {
  const payload: Record<string, unknown> = {};
  if (body.content !== undefined) payload.content = body.content;
  if (body.embeds !== undefined) payload.embeds = body.embeds;

  const response = await executeProviderRequest(webhookUrl, 'discord.webhook.update', {
    messageId,
    body: payload,
  }, () => fetch(`${webhookUrl}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  if (!response.ok) {
    throw response;
  }
  return { success: true };
}

/**
 * Delete an existing webhook message via DELETE
 * /webhooks/{webhook.id}/{webhook.token}/messages/{message_id}
 */
async function deleteWebhookMessage(
  webhookUrl: string,
  messageId: string
): Promise<{ success: boolean; error?: string }> {
  const response = await executeProviderRequest(webhookUrl, 'discord.webhook.delete', { messageId }, () => fetch(`${webhookUrl}/messages/${messageId}`, {
    method: 'DELETE',
  }));
  if (!response.ok) {
    throw response;
  }
  return { success: true };
}

// ============================================================================
// Embed builders
// ============================================================================

function buildGroupEmbed(
  groupName: string,
  tabs: ReadonlyArray<{ url: string; title?: string }>,
  groupNote?: string,
): DiscordEmbed {
  const title = truncate(groupName, EMBED_TITLE_LIMIT);
  const note = groupNote?.trim();
  const tabLines = tabs.map((tab) => {
    const tabTitle = tab.title?.trim() || tab.url || 'Untitled tab';
    return `[${tabTitle}](${tab.url})`;
  });
  const description = truncate(
    (note ? ['Note:', note, '', ...tabLines] : tabLines).join('\n'),
    EMBED_DESCRIPTION_LIMIT
  );
  return { title, description, color: BLUETAB_BLUE };
}

async function mirroredGroup(groupId: string): Promise<{
  name: string;
  notes?: string;
  tabs: Array<{ url: string; title?: string }>;
} | undefined> {
  const memory = await GroupMemoryStorageService.getMemory();
  const rememberedGroup = memory.groups[groupId];
  const liveGroup = (await Storage.get<Array<{
    id: string;
    name: string;
    notes?: string;
    tabs: Array<{ id: string; url: string; title?: string }>;
  }>>('groups'))?.find(group => group.id === groupId);

  if (!rememberedGroup) return liveGroup;

  const tabsByStableId = new Map<string, { url: string; title?: string }>(rememberedGroup.tabs.map(tab => [
    tab.originalId,
    { url: tab.url, title: tab.title },
  ]));
  for (const tab of liveGroup?.tabs ?? []) {
    tabsByStableId.set(tab.id, { url: tab.url, title: tab.title });
  }
  return {
    name: liveGroup?.name ?? rememberedGroup.name,
    notes: liveGroup ? liveGroup.notes : rememberedGroup.notes,
    tabs: [...tabsByStableId.values()],
  };
}

function buildBrainDumpEmbed(text: string, sourceUrl?: string, sourceTitle?: string): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: 'Brain dump',
    description: truncate(text, EMBED_DESCRIPTION_LIMIT),
    color: BLUETAB_BLUE,
  };
  if (sourceUrl) {
    embed.url = sourceUrl;
    const linkLine = `\n\n[${sourceTitle || sourceUrl}](${sourceUrl})`;
    const maxDesc = EMBED_DESCRIPTION_LIMIT - linkLine.length;
    embed.description = truncate(text, maxDesc) + linkLine;
  }
  return embed;
}

// ============================================================================
// Verb implementations
// ============================================================================

async function shareToChannel(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<ReturnType<typeof postWebhook>> {
  const webhookUrl = isCloudConnectionCredential(accessToken)
    ? accessToken
    : asString(accountMeta.webhook_url) ?? asString(args.webhook_url);
  if (!webhookUrl) {
    return { success: false, error: 'missing_webhook_url' };
  }

  const content = typeof args.content === 'string' ? args.content : undefined;
  const embeds = Array.isArray(args.embeds) ? (args.embeds as DiscordEmbed[]) : undefined;

  return postWebhook(webhookUrl, { content, embeds });
}

async function sendGroupToDiscord(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<ReturnType<typeof postWebhook>> {
  const groupId = asString(args.groupId);
  if (!groupId) {
    throw new Error('missing_group_id');
  }
  const webhookUrl = isCloudConnectionCredential(accessToken)
    ? accessToken
    : asString(accountMeta.webhook_url) ?? asString(args.webhook_url);
  if (!webhookUrl) {
    return { success: false, error: 'missing_webhook_url' };
  }

  const liveGroups = await Storage.get<Array<{ id: string; name: string; tabs: Array<{ url: string; title?: string }> }>>('groups');
  const liveGroup = liveGroups?.find(g => g.id === groupId);
  const memory = await GroupMemoryStorageService.getMemory();
  const rememberedGroup = memory.groups[groupId];
  const group = liveGroup ?? (rememberedGroup ? { name: rememberedGroup.name, tabs: rememberedGroup.tabs.map(t => ({ url: t.url, title: t.title })) } : undefined);
  if (!group) {
    throw new Error('group_not_found');
  }

  const embed = buildGroupEmbed(group.name, group.tabs);
  return postWebhook(webhookUrl, { embeds: [embed] });
}

async function pushBrainDumpToDiscord(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<ReturnType<typeof postWebhook>> {
  const entryId = asString(args.entryId);
  if (!entryId) {
    throw new Error('missing_entry_id');
  }
  const webhookUrl = isCloudConnectionCredential(accessToken)
    ? accessToken
    : asString(accountMeta.webhook_url) ?? asString(args.webhook_url);
  if (!webhookUrl) {
    return { success: false, error: 'missing_webhook_url' };
  }

  const entries = await BrainDumpService.list();
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error('entry_not_found');
  }

  const text = (typeof args.text === 'string' && args.text) || entry.text;
  const sourceUrl = entry.tabContext?.url;
  const sourceTitle = entry.tabContext?.title;
  const embed = buildBrainDumpEmbed(text, sourceUrl, sourceTitle);
  return postWebhook(webhookUrl, { embeds: [embed] });
}

// ============================================================================
// Group Mirroring
// ============================================================================

async function startGroupMirroring(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ success: boolean; result?: { messageId: string }; error?: string }> {
  const groupId = asString(args.groupId);
  if (!groupId) throw new Error('missing_group_id');

  const webhookUrl = isCloudConnectionCredential(accessToken)
    ? accessToken
    : asString(accountMeta.webhook_url) ?? asString(args.webhook_url);
  if (!webhookUrl) return { success: false, error: 'missing_webhook_url' };

  const group = await mirroredGroup(groupId);
  if (!group) throw new Error('group_not_found');

  const embed = buildGroupEmbed(group.name, group.tabs, group.notes);
  const result = await postWebhook(webhookUrl, { embeds: [embed] }, true);
  if (!result.success || !result.result?.messageId) {
    return { success: false, error: result.error || 'failed_to_post' };
  }

  const state: DiscordMirrorState = {
    ...(isCloudConnectionCredential(accessToken) ? {} : { webhookUrl }),
    messageId: result.result.messageId,
    accountId: accountMeta.account_id ?? '',
  };
  await saveIntegrationMirrorState(mirrorKey(groupId), state);

  return { success: true, result: { messageId: result.result.messageId } };
}

async function syncGroupMirroring(
  args: Record<string, unknown>,
  accessToken: string,
): Promise<{ success: boolean; error?: string }> {
  const groupId = asString(args.groupId);
  if (!groupId) throw new Error('missing_group_id');

  const state = await getIntegrationMirrorState<DiscordMirrorState>(mirrorKey(groupId));
  if (!state) return { success: false, error: 'mirror_not_found' };

  const group = await mirroredGroup(groupId);

  if (!group) {
    await stopGroupMirroring({ groupId }, accessToken);
    return { success: false, error: 'group_deleted' };
  }

  const embed = buildGroupEmbed(group.name, group.tabs, group.notes);
  return editWebhookMessage(state.webhookUrl ?? accessToken, state.messageId, { embeds: [embed] });
}

async function stopGroupMirroring(
  args: Record<string, unknown>,
  accessToken: string,
): Promise<{ success: boolean; error?: string }> {
  const groupId = asString(args.groupId);
  if (!groupId) throw new Error('missing_group_id');

  const state = await getIntegrationMirrorState<DiscordMirrorState>(mirrorKey(groupId));
  if (state) {
    await deleteWebhookMessage(state.webhookUrl ?? accessToken, state.messageId).catch(() => {});
    await removeIntegrationMirrorState(mirrorKey(groupId));
  }

  return { success: true };
}

// ============================================================================
// Adapter export
// ============================================================================

export const adapter: IntegrationAdapter = {
  async executeVerb(
    verb: string,
    args: Record<string, unknown>,
    accessToken: string,
    accountMeta: Record<string, string>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    try {
      switch (verb) {
        case 'share_to_channel':
          return await shareToChannel(args, accessToken, accountMeta);
        case 'send_group_to_discord':
          return await sendGroupToDiscord(args, accessToken, accountMeta);
        case 'push_brain_dump_to_discord':
          return await pushBrainDumpToDiscord(args, accessToken, accountMeta);
        case 'start_group_mirroring':
          return await startGroupMirroring(args, accessToken, accountMeta);
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
