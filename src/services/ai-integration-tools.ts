/**
 * @module services/ai-integration-tools
 *
 * WHY:  Lets Bluetab AI act in the apps the user connected (create an Outlook
 *       event, a Linear issue, a Todoist task, ...).
 *
 * WHAT: A curated set of direct "create" actions, one per connected
 *       integration. Each has a real JSON schema (the adapters need specific
 *       fields), a provider-safe name (`outlook_calendar__create_event`, the
 *       model API only allows [a-zA-Z0-9_-]), a mapping to the adapter's
 *       arguments with Bluetab's default targets filled in, and a short
 *       summary for the confirmation card. Actions that post to shared
 *       places (Slack, Discord) or publish (public gists) always ask, even
 *       when the user chose "Always allow app actions".
 *
 *       Errors carry an English `message` for the model and a stable `code`
 *       (see TOOL_ERROR_CODES) that the chat shows in the UI language.
 *
 * HOW:  buildAIIntegrationTools() feeds the chat tool schema;
 *       prepareAIIntegrationAction() + runAIIntegrationTool() run inside
 *       useAIChat after the user confirmed (or always-allowed) the action.
 *
 * NOT:  Group/Brain Dump bulk verbs and mirroring stay UI-only for now.
 */

import { dispatchVerb } from './integration-service';
import { listConnectedAccounts } from './integration-token-storage';
import { getRegistryEntry, type IntegrationId } from './integrations/registry';
import { Storage } from '../utils/storage';
import { t as translate } from '../i18n';
import type { ToolErrorCode, ToolErrorOutput } from '../utils/ai-tool-loop';
import type { IntegrationAccount } from '../types/integrations';

type JsonSchema = Record<string, unknown>;

interface IntegrationSettingsSnapshot {
  default_sync_target?: Record<string, string>;
  github_repos?: Array<{ fullName: string }>;
  brain_dump_destination?: { integrationId?: string; parentPageId?: string } | null;
}

interface ToolContext {
  displayName: string;
  defaultTarget?: string;
  githubRepos: string[];
  notionParentPageId?: string;
}

interface ToolSpec {
  integrationId: IntegrationId;
  verb: string;
  describe: (ctx: ToolContext) => string;
  properties: Record<string, JsonSchema>;
  required: string[];
  /** Returns the problem when the action cannot run with the current settings. */
  precheck?: (ctx: ToolContext, input: Record<string, unknown>) => ToolErrorOutput | null;
  toArgs: (input: Record<string, unknown>, ctx: ToolContext) => Record<string, unknown>;
  /** Lines for the confirmation card: user content, plus localized notes. */
  summarize: (input: Record<string, unknown>, ctx: ToolContext) => string[];
  /** Shares outside the user's own workspace: never skip the confirmation. */
  alwaysConfirm?: (input: Record<string, unknown>, ctx: ToolContext) => boolean;
}

