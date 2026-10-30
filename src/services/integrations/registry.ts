/**
 * @module services/integrations/registry
 *
 * INTEGRATION_REGISTRY — 15 locked entries for Phase 14.
 *
 * Out-of-scope ids (explicitly excluded): spotify, raindrop, pocket,
 * perplexity, obsidian, chatgpt.
 *
 * TOKEN-01: All OAuth client_ids are fetched at runtime from Supertry
 * GET /v1/integrations/clients — never hardcoded in extension source.
 * PKCE verifiers are stored in chrome.storage.session, not here.
 */

import { IntegrationRegistryEntrySchema, type IntegrationRegistryEntry } from '../../types/integrations';

// ============================================================================
// Locked integration id list (DO NOT EXPAND without CONTEXT.md update)
// ============================================================================

export const INTEGRATION_IDS = [
  // Tier 1
  'linear', 'todoist', 'notion', 'github',
  // Tier 2
  'google-calendar', 'outlook-calendar', 'slack', 'discord',
  // Tier 3
  'readwise',
  // Tier 4
  'jira', 'trello', 'asana', 'gitlab',
] as const;

export type IntegrationId = (typeof INTEGRATION_IDS)[number];

// Integrations that stay in the id list but must not be offered or dispatched
// (e.g. while a provider issue is investigated). Empty when everything is live.
const TEMPORARILY_DISABLED_INTEGRATION_MESSAGES: Readonly<
  Partial<Record<IntegrationId, string>>
> = {};

export function getIntegrationUnavailableMessage(integrationId: string): string | null {
  return TEMPORARILY_DISABLED_INTEGRATION_MESSAGES[integrationId as IntegrationId] ?? null;
}

// ============================================================================
// Registry
// ============================================================================

