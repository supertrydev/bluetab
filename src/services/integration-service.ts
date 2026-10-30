/**
 * @module services/integration-service
 *
 * WHY: Registry-driven dispatcher + cross-cutting concerns for all 15 Phase 14
 *      integrations (rate-limiting, kill-switch, auto-sync, AI tool schema merge).
 *
 * WHAT: Exports:
 *   - dispatchVerb(integrationId, verb, args, accountId): Registry-driven adapter resolver
 *   - pushAutoSyncDeltas(deltas): Sync-engine piggyback for auto-sync groups
 *   - buildIntegrationToolsForTurn(): Dynamic prune to MAX_INTEGRATION_TOOLS=25
 *   - withRateLimit<T>(fn, rps, retries?): Token-bucket + 429 backoff wrapper
 *   - pullFromIntegration(integrationId, accountId, since?): LWW merge pull
 *   - isKillSwitched(integrationId): Kill-switch check
 *
 * HOW: Uses dynamic import for per-integration adapter modules.
 *      Falls back to __placeholder/adapter.ts if real adapter not found yet.
 *      Checks kill-switch before every verb dispatch.
 *      Wires into sync-engine via pushAutoSyncDeltas.
 *
 * NOT: pullFromIntegration is NOT registered as an LLM verb (verb-taxonomy guard).
 *      Adapters MUST NOT call chrome.storage.local directly (XC-01 contract).
 */

import { Storage } from '../utils/storage';
import {
  getIntegrationUnavailableMessage,
  getRegistryEntry,
  INTEGRATION_IDS,
} from './integrations/registry';
import type { IntegrationId } from './integrations/registry';
import { getValidToken, listConnectedAccounts } from './integration-token-storage';
import type { IntegrationAdapter, IntegrationVerbResult, IntegrationAITool } from '../types/integrations';
import * as notionAdapter from './integrations/notion/adapter';
import * as linearAdapter from './integrations/linear/adapter';
import * as todoistAdapter from './integrations/todoist/adapter';
import * as githubAdapter from './integrations/github/adapter';
import * as googleCalendarAdapter from './integrations/google-calendar/adapter';
import * as outlookCalendarAdapter from './integrations/outlook-calendar/adapter';
import * as slackAdapter from './integrations/slack/adapter';
import * as discordAdapter from './integrations/discord/adapter';
import * as jiraAdapter from './integrations/jira/adapter';
import * as trelloAdapter from './integrations/trello/adapter';
import * as asanaAdapter from './integrations/asana/adapter';
import * as gitlabAdapter from './integrations/gitlab/adapter';
import * as readwiseAdapter from './integrations/readwise/adapter';
import * as placeholderAdapter from './integrations/__placeholder/adapter';
import { BrainDumpService } from './brain-dump-service';
import { formatIntegrationDestinationLabel, type IntegrationMenuSettings } from '../utils/integration-labels';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import type { NotionMirrorState, RememberedGroup } from '../types/models';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum integration tools injected into LLM tool schema per turn.
 * Tier 4 trimmed first, then Tier 3. (RESEARCH §Pitfall 13)
 */
export const MAX_INTEGRATION_TOOLS = 25;

// ============================================================================
// Kill-switch check
// ============================================================================

/**
 * Check whether an integration is kill-switched via Supertry config cache.
 *
 * Returns true if:
 *   - cache.integrationsDisabled === true (all integrations disabled), OR
 *   - cache.integrationDisabled includes this specific integrationId.
 *
 * Fail-open: returns false when cache is absent (same semantics as KillSwitchService.isEnabled).
 */
export async function isKillSwitched(integrationId: IntegrationId): Promise<boolean> {
  const cache = await Storage.get<{
    enabled?: boolean;
    integrationsDisabled?: boolean;
    integrationDisabled?: string[];
    fetchedAt?: number;
  }>('ai_kill_switch_cache');

  if (!cache) return false;
  if (cache.integrationsDisabled === true) return true;
  if (Array.isArray(cache.integrationDisabled) && cache.integrationDisabled.includes(integrationId)) {
    return true;
  }
  return false;
}

// ============================================================================
// Rate-limit wrapper
// ============================================================================

/**
 * Wrap an API call with rate-limiting and 429 backoff.
 * Uses token-bucket semantics with exponential backoff on 429.
 * (RESEARCH §Code Examples — Rate Limit Wrapper)
 */
export async function withRateLimit<T>(
  fn: () => Promise<T>,
  rps: number,
  retries = 3
): Promise<T> {
  const minDelay = Math.ceil(1000 / rps);
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise<void>((r) => setTimeout(r, minDelay * attempt));
      }
      return await fn();
    } catch (e: unknown) {
      const isResponse = e != null && typeof (e as Response).status === 'number';
      if (isResponse && (e as Response).status === 429) {
        const retryAfter = parseInt(
          (e as Response).headers?.get('Retry-After') || String(attempt + 1),
          10
        );
        await new Promise<void>((r) => setTimeout(r, retryAfter * 1000));
      } else {
        if (attempt === retries - 1) throw e;
      }
    }
  }
  throw new Error('Rate limit retries exhausted');
}

