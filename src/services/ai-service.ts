/**
 * @module services/ai-service
 *
 * WHY:  The AI assistant needs tab context from the user's current session
 *       and persistent conversation history, but sending all 500+ tabs to the
 *       LLM would exceed token limits and expose irrelevant data.
 *
 * WHAT: Core AI service providing:
 *       - Context pruning: reduces 500+ tabs to ~50 most relevant ones
 *       - History management: persists conversation ring buffer (50 entries)
 *       - Settings CRUD: stores/retrieves user AI preferences
 *       - Stale ID validation: verifies tab IDs against live chrome.tabs.query
 *       - System prompt builder: constructs LLM system message
 *
 * HOW:  Uses chrome.tabs.query for live tab data, Storage class for persistence,
 *       and RingBuffer for bounded history. Two-stage pruning: domain frequency
 *       scoring + keyword relevance scoring from user message.
 *
 * NOT:  Does not handle streaming, UI rendering, or direct LLM API calls.
 *       Does not modify tabs — only reads and validates.
 */

import { Storage } from '../utils/storage';
import { RingBuffer } from '../utils/ring-buffer';
import { config } from '../config/config';
import { getToolsForBody } from '../utils/ai-tools';
import { getAccessToken } from '../utils/auth-state';
import { AIAllowanceService } from './ai-allowance-service';
import { canAccessFeature } from '../utils/feature-gate';
import { buildAIIntegrationTools } from './ai-integration-tools';
import type { AIHistoryEntry, AISettings } from '../types/ai';
import { DEFAULT_AI_SETTINGS } from '../types/ai';

const LOG_PREFIX = '[BlueTab][AIService]';

/** Group naming waits this long for the server before keeping the default name. */
const NAME_GROUP_TIMEOUT_MS = 15_000;
const LEGACY_AI_HISTORY_KEY = 'ai_history';
const THREADS_KEY = 'ai_chat_threads';
const ACTIVE_THREAD_KEY = 'ai_active_thread';

// ============================================================================
// Local Types
// ============================================================================

/**
 * Minimal tab summary sent to LLM — strips sensitive browser metadata.
 */
export interface TabSummary {
  id: number;
  title: string;
  url: string;
}

/**
 * Group summary for LLM context — shows group structure without full content.
 */
export interface GroupSummary {
  id: string;
  name: string;
  tabCount: number;
  /** Last change time, used to list the most recently used groups first. */
  modified?: number;
}

/** Connected-app actions (ai-integration-tools) are offered to the chat. */
export const INTEGRATION_TOOLS_IN_CHAT = true;

/** Saved groups listed by name in the system prompt; the rest via search_bluetab. */
export const PROMPT_GROUP_LIMIT = 20;

/**
 * Pruned context passed to the LLM — always ≤ maxTabsInContext entries.
 */
export interface TabContext {
  tabs: TabSummary[];
  groupSummary: GroupSummary[];
  totalTabCount: number;
}

// ============================================================================
// Internal helpers

/** "2026-10-01 09:05 (Thursday), time zone Europe/Istanbul (UTC+03:00)" for reminder math. */
export function formatLocalNow(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const offset = `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    zone = '';
  }
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${date} ${time} (${weekday}), time zone ${zone ? `${zone} ` : ''}(${offset})`;
}
// ============================================================================

/**
 * Extract keywords from a user message for intent-based tab scoring.
 * Splits on non-word characters, filters short/common words.
 */
function extractKeywords(message: string): string[] {
  if (!message || message.trim().length === 0) return [];
  return message
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 3);
}

/**
 * Extract the hostname from a URL string, returning empty string on error.
 */