const rawRegistry: Omit<IntegrationRegistryEntry, never>[] = [
  // ---- Tier 1 ----
  {
    id: 'linear',
    display_name: 'Linear',
    tier: '1',
    auth_type: 'oauth_pkce_via_supertry',
    // oauth_client_id fetched at runtime from Supertry GET /v1/integrations/clients
    oauth_authorize_url: 'https://linear.app/oauth/authorize',
    oauth_token_url: 'https://api.linear.app/oauth/token',
    oauth_scopes: ['read', 'issues:create', 'write'],
    redirect_uri_kind: 'chromiumapp',
    token_expiry_seconds: 86400, // 24 hours
    supports_refresh: true,
    rate_limit_rps: 3,
    consent_fields: [
      'Group names',
      'Tab titles, URLs, and notes',
      'Group-level notes',
      'Brain dump entry text',
    ],
    verbs: ['create_issue', 'update_issue', 'send_group_to_linear', 'push_brain_dump_to_linear'],
    verb_descriptions: {
      create_issue: 'Create a new Linear issue. Use when the user wants to file a bug, ticket, or task in Linear. Supports priority and assignee fields.',
      update_issue: 'Update an existing Linear issue by ID. Use when the user wants to change priority, title, description, or state.',
      send_group_to_linear: 'Save every tab in a Bluetab group as a Linear issue with the tab URL in the issue description.',
      push_brain_dump_to_linear: 'Turn a single Brain Dump entry into a Linear issue.',
    },
    supports_auto_sync: true,
    supports_manual_pull: false,
  },
  {
    id: 'todoist',
    display_name: 'Todoist',
    tier: '1',
    auth_type: 'oauth_pkce_via_supertry',
    // oauth_client_id fetched at runtime from Supertry GET /v1/integrations/clients
    oauth_authorize_url: 'https://app.todoist.com/oauth/authorize',
    oauth_scopes: ['data:read_write'],
    redirect_uri_kind: 'supertry-proxy',
    token_expiry_seconds: null, // Todoist OAuth tokens are non-expiring
    supports_refresh: false,
    rate_limit_rps: 4,
    consent_fields: [
      'Group names',
      'Tab titles and URLs',
      'Brain dump entry text',
    ],
    verbs: ['create_task', 'send_group_to_todoist', 'push_brain_dump_to_todoist', 'start_group_mirroring', 'stop_group_mirroring', 'sync_group_changes_to_todoist'],
    verb_descriptions: {
      create_task: 'Create a new Todoist task. Use when the user wants to capture a to-do, task, or reminder in Todoist. Supports due date and priority.',
      send_group_to_todoist: 'Save every tab in a Bluetab group as a Todoist task with the tab URL.',
      push_brain_dump_to_todoist: 'Turn a single Brain Dump entry into a Todoist task.',
      start_group_mirroring: 'Start auto-syncing a Bluetab group to Todoist. Creates tasks for all tabs and enables real-time sync.',
      stop_group_mirroring: 'Stop auto-syncing a group to Todoist and delete all tasks created by the mirror.',
      sync_group_changes_to_todoist: 'Internal verb for auto-sync engine: sync individual tab changes to Todoist.',
    },
    supports_auto_sync: true,
    supports_manual_pull: false,
  },
  {
    id: 'notion',
    display_name: 'Notion',
    tier: '1',
    auth_type: 'oauth_pkce_via_supertry',
    // oauth_client_id fetched at runtime from Supertry GET /v1/integrations/clients
    oauth_authorize_url: 'https://api.notion.com/v1/oauth/authorize',
    // token_url handled server-side via Supertry bridge — no direct exchange
    redirect_uri_kind: 'chromiumapp',
    token_expiry_seconds: null, // Notion tokens are non-expiring
    supports_refresh: false,
    rate_limit_rps: 2, // conservative (API limit is 3 req/s avg)
    consent_fields: [
      'Group names',
      'Tab titles, URLs, and notes',
      'Group-level notes',
      'Brain dump entry text',
    ],
    verbs: ['create_page', 'append_to_database', 'send_group_to_notion', 'push_brain_dump_to_notion'],
    verb_descriptions: {
      create_page: 'Create a new Notion page. Use when the user wants to save content as a Notion page under a parent page or workspace.',
      append_to_database: 'Add a row to a Notion database. Use when the user has a database (table) and wants to add a structured entry.',
      send_group_to_notion: 'Save every tab in a Bluetab group as a Notion page or database row.',
      push_brain_dump_to_notion: 'Turn a Brain Dump entry into a Notion page.',
    },
    supports_auto_sync: true,
    // Manual Pull button hidden in the UI — Notion pull is replaced by the
    // AI smart-import tool (`import_groups_from_notion`) in Batch 5.
    supports_manual_pull: false,
  },
  {
    id: 'github',
    display_name: 'GitHub',
    tier: '1',
    auth_type: 'oauth_pkce_via_supertry',
    // oauth_client_id fetched at runtime from Supertry GET /v1/integrations/clients
    oauth_authorize_url: 'https://github.com/login/oauth/authorize',
    oauth_scopes: ['repo', 'gist'],
    redirect_uri_kind: 'chromiumapp',
    token_expiry_seconds: null, // GitHub tokens are non-expiring by default
    supports_refresh: false,
    rate_limit_rps: 1, // 5000 req/hr = ~1.39/s; conservative 1 to stay under
    consent_fields: [
      'Brain dump entry text',
      'URL of the page attached to a Brain Dump entry',
      'Repository owner and name',
    ],
    verbs: ['create_issue', 'create_gist', 'push_brain_dump_to_github'],
    verb_descriptions: {
      create_issue: 'Open a GitHub issue in a repository. Use when the user wants to file a bug, feature request, or task on GitHub.',
      create_gist: 'Create a GitHub gist (code or text snippet). Use when the user wants to share a snippet or save text as a public or private gist.',
      push_brain_dump_to_github: 'Turn a Brain Dump entry into either a GitHub issue or a gist (kind chosen by the user).',
    },
    supports_auto_sync: false,
    supports_manual_pull: false,
  },

  // ---- Tier 2 ----
  {
    id: 'google-calendar',
    display_name: 'Google Calendar',
    tier: '2',
    auth_type: 'oauth_pkce_via_supertry',
    // oauth_client_id fetched at runtime from Supertry GET /v1/integrations/clients
    oauth_authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth',
    oauth_scopes: [
      'https://www.googleapis.com/auth/calendar.events.owned',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    ],
    redirect_uri_kind: 'google-identity',
    token_expiry_seconds: 3600,
    supports_refresh: true,
    rate_limit_rps: 10,
    consent_fields: [
      'Calendar event title',
      'Tab URL',
      'Event start and end time',
      'Event description',
      'List of your calendars (read-only)',
    ],
    verbs: ['create_event', 'schedule_tab_as_event', 'push_brain_dump_to_google_calendar'],
    verb_descriptions: {
      create_event: 'Create a Google Calendar event on the selected calendar.',
      schedule_tab_as_event: 'Turn a tab into a calendar event — the event title is the tab title and the description is the tab URL.',
      push_brain_dump_to_google_calendar: 'Save a Brain Dump entry as a reminder event one hour from now (15 minutes long).',
    },
    supports_auto_sync: false,
    supports_manual_pull: false,
  },
  {
    id: 'outlook-calendar',
    display_name: 'Outlook Calendar',
    tier: '2',
    auth_type: 'oauth_pkce_via_supertry',
    // oauth_client_id fetched at runtime from Supertry GET /v1/integrations/clients
    oauth_authorize_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    oauth_scopes: ['Calendars.ReadWrite', 'offline_access'],
    redirect_uri_kind: 'chromiumapp',
    token_expiry_seconds: 3600,
    supports_refresh: true,
    rate_limit_rps: 16,
    consent_fields: [
      'Calendar event subject',
      'Tab URL',
      'Event start and end time',
      'Event location (optional)',
    ],
    verbs: ['create_event', 'schedule_tab_as_event', 'push_brain_dump_to_outlook_calendar'],
    verb_descriptions: {
      create_event: "Create an Outlook Calendar event on the user's primary calendar.",
      schedule_tab_as_event: 'Turn a tab into a calendar event in Outlook — the event subject is the tab title and the body is the tab URL.',
      push_brain_dump_to_outlook_calendar: 'Save a brain dump entry as an Outlook Calendar event.',
    },
    supports_auto_sync: false,
    supports_manual_pull: false,
  },
  {
    id: 'slack',
    display_name: 'Slack',
    tier: '2',
    auth_type: 'oauth_pkce_via_supertry',
    // oauth_client_id fetched at runtime from Supertry GET /v1/integrations/clients
    // User-token authorize URL — Slack distinguishes user vs bot OAuth flows.
    // Desktop redirect URIs cannot request bot scopes (RESEARCH §Pitfall 6).
    oauth_authorize_url: 'https://slack.com/oauth/v2_user/authorize',
    // oauth_token_url handled server-side via Supertry bridge
    // chat:write is the user-token scope; bot scopes are unavailable for
    // chromiumapp.org redirects per Slack PKCE requirements.
    oauth_scopes: ['chat:write', 'channels:read'],
    redirect_uri_kind: 'chromiumapp',
    // access_token rotates every ~12h; refresh_token expires every 30 days
    // when PKCE is active (RESEARCH §Pitfall 6). Refresh failure → reauth banner.
    token_expiry_seconds: 43200, // 12 hours (access_token rotation cadence)
    supports_refresh: true,
    rate_limit_rps: 1, // chat.postMessage tier-1: 1 req/s per channel
    consent_fields: [
      'Slack channel name (typed by user)',
      'Group names',
      'Tab titles and URLs',
      'Brain dump entry text',
    ],
    verbs: [
      'share_to_channel',
      'send_dm',
      'send_group_to_slack',
      'push_brain_dump_to_slack',
      'start_group_mirroring',
      'stop_group_mirroring',
      'sync_group_mirroring',
    ],
    verb_descriptions: {
      share_to_channel: 'Post a message to a Slack channel.',
      send_dm: 'Send a Slack direct message to a user.',
      send_group_to_slack:
        'Share every tab in a Bluetab group to a Slack channel as a bulleted list with links.',
      push_brain_dump_to_slack: 'Share a Brain Dump entry to a Slack channel.',
      start_group_mirroring: 'Start mirroring a Bluetab group to a Slack channel message.',
      stop_group_mirroring: 'Stop mirroring and delete the Slack message.',
      sync_group_mirroring: 'Update the mirrored Slack message to match current group tabs.',
    },
    supports_auto_sync: true,
    supports_manual_pull: false,
  },
  {
    id: 'discord',
    display_name: 'Discord',
    tier: '2',
    auth_type: 'oauth_pkce_via_supertry',
    // oauth_client_id fetched at runtime from Supertry GET /v1/integrations/clients
    oauth_authorize_url: 'https://discord.com/oauth2/authorize',
    // webhook.incoming returns a webhook object in the token response — the
    // user picks the channel during consent, and the resulting webhook URL is
    // captured into accountMeta.webhook_url (RESEARCH §Pitfall 7).
    oauth_scopes: ['webhook.incoming'],
    redirect_uri_kind: 'chromiumapp',
    token_expiry_seconds: null, // webhook tokens are non-expiring
    supports_refresh: false,
    // Discord webhook rate limit: 5 per channel per 2s = 2.5 rps; round down.
    rate_limit_rps: 2,
    consent_fields: [
      'Discord channel name (chosen at connect time)',
      'Group names',
      'Tab titles and URLs',
      'Brain dump entry text',
    ],
    verbs: [
      'share_to_channel',
      'send_group_to_discord',
      'push_brain_dump_to_discord',
      'start_group_mirroring',
      'stop_group_mirroring',
      'sync_group_mirroring',
    ],
    verb_descriptions: {
      share_to_channel:
        'Post a message to the Discord channel selected during connect (webhook flow).',
      send_group_to_discord:
        'Share every tab in a Bluetab group to a Discord channel as a single embed with linked titles.',
      push_brain_dump_to_discord:
        'Share a Brain Dump entry (with source link if available) to a Discord channel as an embed.',
      start_group_mirroring:
        'Start mirroring a Bluetab group to a Discord channel — posts a live embed that updates as tabs change.',
      stop_group_mirroring:
        'Stop mirroring and delete the Discord embed message.',
      sync_group_mirroring:
        'Update the mirrored Discord embed to match the current group tabs.',
    },
    supports_auto_sync: true,
    supports_manual_pull: false,
  },

  // ---- Tier 3 ----
  {
    id: 'readwise',
    display_name: 'Readwise',
    tier: '3',
    auth_type: 'token_paste',
    // Plan 14-04 deferred-items.md drift fix: token_paste entries still need
    // redirect_uri_kind explicitly because rawRegistry uses Omit<…, never>.
    redirect_uri_kind: 'chromiumapp',
    token_expiry_seconds: null, // Readwise tokens are non-expiring
    supports_refresh: false,
    rate_limit_rps: 4, // 240 req/min global limit
    // Settings paste form renders this URL as a link.
    token_paste_instructions_url: 'https://readwise.io/access_token',
    consent_fields: [
      'Tab titles and URLs',
      'Tab notes',
      'Brain dump entry text',
    ],
    verbs: ['save_article', 'send_group_to_readwise', 'push_brain_dump_to_readwise'],
    verb_descriptions: {
      save_article: 'Save an article to Readwise reader.',
      send_group_to_readwise:
        'Save every tab in a Bluetab group as Readwise highlights (one highlight per tab).',
      push_brain_dump_to_readwise: 'Save a Brain Dump entry to Readwise as a highlight.',
    },
    supports_auto_sync: true,
    supports_manual_pull: false,
  },

  // ---- Tier 4 ----
  {
    id: 'jira',
    display_name: 'Jira',
    tier: '4',
    auth_type: 'oauth_pkce_via_supertry',
    // oauth_client_id fetched at runtime from Supertry GET /v1/integrations/clients
    oauth_authorize_url: 'https://auth.atlassian.com/authorize',
    oauth_scopes: ['read:jira-work', 'write:jira-work', 'offline_access'],
    redirect_uri_kind: 'chromiumapp',
    token_expiry_seconds: 3600,
    supports_refresh: true,
    rate_limit_rps: 10, // Atlassian per-product limits are generous
    consent_fields: [
      'Group names',
      'Tab titles, URLs, and notes',
      'Brain dump entry text',
      'Jira project key (typed by user)',
    ],
    verbs: ['create_issue', 'send_group_to_jira', 'push_brain_dump_to_jira'],
    verb_descriptions: {
      create_issue: 'Create a Jira issue in the specified project.',
      send_group_to_jira: 'Create one Jira issue for a Bluetab group, with the group tabs listed in the issue description.',
      push_brain_dump_to_jira: 'Turn a Brain Dump entry into a Jira issue.',
    },
    supports_auto_sync: true,
    supports_manual_pull: false,
  },
  {
    id: 'trello',
    display_name: 'Trello',
    tier: '4',
    // New connections use Cloud's OAuth 1.0a request-token lifecycle. Existing
    // device-token accounts remain readable by the Trello adapter.
    auth_type: 'oauth_pkce_via_supertry',
    oauth_scopes: ['read', 'write'],
    redirect_uri_kind: 'chromiumapp',
    token_expiry_seconds: null, // expiration=never
    supports_refresh: false,
    rate_limit_rps: 10, // 100 req / 10s per token
    consent_fields: [
      'Group names',
      'Tab titles, URLs, and notes',
      'Brain dump entry text',
      'Trello list ID (chosen by user)',
    ],
    verbs: ['create_card', 'send_group_to_trello', 'push_brain_dump_to_trello'],
    verb_descriptions: {
      create_card: 'Create a Trello card on a board list.',
      send_group_to_trello: 'Save every tab in a Bluetab group as a Trello card.',
      push_brain_dump_to_trello: 'Turn a Brain Dump entry into a Trello card.',
    },
    supports_auto_sync: true,
    supports_manual_pull: false,
  },
  {
    id: 'asana',
    display_name: 'Asana',
    tier: '4',
    auth_type: 'oauth_pkce_via_supertry',
    // oauth_client_id fetched at runtime from Supertry GET /v1/integrations/clients
    oauth_authorize_url: 'https://app.asana.com/-/oauth_authorize',
    oauth_scopes: ['default'],
    redirect_uri_kind: 'chromiumapp',
    // Asana OAuth access tokens expire after roughly one hour. Keep a
    // fallback here in case the bridge/provider omits expires_in.
    token_expiry_seconds: 3600,
    supports_refresh: true,
    rate_limit_rps: 25, // 1500/min = 25/s
    consent_fields: [
      'Group names',
      'Tab titles and URLs',
      'Brain dump entry text',
      'Asana project (chosen by user)',
    ],
    verbs: ['create_task', 'send_group_to_asana', 'push_brain_dump_to_asana'],
    verb_descriptions: {
      create_task: 'Create an Asana task in the specified project.',
      send_group_to_asana: 'Save every tab in a Bluetab group as an Asana task.',
      push_brain_dump_to_asana: 'Turn a Brain Dump entry into an Asana task.',
    },
    supports_auto_sync: true,
    supports_manual_pull: false,
  },
  {
    id: 'gitlab',
    display_name: 'GitLab',
    tier: '4',
    auth_type: 'oauth_pkce_via_supertry',
    // oauth_client_id fetched at runtime from Supertry GET /v1/integrations/clients
    oauth_authorize_url: 'https://gitlab.com/oauth/authorize',
    oauth_scopes: ['api'], // covers issues + repo write
    redirect_uri_kind: 'chromiumapp',
    token_expiry_seconds: 7200, // 2 hours, refresh_token rotates
    supports_refresh: true,
    rate_limit_rps: 10, // 3600/hr global limit
    consent_fields: [
      'Group names',
      'Tab titles, URLs, and notes',
      'Brain dump entry text',
      'GitLab project ID (typed by user)',
    ],
    verbs: ['create_issue', 'send_group_to_gitlab', 'push_brain_dump_to_gitlab'],
    verb_descriptions: {
      create_issue: 'Open a GitLab issue in a project.',
      send_group_to_gitlab: 'Save every tab in a Bluetab group as a GitLab issue.',
      push_brain_dump_to_gitlab: 'Turn a Brain Dump entry into a GitLab issue.',
    },
    supports_auto_sync: true,
    supports_manual_pull: false,
  },
];

// Validate every active entry against the Zod schema at module load time.
export const INTEGRATION_REGISTRY: IntegrationRegistryEntry[] = rawRegistry
  .filter((entry) => getIntegrationUnavailableMessage(entry.id) === null)
  .map((entry) => {
    const result = IntegrationRegistryEntrySchema.parse(entry);
    return result;
  });

// Quick lookup map by id
export const INTEGRATION_REGISTRY_MAP: ReadonlyMap<IntegrationId, IntegrationRegistryEntry> =
  new Map(INTEGRATION_REGISTRY.map((e) => [e.id as IntegrationId, e]));

export function getRegistryEntry(id: string): IntegrationRegistryEntry | undefined {
  return INTEGRATION_REGISTRY_MAP.get(id as IntegrationId);
}