// ============================================================================
// Adapter loader
// ============================================================================

// Static loader map — Vite/Rollup cannot resolve a template-literal dynamic
// import (`./integrations/${integrationId}/adapter`), so every adapter has
// its own explicit import() entry. Without this, every dispatchVerb call
// fell through to the placeholder adapter and returned `not_implemented`.
const ADAPTER_LOADERS: Record<string, () => Promise<{ adapter: IntegrationAdapter }>> = {
  linear: () => Promise.resolve(linearAdapter),
  todoist: () => Promise.resolve(todoistAdapter),
  notion: () => Promise.resolve(notionAdapter),
  github: () => Promise.resolve(githubAdapter),
  'google-calendar': () => Promise.resolve(googleCalendarAdapter),
  'outlook-calendar': () => Promise.resolve(outlookCalendarAdapter),
  slack: () => Promise.resolve(slackAdapter),
  discord: () => Promise.resolve(discordAdapter),
  jira: () => Promise.resolve(jiraAdapter),
  trello: () => Promise.resolve(trelloAdapter),
  asana: () => Promise.resolve(asanaAdapter),
  gitlab: () => Promise.resolve(gitlabAdapter),
  readwise: () => Promise.resolve(readwiseAdapter),
};

async function loadAdapter(integrationId: IntegrationId): Promise<IntegrationAdapter> {
  const loader = ADAPTER_LOADERS[integrationId];
  if (loader) {
    try {
      const mod = await loader();
      if (mod.adapter) return mod.adapter;
    } catch (err) {
      console.warn(`[BlueTab][Integrations] Failed to load ${integrationId} adapter`, err);
    }
  }
  return placeholderAdapter.adapter;
}

// ============================================================================
// Verb dispatch
// ============================================================================

/**
 * Dispatch a verb to the appropriate integration adapter.
 *
 * Pre-flight checks:
 * 1. Integration must be in registry
 * 2. Kill-switch check (returns kill_switched error without adapter call)
 * 3. Load adapter (real or placeholder)
 * 4. Get valid token (transparent refresh)
 * 5. Execute verb with rate-limit wrapper
 * 6. On 401 response: set reauth flag
 */