export interface AIIntegrationTool {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface AIIntegrationActionPlan {
  integrationName: string;
  details: string[];
  /** True when "Always allow app actions" must not skip the card. */
  alwaysConfirm: boolean;
}

function toolError(code: ToolErrorCode, message: string, params?: Record<string, string>): ToolErrorOutput {
  return params ? { status: 'error', message, code, params } : { status: 'error', message, code };
}

const text = (description: string): JsonSchema => ({ type: 'string', description });
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
const lines = (...values: unknown[]): string[] => values.map(str).filter((v): v is string => Boolean(v));

const LOCAL_TIME =
  'Local date and time WITHOUT a UTC offset, e.g. 2026-10-12T12:00:00. Work it out from the current local time.';

const calendarSpec = (integrationId: IntegrationId, titleField: 'summary' | 'subject', bodyField: 'description' | 'body'): ToolSpec => ({
  integrationId,
  verb: 'create_event',
  describe: (ctx) =>
    `Create an event on the user's ${ctx.displayName} (the default calendar chosen in Bluetab settings). ` +
    'If the user gives no end time, end it one hour after the start.',
  properties: {
    title: text('Event title.'),
    start: text(`Start. ${LOCAL_TIME}`),
    end: text(`End. ${LOCAL_TIME}`),
    description: text('Optional event notes.'),
    location: text('Optional location.'),
  },
  required: ['title', 'start', 'end'],
  toArgs: (input) => ({
    [titleField]: str(input.title),
    start: str(input.start),
    end: str(input.end),
    [bodyField]: str(input.description),
    location: str(input.location),
  }),
  summarize: (input) => lines(input.title, [str(input.start), str(input.end)].filter(Boolean).join(' – ')),
});

const TOOL_SPECS: ToolSpec[] = [
  calendarSpec('google-calendar', 'summary', 'description'),
  calendarSpec('outlook-calendar', 'subject', 'body'),
  {
    integrationId: 'linear',
    verb: 'create_issue',
    describe: () => 'Create an issue in Linear, in the team chosen in Bluetab settings.',
    properties: {
      title: text('Issue title.'),
      description: text('Optional issue description (Markdown).'),
      priority: { type: 'integer', minimum: 0, maximum: 4, description: '0 none, 1 urgent, 2 high, 3 medium, 4 low.' },
    },
    required: ['title'],
    toArgs: (input) => ({ title: str(input.title), description: str(input.description), priority: input.priority }),
    summarize: (input) => lines(input.title),
  },
  {
    integrationId: 'todoist',
    verb: 'create_task',
    describe: () => 'Create a task in Todoist, in the project chosen in Bluetab settings.',
    properties: {
      content: text('Task title.'),
      description: text('Optional task description.'),
      due_date: text('Optional due date as YYYY-MM-DD.'),
      priority: { type: 'integer', minimum: 1, maximum: 4, description: '1 normal ... 4 urgent.' },
    },
    required: ['content'],
    toArgs: (input, ctx) => ({
      content: str(input.content),
      description: str(input.description),
      due_date: str(input.due_date),
      priority: input.priority,
      project_id: ctx.defaultTarget,
    }),
    summarize: (input) => lines(input.content, input.due_date),
  },
  {
    integrationId: 'notion',
    verb: 'create_page',
    describe: () => 'Create a Notion page under the Notion page chosen for Brain Dump in Bluetab settings.',
    properties: {
      title: text('Page title.'),
      content: text('Optional page text.'),
    },
    required: ['title'],
    precheck: (ctx) =>
      ctx.notionParentPageId
        ? null
        : toolError('notionPageMissing', 'No Notion page is chosen yet. Pick one in Bluetab Settings > Integrations > Notion.'),
    toArgs: (input, ctx) => ({
      parent: { page_id: ctx.notionParentPageId },
      title: str(input.title),
      content: str(input.content),
    }),
    summarize: (input) => lines(input.title),
  },
  {
    integrationId: 'github',
    verb: 'create_issue',
    describe: (ctx) =>
      'Create a GitHub issue.' +
      (ctx.githubRepos.length > 0
        ? ` Repositories the user added in Bluetab: ${ctx.githubRepos.join(', ')}. Use the one the user names, otherwise ${ctx.githubRepos[0]}.`
        : ' The user has not added a repository in Bluetab settings yet.'),
    properties: {
      repo: text('Repository as owner/name.'),
      title: text('Issue title.'),
      body: text('Optional issue body (Markdown).'),
    },
    required: ['title'],
    precheck: (ctx, input) =>
      str(input.repo) || ctx.githubRepos.length > 0
        ? null
        : toolError('githubRepoMissing', 'No GitHub repository is added yet. Add one in Bluetab Settings > Integrations > GitHub.'),
    toArgs: (input, ctx) => {
      const [owner, repo] = (str(input.repo) ?? ctx.githubRepos[0] ?? '').split('/');
      return { owner, repo, title: str(input.title), body: str(input.body) };
    },
    summarize: (input) => lines(input.title, input.repo),
    alwaysConfirm: (input, ctx) => {
      const target = (str(input.repo) ?? ctx.githubRepos[0])?.toLowerCase();
      return !ctx.githubRepos.some((repo) => repo.toLowerCase() === target);
    },
  },
  {
    integrationId: 'github',
    verb: 'create_gist',
    describe: () => 'Create a GitHub gist (private unless the user asks for a public one).',
    properties: {
      filename: text('File name, e.g. notes.md.'),
      content: text('File content.'),
      description: text('Optional gist description.'),
      public: { type: 'boolean', description: 'Only true when the user asks for a public gist.' },
    },
    required: ['filename', 'content'],
    toArgs: (input) => ({
      description: str(input.description),
      public: input.public === true,
      files: { [str(input.filename) ?? 'note.md']: { content: String(input.content ?? '') } },
    }),
    summarize: (input) => [
      ...lines(input.filename, input.description),
      ...(input.public === true ? [translate('components.confirmation.integrationDetails.publicGist')] : []),
    ],
    alwaysConfirm: (input) => input.public === true,
  },
  {
    integrationId: 'slack',
    verb: 'share_to_channel',
    describe: () => 'Post a message to Slack, in the channel chosen in Bluetab settings unless the user names another channel ID.',
    properties: {
      text: text('Message text.'),
      channel: text('Optional Slack channel ID. Leave empty for the default channel.'),
    },
    required: ['text'],
    toArgs: (input) => ({ text: str(input.text), channel: str(input.channel) }),
    summarize: (input, ctx) => {
      const channel = str(input.channel) ?? ctx.defaultTarget;
      return [
        ...lines(input.text),
        channel
          ? translate('components.confirmation.integrationDetails.channel', { channel })
          : translate('components.confirmation.integrationDetails.defaultChannel'),
      ];
    },
    alwaysConfirm: () => true,
  },
  {
    integrationId: 'discord',
    verb: 'share_to_channel',
    describe: () => 'Post a message to the Discord channel connected in Bluetab.',
    properties: { content: text('Message text.') },
    required: ['content'],
    toArgs: (input) => ({ content: str(input.content) }),
    summarize: (input) => lines(input.content),
    alwaysConfirm: () => true,
  },
  {
    integrationId: 'readwise',
    verb: 'save_article',
    describe: () => 'Save a web page to Readwise.',
    properties: {
      url: text('Page URL.'),
      title: text('Page title.'),
      note: text('Optional note to save with it.'),
    },
    required: ['url', 'title'],
    toArgs: (input) => ({ source_url: str(input.url), title: str(input.title), text: str(input.note) ?? str(input.title) }),
    summarize: (input) => lines(input.title, input.url),
  },
  {
    integrationId: 'jira',
    verb: 'create_issue',
    describe: () => 'Create a Jira issue in the project chosen in Bluetab settings.',
    properties: {
      summary: text('Issue summary.'),
      description: text('Optional issue description.'),
      issuetype: text('Optional issue type, default Task.'),
    },
    required: ['summary'],
    toArgs: (input) => ({ summary: str(input.summary), description: str(input.description), issuetype: str(input.issuetype) }),
    summarize: (input) => lines(input.summary),
  },
  {
    integrationId: 'trello',
    verb: 'create_card',
    describe: () => 'Create a Trello card in the list chosen in Bluetab settings.',
    properties: {
      name: text('Card title.'),
      desc: text('Optional card description.'),
      due: text(`Optional due date and time. ${LOCAL_TIME}`),
    },
    required: ['name'],
    toArgs: (input) => ({ name: str(input.name), desc: str(input.desc), due: str(input.due) }),
    summarize: (input) => lines(input.name, input.due),
  },
  {
    integrationId: 'asana',
    verb: 'create_task',
    describe: () => 'Create an Asana task in the project chosen in Bluetab settings.',
    properties: {
      name: text('Task name.'),
      notes: text('Optional task notes.'),
      due_on: text('Optional due date as YYYY-MM-DD.'),
    },
    required: ['name'],
    toArgs: (input, ctx) => ({ name: str(input.name), notes: str(input.notes), due_on: str(input.due_on), project: ctx.defaultTarget }),
    summarize: (input) => lines(input.name, input.due_on),
  },
  {
    integrationId: 'gitlab',
    verb: 'create_issue',
    describe: () => 'Create a GitLab issue in the project chosen in Bluetab settings.',
    properties: {
      title: text('Issue title.'),
      description: text('Optional issue description (Markdown).'),
    },
    required: ['title'],
    toArgs: (input) => ({ title: str(input.title), description: str(input.description) }),
    summarize: (input) => lines(input.title),
  },
];

const TOOL_NAME_PATTERN = /^[a-z_]+__[a-z_]+$/;

export function aiIntegrationToolName(integrationId: string, verb: string): string {
  return `${integrationId.replace(/-/g, '_')}__${verb}`;
}

const SPECS_BY_NAME = new Map(TOOL_SPECS.map((spec) => [aiIntegrationToolName(spec.integrationId, spec.verb), spec]));

/** True for the chat tool names produced here (`provider__verb`). */
export function isAIIntegrationToolName(name: string): boolean {
  return TOOL_NAME_PATTERN.test(name) && SPECS_BY_NAME.has(name);
}

function withoutEmpty(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined && value !== ''));
}

