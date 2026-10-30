/**
 * @module utils/ai-tools
 *
 * WHY:  The AI assistant uses structured function calling (tools) to perform
 *       tab management actions. Defining all tool schemas in one place ensures
 *       consistent validation and makes it easy to add new tools.
 *
 * WHAT: All 15 AI tool definitions with Zod input schemas for LLM function calling.
 *       No execute functions — all execution is client-side in the UI layer.
 *
 * HOW:  Uses the Vercel AI SDK `tool()` helper with Zod `inputSchema` schemas.
 *       Exported as `aiTools` object keyed by tool name.
 *
 * NOT:  Does not contain tool execution logic.
 *       Does not handle confirmation gates (that's the UI layer's responsibility).
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { AIToolName } from '../types/ai';

// ============================================================================
// Tool Definitions
// ============================================================================

export const aiTools = {
  /**
   * Search for open tabs by keyword in title or URL.
   */
  search_tabs: tool({
    description: 'Search for open browser tabs by keyword. Matches against tab title and URL.',
    inputSchema: z.object({
      query: z.string().describe('Search query to match against tab titles and URLs'),
    }),
  }),

  /**
   * Group tabs into a named Chrome tab group.
   */
  group_tabs: tool({
    description: 'Group tabs into one or more named Chrome tab groups. Supports batch: pass multiple groups in one call to group all tabs at once. Always provide meaningful names and colors.',
    inputSchema: z.object({
      groups: z.array(z.object({
        tabIds: z.array(z.number()).describe('Tab IDs for this group'),
        groupName: z.string().describe('Descriptive name (e.g. "YouTube", "React Docs")'),
        color: z.enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']).optional().describe('Color: red=video, blue=dev, green=learning, purple=work, orange=shopping'),
      })).describe('Array of groups to create. Use multiple entries to batch-group tabs in one call.'),
    }),
  }),

  /**
   * Save open tabs to Bluetab groups and close them.
   */
  save_tabs: tool({
    description:
      'Save open browser tabs to Bluetab saved groups and optionally close them based on user settings. Supports batch: pass multiple groups to save different categories at once. Use mode="auto_organize" for normal smart sorting, or mode="preserve_set" to keep the provided tabs together exactly as one saved bundle. Use this when user says "save", "kaydet", or wants to keep tabs for later.',
    inputSchema: z.object({
      mode: z.enum(['auto_organize', 'preserve_set']).optional().describe('auto_organize = Bluetab may route tabs through memory/flow/smart grouping. preserve_set = keep exactly the provided tabs together in the provided groupName without repartitioning.'),
      groups: z.array(z.object({
        tabIds: z.array(z.number()).describe('Tab IDs to save'),
        groupName: z.string().optional().describe('Name for the saved group (auto-generated from domain if empty)'),
      })).describe('Array of groups to save. Use multiple entries to batch-save into separate groups.'),
    }),
  }),

  /**
   * Archive tabs to long-term storage. Accepts groupId (saved group) or tabIds (open browser tabs).
   */
  archive_group: tool({
    description:
      'Archive tabs to long-term storage. Pass groupId to archive a saved Bluetab group. Pass tabIds to archive open browser tabs directly (skip intermediate save). Archiving is non-destructive and fully restorable.',
    inputSchema: z.object({
      groupId: z.string().optional().describe('ID of the saved Bluetab group to archive'),
      tabIds: z.array(z.number()).optional().describe('Browser tab IDs to archive directly from open tabs (alternative to groupId)'),
      reason: z.string().optional().describe('Reason for archiving'),
    }),
  }),

  /**
   * Permanently close/delete tabs.
   */
  delete_tabs: tool({
    description:
      'Permanently close specified browser tabs. REQUIRES user confirmation before executing.',
    inputSchema: z.object({
      tabIds: z.array(z.number()).describe('Array of browser tab IDs to close permanently'),
    }),
  }),

  /**
   * Open URLs as new browser tabs.
   */
  open_tabs: tool({
    description: 'Open one or more URLs as new browser tabs. Maximum 5 URLs at a time.',
    inputSchema: z.object({
      urls: z.array(z.string().url()).max(5).describe('Array of URLs to open (max 5)'),
    }),
  }),

  /**
   * Rename an existing saved Bluetab group.
   */
  rename_group: tool({
    description: 'Rename an existing saved Bluetab group.',
    inputSchema: z.object({
      groupId: z.string().describe('ID of the Bluetab group to rename'),
      newName: z.string().describe('New name for the group'),
    }),
  }),

  /**
   * Search saved Bluetab groups and tabs.
   */
  search_bluetab: tool({
    description:
      'Search through saved Bluetab groups and their tabs. Returns matching groups and tab entries.',
    inputSchema: z.object({
      query: z.string().describe('Search query to match against saved groups and tab titles/URLs'),
    }),
  }),

  /**
   * Search Brain Dump inbox entries or fetch one full entry by id.
   */
  search_brain_dump: tool({
    description:
      'Search Brain Dump inbox entries by text, captured tab title, or captured tab URL. Empty or broad natural-language queries return the newest 20 dumps plus the true total match count. Use action="search" for compact matches with snippets, then action="get" with entryId when you need the full dump text. includeFullText is only for already-narrow search results.',
    inputSchema: z.object({
      action: z.enum(['search', 'get']).optional().describe('search = compact snippet results, get = fetch one full entry by id. Defaults to search when omitted.'),
      query: z.string().optional().describe('Search query for Brain Dump inbox text, captured tab title, or URL. Empty query returns newest dumps.'),
      entryId: z.string().optional().describe('Brain Dump entry id for full-content fetches when action="get".'),
      limit: z.number().int().min(1).max(20).optional().describe('Maximum number of search matches to return (default 5 for targeted search, 20 for browse-all, max 20).'),
      includeFullText: z.boolean().optional().describe('Optional: include the full dump text in search results only when the result set is already narrow.'),
    }),
  }),

  /**
   * Search RSS feed articles from Phase 4 feeds.
   */
  search_rss: tool({
    description:
      'Search through RSS feed articles from your subscribed feeds. Returns article metadata (title, URL, date, feed name) only — never full article content.',
    inputSchema: z.object({
      query: z.string().describe('Search query to match against article titles and URLs'),
    }),
  }),

  /**
   * Perform a web search via the Supertry search proxy.
   */
  web_search: tool({
    description:
      'Search the web for information. Returns top results with title, URL, snippet, and the openedTabIds of any tabs opened from those results so follow-up tools can act on the exact same set. Use freshness when the user asks for current or latest information.',
    inputSchema: z.object({
      query: z.string().describe('Web search query'),
      freshness: z.enum(['day', 'week', 'month', 'year']).optional().describe('Optional freshness window for current information. Prefer month for latest/current requests, week/day for explicit recent-news requests.'),
    }),
  }),

  /**
   * Manage Bluetab projects: create, list, update, delete, or assign groups.
   */
  manage_projects: tool({
    description:
      'Manage Bluetab projects: create, list, update, delete, or assign groups. Delete requires user confirmation.',
    inputSchema: z.object({
      action: z
        .enum(['create', 'list', 'update', 'delete', 'assign'])
        .describe('The project operation to perform'),
      projectId: z
        .string()
        .optional()
        .describe('Project ID for update/delete(single)/assign operations'),
      projectIds: z
        .array(z.string())
        .optional()
        .describe('Multiple project IDs for batch delete'),
      name: z.string().optional().describe('Project name for create/update'),
      color: z
        .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'])
        .optional()
        .describe('Project color'),
      icon: z
        .string()
        .optional()
        .describe('Project icon name (folder, briefcase, code, book, etc.)'),
      groupIds: z
        .array(z.string())
        .optional()
        .describe('Group IDs to assign to the project'),
      projects: z
        .array(z.object({
          name: z.string().describe('Project name'),
          color: z.string().optional().describe('Project color'),
          icon: z.string().optional().describe('Project icon'),
          groupIds: z.array(z.string()).optional().describe('Group IDs to auto-assign to this project'),
        }))
        .optional()
        .describe('Batch create: array of projects to create in one call, each with optional groupIds for auto-assignment'),
    }),
  }),

  /**
   * Read or modify Bluetab settings.
   */
  update_settings: tool({
    description:
      'Read or modify Bluetab settings. Can change theme, sort order, pomodoro settings, focus presets, floating button config, and more. Destructive operations (clear history, reset) require confirmation.',
    inputSchema: z.object({
      action: z
        .enum(['read', 'write'])
        .describe('Read current settings or write new values'),
      settings: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Key-value pairs of settings to update. Keys match Settings interface fields (e.g. theme, sortOrder, floatingButtonEnabled). For pomodoro: pomodoroPreset, customWork, customShortBreak, customLongBreak. For focus: focusEnabled, focusPresets. focusCustomDomains replaces the whole list (use it only to remove sites; use block_site to add). Invalid or unknown keys are returned in "rejected".'
        ),
      category: z
        .enum(['general', 'pomodoro', 'focus', 'ai', 'all'])
        .optional()
        .describe('Which settings category to read. Defaults to all.'),
    }),
  }),

  /**
   * Get current Bluetab context data on demand.
   */
  get_context: tool({
    description:
      'Get current Bluetab context data on demand. Returns stats, pomodoro state, focus state, RSS feed summaries, project details, or all of them as one combined snapshot.',
    inputSchema: z.object({
      source: z
        .enum(['stats', 'pomodoro', 'focus', 'rss', 'projects', 'all'])
        .describe('Which context data to retrieve. Use "all" for one combined snapshot of stats, pomodoro, and focus.'),
      statsDays: z
        .number()
        .optional()
        .describe('Number of days for stats aggregation (default 7)'),
    }),
  }),

  /**
   * Manage Bluetab saved groups: edit tabs, merge, split, delete, or move tabs between groups.
   */
  manage_groups: tool({
    description: 'Manage Bluetab saved groups: edit tabs, merge groups, split a group, delete a group, move tabs between groups, reorganize groups, or smart_organize (AI-powered semantic reorganization of ALL groups at once). Only delete requires confirmation.',
    inputSchema: z.object({
      action: z.enum(['edit_tabs', 'merge', 'split', 'delete', 'move_tabs', 'reorganize', 'smart_organize']).describe('Use smart_organize to AI-reorganize ALL groups semantically (handles 100+ groups, 1000+ tabs). Use reorganize for manual bulk moves.'),
      groupId: z.string().optional().describe('Primary group ID (for edit_tabs, split, delete, move_tabs source)'),
      groupIds: z.array(z.string()).optional().describe('Multiple group IDs (for merge)'),
      newName: z.string().optional().describe('New group name (for merge result, split second group)'),
      tabIds: z.array(z.string()).optional().describe('Tab IDs within a Bluetab group (for edit_tabs add/remove, move_tabs)'),
      tabUrls: z.array(z.string()).optional().describe('Tab URLs to add (for edit_tabs add action)'),
      targetGroupId: z.string().optional().describe('Destination group ID (for move_tabs)'),
      splitSize: z.number().optional().describe('Tabs per new group when splitting (default: half)'),
      removeTabIds: z.array(z.string()).optional().describe('Tab IDs to remove (for edit_tabs remove)'),
      // reorganize action fields
      moves: z.array(z.object({
        tabId: z.string().describe('Tab ID to move'),
        fromGroupId: z.string().describe('Source group ID'),
        toGroupId: z.string().describe('Destination group ID'),
      })).optional().describe('Tab moves for reorganize action — move tabs between existing groups'),
      newGroups: z.array(z.object({
        name: z.string().describe('Name for the new group'),
        tabs: z.array(z.object({
          tabId: z.string().describe('Tab ID to move into this new group'),
          fromGroupId: z.string().describe('Source group ID'),
        })).describe('Tabs to move into this new group'),
      })).optional().describe('New groups to create during reorganize — tabs are moved from existing groups'),
      mergeGroupIds: z.array(z.array(z.string())).optional().describe('Groups to merge during reorganize — each inner array is a set of group IDs to merge into one'),
      deleteGroupIds: z.array(z.string()).optional().describe('Empty groups to delete during reorganize'),
    }),
  }),

  /**
   * Create a Flow automation rule that routes matching saved tabs into a group.
   */
  create_flow_rule: tool({
    description:
      'Create a Flow automation rule (Flow is switched on automatically). Flow runs when tabs are saved and routes each matching tab into a Bluetab group. Use when the user says "always put X tabs into Y" or asks for a rule. Prefer domain_contains for sites.',
    inputSchema: z.object({
      name: z.string().describe('Short rule name, e.g. "GitHub to Dev"'),
      conditions: z.array(z.object({
        type: z.enum(['url_contains', 'url_starts_with', 'url_matches_regex', 'domain_equals', 'domain_contains', 'path_contains', 'title_contains', 'title_matches_regex']).describe('Match type'),
        value: z.string().describe('Value to match, e.g. "github.com"'),
        negate: z.boolean().optional().describe('Invert this condition'),
      })).describe('One or more match conditions (max 10)'),
      conditionOperator: z.enum(['AND', 'OR']).optional().describe('How to combine conditions (default AND)'),
      actionType: z.enum(['add_to_or_create', 'create_group', 'add_to_existing_group']).optional().describe('Default add_to_or_create: use the group with groupName or create it'),
      groupName: z.string().describe('Target group name, e.g. "Dev". Always set it (ignored only for add_to_existing_group)'),
      targetGroupId: z.string().optional().describe('Saved group ID, only for add_to_existing_group'),
    }),
  }),

  /**
   * Add sites to the Focus Mode blocklist without replacing existing entries.
   */
  block_site: tool({
    description:
      'Add one or more sites to the Focus Mode blocklist and turn Focus Mode on. Merges with the existing list and never removes entries. Always use this instead of update_settings for blocking sites.',
    inputSchema: z.object({
      domains: z.array(z.string()).describe('Bare domains, e.g. ["youtube.com", "x.com"] (max 50)'),
    }),
  }),

  /**
   * Create, update or delete Brain Dump notes. Delete shows a confirmation card.
   */
  manage_brain_dump: tool({
    description:
      'Create, update or delete Brain Dump notes. create saves a new note (optionally linked to the current tab or a URL; a note for a page that already has one is appended to it). update replaces or appends text. delete removes notes after the user confirms in a card. Use search_brain_dump first to get entry ids for update/delete.',
    inputSchema: z.object({
      action: z.enum(['create', 'update', 'delete']).describe('Operation to perform'),
      text: z.string().optional().describe('Note text (create, update)'),
      attachCurrentTab: z.boolean().optional().describe('create: link the note to the active tab'),
      url: z.string().optional().describe('create: link the note to this http(s) URL instead'),
      urlTitle: z.string().optional().describe('create: title for url'),
      entryId: z.string().optional().describe('update/delete: Brain Dump entry id'),
      entryIds: z.array(z.string()).optional().describe('delete: several entry ids (max 50, one confirmation)'),
      mode: z.enum(['replace', 'append']).optional().describe('update: replace the text (default) or append to it'),
    }),
  }),

  /**
   * Create, list or delete reminders.
   */
  set_reminder: tool({
    description:
      'Create, list or delete reminders. A reminder shows a notification at the given time and can reopen a saved group, the tabs of a Brain Dump note, URLs or the current tab; with only a title it is a plain notification. Use inMinutes for relative times ("in 2 hours") and at (local ISO date-time, e.g. 2026-10-01T09:00) for clock times; compute it from the current local time in CURRENT STATE.',
    inputSchema: z.object({
      action: z.enum(['create', 'list', 'delete']).optional().describe('Default create'),
      title: z.string().optional().describe('Short reminder text shown in the notification'),
      inMinutes: z.number().optional().describe('Minutes from now'),
      at: z.string().optional().describe('Local ISO date-time without offset, e.g. 2026-10-01T09:00'),
      groupId: z.string().optional().describe('Saved group to reopen'),
      entryId: z.string().optional().describe('Brain Dump note to remind about'),
      urls: z.array(z.string()).optional().describe('http(s) URLs to reopen'),
      attachCurrentTab: z.boolean().optional().describe('Reopen the active tab'),
      recurring: z.enum(['daily', 'weekly', 'weekdays']).optional().describe('Repeat the reminder'),
      reminderId: z.string().optional().describe('delete: reminder id from list'),
    }),
  }),
} as const;