export async function dispatchVerb(
  integrationId: IntegrationId,
  verb: string,
  args: Record<string, unknown>,
  accountId: string
): Promise<IntegrationVerbResult> {
  const unavailableMessage = getIntegrationUnavailableMessage(integrationId);
  if (unavailableMessage) {
    return { success: false, error: unavailableMessage };
  }

  // Validate integration is in registry
  const entry = getRegistryEntry(integrationId);
  if (!entry) {
    throw new Error(`Integration ${integrationId} not found in registry`);
  }

  // Kill-switch pre-flight
  const killSwitched = await isKillSwitched(integrationId);
  if (killSwitched) {
    return { success: false, error: 'kill_switched' };
  }

  // Load adapter
  const adapter = await loadAdapter(integrationId);

  // Get valid token
  let accessToken: string;
  try {
    accessToken = await getValidToken(integrationId, accountId);
  } catch (tokenErr: unknown) {
    const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
    return { success: false, error: `token_error:${msg}` };
  }

  // Get account metadata
  const accounts = await listConnectedAccounts();
  const account = accounts.find(
    (a) => a.integrationId === integrationId && a.accountId === accountId
  );
  let accountMeta: Record<string, string> = { ...(account?.metadata || {}), account_id: accountId };

  // Merge default sync target for integrations that need it
  const integrationSettings = await Storage.get<{ default_sync_target?: Record<string, string> }>('integration_settings');
  const defaultSyncTarget = integrationSettings?.default_sync_target?.[integrationId];

  // Slack: inject default channel into args if missing
  if (integrationId === 'slack' && defaultSyncTarget && !args.channel) {
    args = { ...args, channel: defaultSyncTarget };
  }

  if (integrationId === 'trello' && defaultSyncTarget && !args.idList) {
    args = { ...args, idList: defaultSyncTarget };
  }

  if (defaultSyncTarget) {
    accountMeta = {
      ...accountMeta,
      // Map common sync target patterns
      team_id: defaultSyncTarget, // Linear uses team_id
      database_id: defaultSyncTarget, // Notion uses database_id
      project_key: defaultSyncTarget, // Jira uses project_key
      project: defaultSyncTarget, // Asana/Todoist use project id/gid
      default_target: defaultSyncTarget, // Generic fallback
    };
  }

  // Execute verb with rate limiting
  try {
    const result = await withRateLimit(
      () => adapter.executeVerb(verb, args, accessToken, accountMeta),
      entry.rate_limit_rps
    );

    // Update last_used_at on success (fire-and-forget)
    if (result.success) {
      updateLastUsed(integrationId, accountId).catch(() => {});
      // A working call proves the connection is fine: drop a stale
      // "reconnect" flag left by an earlier failure.
      Storage.remove(`integration_reauth_required:${integrationId}:${accountId}`).catch(() => {});
    }

    return result;
  } catch (err: unknown) {
    // Surface 401 as reauth needed
    if (err != null && typeof (err as Response).status === 'number' && (err as Response).status === 401) {
      await Storage.set(`integration_reauth_required:${integrationId}:${accountId}`, true);
      return { success: false, error: 'reauth_required' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

async function updateLastUsed(_integrationId: string, _accountId: string): Promise<void> {
  // Best-effort last_used_at update — intentionally no-op for now.
  // Dynamic import() is disallowed in ServiceWorkerGlobalScope; a full
  // bundle re-read would require exporting loadTokenMap from integration-token-storage.
}

// ============================================================================
// Auto-sync push
// ============================================================================

interface DeltaLike {
  storageKey?: string;
  entityId?: string;
}

interface AutoSyncMapping {
  groupId: string;
  integrationId: string;
  accountId: string;
  mirrorVerb: string;
}

interface IntegrationSettings {
  auto_sync_groups?: AutoSyncMapping[];
  [key: string]: unknown;
}

/**
 * Push auto-sync deltas for groups with autoSync.enabled=true.
 * Called from sync-engine 500ms debounce flush (Promise.allSettled — fire-and-forget).
 *
 * DEFAULT-OFF: no group is auto-synced unless user explicitly enables it.
 */
export async function pushAutoSyncDeltas(deltas: DeltaLike[]): Promise<void> {
  const settings = await Storage.get<IntegrationSettings>(SETTINGS_KEY);
  const autoSyncGroups = settings?.auto_sync_groups || [];

  if (autoSyncGroups.length === 0) return;

  // Build a set of group IDs that changed
  const changedGroupIds = new Set(
    deltas
      .filter((d) => d.storageKey === 'groups' && d.entityId)
      .map((d) => d.entityId as string)
  );

  if (changedGroupIds.size === 0) return;

  // Filter auto-sync mappings for changed groups only
  const relevantMappings = autoSyncGroups.filter((m) => changedGroupIds.has(m.groupId));

  if (relevantMappings.length === 0) return;

  // Fire-and-forget — neither failure blocks the other
  await Promise.allSettled(
    relevantMappings.map(async (mapping) => {
      if (!INTEGRATION_IDS.includes(mapping.integrationId as IntegrationId)) return;
      await dispatchVerb(
        mapping.integrationId as IntegrationId,
        mapping.mirrorVerb,
        { groupId: mapping.groupId },
        mapping.accountId
      );
    })
  );
}

const SETTINGS_KEY = 'integration_settings';

// ============================================================================
// AI Tool Schema Builder
// ============================================================================

// Per-verb tool descriptions (hand-written per CONTEXT §verb taxonomy)
const VERB_DESCRIPTIONS: Record<string, Record<string, string>> = {
  linear: {
    create_issue: 'Create a new Linear issue. Use when the user wants to file a bug, ticket, or task in Linear.',
    update_issue: 'Update an existing Linear issue by ID.',
  },
  todoist: {
    create_task: 'Create a new Todoist task. Use when the user wants to add an item to their Todoist inbox or a specific project.',
  },
  notion: {
    create_page: 'Create a new Notion page. Use when the user wants to save content to their Notion workspace.',
    append_to_database: 'Add a new row to a Notion database. Use for structured task/project tracking in Notion.',
  },
  github: {
    create_issue: 'Create a new GitHub issue in a repository. Use when the user wants to file a bug or feature request.',
    create_gist: 'Create a new GitHub Gist with content. Use when the user wants to share a code snippet or notes.',
  },
  'google-calendar': {
    create_event: 'Create a new Google Calendar event. Use when the user wants to schedule something from a tab or note.',
  },
  'outlook-calendar': {
    create_event: 'Create a new Outlook Calendar event. Use when the user wants to schedule something from a tab or note.',
  },
  slack: {
    share_to_channel: 'Share content to a Slack channel. Use when the user wants to post a tab or note to a team.',
    send_dm: 'Send a Slack direct message. Use when the user wants to send content to a specific person.',
  },
  discord: {
    share_to_channel: 'Share content to a Discord channel via webhook. Use when the user wants to post to Discord.',
  },
  readwise: {
    save_article: 'Save an article or highlight to Readwise. Use when the user wants to add reading material to Readwise.',
  },
  jira: {
    create_issue: 'Create a new Jira issue. Use when the user wants to file a ticket in their Jira project board.',
  },
  trello: {
    create_card: 'Create a new Trello card. Use when the user wants to add a card to a Trello board.',
  },
  asana: {
    create_task: 'Create a new Asana task. Use when the user wants to add a task to their Asana workspace.',
  },
  gitlab: {
    create_issue: 'Create a new GitLab issue. Use when the user wants to file a bug or task in a GitLab project.',
  },
};

/**
 * Build the LLM tool schema for connected integrations.
 *
 * - Only injects tools for currently connected integrations × accounts.
 * - Prunes to MAX_INTEGRATION_TOOLS=25 (Tier 4 trimmed first).
 * - Tool names are namespaced: ${integrationId}.${verb}
 * - Account label appears in tool description (not in tool name).
 * - pullFromIntegration is NOT registered here (verb-taxonomy guard).
 */
export async function buildIntegrationToolsForTurn(): Promise<IntegrationAITool[]> {
  const connectedAccounts = await listConnectedAccounts();
  if (connectedAccounts.length === 0) return [];

  const tools: IntegrationAITool[] = [];

  for (const account of connectedAccounts) {
    const entry = getRegistryEntry(account.integrationId);
    if (!entry) continue;

    for (const verb of entry.verbs) {
      const verbDesc =
        entry.verb_descriptions?.[verb] ||
        VERB_DESCRIPTIONS[account.integrationId]?.[verb] ||
        `Invoke ${verb} on ${entry.display_name}.`;

      tools.push({
        name: `${account.integrationId}.${verb}`,
        description: `${verbDesc} (${account.accountLabel})`,
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The content to send to the integration.' },
          },
          required: [],
        },
        integrationId: account.integrationId,
        accountId: account.accountId,
        verb,
        tier: entry.tier,
      });
    }
  }

  // Prune to MAX_INTEGRATION_TOOLS (Tier 4 first, then Tier 3, etc.)
  if (tools.length <= MAX_INTEGRATION_TOOLS) return tools;

  const tierOrder: Array<'4' | '3' | '2' | '1'> = ['4', '3', '2', '1'];
  let pruned = [...tools];

  for (const tier of tierOrder) {
    if (pruned.length <= MAX_INTEGRATION_TOOLS) break;
    const tierTools = pruned.filter((t) => t.tier === tier);
    const keepCount = pruned.length - MAX_INTEGRATION_TOOLS;
    if (tierTools.length <= keepCount) {
      // Remove all tier tools
      pruned = pruned.filter((t) => t.tier !== tier);
    } else {
      // Remove only some tier tools
      const toRemove = tierTools.slice(0, keepCount);
      const toRemoveSet = new Set(toRemove.map((t) => `${t.integrationId}.${t.verb}.${t.accountId}`));
      pruned = pruned.filter(
        (t) => !toRemoveSet.has(`${t.integrationId}.${t.name.split('.')[1]}.${t.accountId}`)
      );
    }
  }

  return pruned.slice(0, MAX_INTEGRATION_TOOLS);
}

// ============================================================================
// Manual Pull (NOT an LLM verb — verb-taxonomy guard)
// ============================================================================

/**
 * Pull records from a Tier 1 integration and merge via LWW.
 *
 * This function is intentionally NOT registered in buildIntegrationToolsForTurn.
 * It is a user-initiated UI action (button-only). (CONTEXT.md §verb taxonomy)
 */
export async function pullFromIntegration(
  integrationId: IntegrationId,
  accountId: string,
  since?: Date
): Promise<{ merged: number }> {
  const entry = getRegistryEntry(integrationId);
  if (!entry) {
    throw new Error(`Integration ${integrationId} not found in registry`);
  }

  if (!entry.supports_manual_pull) {
    return { merged: 0 };
  }

  const killSwitched = await isKillSwitched(integrationId);
  if (killSwitched) {
    return { merged: 0 };
  }

  const adapter = await loadAdapter(integrationId);
  if (!adapter.listRecords) {
    return { merged: 0 };
  }

  const accessToken = await getValidToken(integrationId, accountId);
  const accounts = await listConnectedAccounts();
  const account = accounts.find(
    (a) => a.integrationId === integrationId && a.accountId === accountId
  );
  const accountMeta = account?.metadata || {};

  const records = await adapter.listRecords(accessToken, accountMeta, since);

  // LWW merge — Phase 13 MCP-07 pattern (simplified placeholder for this plan)
  // Real LWW per-record merge happens when adapters land in 14-02..14-06
  return { merged: records.length };
}

// ============================================================================
// Notion-specific helpers used by the Save-to-auto-mirror flow (Batch 3).
// Public client_id resolution stays in integration-oauth-service; here we
// just need the access token + the adapter's listAccessiblePages /
// createMirrorDatabase entry points.
// ============================================================================

export interface NotionPageOption {
  id: string;
  title: string;
  url: string;
}

/**
 * List Notion pages the integration has access to. UI uses this to populate
 * the page picker before creating a mirror database.
 */
export async function listNotionPages(accountId: string): Promise<NotionPageOption[]> {
  const accessToken = await getValidToken('notion', accountId);
  return notionAdapter.listAccessiblePages(accessToken);
}

/**
 * Create a fresh mirror database under a chosen Notion page and return its
 * id. Caller is responsible for registering the database_id in
 * integration_settings.auto_sync_groups so subsequent group changes flow
 * to it.
 */
export async function createNotionMirrorDatabase(
  accountId: string,
  parentPageId: string,
  title: string
): Promise<{ databaseId: string; url?: string }> {
  const accessToken = await getValidToken('notion', accountId);
  const result = await notionAdapter.createMirrorDatabase(accessToken, parentPageId, title);
  return { databaseId: result.database_id, url: result.url };
}

interface AutoSyncMapping {
  groupId: string;
  integrationId: string;
  accountId: string;
  targetId: string;
  notionState?: NotionMirrorState;
}

interface BrainDumpDestination {
  integrationId: 'notion';
  accountId: string;
  parentPageId: string;
  databaseId: string;
}

interface IntegrationSettingsBucket {
  auto_sync_groups?: AutoSyncMapping[];
  brain_dump_destination?: BrainDumpDestination | null;
  [key: string]: unknown;
}

/**
 * One-shot Save-to-auto-mirror flow for Notion. UI picks a parent page +
 * database title via NotionPagePicker, then calls this:
 *
 *   1. Create a mirror database under the parent page (URL + Name columns).
 *   2. Run send_group_to_notion once with parent={database_id} to populate it.
 *   3. Register the mapping in integration_settings.auto_sync_groups so
 *      subsequent group edits flow into the same database.
 *
 * Throws on any step's failure so the caller can surface a single toast.
 */
export async function setupNotionMirror(args: {
  group: { id: string; name: string };
  accountId: string;
  parentPageId: string;
  databaseTitle: string;
}): Promise<{ databaseId: string }> {
  const { group, accountId, parentPageId, databaseTitle } = args;

  const { databaseId } = await createNotionMirrorDatabase(
    accountId,
    parentPageId,
    databaseTitle
  );

  const initialPush = await dispatchVerb(
    'notion',
    'send_group_to_notion',
    { groupId: group.id, parent: { database_id: databaseId } },
    accountId
  );
  if (!initialPush.success) {
    throw new Error(initialPush.error || 'initial push to Notion failed');
  }

  const pushedItems = (
    initialPush.result as {
      items?: Array<{ tabId: string; pageId: string; title: string; url: string }>;
    } | undefined
  )?.items ?? [];
  const liveGroups = (await Storage.get<GroupShape[]>('groups')) ?? [];
  const liveGroup = liveGroups.find((candidate) => candidate.id === group.id);
  const mirroredNote = liveGroup?.notes ?? '';
  const notionState: NotionMirrorState = {
    version: 1,
    mirroredNote,
    tabs: Object.fromEntries(pushedItems.map((item) => [item.tabId, {
      pageId: item.pageId,
      title: item.title,
      url: item.url,
    }])),
  };

  if (mirroredNote) {
    const accessToken = await getValidToken('notion', accountId);
    await notionAdapter.updateDatabaseDescription(accessToken, databaseId, mirroredNote);
  }

  const settings = (await Storage.get<IntegrationSettingsBucket>('integration_settings')) ?? {};
  const existing = (settings.auto_sync_groups ?? []).filter((m) => m.groupId !== group.id);
  const next: AutoSyncMapping[] = [
    ...existing,
    {
      groupId: group.id,
      integrationId: 'notion',
      accountId,
      mirrorVerb: 'send_group_to_notion',
      targetId: databaseId,
      notionState,
    },
  ];
  await Storage.set('integration_settings', { ...settings, auto_sync_groups: next });

  return { databaseId };
}

// ============================================================================
// Brain Dump auto-route — Batch 4. Settings → Notion card → page select +
// checkbox. When the checkbox flips on, a "Bluetab Brain Dumps" database is
// created under the chosen page and stored as the destination. Every
// brain-dump capture after that fires append_to_database via dispatcher.
// Off by default; toggling off clears the destination.
// ============================================================================

const BRAIN_DUMP_DB_TITLE = 'Bluetab Brain Dumps';

/**
 * Create a brain-dump destination database under the chosen page and save
 * it as the active route. Idempotent enough — a fresh database is created
 * each call so the caller is responsible for clearing first if a previous
 * destination exists (toggle UX handles that).
 */
export async function setBrainDumpDestination(opts: {
  accountId: string;
  parentPageId: string;
}): Promise<BrainDumpDestination> {
  const { databaseId } = await createNotionMirrorDatabase(
    opts.accountId,
    opts.parentPageId,
    BRAIN_DUMP_DB_TITLE
  );

  const settings = (await Storage.get<IntegrationSettingsBucket>('integration_settings')) ?? {};
  const dest: BrainDumpDestination = {
    integrationId: 'notion',
    accountId: opts.accountId,
    parentPageId: opts.parentPageId,
    databaseId,
  };
  await Storage.set('integration_settings', { ...settings, brain_dump_destination: dest });

  // Immediately sync all existing brain dump entries to the new destination
  console.log('[BlueTab][BrainDump] New destination configured, syncing existing entries...');
  void syncAllBrainDumpEntries(); // Run async without blocking

  return dest;
}

export async function clearBrainDumpDestination(): Promise<void> {
  const settings = (await Storage.get<IntegrationSettingsBucket>('integration_settings')) ?? {};
  const next = { ...settings };
  delete next.brain_dump_destination;
  await Storage.set('integration_settings', next);
}

export async function getBrainDumpDestination(): Promise<BrainDumpDestination | null> {
  const settings = await Storage.get<IntegrationSettingsBucket>('integration_settings');
  return settings?.brain_dump_destination ?? null;
}

export async function routeBrainDumpToNotionDestination(input: {
  accountId: string;
  text: string;
  tabUrl?: string;
}): Promise<IntegrationVerbResult> {
  const destination = await getBrainDumpDestination();
  if (!destination || destination.accountId !== input.accountId) {
    return { success: false, error: 'missing_database_id' };
  }

  const text = input.text.trim();
  const title = text.slice(0, 100);
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: title } }] },
  };
  if (input.tabUrl) properties.URL = { url: input.tabUrl };
  const content = input.tabUrl ? `${text}\n\n${input.tabUrl}` : text;

  return dispatchVerb(
    'notion',
    'append_to_database',
    {
      database_id: destination.databaseId,
      properties,
      children: [{
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content } }],
        },
      }],
    },
    input.accountId,
  );
}