async function loadContext(account: IntegrationAccount): Promise<ToolContext> {
  const settings = (await Storage.get<IntegrationSettingsSnapshot>('integration_settings')) ?? {};
  const destination = settings.brain_dump_destination;
  return {
    displayName: getRegistryEntry(account.integrationId)?.display_name ?? account.integrationId,
    defaultTarget: settings.default_sync_target?.[account.integrationId],
    githubRepos: (settings.github_repos ?? []).map((repo) => repo.fullName).filter(Boolean),
    notionParentPageId: destination?.integrationId === 'notion' ? destination.parentPageId : undefined,
  };
}

/** One account per provider (the cloud keeps a single connection per user and provider). */
async function connectedAccountsById(): Promise<Map<string, IntegrationAccount>> {
  const byId = new Map<string, IntegrationAccount>();
  for (const account of await listConnectedAccounts()) {
    if (!byId.has(account.integrationId)) byId.set(account.integrationId, account);
  }
  return byId;
}

export async function buildAIIntegrationTools(): Promise<AIIntegrationTool[]> {
  const accounts = await connectedAccountsById();
  const tools: AIIntegrationTool[] = [];
  for (const spec of TOOL_SPECS) {
    const account = accounts.get(spec.integrationId);
    if (!account || !getRegistryEntry(spec.integrationId)) continue;
    const ctx = await loadContext(account);
    tools.push({
      name: aiIntegrationToolName(spec.integrationId, spec.verb),
      description: `${spec.describe(ctx)} Acts in the user's connected ${ctx.displayName} account.`,
      parameters: { type: 'object', properties: spec.properties, required: spec.required, additionalProperties: false },
    });
  }
  return tools;
}