// ============================================================================
// Exports
// ============================================================================

/**
 * Tools that are always confirmation-gated regardless of arguments.
 * Action-specific confirmation (for example manage_groups delete) is handled in the UI layer.
 */
export const DESTRUCTIVE_TOOLS: AIToolName[] = [
  'delete_tabs',
  'manage_projects',
];

/**
 * Loading message shown in the AI chat UI while a tool is executing.
 * Consumed by the loading overlay in Plan 03.
 */
export const TOOL_LOADING_MESSAGES: Record<string, string> = {
  search_tabs: 'Searching your tabs...',
  group_tabs: 'Grouping your tabs...',
  save_tabs: 'Saving to Bluetab...',
  archive_group: 'Archiving groups...',
  delete_tabs: 'Closing tabs...',
  manage_projects: 'Managing projects...',
  manage_groups: 'Organizing groups...',
  update_settings: 'Updating settings...',
  get_context: 'Fetching data...',
  web_search: 'Searching the web...',
  open_tabs: 'Opening tabs...',
  rename_group: 'Renaming group...',
  search_bluetab: 'Searching Bluetab...',
  search_brain_dump: 'Searching Brain Dump...',
  search_rss: 'Searching articles...',
  create_flow_rule: 'Creating Flow rule...',
  block_site: 'Updating blocklist...',
  manage_brain_dump: 'Updating Brain Dump...',
  set_reminder: 'Setting reminder...',
};