// ============================================================================
// Mirror sync — Batch 6. Service-worker calls syncMirroredGroupsAfterChange
// when 'groups' storage key changes. We diff against auto_sync_groups; for
// each mirrored Notion group we compare the stable tab-to-page mapping and
// push only the required create/update/archive operations. Debounced upstream
// so rapid edits collapse to one sync. Rate-limit/kill-switch failures are
// swallowed so they never block the local edit.
// ============================================================================

let mirrorSyncTimer: ReturnType<typeof setTimeout> | null = null;
const pendingMirrorGroupIds = new Set<string>();
// Tight debounce — long enough to coalesce a burst of edits but short
// enough to land before MV3 service-worker idle teardown wipes the timer.
const MIRROR_DEBOUNCE_MS = 1_000;

interface GroupShape {
  id: string;
  name: string;
  notes?: string;
  tabs?: Array<{ id?: string; url?: string; title?: string; notes?: string }>;
}

/**
 * Schedule a mirror sync for the given changed group ids. Called from the
 * service-worker storage listener; multiple invocations within the debounce
 * window fold into one push per group.
 */
export function scheduleMirrorSync(changedGroupIds: string[]): void {
  console.log('[BlueTab][Mirror] scheduleMirrorSync ids=', changedGroupIds);
  for (const id of changedGroupIds) pendingMirrorGroupIds.add(id);
  if (mirrorSyncTimer) clearTimeout(mirrorSyncTimer);
  mirrorSyncTimer = setTimeout(() => {
    mirrorSyncTimer = null;
    const ids = Array.from(pendingMirrorGroupIds);
    pendingMirrorGroupIds.clear();
    void syncNotionMirrors(ids);
  }, MIRROR_DEBOUNCE_MS);
}