function extractHostname(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ============================================================================
// AIService
// ============================================================================

const historyBuffer = new RingBuffer<AIHistoryEntry>(50);

export class AIService {
  /**
   * Build pruned tab context for an LLM prompt.
   *
   * Two-stage pruning:
   * 1. Query all current-window tabs, build domain frequency map
   * 2. Score each tab by keyword relevance to userMessage
   * Returns top maxTabsInContext (50) tabs sorted by score.
   *
   * @param userMessage - The user's latest input (used for keyword extraction)
   * @returns Pruned context with tabs, group summaries, and total count
   */
  static async buildContext(userMessage: string): Promise<TabContext> {
    // Stage 1: Gather raw data
    const allTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
      chrome.tabs.query({ currentWindow: true }, resolve);
    });

    const storedGroups = (await Storage.get<Record<string, unknown>[]>('groups')) ?? [];

    // Build domain frequency map (higher frequency = more "relevant" domain)
    const domainFrequency: Map<string, number> = new Map();
    for (const tab of allTabs) {
      const hostname = extractHostname(tab.url);
      if (hostname) {
        domainFrequency.set(hostname, (domainFrequency.get(hostname) ?? 0) + 1);
      }
    }

    // Stage 2: Keyword-based scoring
    const keywords = extractKeywords(userMessage);

    const scored = allTabs.map((tab) => {
      let score = 0;
      const titleLower = (tab.title ?? '').toLowerCase();
      const urlLower = (tab.url ?? '').toLowerCase();
      const hostname = extractHostname(tab.url);

      if (keywords.length > 0) {
        for (const kw of keywords) {
          if (titleLower.includes(kw)) score += 2;
          if (urlLower.includes(kw)) score += 1;
        }
      }

      // Boost for high-frequency domains (present in 2+ tabs)
      const freq = domainFrequency.get(hostname) ?? 0;
      if (freq >= 2) score += 0.5;

      return { tab, score };
    });

    // Sort by score descending, take top maxTabsInContext
    scored.sort((a, b) => b.score - a.score);
    const topTabs = scored
      .slice(0, config.ai.maxTabsInContext)
      .map(({ tab }): TabSummary => ({
        id: tab.id ?? 0,
        title: tab.title ?? '',
        url: tab.url ?? '',
      }));

    // Build group summaries from stored groups
    const groupSummary: GroupSummary[] = (storedGroups as Array<{
      id: string;
      name: string;
      tabs?: unknown[];
      modified?: number;
      created?: number;
    }>).map((g) => ({
      id: g.id,
      name: g.name,
      tabCount: Array.isArray(g.tabs) ? g.tabs.length : 0,
      modified: Math.max(g.modified ?? 0, g.created ?? 0),
    }));

    // Counts only; the user's words stay out of the console.
    console.log(`${LOG_PREFIX} buildContext: ${allTabs.length} total tabs → ${topTabs.length} pruned`);

    return {
      tabs: topTabs,
      groupSummary,
      totalTabCount: allTabs.length,
    };
  }

  /**
   * Validate tab IDs against live chrome.tabs.query.
   *
   * Partitions provided IDs into valid (exist in live browser) and stale
   * (no longer present). Returns live tab summaries for error recovery.
   *
   * @param tabIds - Tab IDs to validate (from LLM tool call)
   * @returns Valid IDs, stale IDs, and current live tab summaries
   */
  static async validateTabIds(
    tabIds: number[]
  ): Promise<{ valid: number[]; stale: number[]; liveTabs: TabSummary[] }> {
    const liveTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
      chrome.tabs.query({ currentWindow: true }, resolve);
    });

    const liveIdSet = new Set(liveTabs.map((t) => t.id ?? -1));
    const valid: number[] = [];
    const stale: number[] = [];

    for (const id of tabIds) {
      if (liveIdSet.has(id)) {
        valid.push(id);
      } else {
        stale.push(id);
      }
    }

    const liveSummaries: TabSummary[] = liveTabs.map((t) => ({
      id: t.id ?? 0,
      title: t.title ?? '',
      url: t.url ?? '',
    }));

    if (stale.length > 0) {
      console.warn(`${LOG_PREFIX} validateTabIds: ${stale.length} stale IDs detected:`, stale);
    }

    return { valid, stale, liveTabs: liveSummaries };
  }

  /**
   * Persist a conversation history entry.
   *
   * Uses RingBuffer(50) to prevent unbounded storage growth.
   *
   * @param entry - The history entry to save
   */
  static async saveHistoryEntry(entry: AIHistoryEntry): Promise<void> {
    const existing = (await Storage.get<AIHistoryEntry[]>(LEGACY_AI_HISTORY_KEY)) ?? [];
    const updated = historyBuffer.push(existing, entry);
    await Storage.set(LEGACY_AI_HISTORY_KEY, updated);
  }

  /**
   * Load all conversation history entries.
   *
   * @returns Array of history entries (empty if none stored)
   */
  static async getHistory(): Promise<AIHistoryEntry[]> {
    return (await Storage.get<AIHistoryEntry[]>(LEGACY_AI_HISTORY_KEY)) ?? [];
  }

  /**
   * Clear all conversation history.
   */
  static async clearHistory(): Promise<void> {
    await Storage.remove(LEGACY_AI_HISTORY_KEY);
    await Storage.remove(THREADS_KEY);
    await Storage.remove(ACTIVE_THREAD_KEY);
  }

  /**
   * Load AI settings, merging stored values with defaults.
   *
   * @returns Merged AI settings (defaults for any missing fields)
   */
  static async getSettings(): Promise<AISettings> {
    const stored = (await Storage.get<Partial<AISettings>>('ai_settings')) ?? {};
    return { ...DEFAULT_AI_SETTINGS, ...stored };
  }

  /**
   * Persist AI settings.
   *
   * @param settings - Full settings object to save
   */
  static async saveSettings(settings: AISettings): Promise<void> {
    await Storage.set('ai_settings', settings);
  }

  /**
   * Suggest an AI-generated name for a group of tabs.
   *
   * Calls the Supertry naming endpoint with the tab titles and URLs, returning
   * the suggested name string, or null on any failure (timeout, network error,
   * disabled setting, single-tab group).
   *
   * Never throws — always returns string | null.
   *
   * @param tabs - Array of tab summaries (title + url)
   * @returns Suggested name string, or null if unavailable
   */
  static async suggestGroupName(
    tabs: { title: string; url: string }[]
  ): Promise<string | null> {
    // Single-tab groups skip AI naming
    if (tabs.length < 2) return null;

    // Naming follows the saved preference and Pro access, independently of the notice.
    try {
      const settings = await AIService.getSettings();
      if (!settings.smartNaming) return null;
      if (!(await canAccessFeature('ai_commands')).allowed) return null;
    } catch {
      return null;
    }

    const token = await getAccessToken();

    try {
      const response = await fetch(
        config.supertry.apiUrl + config.ai.nameGroupEndpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ tabs: tabs.slice(0, 10) }),
          // The naming model thinks before it answers; 5 s cut off names the
          // server had already produced, leaving the group untitled.
          signal: AbortSignal.timeout(NAME_GROUP_TIMEOUT_MS),
        }
      );
      await AIAllowanceService.syncFromAIResponse(response);
      if (!response.ok) {
        console.warn(`${LOG_PREFIX} suggestGroupName: HTTP ${response.status}`);
        return null;
      }
      const data = await response.json() as { name: string };
      return data.name ?? null;
    } catch (err) {
      // warn, not log: store builds strip console.log.
      console.warn(`${LOG_PREFIX} suggestGroupName: no name`, err);
      return null;
    }
  }

  /**
   * Search using three-tier fallthrough: Bluetab groups → RSS articles → web search.
   *
   * Tier 1 (Bluetab): Searches saved groups. If >= 3 matches found, returns immediately.
   * Tier 2 (RSS): Searches stored RSS articles if available. If >= 3 matches, returns.
   * Tier 3 (Web): Calls the Supertry search endpoint. Returns results or empty array on failure.
   *
   * @param query - Search query string
   * @returns Object with tier name and array of results
   */
  static async searchTiered(
    query: string
  ): Promise<{
    tier: 'bluetab' | 'rss' | 'web';
    results: { title: string; url: string; snippet?: string }[];
  }> {
    const queryLower = query.toLowerCase();

    // --- Tier 1: Bluetab saved groups ---
    try {
      const groups = (await Storage.get<Array<{
        id: string;
        name: string;
        tabs?: Array<{ title: string; url: string }>;
      }>>('groups')) ?? [];

      const bluetabMatches: { title: string; url: string }[] = [];
      for (const group of groups) {
        for (const tab of group.tabs ?? []) {
          if (
            tab.title.toLowerCase().includes(queryLower) ||
            tab.url.toLowerCase().includes(queryLower)
          ) {
            bluetabMatches.push({ title: tab.title, url: tab.url });
          }
        }
      }

      if (bluetabMatches.length >= 3) {
        return { tier: 'bluetab', results: bluetabMatches };
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} searchTiered: Bluetab tier failed`, err);
    }

    // --- Tier 2: RSS articles ---
    try {
      const rssArticles = await Storage.get<Record<string, Array<{
        title: string;
        link: string;
        description?: string;
      }>>>('rssArticles');

      if (rssArticles) {
        const rssMatches: { title: string; url: string; snippet?: string }[] = [];
        for (const feedArticles of Object.values(rssArticles)) {
          for (const article of feedArticles) {
            if (
              article.title.toLowerCase().includes(queryLower) ||
              (article.description ?? '').toLowerCase().includes(queryLower)
            ) {
              rssMatches.push({
                title: article.title,
                url: article.link,
                snippet: article.description,
              });
            }
          }
        }

        if (rssMatches.length >= 3) {
          return { tier: 'rss', results: rssMatches };
        }
      } else {
        console.debug(`${LOG_PREFIX} RSS not available, skipping tier 2`);
      }
    } catch (err) {
      console.debug(`${LOG_PREFIX} searchTiered: RSS tier skipped`, err);
    }

    // --- Tier 3: Web search ---
    const token = await getAccessToken();
    try {
      const response = await fetch(
        config.supertry.apiUrl + config.ai.searchEndpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ query }),
        }
      );
      const data = await response.json() as {
        results: { title: string; url: string; snippet?: string }[];
      };
      return { tier: 'web', results: data.results ?? [] };
    } catch (err) {
      console.log(`${LOG_PREFIX} searchTiered: web search failed`, err);
      return { tier: 'web', results: [] };
    }
  }

  /**
   * Build the system prompt for the LLM.
   *
   * Includes: AI identity, available tools, current tab/group summary,
   * user Pro status, and strict constraints (never fabricate IDs).
   *
   * @param context - Pruned tab context from buildContext()
   * @param isPro - Whether the user has a Pro subscription
   * @returns System prompt string
   */
  static buildSystemPrompt(context: TabContext, isPro: boolean, now: Date = new Date()): string {
    const tabSummaryText =
      context.tabs.length > 0
        ? context.tabs
            .slice(0, 10)
            .map((t) => `- [${t.id}] ${t.title} (${t.url})`)
            .join('\n') +
          (context.tabs.length > 10
            ? `\n... and ${context.tabs.length - 10} more tabs`
            : '')
        : '(no open tabs)';

    // Most recently changed groups first, capped; the model is told how to
    // reach the rest so "show all my groups" still works.
    const listedGroups = [...context.groupSummary]
      .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))
      .slice(0, PROMPT_GROUP_LIMIT);
    const hiddenGroupCount = context.groupSummary.length - listedGroups.length;
    const groupSummaryText =
      context.groupSummary.length > 0
        ? listedGroups
            .map((g) => `- "${g.name}" (${g.tabCount} tabs)`)
            .join('\n') +
          (hiddenGroupCount > 0
            ? `\n... and ${hiddenGroupCount} more saved groups. When the user asks about all groups or one not listed here, call search_bluetab (empty query lists every group).`
            : '')
        : '(no saved groups)';

    const proStatus = isPro
      ? 'User has Pro subscription — all features available.'
      : 'User is on free plan — AI features are for demonstration only.';

    // Static instructions first, live state last: providers cache identical
    // prompt prefixes, so the long rules block is reused across requests.
    return `You are Bluetab AI — a concise tab management assistant. Be brief. Save tokens.

DOMAIN KNOWLEDGE -- Bluetab concepts:
- "Saved groups" = tab groups the user saved to Bluetab. These are NOT archived. They are active saved collections.
- "Brain Dump" = a local inbox of captured thoughts/notes, sometimes with a linked tab URL/title. Use search_brain_dump to search it. Use action="get" when you need one entry's full text. For "what's in Brain Dump overall?" requests, call search_brain_dump with an empty query so you get the newest 20 entries and the true total count.
- "Save" = save open browser tabs to Bluetab groups and close them. Use save_tabs tool.
- save_tabs mode="auto_organize" = Bluetab may route tabs through memory, Flow, browser groups, and domain grouping.
- save_tabs mode="preserve_set" = keep the exact provided tabs together in one saved bundle with the provided groupName. Use this for research/result sets the user wants kept together.
- "Archive" = move tabs to long-term archive storage. archive_group can accept a saved groupId OR tabIds of open browser tabs to archive directly. No intermediate step needed.
- "Open tabs" = currently open browser tabs. Different from saved groups.
- When the user asks to save tabs, use save_tabs.
- When the user asks to archive tabs or groups, use archive_group.

TOOL DOMAINS:
BROWSER tools (operate on live Chrome tabs -- use numeric browser tab IDs):
  search_tabs, group_tabs, delete_tabs, open_tabs

BLUETAB tools (operate on saved Bluetab storage -- use string group/tab IDs):
  save_tabs, archive_group, rename_group, search_bluetab, search_brain_dump, manage_brain_dump, set_reminder, manage_projects, manage_groups, update_settings, get_context, create_flow_rule, block_site

SEARCH tools:
search_rss (read-only), web_search (opens browser tabs for the selected research set)

RULES (MANDATORY — follow exactly, no exceptions):
1. NEVER fabricate or invent data. ALWAYS report EXACTLY what the tool result says — check the actual numbers and fields in the JSON response. If a tool returns unassignedCount > 0 or unassignedGroups with items, you MUST report them. Do NOT say "all done" or "everything assigned" unless the tool result explicitly confirms zero unassigned. When asked about counts/status, ALWAYS call a tool to verify — never answer from memory.
2. Confirmation-gated actions (delete_tabs, manage_projects delete, manage_groups delete, manage_brain_dump delete) show a confirmation card automatically. NEVER ask "are you sure?" in text — just call the tool directly. The confirmation UI handles user consent.
3. Respond in the user's language.
4. Plain text only. No markdown headers, bold, or emoji. Use lists only when listing items.
5. Be extremely concise — one sentence when possible.
6. NEVER ask clarifying questions for simple requests. "Create project X" → create it immediately with name "X". Do NOT ask for a different name, do NOT translate the name. USE THE EXACT NAME THE USER GAVE.
7. ALWAYS call tools to execute actions. NEVER respond with text when a tool call is needed. No hesitation, no questions.
8. MULTI-STEP TOOL CHAINS: You can call multiple tools in sequence. After creating a project, you MUST check unassignedGroups in the result. If ANY group is semantically related, make a SECOND tool call: manage_projects assign. Do NOT just say "assigned" in text — CALL THE TOOL. You have NOT assigned a group unless you called manage_projects with action=assign. Text is not action.
9. When no matching open tabs found, check saved groups before saying "not found".
10. For manage_projects create: pick icon and color based on name. Never ask the user to choose.
11. Chain related actions automatically. After creating a project → assign matching groups. After changing a setting → confirm in one sentence.
12. For group_tabs: ALWAYS provide descriptive groupName for each group (e.g. "YouTube", "GitHub", "Google Docs"). NEVER leave groupName empty. Use the batch format with the groups array — put ALL groups in a single call.
13. For BULK operations ("group all tabs", "archive all X tabs"): first call search_tabs with empty query to get the COMPLETE tab list. The context only has a sample. Then categorize ALL returned tabs and execute in ONE batch call. Do NOT skip any tabs. group_tabs supports batch groups. For archive operations, use archive_group with tabIds for direct archive from open tabs.
14. BATCH HANDLING: For large-scale operations (many groups/tabs), maximize parameters per tool call. Use arrays (groupIds, tabIds) to handle as many items as possible in each call. Chain tool calls automatically without asking for confirmation between batches. Handle ALL items — never stop partway and ask if user wants to continue.
15. RESEARCH + SAVE: When you use web_search and then the user wants those results saved together, use the returned openedTabIds in a FOLLOW-UP save_tabs call with mode="preserve_set" and a meaningful groupName. Do NOT re-search tabs by guesswork and do NOT switch to auto_organize for this case.
16. SMART ORGANIZE vs PROJECT MANAGEMENT — IMPORTANT DISTINCTION:
- smart_organize: ONLY when user EXPLICITLY asks to reorganize/categorize/sort GROUPS. Never as a fallback or retry.
- manage_projects create/assign: For creating and managing PROJECTS. Use when user asks to create projects, assign groups to projects, or manage project structure.
- NEVER use smart_organize when the user asks about projects, assignment, or retry. smart_organize reorganizes GROUPS, not projects.
- For "create projects for unassigned groups": use manage_projects create (batch: pass projects array with groupIds) in ONE call.
17. RETRY/REPEAT: When the user says "try again", "retry", "repeat", "once more", or similar — repeat the EXACT SAME action you last performed. Do NOT switch to a different tool or action. Look at your last tool call in the conversation and re-execute it.
18. NO PRETEND ACTIONS: Say something was saved, added, changed, deleted, blocked or scheduled ONLY when a tool call in this conversation returned status "success" for exactly that. If the result is error, not_found, exists or cancelled, say plainly that it did not happen and why. If no tool can do what the user asks, say you cannot do that yet and offer the closest thing you can do. Never describe an action you did not call a tool for.
19. BRAIN DUMP WRITES: "add to my dump", "note this", "jot down", "save this thought" -> manage_brain_dump create (attachCurrentTab=true when it is about the page the user is on). To edit or delete a note, call search_brain_dump first to get its id. If the result says merged=true, tell the user the text was added to the existing note for that page.
20. REMINDERS: "remind me", "hatirlat", "alarm" -> set_reminder. Work out clock times from the current local time in CURRENT STATE and pass at as local time without an offset; use inMinutes for relative times. The result's fireAt is already local time with its UTC offset (e.g. 2026-10-01T09:00+03:00); repeat that date and time to the user in their language.
21. TOOL ERRORS: If a tool returns status "error", read its message, fix the arguments and call it ONE more time. If it fails again, stop calling tools and tell the user the error in one sentence. Never call the same tool with the same arguments twice.

22. CONNECTED APPS: Tools named <app>__<action> (e.g. outlook_calendar__create_event, linear__create_issue) act in apps the user connected. When the user asks for something in one of those apps, call that tool. If there is no tool for the app or action they named, say so in one sentence; NEVER do a different action instead (do not turn a calendar event into a reminder) unless the user agrees. Calendar times are local date-times without an offset, worked out from CURRENT STATE. Bluetab may show a confirmation card; do not ask for confirmation in text. If one of these tools returns status "error", do NOT call it again in this turn (the user already confirmed it once and the error comes from the app or the connection); tell the user its message in one sentence.

NEW TOOLS — Phase 5.1/5.2:

manage_projects:
- create: single or BATCH. For single: pass name, color, icon. For batch: pass projects array [{name, color?, icon?, groupIds?}]. ALWAYS use batch when creating multiple projects — ONE tool call creates all projects and assigns groups. Pick icon and color based on name. Available colors: red, orange, yellow, green, blue, purple, pink. Available icons: folder, briefcase, code, book, shopping-cart, plane, gamepad, heart, star, music, graduation-cap, home, globe, camera, coffee, film, gift, lightbulb, palette, settings.
- list: returns all projects with their group counts
- update: change name, color, or icon
- delete: DESTRUCTIVE — requires confirmation. Pass projectId for single or projectIds array for batch delete. ALWAYS use batch (projectIds) when deleting multiple projects — ONE tool call, ONE confirmation card.
- assign: assign one or more groups to a project by groupId. If user doesn't specify a project, infer the best match from existing projects based on group content.

manage_groups:
- edit_tabs: add or remove individual tabs from a saved Bluetab group
- merge: combine two or more groups into one (URL deduplication automatic)
- split: divide a group into multiple groups (optional splitSize, default half)
- delete: DESTRUCTIVE -- permanently remove a group (requires confirmation)
- move_tabs: move specific tabs from one group to another
- reorganize: manual bulk moves/merges/deletes in one atomic call (for small-scale operations)
- smart_organize: AI-POWERED semantic reorganization of ALL groups. No parameters needed — just call with action=smart_organize. The system reads all groups, sends them to AI for semantic categorization, and atomically reorganizes everything. Handles 100+ groups and 1000+ tabs. Use this when the user asks to "organize my groups", "clean up my tabs", or any large-scale reorganization request.

update_settings:
- read: returns current settings for the requested category (general, pomodoro, focus, ai, or all)
- write: applies key-value changes immediately. Non-destructive changes need no confirmation.
- For theme: valid values are 'light', 'dark', 'system'
- For pomodoro: use pomodoroPreset, customWork, customShortBreak, customLongBreak keys
- For focus: use focusEnabled and focusPresets (socialMedia/newsMedia/entertainment/shopping booleans). Do NOT write focusCustomDomains to block a site; it replaces the whole list. Use block_site instead.

create_flow_rule: creates a Flow automation rule ("always put GitHub tabs into Dev") and turns Flow on if needed. Flow runs when tabs are saved. Use domain_contains for sites, add_to_or_create with groupName by default.
manage_brain_dump: create, update (replace or append) and delete Brain Dump notes. delete accepts entryIds for several notes and shows one confirmation card.
set_reminder: create (for a saved group, a Brain Dump note, urls, the current tab, or just a title), list, and delete reminders. recurring can be daily, weekly or weekdays.
block_site: adds domains to the Focus Mode blocklist without removing existing ones ("block youtube.com") and turns Focus Mode on. Pass bare domains. Only mention something extra if the result note says site access is missing.

get_context:
- stats: returns aggregate tab statistics for the requested period (default 7 days)
- pomodoro: returns current timer state (active, paused, session type, time remaining)
- focus: returns focus mode state and settings (active, blocked domains)
- rss: returns feed list with unread counts
- projects: returns all projects with assigned group names
- all: returns one combined snapshot of stats, pomodoro, and focus for quick status checks

save_tabs: saves open browser tabs to Bluetab groups. Use auto_organize for normal cleanup; use preserve_set to keep one explicit set together without repartitioning. Report results after -- do not ask how to organize.
search_brain_dump: searches the local Brain Dump inbox. Use action="search" first for compact snippets. If one result looks relevant and you need the full note body, call it again with action="get" and entryId.
web_search: searches the web and opens the selected results as browser tabs. Returns openedTabIds for exact follow-up actions. Use freshness=month for "latest/current" style queries unless the user asks for a tighter window.
archive_group: archives to long-term storage. Pass groupId for saved groups, OR tabIds for open browser tabs (direct archive, no intermediate save step).

CURRENT STATE (live, refreshed every request):
${proStatus}
Current local time: ${formatLocalNow(now)}

CONTEXT: ${context.totalTabCount} open tabs, ${context.groupSummary.length} saved groups.
Open tabs (sample):
${tabSummaryText}

Saved groups (most recent first):
${groupSummaryText}`.trim();
  }

  static async buildToolSchemaForTurn(): Promise<
    Record<string, { description: string; parameters: Record<string, unknown> }>
  > {
    const baseTools = getToolsForBody();

    if (!INTEGRATION_TOOLS_IN_CHAT) return baseTools;

    // Curated connected-app actions with provider-safe names
    // (`outlook_calendar__create_event`) and real schemas; useAIChat runs them
    // after the user confirms. try-catch: integration unavailability MUST NOT
    // break core AI chat.
    try {
      const integrationTools = await buildAIIntegrationTools();
      const integrationSchema: Record<string, { description: string; parameters: Record<string, unknown> }> = {};
      for (const tool of integrationTools) {
        integrationSchema[tool.name] = {
          description: tool.description,
          parameters: tool.parameters,
        };
      }
      return { ...baseTools, ...integrationSchema };
    } catch {
      // Integration service unavailable — return base tools only
      return baseTools;
    }
  }
}