async function resolve(name: string): Promise<{ spec: ToolSpec; account: IntegrationAccount; ctx: ToolContext } | ToolErrorOutput> {
  const spec = SPECS_BY_NAME.get(name);
  if (!spec) return { status: 'error', message: `Unknown tool: ${name}` };
  const account = (await connectedAccountsById()).get(spec.integrationId);
  if (!account) {
    const app = getRegistryEntry(spec.integrationId)?.display_name ?? spec.integrationId;
    return toolError('notConnected', `${app} is not connected.`, { app });
  }
  return { spec, account, ctx: await loadContext(account) };
}

/** Validates the call and returns what the confirmation card shows. */
export async function prepareAIIntegrationAction(
  name: string,
  input: Record<string, unknown>,
): Promise<AIIntegrationActionPlan | ToolErrorOutput> {
  const resolved = await resolve(name);
  if ('status' in resolved) return resolved;
  const { spec, ctx } = resolved;
  const missing = spec.required.filter((field) => input[field] === undefined || input[field] === '');
  if (missing.length > 0) return toolError('missingFields', `Missing required field(s): ${missing.join(', ')}`);
  const problem = spec.precheck?.(ctx, input);
  if (problem) return problem;
  return {
    integrationName: ctx.displayName,
    details: spec.summarize(input, ctx),
    alwaysConfirm: spec.alwaysConfirm?.(input, ctx) ?? false,
  };
}

/** Whether to show the confirmation card for a prepared action. */
export function shouldConfirmIntegrationAction(plan: AIIntegrationActionPlan, alwaysAllowIntegrationActions: boolean): boolean {
  return plan.alwaysConfirm || !alwaysAllowIntegrationActions;
}

// Adapter codes that mean "no default destination chosen in Bluetab settings".
const TARGET_MISSING_CODES = new Set([
  'missing_team_id', 'missing_project_key', 'missing_project_id', 'missing_cloud_id', 'missing_id_list',
  'missing_channel', 'missing_webhook_url', 'missing_workspace', 'missing_parent', 'missing_database_id',
  'missing_default_database_id', 'missing_default_repo', 'missing_default_owner',
]);

/** Classifies an adapter error so the chat can explain it in the UI language. */
function adapterError(error: string | undefined, app: string): ToolErrorOutput {
  const message = error ?? 'The action did not complete.';
  if (error === 'reauth_required') {
    return toolError('reconnect', `${app} needs to be reconnected in Bluetab Settings > Integrations.`, { app });
  }
  if (error && TARGET_MISSING_CODES.has(error)) {
    return toolError('targetMissing', `${app} has no default destination (${error}). It is chosen in Bluetab Settings > Integrations.`, { app });
  }
  if (error && /^missing_[a-z_]+$/.test(error)) return toolError('missingFields', message);
  // These two arrive already localized from cloud-operation-client.
  if (error === translate('settings.integrations.signInAgain')) return toolError('signIn', message);
  if (error === translate('settings.integrations.accountUnsupported')) return toolError('accountUnsupported', message, { app });
  return toolError('appError', message, { app });
}

export async function runAIIntegrationTool(
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resolved = await resolve(name);
  if ('status' in resolved) return resolved;
  const { spec, account, ctx } = resolved;
  try {
    const result = await dispatchVerb(spec.integrationId, spec.verb, withoutEmpty(spec.toArgs(input, ctx)), account.accountId);
    return result.success
      ? { status: 'success', integration: ctx.displayName, result: result.result ?? null }
      : adapterError(result.error, ctx.displayName);
  } catch (error) {
    if (error instanceof Response) {
      return error.status === 401
        ? adapterError('reauth_required', ctx.displayName)
        : toolError('appError', `${ctx.displayName} returned HTTP ${error.status}.`, { app: ctx.displayName });
    }
    return adapterError(error instanceof Error ? error.message : String(error), ctx.displayName);
  }
}