function mergeRememberedGroup(
  liveGroup: GroupShape | undefined,
  rememberedGroup: RememberedGroup,
): GroupShape {
  const liveTabs = new Map((liveGroup?.tabs ?? []).map((tab) => [tab.id, tab]));
  const rememberedIds = new Set(rememberedGroup.tabs.map((tab) => tab.originalId));
  const rememberedTabs = rememberedGroup.tabs.map((tab) => (
    liveTabs.get(tab.originalId) ?? {
      id: tab.originalId,
      url: tab.url,
      title: tab.title,
    }
  ));
  const newLiveTabs = (liveGroup?.tabs ?? []).filter((tab) => !tab.id || !rememberedIds.has(tab.id));

  return {
    id: rememberedGroup.id,
    name: liveGroup?.name ?? rememberedGroup.name,
    notes: liveGroup?.notes ?? rememberedGroup.notes,
    tabs: [...rememberedTabs, ...newLiveTabs],
  };
}

export async function syncNotionMirrors(groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) return;
  console.log('[BlueTab][Mirror] syncNotionMirrors starting for', groupIds);
  try {
    const settings = await Storage.get<IntegrationSettingsBucket>('integration_settings');
    const allMappings = settings?.auto_sync_groups ?? [];
    console.log(
      '[BlueTab][Mirror] auto_sync_groups in storage =',
      allMappings.length,
      allMappings,
    );
    const mappings = allMappings.filter((m) =>
      groupIds.includes(m.groupId) && m.integrationId === 'notion'
    );
    if (mappings.length === 0) {
      console.log('[BlueTab][Mirror] no Notion mappings for changed groups — nothing to do');
      return;
    }

    const groups = (await Storage.get<GroupShape[]>('groups')) ?? [];
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const memory = await GroupMemoryStorageService.getMemory();

    for (const mapping of mappings) {
      const liveGroup = groupById.get(mapping.groupId);
      const rememberedGroup = memory.groups[mapping.groupId];
      const group = rememberedGroup
        ? mergeRememberedGroup(liveGroup, rememberedGroup)
        : liveGroup;
      if (!group) {
        console.log(
          `[BlueTab][Mirror] group ${mapping.groupId} no longer exists locally — unregistering binding`
        );
        await unregisterMirrorBinding(mapping);
        continue;
      }
      await pushOneNotionMirror(mapping, group);
    }
  } catch (err) {
    console.warn('[BlueTab][Integrations] mirror sync failed', err);
  }
}