export type AITools = typeof aiTools;

/**
 * Convert all tool definitions to AI SDK tools format (object keyed by name).
 * Sent in the request body so Supertry can forward to streamText({ tools }).
 * Uses Zod v4's built-in toJSONSchema for schema conversion.
 */
/**
 * Recursively strip JSON Schema fields that OpenAI doesn't support.
 * OpenAI function calling only supports: type, properties, required, enum, description, items.
 */
function cleanSchemaForOpenAI(obj: Record<string, unknown>): Record<string, unknown> {
  const ALLOWED_KEYS = new Set(['type', 'properties', 'required', 'enum', 'description', 'items']);
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (!ALLOWED_KEYS.has(key)) continue;

    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
        if (pv && typeof pv === 'object') {
          props[pk] = cleanSchemaForOpenAI(pv as Record<string, unknown>);
        } else {
          props[pk] = pv;
        }
      }
      cleaned[key] = props;
    } else if (key === 'items' && value && typeof value === 'object') {
      cleaned[key] = cleanSchemaForOpenAI(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

type ToolBodySchema = Record<string, { description: string; parameters: Record<string, unknown> }>;
/** The schemas never change at runtime; build them once instead of on every request. */
let cachedToolsForBody: ToolBodySchema | null = null;

export function getToolsForBody(): ToolBodySchema {
  if (cachedToolsForBody) return cachedToolsForBody;
  const result: ToolBodySchema = {};
  for (const [name, t] of Object.entries(aiTools)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawSchema = z.toJSONSchema(t.inputSchema as any) as Record<string, unknown>;
    const schema = cleanSchemaForOpenAI(rawSchema);
    // Ensure type: "object" is always present at root
    if (!schema['type']) schema['type'] = 'object';
    result[name] = {
      description: t.description ?? '',
      parameters: schema,
    };
  }
  cachedToolsForBody = result;
  return result;
}