async function pushOneNotionMirror(
  mapping: AutoSyncMapping,
  group: GroupShape
): Promise<void> {
  const tabCount = group.tabs?.length ?? 0;
  console.log(
    `[BlueTab][Mirror] pushing group ${group.id} (${tabCount} tabs) → Notion db ${mapping.targetId}`
  );
  try {
    const accessToken = await getValidToken('notion', mapping.accountId);
    const syncResult = await notionAdapter.syncDatabaseIncrementally(
      accessToken,
      mapping.targetId,
      group.tabs || [],
      group.name,
      mapping.notionState,
    );
    console.log(`[BlueTab][Mirror] incremental sync: ${syncResult.created} created, ${syncResult.updated} updated, ${syncResult.deleted} deleted`);

    let nextState = syncResult.state;
    if (JSON.stringify(nextState) !== JSON.stringify(mapping.notionState)) {
      await persistNotionState(mapping, nextState);
    }

    const note = group.notes ?? '';
    if (nextState.mirroredNote !== note) {
      await notionAdapter.updateDatabaseDescription(accessToken, mapping.targetId, note);
      nextState = { ...nextState, mirroredNote: note };
      await persistNotionState(mapping, nextState);
    }
  } catch (err) {
    console.warn(
      `[BlueTab][Integrations] mirror sync to Notion failed for group ${mapping.groupId}`,
      err
    );
  }
}

async function persistNotionState(
  mapping: AutoSyncMapping,
  notionState: NotionMirrorState,
): Promise<void> {
  const settings = (await Storage.get<IntegrationSettingsBucket>('integration_settings')) ?? {};
  const next = (settings.auto_sync_groups ?? []).map((candidate) => (
    candidate.groupId === mapping.groupId
      && candidate.integrationId === mapping.integrationId
      && candidate.accountId === mapping.accountId
      && candidate.targetId === mapping.targetId
      ? { ...candidate, notionState }
      : candidate
  ));
  await Storage.set('integration_settings', { ...settings, auto_sync_groups: next });
}

async function unregisterMirrorBinding(mapping: AutoSyncMapping): Promise<void> {
  const settings = (await Storage.get<IntegrationSettingsBucket>('integration_settings')) ?? {};
  const next = (settings.auto_sync_groups ?? []).filter((candidate) => !(
    candidate.groupId === mapping.groupId
      && candidate.integrationId === mapping.integrationId
      && candidate.accountId === mapping.accountId
      && candidate.targetId === mapping.targetId
  ));
  await Storage.set('integration_settings', { ...settings, auto_sync_groups: next });
}

/**
 * Stop mirroring a group. Optionally archives the Notion database that
 * Bluetab created for it (PATCH databases/{id} {archived:true}). The
 * archived database lives in Notion's trash for 30 days — fully reversible.
 */
export async function stopGroupMirror(
  groupId: string,
  options?: { archiveNotionDatabase?: boolean }
): Promise<void> {
  const settings = (await Storage.get<IntegrationSettingsBucket>('integration_settings')) ?? {};
  const mapping = (settings.auto_sync_groups ?? []).find((m) => m.groupId === groupId);

  const next = (settings.auto_sync_groups ?? []).filter((m) => m.groupId !== groupId);
  await Storage.set('integration_settings', { ...settings, auto_sync_groups: next });

  if (options?.archiveNotionDatabase && mapping?.integrationId === 'notion') {
    try {
      const accessToken = await getValidToken('notion', mapping.accountId);
      await notionAdapter.archiveDatabase(accessToken, mapping.targetId);
    } catch (err) {
      // Local mapping is already cleared; surface but do not throw.
      console.warn(
        '[BlueTab][Integrations] could not archive Notion database — clean it up manually if desired',
        err
      );
    }
  }
}

/**
 * Best-effort fire-and-forget route. Called by BrainDumpService.add after
 * a successful local capture. Failures (no destination, Notion 4xx/5xx,
 * kill-switch, rate-limit) never throw — the local entry is the source
 * of truth and Notion is opportunistic.
 */
export async function routeBrainDumpIfConfigured(entry: {
  text: string;
  tabContext?: { url?: string };
}): Promise<void> {
  try {
    const dest = await getBrainDumpDestination();
    if (!dest) return;

    const title = entry.text.slice(0, 100);
    const url = entry.tabContext?.url;
    const properties: Record<string, unknown> = {
      Name: { title: [{ text: { content: title } }] },
    };
    if (url) properties.URL = { url };

    const description = url ? `${entry.text}\n\n${url}` : entry.text;
    const children = [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: description } }],
        },
      },
    ];

    await dispatchVerb(
      'notion',
      'append_to_database',
      { database_id: dest.databaseId, properties, children },
      dest.accountId
    );
  } catch (err) {
    // Local capture is not blocked by Notion failure — log and move on.
    console.warn('[BlueTab][Integrations] brain-dump auto-route failed', err);
  }
}

/**
 * Sync all existing brain dump entries to Notion.
 * Called when brain dump destination is configured to catch up on existing entries.
 */
export async function syncAllBrainDumpEntries(): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  try {
    const dest = await getBrainDumpDestination();
    if (!dest) {
      console.log('[BlueTab][BrainDump] No destination configured, skipping sync');
      return { success, failed };
    }

    const entries = await BrainDumpService.list();
    console.log(`[BlueTab][BrainDump] Syncing ${entries.length} entries to Notion`);

    for (const entry of entries) {
      try {
        await routeBrainDumpIfConfigured({
          text: entry.text,
          tabContext: entry.tabContext,
        });
        success++;
      } catch (err) {
        console.warn('[BlueTab][BrainDump] Failed to sync entry:', entry.id, err);
        failed++;
      }
    }

    console.log(`[BlueTab][BrainDump] Sync complete: ${success} success, ${failed} failed`);
  } catch (err) {
    console.error('[BlueTab][BrainDump] Sync all failed:', err);
  }

  return { success, failed };
}

// ============================================================================
// Brain Dump destinations (expanded list)
// ============================================================================

export interface BrainDumpDestinationOption {
  key: string;              // picker value, e.g. "github:acc:emre/Bluetab" or "notion:xyz"
  integrationId: string;
  accountId: string;
  accountLabel: string;
  target: string | null;    // GitHub: "gist" or "owner/repo"; null elsewhere
  label: string;            // display label
}

interface GitHubRepoConfig {
  owner: string;
  repo: string;
  fullName: string;
}

/**
 * Returns the flat list of destinations available to the Brain Dump picker.
 * Most integrations expose one entry per connected account. GitHub is
 * different: each user-added repo becomes its own destination, plus a
 * single "Gist (private)" entry that needs no repo config.
 */
export async function getBrainDumpDestinations(): Promise<BrainDumpDestinationOption[]> {
  const [accounts, settings] = await Promise.all([
    listConnectedAccounts(),
    Storage.get<IntegrationMenuSettings & { github_repos?: GitHubRepoConfig[] }>('integration_settings'),
  ]);
  const destinations: BrainDumpDestinationOption[] = [];
  for (const a of accounts) {
    const entry = getRegistryEntry(a.integrationId as IntegrationId);
    if (!entry) continue;
    if (a.integrationId === 'github') {
      destinations.push({
        key: `${a.integrationId}:${a.accountId}:gist`,
        integrationId: a.integrationId,
        accountId: a.accountId,
        accountLabel: a.accountLabel,
        target: 'gist',
        label: `${entry.display_name} — Gist (private)`,
      });
      for (const repo of settings?.github_repos ?? []) {
        destinations.push({
          key: `${a.integrationId}:${a.accountId}:${repo.fullName}`,
          integrationId: a.integrationId,
          accountId: a.accountId,
          accountLabel: a.accountLabel,
          target: repo.fullName,
          label: `${entry.display_name} — ${repo.fullName}`,
        });
      }
    } else {
      destinations.push({
        key: `${a.integrationId}:${a.accountId}`,
        integrationId: a.integrationId,
        accountId: a.accountId,
        accountLabel: a.accountLabel,
        target: null,
        label: formatIntegrationDestinationLabel(entry.display_name, a, settings),
      });
    }
  }
  return destinations;
}
