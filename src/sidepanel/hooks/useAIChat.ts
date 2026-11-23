import { matchesSearch, normalizeForSearch } from '@/utils/search-text';
/**
 * @module sidepanel/hooks/useAIChat
 *
 * WHY:  Wires the Vercel AI SDK useChat hook with Chrome extension APIs,
 *       Supertry proxy transport, auth injection, and all 12 tool call
 *       handlers including Phase 5.1 project/settings/context tools.
 *
 * WHAT: Core AI chat hook providing:
 *       - DefaultChatTransport pointing at the Supertry AI proxy endpoint
 *       - Per-request auth token injection from chrome.storage.local
 *       - System prompt and tab context injection before each message
 *       - All AI tool call handlers (search, group, archive, delete, open,
 *         rename, saved-group search, brain-dump search, RSS search, web search,
 *         manage_projects, update_settings, get_context)
 *       - Pending confirmation state for destructive tools (archive/delete/
 *         project-delete)
 *       - Auto-cancel pending confirmation when a new message is sent
 *
 * HOW:  Uses useChat from @ai-sdk/react with DefaultChatTransport from ai.
 *       Tool execution in onToolCall. Destructive tools pause and wait for
 *       user confirmation via a Promise + React state pattern.
 *
 * NOT:  Does not render UI. Does not handle streaming protocol parsing.
 *       Does not handle payment — that is feature-gate.ts.
 */

import { createBrowserTabGroup } from '@/platform/create-browser-tab-group';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import type { UIMessage } from 'ai';
import { AIService } from '@/services/ai-service';
import { isAIIntegrationToolName } from '@/services/ai-integration-tools';
import { BrainDumpService } from '@/services/brain-dump-service';
import { AIGroupOrganizerService } from '@/services/ai-group-organizer';
import { getToolsForBody } from '@/utils/ai-tools';
import { isChatOnlyTurn } from '@/utils/ai-model-routing';
import { shapeHistoryForRequest } from '@/utils/ai-history-window';
import { decideToolLoop, previousToolError, type ToolLoopStop } from '@/utils/ai-tool-loop';
import { toRuntimeMessages, toStoredMessages } from '@/utils/ai-chat-storage';
import { planSettingsWrite } from '@/utils/ai-settings-write';
import { t as translate } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { Storage } from '@/utils/storage';
import { GroupMemoryStorageService } from '@/utils/group-memory-storage';
import { saveTabsToBlueTab } from '@/services/saved-tab-actions';
import { getAccessToken, getAuthState } from '@/utils/auth-state';
import { normalizeFocusSettings } from '@/config/focus-presets';
import { config } from '@/config/config';
import { AIAllowanceService } from '@/services/ai-allowance-service';
import type { AIConfirmationState, AIToolName } from '@/types/ai';
import type { TabGroup, Project, ProjectColor, ProjectIcon } from '@/types/models';
import type { PomodoroSettings, PomodoroState, FocusState, FocusSettings } from '@/types/productivity';
import type { ChatInit } from 'ai';
import { inferSearchFreshness, openSearchResults, sortSearchResults, type WebSearchFreshness } from '../ai-web-search';

// ============================================================================
// Return type
// ============================================================================

// ============================================================================
// Chat thread storage
// ============================================================================

interface ChatThread {
  id: string;
  title: string;
  messages: UIMessage[];
  created: number;
  modified: number;
}

const THREADS_KEY = 'ai_chat_threads';
const ACTIVE_THREAD_KEY = 'ai_active_thread';
const MAX_THREADS = 20;
/** currentToolName value while the model writes its reply after a tool ran. */
export const AI_REPLY_PHASE = '__reply__';
/** Wait for back-to-back tool round-trips to finish before reading the allowance. */
const ALLOWANCE_REFRESH_DEBOUNCE_MS = 1500;

function createFreshThread(now: number = Date.now()): ChatThread {
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    messages: [],
    created: now,
    modified: now,
  };
}

/**
 * Return type of useAIChat hook.
 */
export interface UseAIChatReturn {
  messages: UIMessage[];
  sendMessage: (text: string) => Promise<void>;
  isLoading: boolean;
  error: Error | undefined;
  pendingConfirmation: AIConfirmationState | null;
  /** alwaysAllowIntegrations: also stop asking for connected-app actions. */
  confirmAction: (options?: { alwaysAllowIntegrations?: boolean }) => void;
  cancelAction: () => void;
  /** Raw useChat helpers needed for useChatRuntime (assistant-ui bridge) */
  chat: ReturnType<typeof useChat>;
  /** Currently executing tool name — null when no tool is running */
  currentToolName: string | null;
  /** Why the automatic tool loop stopped this turn (with the tool's error), if it did. */
  toolLoopStopped: ToolLoopStop | null;
  /** Multi-thread support */
  threads: ChatThread[];
  activeThreadId: string;
  newChat: () => Promise<void>;
  switchThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
}

// ============================================================================
// Helpers
// ============================================================================

/** Narrow toolCall args to a typed record safely.
 *  AI SDK v6 uses `input` (not `args`) for tool call parameters. */
function getArgs(toolCall: unknown): Record<string, unknown> {
  if (toolCall && typeof toolCall === 'object') {
    // AI SDK v6 uses "input", older versions used "args"
    const obj = toolCall as Record<string, unknown>;
    const data = obj.input ?? obj.args;
    if (data && typeof data === 'object') {
      return data as Record<string, unknown>;
    }
  }
  return {};
}

/** Narrow toolCall toolCallId */
function getToolCallId(toolCall: unknown): string {
  if (toolCall && typeof toolCall === 'object' && 'toolCallId' in toolCall) {
    return String((toolCall as { toolCallId: unknown }).toolCallId ?? Date.now());
  }
  return String(Date.now());
}

/**
 * Pick a project color based on the project name.
 * Falls back to 'blue' when no keyword matches.
 */
function pickProjectColor(name: string): ProjectColor {
  const n = name.toLowerCase();
  if (/code|dev|program|tech|api|git/.test(n)) return 'blue';
  if (/work|biz|meeting|office|career/.test(n)) return 'purple';
  if (/shop|buy|store|amazon|deal/.test(n)) return 'orange';
  if (/learn|study|course|edu|school/.test(n)) return 'green';
  if (/game|play|fun|entertainment/.test(n)) return 'red';
  if (/travel|trip|holiday|vacation/.test(n)) return 'yellow';
  if (/health|fit|sport|well/.test(n)) return 'pink';
  return 'blue';
}

/**
 * Pick a project icon based on the project name.
 * Falls back to 'folder' when no keyword matches.
 */
function pickProjectIcon(name: string): ProjectIcon {
  const n = name.toLowerCase();
  if (/code|dev|program|tech|api|git/.test(n)) return 'code';
  if (/work|biz|meeting|office|career/.test(n)) return 'briefcase';
  if (/shop|buy|store|amazon|deal/.test(n)) return 'shopping-cart';
  if (/learn|study|course|edu|school/.test(n)) return 'graduation-cap';
  if (/game|play|fun/.test(n)) return 'gamepad';
  if (/travel|trip|holiday|vacation/.test(n)) return 'plane';
  if (/music|song|playlist/.test(n)) return 'music';
  if (/read|book|article|wiki/.test(n)) return 'book';
  if (/home|house|family/.test(n)) return 'home';
  if (/photo|image|picture/.test(n)) return 'camera';
  if (/movie|video|film|watch/.test(n)) return 'film';
  if (/idea|brain|think/.test(n)) return 'lightbulb';
  if (/design|art|creative/.test(n)) return 'palette';
  if (/news|world|global/.test(n)) return 'globe';
  return 'folder';
}

/**
 * Ensure Bluetab manager tab is open before closing all tabs.
 * Prevents browser window from closing when last tab is removed.
 */
async function ensureManagerTabOpen(tabIdsToClose: number[]): Promise<void> {
  const allTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({ currentWindow: true }, resolve);
  });
  const managerUrl = chrome.runtime.getURL('src/options/index.html');
  const hasManager = allTabs.some((t) => t.url?.startsWith(managerUrl));
  const nonManagerIds = allTabs
    .filter((t) => !t.url?.startsWith(managerUrl))
    .map((t) => t.id!);
  const allWouldClose = tabIdsToClose.length >= nonManagerIds.length;
  if (allWouldClose && !hasManager) {
    await chrome.tabs.create({ url: managerUrl });
  }
}

/**
 * Read browserTabsCloseOnSave setting. Default: true (close tabs after save).
 */
async function shouldCloseTabs(): Promise<boolean> {
  const settings = await Storage.getSettings();
  return (settings as unknown as Record<string, unknown>).browserTabsCloseOnSave !== false;
}

// ============================================================================
// Hook
// ============================================================================

export function useAIChat(): UseAIChatReturn {
  // Pending confirmation state shown to the user via ConfirmationCard
  const [pendingConfirmation, setPendingConfirmation] = useState<AIConfirmationState | null>(null);

  // Promise resolver for the pending confirmation — resolved by confirmAction/cancelAction
  const confirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const allowanceRefreshTimerRef = useRef<number | null>(null);

  // -------------------------------------------------------------------------
  // Transport — points at Supertry AI proxy with auth + context injection
  // -------------------------------------------------------------------------
  const transport = useRef(
    new DefaultChatTransport({
      api: config.supertry.apiUrl + config.ai.chatEndpoint,
      // Custom fetch injects auth + context on every request.
      // headers/body callbacks may not properly await async — using
      // fetch wrapper guarantees correct async handling.
      fetch: async (url, init) => {
        const token = await getAccessToken();

        const headers = new Headers(init?.headers);
        if (token) headers.set('Authorization', `Bearer ${token}`);

        // System prompt + model routing in body
        let body = init?.body;
        if (body && typeof body === 'string') {
          try {
            const parsed = JSON.parse(body);

            // Model routing: 'fast' for simple chat, 'full' when tools needed.
            // Language-agnostic: if message is short greeting/chitchat → fast.
            // Otherwise assume it might need tools → full. Better to over-send
            // tools than to miss a tool call.
            const msgs = parsed.messages ?? [];
            const lastUserMsg = [...msgs].reverse().find((m: { role: string }) => m.role === 'user');
            const lastText = (typeof lastUserMsg?.content === 'string'
              ? lastUserMsg.content
              : lastUserMsg?.parts?.find((p: { type: string }) => p.type === 'text')?.text ?? ''
            ).trim();

            // Context is rebuilt on every request (tools may have changed the
            // tabs), scored against the user's latest words.
            const context = await AIService.buildContext(lastText);
            parsed.systemPrompt = AIService.buildSystemPrompt(context, true);
            parsed.tabCount = context.totalTabCount;

            // Mid-chain: conversation already has tool calls → always full
            const hasToolCalls = msgs.some((m: { role: string; parts?: Array<{ type: string }> }) =>
              m.parts?.some((p) => p.type?.startsWith?.('tool-'))
            );

            // Send a bounded window; old large tool outputs are shortened.
            parsed.messages = shapeHistoryForRequest(msgs);

            // Short messages with no tool history and no target (domain, URL,
            // number) are likely greetings
            const isChatOnly = isChatOnlyTurn(lastText, hasToolCalls);
            const needsTools = !isChatOnly;
            parsed.model = needsTools ? 'full' : 'fast';

            if (needsTools) {
              // Merge internal + external MCP tools (Plan 13-03)
              try {
                parsed.tools = await AIService.buildToolSchemaForTurn();
              } catch {
                // Fallback to internal-only tools if MCP merge fails
                parsed.tools = getToolsForBody();
              }
            }

            body = JSON.stringify(parsed);
          } catch {
            // Keep original body if not JSON
          }
        }

        const response = await fetch(url, { ...init, headers, body });
        void AIAllowanceService.syncFromAIResponse(response, { refreshOnSuccess: false });
        if (!response.ok) {
          const text = await response.clone().text().catch(() => '');
          console.error('[BlueTab][AI] fetch error:', response.status, text.slice(0, 300));
        }
        return response;
      },
    })
  ).current;

  // -------------------------------------------------------------------------
  // useChat setup
  // -------------------------------------------------------------------------
  const chatInit: ChatInit<UIMessage> = {
    transport,

    // Auto-send to LLM when all tool results are available.
    // After addToolOutput fills the tool result, this triggers a new
    // request so the LLM can generate a text response.
    // Continue after tool results, but stop runaway retries (see ai-tool-loop).
    sendAutomaticallyWhen: ({ messages }) => {
      if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) return false;
      const decision = decideToolLoop(messages as Parameters<typeof decideToolLoop>[0]);
      if (!decision.continue) {
        setToolLoopStopped(decision.reason === 'repeated_error'
          ? { reason: decision.reason, code: decision.code, params: decision.params }
          : { reason: decision.reason });
        return false;
      }
      return true;
    },

    onError: (error) => {
      console.error('[BlueTab][AI] chat error:', error);
    },

    onFinish: ({ isAbort, isDisconnect, isError }) => {
      if (isAbort || isDisconnect || isError) {
        return;
      }

      // One refresh per user turn: tool round-trips finish several streams
      // back to back, so wait until they settle.
      if (allowanceRefreshTimerRef.current !== null) {
        window.clearTimeout(allowanceRefreshTimerRef.current);
      }
      allowanceRefreshTimerRef.current = window.setTimeout(() => {
        allowanceRefreshTimerRef.current = null;
        void AIAllowanceService.refresh();
      }, ALLOWANCE_REFRESH_DEBOUNCE_MS);
    },

    onToolCall: (({ toolCall }: { toolCall: unknown }) => {
      // Execute the tool, then send result back via addToolOutput so the
      // LLM can generate a text response based on the tool output.
      const toolName = (toolCall as { toolName: string }).toolName as AIToolName | string;
      const toolCallId = getToolCallId(toolCall);
      const args = getArgs(toolCall);

      setCurrentToolName(toolName);

      // Execute tool and send result back to LLM
      (async () => {

        // --------------------------------------------------------------------
        // delete_tabs — permanently close tabs (confirmation required)
        // --------------------------------------------------------------------
        if (toolName === 'delete_tabs') {
          const tabIds = Array.isArray(args.tabIds) ? (args.tabIds as number[])
            : Array.isArray((args as Record<string, unknown>).ids) ? ((args as Record<string, unknown>).ids as number[])
            : [];

          const liveTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ currentWindow: true }, resolve);
          });
          const liveIdMap = new Map(liveTabs.map((t) => [t.id!, t]));
          const affectedItems: AIConfirmationState['affectedItems'] = tabIds
            .filter((id) => liveIdMap.has(id))
            .map((id) => ({ id, title: liveIdMap.get(id)!.title ?? String(id) }));

          if (affectedItems.length === 0) {
            return { status: 'error', message: 'No matching open tabs found.' };
          }

          const confirmed = await new Promise<boolean>((resolve) => {
            confirmResolveRef.current = resolve;
            setPendingConfirmation({
              toolCallId: getToolCallId(toolCall),
              toolName: 'delete_tabs',
              affectedItems,
              status: 'pending',
            });
          });

          if (!confirmed) return { status: 'cancelled' };

          try {
            const tabIdsToClose = affectedItems.map((i) => i.id);
            await ensureManagerTabOpen(tabIdsToClose);
            await chrome.tabs.remove(tabIdsToClose);
            return { status: 'success', closedCount: affectedItems.length };
          } catch (err) {
            return { status: 'error', message: String(err) };
          }
        }

        // --------------------------------------------------------------------
        // save_tabs — 3-step smart pipeline: Flow rules -> browser group
        //             matching -> domain categorization. Batch and single
        //             formats supported.
        // Supports: { groups: [{ tabIds, groupName }] } (batch)
        //       or: { tabIds, groupName } (single, backward compat)
        //       or: { tabIds } (save all, smart pipeline applies)
        // --------------------------------------------------------------------
        if (toolName === 'save_tabs') {
          // Parse batch or single format to collect all tab IDs
          type BatchGroup = { tabIds?: number[]; ids?: number[]; groupName?: string };
          let batchGroups: BatchGroup[] = [];
          const requestedMode = args.mode === 'preserve_set' ? 'preserve_set' : 'auto_organize';

          if (Array.isArray(args.groups)) {
            batchGroups = args.groups as BatchGroup[];
          } else {
            const ids = Array.isArray(args.tabIds) ? (args.tabIds as number[])
              : Array.isArray((args as Record<string, unknown>).ids) ? ((args as Record<string, unknown>).ids as number[])
              : [];
            if (ids.length > 0) {
              batchGroups = [{ tabIds: ids, groupName: args.groupName as string | undefined }];
            }
          }

          // Collect ALL tab IDs for confirmation card
          const allTabIds: number[] = [];
          for (const g of batchGroups) {
            const ids = Array.isArray(g.tabIds) ? g.tabIds : Array.isArray(g.ids) ? g.ids : [];
            allTabIds.push(...ids);
          }

          const liveTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ currentWindow: true }, resolve);
          });
          const liveIdMap = new Map(liveTabs.map((t) => [t.id!, t]));
          const validTabIds = allTabIds.filter((id) => liveIdMap.has(id));
          const affectedItems: AIConfirmationState['affectedItems'] = validTabIds
            .map((id) => ({ id, title: liveIdMap.get(id)!.title ?? String(id) }));

          if (affectedItems.length === 0) {
            return { status: 'error', message: 'No matching open tabs found.' };
          }

          // No confirmation — auto-save and report results (CONTEXT.md locked decision)
          // Browser protection: ensure manager tab stays open
          await ensureManagerTabOpen(validTabIds);

          if (requestedMode === 'preserve_set') {
            const authState = await getAuthState();
            let groupsCreated = 0;
            const groupNames: string[] = [];
            const preservedTabIds = new Set<number>();

            for (const [index, group] of batchGroups.entries()) {
              const ids = (Array.isArray(group.tabIds) ? group.tabIds : Array.isArray(group.ids) ? group.ids : [])
                .filter((id): id is number => liveIdMap.has(id) && !preservedTabIds.has(id));
              if (ids.length === 0) continue;
              ids.forEach((id) => preservedTabIds.add(id));

              const tabsToSave = ids
                .map((id) => liveIdMap.get(id)!)
                .filter((tab): tab is chrome.tabs.Tab => Boolean(tab));

              const explicitName = group.groupName?.trim()
                || (batchGroups.length === 1
                  ? translate('contextMenu.generatedGroups.saved', { date: formatDate(Date.now()) })
                  : translate('contextMenu.generatedGroups.savedSet', { index: index + 1 }));

              const result = await saveTabsToBlueTab(
                tabsToSave,
                explicitName,
                {
                  closeSourceTabs: false,
                  now: Date.now(),
                  isPro: authState.isPro,
                  mode: 'preserve_set',
                },
              );

              groupsCreated += result.defaultGroupedCount > 0 ? 1 : 0;
              if (result.defaultGroupedCount > 0) {
                groupNames.push(explicitName);
              }
            }

            if (await shouldCloseTabs()) {
              await ensureManagerTabOpen(validTabIds);
              try { await chrome.tabs.remove(validTabIds); } catch { /* some may already be closed */ }
            }

            return {
              status: 'success',
              savedCount: validTabIds.length,
              groupsCreated,
              groupsUpdated: 0,
              groupNames,
              mode: 'preserve_set',
            };
          }

          // ---- 3-step smart pipeline ----
          // Track which tab IDs have been handled to avoid duplicates
          const handledTabIds = new Set<number>();
          const existingGroups = (await Storage.get<TabGroup[]>('groups')) ?? [];
          // We'll accumulate updates: new groups to create, existing groups to update
          const newGroupsToAdd: TabGroup[] = [];
          const groupUpdates = new Map<string, TabGroup>(); // existing group id -> updated group

          // Build tab items ONCE for all pipeline steps.
          const tabItems = validTabIds.map((id) => {
            const t = liveIdMap.get(id)!;
            return {
              id: crypto.randomUUID(),
              url: t.url ?? '',
              title: t.title ?? '',
              favicon: t.favIconUrl ?? '',
              timestamp: Date.now(),
              groupId: '',
              _originalTabId: id, // private: maps back to chrome tab ID
            };
          });

          // --- Step 0: Group Memory partition (restore remembered groups first) ---
          const settings = await Storage.getSettings();
          if (settings.groupMemoryEnabled !== false) {
            const { buckets } = await GroupMemoryStorageService.partitionTabsByMemory(tabItems);
            if (buckets.size > 0) {
              const projects = await Storage.getProjects();
              for (const { group: remembered, tabs: memoryTabs } of buckets.values()) {
                // Validate projectId — only use if the project still exists.
                let validProjectId: string | undefined = undefined;
                if (remembered.projectId && projects.some((p) => p.id === remembered.projectId)) {
                  validProjectId = remembered.projectId;
                }

                const existing = existingGroups.find((g) => g.id === remembered.id);
                if (existing) {
                  // Merge into existing: append deduped (by URL) tabs.
                  const base = groupUpdates.get(existing.id) ?? existing;
                  const existingUrls = new Set(base.tabs.map((t) => t.url));
                  const mergedTabs = memoryTabs
                    .filter((t) => !existingUrls.has(t.url))
                    .map((t) => ({
                      id: crypto.randomUUID(),
                      url: t.url,
                      title: t.title,
                      favicon: t.favicon,
                      timestamp: t.timestamp,
                      groupId: base.id,
                    }));
                  groupUpdates.set(existing.id, {
                    ...base,
                    tabs: [...base.tabs, ...mergedTabs],
                    modified: Date.now(),
                  });
                } else {
                  // Recreate restored group from remembered properties.
                  newGroupsToAdd.push({
                    id: remembered.id,
                    name: remembered.name,
                    color: remembered.color,
                    tags: remembered.tags,
                    isPinned: remembered.isPinned,
                    pinnedAt: remembered.pinnedAt,
                    projectId: validProjectId,
                    tabs: memoryTabs.map((t) => ({
                      id: crypto.randomUUID(),
                      url: t.url,
                      title: t.title,
                      favicon: t.favicon,
                      timestamp: t.timestamp,
                      groupId: remembered.id,
                    })),
                    created: remembered.created,
                    modified: Date.now(),
                  });
                }

                for (const t of memoryTabs) handledTabIds.add(t._originalTabId);
              }
            }
          }

          // --- Step 1 (Pro only): Flow rules on tabs NOT consumed by memory ---
          const flowInputItems = tabItems.filter((t) => !handledTabIds.has(t._originalTabId));
          if (flowInputItems.length > 0) {
            try {
              const { FlowService } = await import('@/services/flow-service');
              const flowResult = await FlowService.processTabs(
                flowInputItems as Parameters<typeof FlowService.processTabs>[0],
                existingGroups
              );
              // Mark tabs that were handled by Flow rules
              for (const r of flowResult.results) {
                if (r.actionTaken === 'added_to_group' || r.actionTaken === 'created_group') {
                  // Map back to original chrome tab ID via URL match
                  for (const [chromeId, chromeTab] of liveIdMap) {
                    if (chromeTab.url === r.tabUrl) {
                      handledTabIds.add(chromeId);
                    }
                  }
                }
              }
              // Reload existing groups to pick up Flow-created groups
              const updatedAfterFlow = (await Storage.get<TabGroup[]>('groups')) ?? [];
              existingGroups.splice(0, existingGroups.length, ...updatedAfterFlow);
            } catch {
              // FlowService not available or Pro not active — fall through
            }
          }

          // --- Step 2: Browser tab group matching ---
          try {
            const browserGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
            for (const browserGroup of browserGroups) {
              if (!browserGroup.title) continue;
              const memberTabs = await chrome.tabs.query({ groupId: browserGroup.id });
              const memberTabIds = memberTabs.map((t) => t.id!).filter((id) => validTabIds.includes(id) && !handledTabIds.has(id));
              if (memberTabIds.length === 0) continue;

              const browserGroupTitle = browserGroup.title.toLowerCase();
              // Case-insensitive exact match, then normalized (no whitespace) match
              const existingMatch = existingGroups.find((g) =>
                g.name.toLowerCase() === browserGroupTitle ||
                g.name.toLowerCase().replace(/\s+/g, '') === browserGroupTitle.replace(/\s+/g, '')
              );

              if (existingMatch) {
                // Append to existing group (deduplicate by URL)
                const base = groupUpdates.get(existingMatch.id) ?? existingMatch;
                const existingUrls = new Set(base.tabs.map((t) => t.url));
                const newTabs = memberTabIds
                  .filter((id) => !existingUrls.has(liveIdMap.get(id)?.url ?? ''))
                  .map((id) => {
                    const tab = liveIdMap.get(id)!;
                    return { id: crypto.randomUUID(), url: tab.url ?? '', title: tab.title ?? '', favicon: tab.favIconUrl ?? '', timestamp: Date.now(), groupId: base.id };
                  });
                groupUpdates.set(existingMatch.id, { ...base, tabs: [...base.tabs, ...newTabs], modified: Date.now() });
              } else {
                // Create new Bluetab group with browser group name
                const newGroupId = crypto.randomUUID();
                const tabs = memberTabIds.map((id) => {
                  const tab = liveIdMap.get(id)!;
                  return { id: crypto.randomUUID(), url: tab.url ?? '', title: tab.title ?? '', favicon: tab.favIconUrl ?? '', timestamp: Date.now(), groupId: newGroupId };
                });
                newGroupsToAdd.push({ id: newGroupId, name: browserGroup.title, tabs, created: Date.now(), modified: Date.now() });
              }

              for (const id of memberTabIds) handledTabIds.add(id);
            }
          } catch {
            // chrome.tabGroups may not be available in all contexts
          }

          // --- Step 3: Ungrouped tab categorization by domain ---
          const remainingIds = validTabIds.filter((id) => !handledTabIds.has(id));
          if (remainingIds.length > 0) {
            // Group by TLD hostname (strip www.)
            const domainMap = new Map<string, number[]>();
            for (const id of remainingIds) {
              const tab = liveIdMap.get(id)!;
              let domain = '';
              try { domain = new URL(tab.url ?? '').hostname.replace(/^www\./, ''); } catch { domain = 'Other'; }
              if (!domainMap.has(domain)) domainMap.set(domain, []);
              domainMap.get(domain)!.push(id);
            }

            for (const [domain, tabIds] of domainMap) {
              const domainRoot = domain.split('.')[0];
              const groupName = domainRoot.charAt(0).toUpperCase() + domainRoot.slice(1) || translate('contextMenu.generatedGroups.saved', { date: formatDate(Date.now()) });
              const newGroupId = crypto.randomUUID();
              const tabs = tabIds.map((id) => {
                const tab = liveIdMap.get(id)!;
                return { id: crypto.randomUUID(), url: tab.url ?? '', title: tab.title ?? '', favicon: tab.favIconUrl ?? '', timestamp: Date.now(), groupId: newGroupId };
              });
              newGroupsToAdd.push({ id: newGroupId, name: groupName, tabs, created: Date.now(), modified: Date.now() });
            }
          }

          // ---- Merge updates and save atomically ----
          const finalGroups = existingGroups.map((g) => groupUpdates.get(g.id) ?? g);
          await Storage.set('groups', [...newGroupsToAdd, ...finalGroups]);

          // ---- Close tabs if setting allows ----
          if (await shouldCloseTabs()) {
            await ensureManagerTabOpen(validTabIds);
            try { await chrome.tabs.remove(validTabIds); } catch { /* some may already be closed */ }
          }

          const totalSaved = validTabIds.length;
          const groupsCreatedCount = newGroupsToAdd.length;
          const groupsUpdatedCount = groupUpdates.size;

          return {
            status: 'success',
            savedCount: totalSaved,
            groupsCreated: groupsCreatedCount,
            groupsUpdated: groupsUpdatedCount,
            groupNames: newGroupsToAdd.map((g) => g.name),
          };
        }

        // --------------------------------------------------------------------
        // archive_group — archive tabs to long-term storage.
        //   Path A (groupId): Archive a saved Bluetab group (with confirmation)
        //   Path B (tabIds): Archive open browser tabs directly (no confirmation,
        //                    archive is non-destructive and fully restorable)
        // --------------------------------------------------------------------
        if (toolName === 'archive_group') {
          const groupId = typeof args.groupId === 'string' ? args.groupId : '';

          // --- Path A: archive saved Bluetab group ---
          if (groupId) {
            const groups = (await Storage.get<TabGroup[]>('groups')) ?? [];
            const target = groups.find((g) => g.id === groupId);
            if (!target) return { status: 'not_found', groupId };

            // No confirmation — archive is non-destructive, can be restored (CONTEXT.md locked decision)
            try {
              const { ArchiveService } = await import('@/services/archive-service');
              const result = await ArchiveService.createArchive(target, { groupId });
              if (!result.success) {
                return { status: 'error', message: result.error ?? 'Archive failed.' };
              }

              // Remove from saved groups after archiving
              const updated = groups.filter((g) => g.id !== groupId);
              await Storage.set('groups', updated);

              return {
                status: 'success',
                archivedGroup: target.name,
                tabCount: target.tabs.length,
                archiveId: result.archiveId,
              };
            } catch (err) {
              return { status: 'error', message: String(err) };
            }
          }

          // --- Path B: archive open browser tabs directly ---
          const rawTabIds = Array.isArray(args.tabIds) ? (args.tabIds as number[])
            : Array.isArray((args as Record<string, unknown>).ids) ? ((args as Record<string, unknown>).ids as number[])
            : [];

          if (rawTabIds.length === 0) {
            return { status: 'error', message: 'Provide groupId (saved Bluetab group) or tabIds (open browser tabs).' };
          }

          const liveTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ currentWindow: true }, resolve);
          });
          const liveIdMap = new Map(liveTabs.map((t) => [t.id!, t]));
          const validTabIds = rawTabIds.filter((id) => liveIdMap.has(id));

          if (validTabIds.length === 0) {
            return { status: 'error', message: 'No matching open tabs found.' };
          }

          // Group tabs by domain for archive organization
          const domainMap = new Map<string, number[]>();
          for (const id of validTabIds) {
            const tab = liveIdMap.get(id)!;
            let domain = '';
            try { domain = new URL(tab.url ?? '').hostname.replace(/^www\./, ''); } catch { domain = 'Other'; }
            if (!domainMap.has(domain)) domainMap.set(domain, []);
            domainMap.get(domain)!.push(id);
          }

          const archiveIds: string[] = [];
          try {
            const { ArchiveService } = await import('@/services/archive-service');
            for (const [domain, tabIds] of domainMap) {
              const domainRoot = domain.split('.')[0];
              const groupName = domainRoot.charAt(0).toUpperCase() + domainRoot.slice(1) || translate('contextMenu.generatedGroups.archive', { date: formatDate(Date.now()) });
              const newGroupId = crypto.randomUUID();
              const tabItems = tabIds.map((id) => {
                const tab = liveIdMap.get(id)!;
                return { id: crypto.randomUUID(), url: tab.url ?? '', title: tab.title ?? '', favicon: tab.favIconUrl ?? '', timestamp: Date.now(), groupId: newGroupId };
              });
              const group: TabGroup = { id: newGroupId, name: groupName, tabs: tabItems, created: Date.now(), modified: Date.now() };
              const result = await ArchiveService.createArchive(group, { groupId: newGroupId });
              if (result.success && result.archiveId) archiveIds.push(result.archiveId);
            }
          } catch (err) {
            return { status: 'error', message: String(err) };
          }

          if (await shouldCloseTabs()) {
            await ensureManagerTabOpen(validTabIds);
            try { await chrome.tabs.remove(validTabIds); } catch { /* some may already be closed */ }
          }

          return {
            status: 'success',
            archivedCount: validTabIds.length,
            archiveIds,
          };
        }

        // --------------------------------------------------------------------
        // search_tabs — search open browser tabs by keyword
        // --------------------------------------------------------------------
        if (toolName === 'search_tabs') {
          const query = typeof args.query === 'string' ? args.query : '';
          const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ currentWindow: true }, resolve);
          });
          const q = normalizeForSearch(query);
          const matches = tabs
            .filter((t) => {
              const title = (t.title ?? '');
              const url = (t.url ?? '');
              return matchesSearch(title, q) || matchesSearch(url, q);
            })
            .map((t) => ({ id: t.id, title: t.title, url: t.url }));
          return { matches, count: matches.length };
        }

        // --------------------------------------------------------------------
        // group_tabs — group tabs into a Chrome tab group
        // --------------------------------------------------------------------
        if (toolName === 'group_tabs') {
          // Support batch grouping: args.groups is an array of { tabIds, groupName, color }
          const groupDefs = Array.isArray(args.groups) ? (args.groups as Array<{
            tabIds?: number[];
            groupName?: string;
            color?: string;
          }>) : [];

          // Backward compat: if no groups array, try flat args
          if (groupDefs.length === 0 && Array.isArray(args.tabIds)) {
            groupDefs.push({
              tabIds: args.tabIds as number[],
              groupName: (args.groupName as string) ?? 'Grouped Tabs',
              color: args.color as string | undefined,
            });
          }

          if (groupDefs.length === 0) {
            return { status: 'error', message: 'No groups provided.' };
          }

          const results: Array<{ groupName: string; tabCount: number; status: string }> = [];

          // Get all live tabs for fallback naming
          const allLiveTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ currentWindow: true }, resolve);
          });
          const liveTabMap = new Map(allLiveTabs.map((t) => [t.id!, t]));

          for (const def of groupDefs) {
            // LLM sometimes sends "ids" instead of "tabIds"
            const rawDef = def as Record<string, unknown>;
            const tabIds = Array.isArray(def.tabIds) ? def.tabIds
              : Array.isArray(rawDef.ids) ? (rawDef.ids as number[])
              : [];

            // Smart fallback name: extract common domain from tabs
            let groupName = def.groupName?.trim() || '';
            if (!groupName) {
              const domains = tabIds
                .map((id) => {
                  try { return new URL(liveTabMap.get(id)?.url ?? '').hostname.replace('www.', ''); }
                  catch { return ''; }
                })
                .filter(Boolean);
              const domainCounts = new Map<string, number>();
              for (const d of domains) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
              const topDomain = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
              groupName = topDomain
                ? topDomain.split('.')[0].charAt(0).toUpperCase() + topDomain.split('.')[0].slice(1)
                : 'Tabs';
            }
            const color = def.color;

            if (tabIds.length === 0) {
              results.push({ groupName, tabCount: 0, status: 'skipped_empty' });
              continue;
            }

            const validation = await AIService.validateTabIds(tabIds);
            if (validation.valid.length === 0) {
              results.push({ groupName, tabCount: 0, status: 'all_stale' });
              continue;
            }

            try {
              const updateProps: chrome.tabGroups.UpdateProperties = { title: groupName };
              if (color) updateProps.color = color as chrome.tabGroups.ColorEnum;
              await createBrowserTabGroup({ tabIds: validation.valid }, updateProps);
              results.push({ groupName, tabCount: validation.valid.length, status: 'success' });
            } catch (err) {
              results.push({ groupName, tabCount: 0, status: String(err) });
            }
          }

          return { status: 'success', groupsCreated: results.length, results };
        }

        // --------------------------------------------------------------------
        // open_tabs — open URLs as new browser tabs (max 5)
        // --------------------------------------------------------------------
        if (toolName === 'open_tabs') {
          const urls = Array.isArray(args.urls) ? (args.urls as string[]) : [];
          const limitedUrls = urls.slice(0, 5);
          const createdIds: number[] = [];
          for (const url of limitedUrls) {
            try {
              const tab = await chrome.tabs.create({ url });
              if (tab.id) createdIds.push(tab.id);
            } catch {
              // Skip URLs that fail to open
            }
          }
          return { status: 'success', openedCount: createdIds.length, tabIds: createdIds };
        }

        // --------------------------------------------------------------------
        // rename_group — rename a saved Bluetab group
        // --------------------------------------------------------------------
        if (toolName === 'rename_group') {
          const groupId = typeof args.groupId === 'string' ? args.groupId : '';
          const newName = typeof args.newName === 'string' ? args.newName : '';
          const groups = (await Storage.get<TabGroup[]>('groups')) ?? [];
          const updated = groups.map((g) =>
            g.id === groupId ? { ...g, name: newName, modified: Date.now() } : g
          );
          await Storage.set('groups', updated);
          const found = updated.find((g) => g.id === groupId);
          return found
            ? { status: 'success', groupId, newName }
            : { status: 'not_found', groupId };
        }

        // --------------------------------------------------------------------
        // search_bluetab — search saved Bluetab groups and tabs
        // --------------------------------------------------------------------
        if (toolName === 'search_bluetab') {
          const query = typeof args.query === 'string' ? args.query : '';
          const groups = (await Storage.get<TabGroup[]>('groups')) ?? [];
          const q = normalizeForSearch(query);

          // Empty query = return ALL groups with ALL tabs (for reorganize workflow)
          // Compact format: short URL (domain only) to save tokens
          if (!q) {
            const shorten = (url: string) => {
              try { const u = new URL(url); return u.hostname.replace('www.', ''); }
              catch { return url.slice(0, 30); }
            };
            const allGroups = groups.map((g) => ({
              id: g.id,
              name: g.name,
              tabs: g.tabs.map((t) => ({
                id: t.id,
                t: t.title.slice(0, 50),
                d: shorten(t.url),
              })),
            }));
            return { g: allGroups, total: { groups: allGroups.length, tabs: allGroups.reduce((s, g) => s + g.tabs.length, 0) } };
          }

          // Search mode — filter by query
          const results: Array<{
            groupId: string;
            groupName: string;
            tabId: string;
            tabTitle: string;
            tabUrl: string;
          }> = [];

          for (const group of groups) {
            if (matchesSearch(group.name, q)) {
              results.push({
                groupId: group.id,
                groupName: group.name,
                tabId: '',
                tabTitle: `[Group] ${group.name}`,
                tabUrl: '',
              });
            }
            for (const tab of group.tabs) {
              if (
                matchesSearch(tab.title, q) ||
                matchesSearch(tab.url, q)
              ) {
                results.push({
                  groupId: group.id,
                  groupName: group.name,
                  tabId: tab.id,
                  tabTitle: tab.title,
                  tabUrl: tab.url,
                });
              }
            }
          }

          return { results: results.slice(0, 50), totalCount: results.length };
        }

        // --------------------------------------------------------------------
        // --------------------------------------------------------------------
        // search_brain_dump — search compact dump snippets or fetch one full
        //                     dump entry by id
        // --------------------------------------------------------------------
        if (toolName === 'search_brain_dump') {
          const action = typeof args.action === 'string' ? args.action : 'search';

          if (action === 'get') {
            const entryId = typeof args.entryId === 'string' ? args.entryId : '';
            if (!entryId) {
              return { status: 'error', message: 'entryId is required for full Brain Dump fetches.' };
            }

            const entry = await BrainDumpService.getEntry(entryId);
            if (!entry) {
              return { status: 'not_found', entryId };
            }

            return {
              status: 'success',
              entry: {
                id: entry.id,
                text: entry.text,
                createdAt: entry.createdAt,
                updatedAt: entry.updatedAt,
                tabTitle: entry.tabContext?.title,
                tabUrl: entry.tabContext?.url,
              },
            };
          }

          const query = typeof args.query === 'string' ? args.query : '';
          const limit = typeof args.limit === 'number' ? args.limit : undefined;
          const includeFullText = args.includeFullText === true;
          const searchResponse = await BrainDumpService.search(query, limit, { includeFullText });

          return {
            status: 'success',
            results: searchResponse.results,
            count: searchResponse.totalCount,
            returnedCount: searchResponse.results.length,
            query,
          };
        }

        // --------------------------------------------------------------------
        // search_rss — search RSS feed articles (Phase 4 dependency)
        // --------------------------------------------------------------------
        if (toolName === 'search_rss') {
          const query = typeof args.query === 'string' ? args.query : '';
          try {
            // Dynamic import — gracefully handles Phase 4 not being built
            const { RSSService } = await import('@/services/rss-service');
            const allArticles = await RSSService.getArticles('all');
            const q = normalizeForSearch(query);
            const matches = allArticles
              .filter((a) => {
                const title = (a.title ?? '');
                const link = (a.link ?? '');
                return matchesSearch(title, q) || matchesSearch(link, q);
              })
              .slice(0, 10)
              .map((a) => ({
                title: a.title,
                url: a.link,
                pubDate: a.pubDate,
              }));
            return { articles: matches, count: matches.length };
          } catch {
            return {
              articles: [],
              count: 0,
              note: 'RSS not configured. Add RSS feeds in the Feeds tab to enable article search.',
            };
          }
        }

        // --------------------------------------------------------------------
        // web_search — search the web via Supertry search proxy
        // --------------------------------------------------------------------
        if (toolName === 'web_search') {
          // LLM may send query (string) or queries (array) — normalize
          const query = typeof args.query === 'string' ? args.query
            : Array.isArray(args.queries) ? (args.queries as string[]).join(' ')
            : '';
          const requestedFreshness = typeof args.freshness === 'string'
            ? args.freshness as WebSearchFreshness
            : undefined;
          const freshness = requestedFreshness ?? inferSearchFreshness(query);
          try {
            const token = await getAccessToken();
            const response = await fetch(config.supertry.apiUrl + config.ai.searchEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                query,
                ...(freshness ? { freshness } : {}),
              }),
              signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
              return { results: [], error: `Search failed: ${response.status}` };
            }

            const data = (await response.json()) as {
              results: Array<{ title: string; url: string; snippet: string }>;
              freshnessApplied?: WebSearchFreshness | null;
            };

            const sorted = sortSearchResults(data.results.slice(0, 20));
            const opened = await openSearchResults(sorted, query);

            return {
              results: sorted.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
              openedResults: opened.openedResults,
              openedTabIds: opened.openedTabIds,
              openedCount: opened.openedCount,
              freshnessApplied: data.freshnessApplied ?? freshness ?? null,
              query,
            };
          } catch (error) {
            return {
              results: [],
              error: error instanceof Error ? error.message : 'Search unavailable',
            };
          }
        }

        // --------------------------------------------------------------------
        // update_settings — read or write app settings (general, pomodoro,
        //                   focus, ai categories)
        // --------------------------------------------------------------------
        if (toolName === 'update_settings') {
          const action = typeof args.action === 'string' ? args.action : '';
          const category = typeof args.category === 'string' ? args.category : 'all';

          if (action === 'read') {
            if (category === 'general') {
              const settings = await Storage.getSettings();
              return { status: 'success', category, settings };
            }
            if (category === 'pomodoro') {
              const pomSettings = await Storage.get<PomodoroSettings>('pomodoroSettings');
              return { status: 'success', category, settings: pomSettings };
            }
            if (category === 'focus') {
              const focusSettings = await Storage.get<FocusSettings>('focusSettings');
              return { status: 'success', category, settings: focusSettings };
            }
            if (category === 'ai') {
              const aiSettings = await AIService.getSettings();
              return { status: 'success', category, settings: aiSettings };
            }
            // 'all' — read everything
            const [generalSettings, pomSettings, focusSettings, aiSettings] = await Promise.all([
              Storage.getSettings(),
              Storage.get<PomodoroSettings>('pomodoroSettings'),
              Storage.get<FocusSettings>('focusSettings'),
              AIService.getSettings(),
            ]);
            return {
              status: 'success',
              category: 'all',
              settings: { general: generalSettings, pomodoro: pomSettings, focus: focusSettings, ai: aiSettings },
            };
          }

          if (action === 'write') {
            const settingsArg = (args.settings && typeof args.settings === 'object')
              ? (args.settings as Record<string, unknown>)
              : {};

            if (Object.keys(settingsArg).length === 0) return { status: 'error', message: 'No settings provided.' };

            // Allowlist + type/enum/range checks; unknown keys are reported, not saved.
            const plan = planSettingsWrite(settingsArg);
            if (plan.applied.length === 0) {
              return { status: 'error', message: 'No valid settings to apply.', rejected: plan.rejected };
            }

            if (Object.keys(plan.general).length > 0) {
              const current = await Storage.getSettings();
              await Storage.setSettings({ ...current, ...plan.general });
            }

            if (Object.keys(plan.pomodoro).length > 0) {
              const current = (await Storage.get<PomodoroSettings>('pomodoroSettings')) ?? {};
              await Storage.set('pomodoroSettings', { ...current, ...plan.pomodoro });
            }

            if (Object.keys(plan.focus).length > 0) {
              const current = normalizeFocusSettings(await Storage.get<FocusSettings>('focusSettings'));
              const { presets, ...rest } = plan.focus as Partial<FocusSettings>;
              await Storage.set('focusSettings', normalizeFocusSettings({
                ...current,
                ...rest,
                presets: { ...current.presets, ...(presets ?? {}) },
              }));
            }

            if (Object.keys(plan.ai).length > 0) {
              const current = await AIService.getSettings();
              await AIService.saveSettings({ ...current, ...plan.ai });
            }

            const applied = plan.applied;
            const rejected = plan.rejected.length > 0 ? plan.rejected : undefined;
            return { status: 'success', applied, rejected };
          }

          return { status: 'error', message: `Unknown action: ${action}` };
        }

        // --------------------------------------------------------------------
        // get_context — return live app data on demand (stats, pomodoro,
        //               focus, rss, projects)
        // --------------------------------------------------------------------
        if (toolName === 'get_context') {
          // LLM sends different keys (source, action, type, target, scope...) — find any string value
          const validSources = ['stats', 'pomodoro', 'focus', 'rss', 'projects', 'all'];
          let source = '';
          for (const val of Object.values(args)) {
            if (typeof val === 'string' && validSources.includes(val.toLowerCase())) {
              source = val.toLowerCase();
              break;
            }
          }

          if (source === 'stats') {
            const days = typeof args.statsDays === 'number' ? args.statsDays : 7;
            try {
              const { StatsService } = await import('@/services/stats-service');
              const stats = await StatsService.getAggregateStats(days);
              return { source: 'stats', period: days, ...stats };
            } catch {
              return { source: 'stats', period: 0, error: 'Stats not available.' };
            }
          }

          if (source === 'pomodoro') {
            const state = await Storage.get<PomodoroState>('pomodoroState');
            const minutesRemaining = state?.isActive && !state.isPaused
              ? Math.max(0, Math.ceil((state.endTime - Date.now()) / 60000))
              : state?.isPaused
                ? Math.max(0, Math.ceil((state.pausedRemaining ?? 0) / 60000))
                : 0;
            return {
              source: 'pomodoro',
              isActive: state?.isActive ?? false,
              isPaused: state?.isPaused ?? false,
              sessionType: state?.sessionType ?? 'work',
              minutesRemaining,
              sessionsCompleted: state?.sessionsCompleted ?? 0,
            };
          }

          if (source === 'focus') {
            const [state, focusSettings] = await Promise.all([
              Storage.get<FocusState>('focusState'),
              Storage.get<FocusSettings>('focusSettings'),
            ]);
            return {
              source: 'focus',
              isActive: state?.isActive ?? false,
              activatedAt: state?.activatedAt ?? 0,
              settings: focusSettings,
            };
          }

          if (source === 'rss') {
            try {
              const { RSSService } = await import('@/services/rss-service');
              const feeds = await RSSService.getFeeds();
              return {
                source: 'rss',
                feeds: feeds.map((f) => ({ id: f.id, title: f.title, url: f.url })),
                count: feeds.length,
              };
            } catch {
              return { source: 'rss', feeds: [], count: 0, note: 'RSS not configured.' };
            }
          }

          if (source === 'projects') {
            const projects = await Storage.getProjects();
            const groups = (await Storage.get<TabGroup[]>('groups')) ?? [];
            return {
              source: 'projects',
              projects: projects.map((p) => ({
                id: p.id,
                name: p.name,
                color: p.color,
                icon: p.icon,
                groups: groups
                  .filter((g) => g.projectId === p.id)
                  .map((g) => ({ id: g.id, name: g.name, tabCount: g.tabs.length })),
              })),
            };
          }

          // "all" — return stats + pomodoro + focus combined
          if (source === 'all') {
            const days = typeof args.statsDays === 'number' ? args.statsDays : 7;
            let stats = null;
            try {
              const { StatsService } = await import('@/services/stats-service');
              stats = await StatsService.getAggregateStats(days);
            } catch { /* stats not available */ }
            const pomState = await Storage.get<PomodoroState>('pomodoroState');
            const focusState = await Storage.get<FocusState>('focusState');
            return {
              source: 'all',
              stats: stats ?? 'not available',
              pomodoro: {
                isActive: pomState?.isActive ?? false,
                isPaused: pomState?.isPaused ?? false,
                sessionsCompleted: pomState?.sessionsCompleted ?? 0,
              },
              focus: { isActive: focusState?.isActive ?? false },
            };
          }

          return { status: 'error', message: `Unknown source: ${source}. Valid: stats, pomodoro, focus, rss, projects, all` };
        }

        // --------------------------------------------------------------------
        // manage_projects — create, list, update, delete, assign projects
        // --------------------------------------------------------------------
        if (toolName === 'manage_projects') {
          const action = typeof args.action === 'string' ? args.action : '';

          // ---- list ----
          if (action === 'list') {
            const projects = await Storage.getProjects();
            const groups = (await Storage.get<TabGroup[]>('groups')) ?? [];
            return {
              projects: projects.map((p) => ({
                id: p.id,
                name: p.name,
                color: p.color,
                icon: p.icon,
                groupCount: groups.filter((g) => g.projectId === p.id).length,
              })),
              count: projects.length,
            };
          }

          // ---- create (single or batch) ----
          if (action === 'create') {
            const validColors: ProjectColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
            const validIcons: ProjectIcon[] = ['folder', 'briefcase', 'code', 'book', 'shopping-cart', 'plane', 'gamepad', 'heart', 'star', 'music', 'graduation-cap', 'home', 'globe', 'camera', 'coffee', 'film', 'gift', 'lightbulb', 'palette', 'settings'];

            // Batch create: args.projects = [{name, color?, icon?, groupIds?}]
            type ProjectDef = { name: string; color?: string; icon?: string; groupIds?: string[] };
            const batch: ProjectDef[] = Array.isArray(args.projects) ? (args.projects as ProjectDef[]) : [];

            // Single create fallback
            if (batch.length === 0 && typeof args.name === 'string' && args.name.trim()) {
              batch.push({
                name: args.name.trim(),
                color: args.color as string | undefined,
                icon: args.icon as string | undefined,
                groupIds: Array.isArray(args.groupIds) ? (args.groupIds as string[]) : undefined,
              });
            }

            if (batch.length === 0) return { status: 'error', message: 'Project name or projects array required.' };

            const groups = (await Storage.get<TabGroup[]>('groups')) ?? [];
            const createdProjects: Array<{ id: string; name: string; color: string; icon: string; assignedGroups: number }> = [];

            for (const def of batch) {
              const name = def.name.trim();
              if (!name) continue;
              const color: ProjectColor = (validColors.includes(def.color as ProjectColor) ? def.color : pickProjectColor(name)) as ProjectColor;
              const icon: ProjectIcon = (validIcons.includes(def.icon as ProjectIcon) ? def.icon : pickProjectIcon(name)) as ProjectIcon;

              const newProject: Project = {
                id: crypto.randomUUID(),
                name,
                color,
                icon,
                searchScope: 'project',
                created: Date.now(),
                modified: Date.now(),
              };
              await Storage.addProject(newProject);

              // Auto-assign groups if specified
              let assignedCount = 0;
              if (def.groupIds && def.groupIds.length > 0) {
                for (const gid of def.groupIds) {
                  const g = groups.find((gr) => gr.id === gid);
                  if (g) {
                    g.projectId = newProject.id;
                    assignedCount++;
                  }
                }
              }
              createdProjects.push({ id: newProject.id, name, color, icon, assignedGroups: assignedCount });
            }

            // If no explicit groupIds were provided, auto-assign unassigned groups
            // by matching group names/content against project names
            const totalExplicitAssignments = createdProjects.reduce((s, p) => s + p.assignedGroups, 0);
            if (totalExplicitAssignments === 0 && createdProjects.length > 0) {
              const unassigned = groups.filter((g) => !g.projectId);
              for (const g of unassigned) {
                // Build a content string from group name + tab titles + domains
                const content = [
                  g.name,
                  ...g.tabs.map((t) => t.title),
                  ...g.tabs.map((t) => { try { return new URL(t.url).hostname; } catch { return ''; } }),
                ].join(' ').toLowerCase();

                // Find the best matching project
                let bestMatch: { id: string; score: number } | null = null;
                for (const p of createdProjects) {
                  // Split project name into keywords and count matches
                  const keywords = p.name.toLowerCase().split(/[\s&,+\/]+/).filter((k) => k.length > 2);
                  const score = keywords.reduce((s, kw) => s + (content.includes(kw) ? 1 : 0), 0);
                  if (score > 0 && (!bestMatch || score > bestMatch.score)) {
                    bestMatch = { id: p.id, score };
                  }
                }
                if (bestMatch) {
                  g.projectId = bestMatch.id;
                  const cp = createdProjects.find((p) => p.id === bestMatch!.id);
                  if (cp) cp.assignedGroups++;
                }
              }
            }

            // Persist group assignments
            await Storage.set('groups', groups);

            // Return unassigned groups for follow-up
            const unassigned = groups
              .filter((g) => !g.projectId)
              .slice(0, 30)
              .map((g) => ({ id: g.id, name: g.name, tabCount: g.tabs.length }));

            return {
              status: 'success',
              created: createdProjects,
              count: createdProjects.length,
              WARNING: unassigned.length > 0
                ? `${unassigned.length} groups are NOT assigned to any project. Report these to the user.`
                : undefined,
              unassignedGroups: unassigned.length > 0 ? unassigned : undefined,
              unassignedCount: unassigned.length,
            };
          }

          // ---- update ----
          if (action === 'update') {
            const projectId = typeof args.projectId === 'string' ? args.projectId : '';
            if (!projectId) return { status: 'error', message: 'projectId is required.' };

            const projects = await Storage.getProjects();
            if (!projects.find((p) => p.id === projectId)) {
              return { status: 'not_found', projectId };
            }
            const updates: Partial<Project> = { modified: Date.now() };
            if (typeof args.name === 'string') updates.name = args.name;
            if (typeof args.color === 'string') updates.color = args.color as ProjectColor;
            if (typeof args.icon === 'string') updates.icon = args.icon as ProjectIcon;
            await Storage.updateProject(projectId, updates);
            return { status: 'success', projectId, updated: updates };
          }

          // ---- delete (single or batch) ----
          if (action === 'delete') {
            // Support both single projectId and batch projectIds
            const ids: string[] = Array.isArray(args.projectIds) ? (args.projectIds as string[]) : [];
            if (typeof args.projectId === 'string' && args.projectId) {
              ids.push(args.projectId);
            }
            if (ids.length === 0) return { status: 'error', message: 'projectId or projectIds required.' };

            const projects = await Storage.getProjects();
            const targets = projects.filter((p) => ids.includes(p.id));
            if (targets.length === 0) return { status: 'not_found', projectIds: ids };

            const groups = (await Storage.get<TabGroup[]>('groups')) ?? [];
            const affectedItems = targets.map((t) => {
              const assignedCount = groups.filter((g) => g.projectId === t.id).length;
              return { id: 0, title: `${t.name} (${assignedCount} groups)` };
            });

            const confirmed = await new Promise<boolean>((resolve) => {
              confirmResolveRef.current = resolve;
              setPendingConfirmation({
                toolCallId: getToolCallId(toolCall),
                toolName: 'manage_projects',
                affectedItems,
                status: 'pending',
                projectMeta: targets.length === 1 ? {
                  name: targets[0].name,
                  color: targets[0].color,
                  icon: targets[0].icon,
                  groupCount: groups.filter((g) => g.projectId === targets[0].id).length,
                } : undefined,
              });
            });

            if (!confirmed) {
              return { status: 'cancelled', message: 'User cancelled project deletion.' };
            }

            const deletedNames: string[] = [];
            for (const t of targets) {
              await Storage.deleteProject(t.id);
              deletedNames.push(t.name);
            }
            return { status: 'success', deletedProjects: deletedNames, count: deletedNames.length };
          }

          // ---- assign ----
          if (action === 'assign') {
            let projectId = typeof args.projectId === 'string' ? args.projectId : '';
            const groupIds = Array.isArray(args.groupIds) ? (args.groupIds as string[]) : [];

            // If no projectId but name provided, fuzzy-find by name
            if (!projectId && typeof args.name === 'string') {
              const projects = await Storage.getProjects();
              const needle = normalizeForSearch(args.name);
              const found = projects.find((p) => matchesSearch(p.name, needle));
              if (found) projectId = found.id;
            }

            if (!projectId) return { status: 'error', message: 'projectId or project name is required.' };
            if (groupIds.length === 0) return { status: 'error', message: 'groupIds array is required.' };

            await Storage.assignGroupsToProject(groupIds, projectId);

            // Check remaining unassigned groups
            const updatedGroups = (await Storage.get<TabGroup[]>('groups')) ?? [];
            const stillUnassigned = updatedGroups
              .filter((g) => !g.projectId)
              .map((g) => ({ id: g.id, name: g.name }));

            return {
              status: 'success',
              assignedCount: groupIds.length,
              projectId,
              WARNING: stillUnassigned.length > 0
                ? `${stillUnassigned.length} groups are still NOT assigned. Report these to the user.`
                : undefined,
              stillUnassigned: stillUnassigned.length > 0 ? stillUnassigned : undefined,
            };
          }

          return { status: 'error', message: `Unknown action: ${action}` };
        }

        // --------------------------------------------------------------------
        // manage_groups — manage saved Bluetab groups (merge, split, edit,
        //                 move_tabs, delete). Only delete requires confirmation.
        // --------------------------------------------------------------------
        if (toolName === 'manage_groups') {
          const action = typeof args.action === 'string' ? args.action : '';
          const groups = (await Storage.get<TabGroup[]>('groups')) ?? [];

          // ---- delete ----
          if (action === 'delete') {
            const groupId = typeof args.groupId === 'string' ? args.groupId : '';
            const target = groups.find((g) => g.id === groupId);
            if (!target) return { status: 'not_found', groupId };

            const confirmed = await new Promise<boolean>((resolve) => {
              confirmResolveRef.current = resolve;
              setPendingConfirmation({
                toolCallId: getToolCallId(toolCall),
                toolName: 'manage_groups',
                affectedItems: [{ id: 0, title: `${target.name} (${target.tabs.length} tabs)` }],
                status: 'pending',
              });
            });

            if (!confirmed) return { status: 'cancelled' };

            await Storage.set('groups', groups.filter((g) => g.id !== groupId));
            return { status: 'success', deleted: target.name };
          }

          // ---- merge ----
          if (action === 'merge') {
            const groupIds = Array.isArray(args.groupIds) ? (args.groupIds as string[]) : [];
            const targets = groups.filter((g) => groupIds.includes(g.id));
            if (targets.length < 2) return { status: 'error', message: 'Need at least 2 groups to merge.' };

            const mergedTabs = targets.flatMap((g) => g.tabs);
            const seen = new Set<string>();
            const uniqueTabs = mergedTabs.filter((t) => (seen.has(t.url) ? false : (seen.add(t.url), true)));
            const newName = typeof args.newName === 'string' ? args.newName : targets[0].name;
            const merged: TabGroup = {
              id: crypto.randomUUID(),
              name: newName,
              tabs: uniqueTabs,
              created: Date.now(),
              modified: Date.now(),
            };
            const remaining = groups.filter((g) => !groupIds.includes(g.id));
            await Storage.set('groups', [merged, ...remaining]);
            return { status: 'success', mergedCount: targets.length, newGroupId: merged.id, name: merged.name };
          }

          // ---- split ----
          if (action === 'split') {
            const groupId = typeof args.groupId === 'string' ? args.groupId : '';
            const target = groups.find((g) => g.id === groupId);
            if (!target) return { status: 'not_found', groupId };

            const splitSize = typeof args.splitSize === 'number' ? args.splitSize : Math.ceil(target.tabs.length / 2);
            const firstTabs = target.tabs.slice(0, splitSize);
            const secondTabs = target.tabs.slice(splitSize);

            if (firstTabs.length === 0 || secondTabs.length === 0) {
              return { status: 'error', message: 'Group too small to split or splitSize out of range.' };
            }

            const secondGroupId = crypto.randomUUID();
            const secondName = typeof args.newName === 'string' ? args.newName : `${target.name} (2)`;

            const firstGroup: TabGroup = { ...target, tabs: firstTabs.map((t) => ({ ...t, groupId: target.id })), modified: Date.now() };
            const secondGroup: TabGroup = { id: secondGroupId, name: secondName, tabs: secondTabs.map((t) => ({ ...t, groupId: secondGroupId })), created: Date.now(), modified: Date.now() };

            const updated = groups.map((g) => (g.id === groupId ? firstGroup : g));
            await Storage.set('groups', [secondGroup, ...updated]);

            return {
              status: 'success',
              groups: [
                { id: firstGroup.id, name: firstGroup.name, tabCount: firstGroup.tabs.length },
                { id: secondGroup.id, name: secondGroup.name, tabCount: secondGroup.tabs.length },
              ],
            };
          }

          // ---- move_tabs ----
          if (action === 'move_tabs') {
            const sourceId = typeof args.groupId === 'string' ? args.groupId
              : typeof args.sourceGroupId === 'string' ? args.sourceGroupId : '';
            const targetId = typeof args.targetGroupId === 'string' ? args.targetGroupId
              : typeof args.destinationGroupId === 'string' ? args.destinationGroupId : '';
            const tabIds = Array.isArray(args.tabIds) ? (args.tabIds as string[]) : [];

            const source = groups.find((g) => g.id === sourceId);
            const target = groups.find((g) => g.id === targetId);
            if (!source || !target) return { status: 'not_found' };

            const moving = source.tabs.filter((t) => tabIds.includes(t.id));
            const targetUrls = new Set(target.tabs.map((t) => t.url));
            const toAdd = moving.filter((t) => !targetUrls.has(t.url)).map((t) => ({ ...t, groupId: targetId }));

            const updated = groups.map((g) => {
              if (g.id === sourceId) return { ...g, tabs: g.tabs.filter((t) => !tabIds.includes(t.id)), modified: Date.now() };
              if (g.id === targetId) return { ...g, tabs: [...g.tabs, ...toAdd], modified: Date.now() };
              return g;
            });
            await Storage.set('groups', updated);
            return { status: 'success', movedCount: toAdd.length };
          }

          // ---- edit_tabs ----
          if (action === 'edit_tabs') {
            const groupId = typeof args.groupId === 'string' ? args.groupId : '';
            const target = groups.find((g) => g.id === groupId);
            if (!target) return { status: 'not_found', groupId };

            const removeTabIds = Array.isArray(args.removeTabIds) ? (args.removeTabIds as string[]) : [];
            const tabUrlsToAdd = Array.isArray(args.tabUrls) ? (args.tabUrls as string[]) : [];

            let updatedTabs = target.tabs.filter((t) => !removeTabIds.includes(t.id));

            // Add new tabs by URL (deduplicate)
            const existingUrls = new Set(updatedTabs.map((t) => t.url));
            for (const url of tabUrlsToAdd) {
              if (!existingUrls.has(url)) {
                updatedTabs.push({
                  id: crypto.randomUUID(),
                  url,
                  title: url,
                  favicon: '',
                  timestamp: Date.now(),
                  groupId,
                });
                existingUrls.add(url);
              }
            }

            const updated = groups.map((g) =>
              g.id === groupId ? { ...g, tabs: updatedTabs, modified: Date.now() } : g
            );
            await Storage.set('groups', updated);

            return {
              status: 'success',
              added: tabUrlsToAdd.length,
              removed: removeTabIds.length,
            };
          }

          // ---- smart_organize (AI-powered two-pass semantic reorganization) ----
          if (action === 'smart_organize') {
            const preview = AIGroupOrganizerService.summarizeGroups(groups);
            if (preview.eligibleTabCount === 0) {
              return { status: 'error', message: 'No tabs to organize.' };
            }

            try {
              const result = await AIGroupOrganizerService.organizeSavedGroups();

              return {
                status: 'success',
                movedTabs: result.organizedTabCount,
                createdCategories: result.createdGroupCount,
                deletedEmptyGroups: Math.max(groups.length + result.createdGroupCount - result.groups.length, 0),
                totalGroupsRemaining: result.groups.length,
                categories: result.createdCategoryNames,
                skippedLockedGroups: result.skippedLockedGroupCount,
                batchCount: result.batchCount,
                fallbackGroupsKept: result.fallbackGroupCount,
                fallbackTabsKept: result.fallbackTabCount,
              };
            } catch (err) {
              return { status: 'error', message: err instanceof Error ? err.message : String(err) };
            }
          }

          // ---- reorganize (bulk atomic operation) ----
          if (action === 'reorganize') {
            // LLM may send tabs as [{tabId, fromGroupId}] or tabIds as [string] — handle both
            type NewGroupItem = {
              name?: string; groupName?: string;
              tabs?: Array<{ tabId: string; fromGroupId: string }>;
              tabIds?: string[];
            };

            // LLM may nest data under a "plan" key or send flat — unwrap if needed
            // LLM may nest data under "plan", "reorganizeData", or send flat — unwrap
            const wrapper = (args.plan && typeof args.plan === 'object') ? args.plan
              : (args.reorganizeData && typeof args.reorganizeData === 'object') ? args.reorganizeData
              : null;
            const data = wrapper ? (wrapper as Record<string, unknown>) : args;

            const newGroupDefs = Array.isArray(data.newGroups) ? (data.newGroups as NewGroupItem[]) : [];
            const mergeGroupIds = Array.isArray(data.mergeGroupIds) ? (data.mergeGroupIds as string[][]) : [];
            const deleteGroupIds = Array.isArray(data.deleteGroupIds) ? (data.deleteGroupIds as string[]) : [];

            // Build a mutable map of groups for atomic updates
            const groupMap = new Map(groups.map((g) => [g.id, { ...g, tabs: [...g.tabs] }]));
            // Build a reverse lookup: tabId → groupId
            const tabToGroup = new Map<string, string>();
            for (const g of groups) {
              for (const t of g.tabs) {
                tabToGroup.set(t.id, g.id);
              }
            }

            let movedCount = 0;
            let mergedCount = 0;
            let createdCount = 0;
            let deletedCount = 0;

            // 1. Execute moves — normalize LLM format variations
            // LLM may send: {tabId, fromGroupId, toGroupId} (single)
            //            or: {sourceGroupId, targetGroupId, tabIds: [...]} (batch)
            const rawMoves = Array.isArray(data.moves) ? (data.moves as Record<string, unknown>[]) : [];
            const normalizedMoves: Array<{ tabId: string; fromGroupId: string; toGroupId: string }> = [];
            for (const m of rawMoves) {
              const toId = (m.toGroupId || m.targetGroupId || m.destinationGroupId || '') as string;
              const fromId = (m.fromGroupId || m.sourceGroupId || '') as string;
              if (m.tabId && typeof m.tabId === 'string') {
                normalizedMoves.push({ tabId: m.tabId, fromGroupId: fromId, toGroupId: toId });
              } else if (Array.isArray(m.tabIds)) {
                for (const tid of m.tabIds as string[]) {
                  normalizedMoves.push({ tabId: tid, fromGroupId: fromId, toGroupId: toId });
                }
              }
            }

            for (const m of normalizedMoves) {
              const srcId = m.fromGroupId || tabToGroup.get(m.tabId) || '';
              const src = groupMap.get(srcId);
              const dst = groupMap.get(m.toGroupId);
              if (!src || !dst) continue;
              const tabIdx = src.tabs.findIndex((t) => t.id === m.tabId);
              if (tabIdx === -1) continue;
              const [tab] = src.tabs.splice(tabIdx, 1);
              if (!dst.tabs.some((t) => t.url === tab.url)) {
                dst.tabs.push(tab);
              }
              src.modified = Date.now();
              dst.modified = Date.now();
              movedCount++;
            }

            // 2. Create new groups from tabs in existing groups
            // Handle both formats: ng.tabs = [{tabId, fromGroupId}] or ng.tabIds = [string]
            for (const ng of newGroupDefs) {
              const groupName = ng.name || ng.groupName || 'Unnamed';
              const newGroup = {
                id: crypto.randomUUID(),
                name: groupName,
                tabs: [] as typeof groups[0]['tabs'],
                created: Date.now(),
                modified: Date.now(),
              };

              // Resolve tab IDs — handle both formats
              const resolvedTabs: Array<{ tabId: string; fromGroupId: string }> = [];
              if (Array.isArray(ng.tabs) && ng.tabs.length > 0) {
                for (const t of ng.tabs) {
                  resolvedTabs.push({ tabId: t.tabId, fromGroupId: t.fromGroupId || tabToGroup.get(t.tabId) || '' });
                }
              } else if (Array.isArray(ng.tabIds)) {
                for (const tid of ng.tabIds) {
                  resolvedTabs.push({ tabId: tid, fromGroupId: tabToGroup.get(tid) || '' });
                }
              }

              for (const t of resolvedTabs) {
                const src = groupMap.get(t.fromGroupId);
                if (!src) continue;
                const tabIdx = src.tabs.findIndex((tab) => tab.id === t.tabId);
                if (tabIdx === -1) continue;
                const [tab] = src.tabs.splice(tabIdx, 1);
                newGroup.tabs.push(tab);
                src.modified = Date.now();
                movedCount++;
              }
              if (newGroup.tabs.length > 0) {
                groupMap.set(newGroup.id, newGroup as typeof groups[0]);
                createdCount++;
              }
            }

            // 3. Merge groups — combine into first group of each set
            for (const mergeSet of mergeGroupIds) {
              if (mergeSet.length < 2) continue;
              const primary = groupMap.get(mergeSet[0]);
              if (!primary) continue;
              const urlSet = new Set(primary.tabs.map((t) => t.url));
              for (let i = 1; i < mergeSet.length; i++) {
                const src = groupMap.get(mergeSet[i]);
                if (!src) continue;
                for (const tab of src.tabs) {
                  if (!urlSet.has(tab.url)) {
                    primary.tabs.push(tab);
                    urlSet.add(tab.url);
                  }
                }
                groupMap.delete(mergeSet[i]);
                mergedCount++;
              }
              primary.modified = Date.now();
            }

            // 4. Delete empty groups
            for (const gid of deleteGroupIds) {
              const g = groupMap.get(gid);
              if (g && g.tabs.length === 0) {
                groupMap.delete(gid);
                deletedCount++;
              }
            }

            // Also auto-delete any group that became empty after moves
            for (const [gid, g] of groupMap) {
              if (g.tabs.length === 0 && !deleteGroupIds.includes(gid)) {
                groupMap.delete(gid);
                deletedCount++;
              }
            }

            // Persist atomically
            await Storage.set('groups', Array.from(groupMap.values()));

            return {
              status: 'success',
              movedTabs: movedCount,
              mergedGroups: mergedCount,
              createdGroups: createdCount,
              deletedEmptyGroups: deletedCount,
              totalGroupsRemaining: groupMap.size,
            };
          }

          return { status: 'error', message: `Unknown manage_groups action: ${action}` };
        }

        // --------------------------------------------------------------------
        // create_flow_rule / block_site — validated writes, see ai-flow-focus-tools
        // --------------------------------------------------------------------
        // --------------------------------------------------------------------
        // manage_brain_dump — create / update; delete waits for the card
        // --------------------------------------------------------------------
        if (toolName === 'manage_brain_dump') {
          try {
            const tools = await import('@/services/ai-brain-dump-reminder-tools');
            if (args.action !== 'delete') return await tools.runBrainDumpAction(args);

            const plan = await tools.prepareBrainDumpDelete(args);
            if ('status' in plan) return plan;

            const confirmed = await new Promise<boolean>((resolve) => {
              confirmResolveRef.current = resolve;
              setPendingConfirmation({
                toolCallId: getToolCallId(toolCall),
                toolName: 'manage_brain_dump',
                affectedItems: plan.items.map((item, index) => ({ id: index, title: item.snippet })),
                status: 'pending',
              });
            });
            if (!confirmed) return { status: 'cancelled' };
            return await tools.deleteBrainDumpEntries(plan);
          } catch (err) {
            return { status: 'error', message: String(err) };
          }
        }

        // --------------------------------------------------------------------
        // set_reminder — create / list / delete reminders
        // --------------------------------------------------------------------
        if (toolName === 'set_reminder') {
          try {
            const { runReminderAction } = await import('@/services/ai-brain-dump-reminder-tools');
            return await runReminderAction(args);
          } catch (err) {
            return { status: 'error', message: String(err) };
          }
        }

        if (toolName === 'create_flow_rule' || toolName === 'block_site') {
          try {
            const { createFlowRuleFromAI, blockSitesFromAI } = await import('@/services/ai-flow-focus-tools');
            return toolName === 'create_flow_rule'
              ? await createFlowRuleFromAI(args)
              : await blockSitesFromAI(args);
          } catch (err) {
            return { status: 'error', message: String(err) };
          }
        }

        // --------------------------------------------------------------------
        // <app>__<action> — act in a connected app (create event, issue...)
        // after a confirmation card, unless the user always-allowed these.
        // Posting to shared places or publishing always asks.
        // --------------------------------------------------------------------
        if (isAIIntegrationToolName(toolName)) {
          try {
            const tools = await import('@/services/ai-integration-tools');
            const plan = await tools.prepareAIIntegrationAction(toolName, args);
            if ('status' in plan) return plan;

            // The same action already did not go through this turn: answer
            // with that error instead of asking the user to confirm it again.
            const earlierError = previousToolError(
              (chatRef.current?.messages ?? []) as Parameters<typeof previousToolError>[0],
              toolName,
              args,
            );
            if (earlierError) return earlierError;

            const settings = await AIService.getSettings();
            if (tools.shouldConfirmIntegrationAction(plan, settings.alwaysAllowIntegrationActions)) {
              const confirmed = await new Promise<boolean>((resolve) => {
                confirmResolveRef.current = resolve;
                setPendingConfirmation({
                  toolCallId: getToolCallId(toolCall),
                  toolName: 'integration_action',
                  integrationName: plan.integrationName,
                  affectedItems: plan.details.map((detail, index) => ({ id: index, title: detail })),
                  // "Always allow" would not apply to this action, so do not offer it.
                  allowAlwaysAllow: !plan.alwaysConfirm,
                  status: 'pending',
                });
              });
              if (!confirmed) return { status: 'cancelled' };
            }
            return await tools.runAIIntegrationTool(toolName, args);
          } catch (err) {
            return { status: 'error', message: String(err) };
          }
        }

        // Unknown tool
        return { status: 'error', message: `Unknown tool: ${toolName}` };
      })().then(async (toolOutput) => {

        // Send tool result back via SDK's addToolOutput.
        // This triggers the SDK to send the result to the LLM which
        // then generates a text response — no manual follow-up needed.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = chatRef.current as any;
        if (!c) return;

        // Tool errors are not rendered in the thread; keep them findable.
        if ((toolOutput as { status?: unknown } | null)?.status === 'error') {
          console.debug('[BlueTab][AI] tool error:', toolName, (toolOutput as { message?: unknown }).message);
        }

        try {
          // The tool is done; from here the model is writing its reply.
          setCurrentToolName(AI_REPLY_PHASE);
          if (c.addToolOutput) {
            await c.addToolOutput({ toolCallId, tool: toolName, output: toolOutput });
          } else if (c.addToolResult) {
            await c.addToolResult({ toolCallId, tool: toolName, output: toolOutput });
          }
        } catch (err) {
          console.error('[BlueTab][AI] addToolOutput error:', err);
        }
      }).catch((err) => {
        console.error('[BlueTab][AI] tool execution error:', err);
      });
    }) as ChatInit<UIMessage>['onToolCall'],
  };

  const chatRef = useRef<ReturnType<typeof useChat> | null>(null);
  const chat = useChat(chatInit);
  chatRef.current = chat;

  // A pending confirmation must never outlive its turn: a new message, edit,
  // regenerate, Stop or thread change resolves it as cancelled right away, so
  // the tool promise does not hang and a late "Confirm" cannot act on a stale
  // conversation.
  const dismissPendingConfirmation = useCallback(() => {
    if (!confirmResolveRef.current) return;
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setPendingConfirmation(null);
    resolve(false);
  }, []);

  // The assistant-ui runtime calls these helpers directly (composer, edit,
  // reload, stop), so the guard is applied to the object it receives.
  const runtimeChat = useMemo<ReturnType<typeof useChat>>(() => ({
    ...chat,
    sendMessage: ((...args: Parameters<typeof chat.sendMessage>) => {
      dismissPendingConfirmation();
      setToolLoopStopped(null);
      return chat.sendMessage(...args);
    }) as typeof chat.sendMessage,
    regenerate: ((...args: Parameters<typeof chat.regenerate>) => {
      dismissPendingConfirmation();
      setToolLoopStopped(null);
      return chat.regenerate(...args);
    }) as typeof chat.regenerate,
    setMessages: ((...args: Parameters<typeof chat.setMessages>) => {
      dismissPendingConfirmation();
      return chat.setMessages(...args);
    }) as typeof chat.setMessages,
    stop: (() => {
      dismissPendingConfirmation();
      return chat.stop();
    }) as typeof chat.stop,
  }), [chat, dismissPendingConfirmation]);

  // -------------------------------------------------------------------------
  // Currently executing tool name — set imperatively in onToolCall handler
  // Used by AIChatThread to show action-specific loading messages
  // -------------------------------------------------------------------------
  const [currentToolName, setCurrentToolName] = useState<string | null>(null);
  /** Set when the automatic tool loop was stopped for this turn. */
  const [toolLoopStopped, setToolLoopStopped] = useState<ToolLoopStop | null>(null);

  // Clear currentToolName only when the entire conversation turn is done
  // This keeps the loading indicator visible through: tool execution → addToolOutput → LLM text streaming
  useEffect(() => {
    if (chat.status === 'ready' || chat.status === 'error') {
      setCurrentToolName(null);
    }
  }, [chat.status]);

  // -------------------------------------------------------------------------
  // Multi-thread chat history
  // -------------------------------------------------------------------------
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>('');
  const historyLoaded = useRef(false);
  // Mirror of `threads` so actions can compute the next list synchronously
  // and write it once, outside React state updaters.
  const threadsRef = useRef<ChatThread[]>([]);

  const commitThreads = useCallback((next: ChatThread[]) => {
    threadsRef.current = next;
    setThreads(next);
    Storage.set(THREADS_KEY, next).catch(() => {});
  }, []);

  // Load threads and active thread on mount
  useEffect(() => {
    if (historyLoaded.current) return;
    historyLoaded.current = true;

    (async () => {
      try {
        const saved = (await Storage.get<ChatThread[]>(THREADS_KEY)) ?? [];
        const activeId = (await Storage.get<string>(ACTIVE_THREAD_KEY)) ?? '';

        if (saved.length > 0) {
          threadsRef.current = saved;
          setThreads(saved);
          const target = saved.find((t) => t.id === activeId) ?? saved[0];
          setActiveThreadId(target.id);
          if (target.messages.length > 0) {
            try {
              chat.setMessages(toRuntimeMessages(target.messages));
            } catch {
              chat.setMessages([]);
            }
          }
        } else {
          // First time — create an initial thread
          const thread = createFreshThread();
          commitThreads([thread]);
          setActiveThreadId(thread.id);
          await Storage.set(ACTIVE_THREAD_KEY, thread.id);
        }
      } catch {
        // Non-critical
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced save of the active thread. Kept in a ref so thread actions can
  // flush or cancel it.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleRuntimeMessage = (
      message: { type?: string },
    ): boolean => {
      if (message?.type !== 'AI_HISTORY_CLEARED') {
        return false;
      }

      const freshThread = createFreshThread();
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }

      dismissPendingConfirmation();
      chat.setMessages([]);
      commitThreads([freshThread]);
      setActiveThreadId(freshThread.id);
      Storage.set(ACTIVE_THREAD_KEY, freshThread.id).catch(() => {});
      return false;
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  }, [chat, commitThreads, dismissPendingConfirmation]);

  /** Threads with the active thread's current messages folded in. */
  const withActiveMessages = useCallback((source: ChatThread[], now: number = Date.now()): ChatThread[] => {
    const messages = chatRef.current?.messages ?? [];
    return source.map((t) => {
      if (t.id !== activeThreadId) return t;
      const firstUserText = messages.find((m) => m.role === 'user')?.parts
        ?.find((p): p is { type: 'text'; text: string } => p.type === 'text')
        ?.text;
      return {
        ...t,
        messages: toStoredMessages(messages),
        modified: now,
        // Auto-title from first user message
        title: t.title === 'New chat' && firstUserText ? firstUserText.slice(0, 40) : t.title,
      };
    });
  }, [activeThreadId]);

  // Save active thread messages on change (debounced). Waits for the stream
  // to settle so a reply is written once, not on every token.
  useEffect(() => {
    if (!historyLoaded.current || !activeThreadId) return;
    if (chat.status === 'streaming' || chat.status === 'submitted') return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      commitThreads(withActiveMessages(threadsRef.current));
    }, 1000);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [chat.messages, chat.status, activeThreadId, commitThreads, withActiveMessages]);

  /** Write the active thread now and cancel the pending debounced save. */
  const flushActiveThread = useCallback((): ChatThread[] => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    return withActiveMessages(threadsRef.current);
  }, [withActiveMessages]);

  // New chat
  const newChat = useCallback(async () => {
    dismissPendingConfirmation();
    const thread = createFreshThread();
    // One write: current thread saved + new thread on top.
    commitThreads([thread, ...flushActiveThread()].slice(0, MAX_THREADS));
    setActiveThreadId(thread.id);
    chat.setMessages([]);
    await Storage.set(ACTIVE_THREAD_KEY, thread.id);
  }, [chat, commitThreads, dismissPendingConfirmation, flushActiveThread]);

  // Switch thread
  const switchThread = useCallback(async (threadId: string) => {
    if (threadId === activeThreadId) return;
    dismissPendingConfirmation();

    // Save the current thread and read the target from the same snapshot,
    // instead of re-reading storage while the write is still in flight.
    const next = flushActiveThread();
    commitThreads(next);
    const target = next.find((t) => t.id === threadId);
    if (!target) return;

    try {
      chat.setMessages(toRuntimeMessages(target.messages));
    } catch {
      chat.setMessages([]);
    }
    setActiveThreadId(threadId);
    await Storage.set(ACTIVE_THREAD_KEY, threadId);
  }, [activeThreadId, chat, commitThreads, dismissPendingConfirmation, flushActiveThread]);

  // Delete thread
  const deleteThread = useCallback(async (threadId: string) => {
    const deletingActive = threadId === activeThreadId;
    if (deletingActive) {
      dismissPendingConfirmation();
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    }

    const remaining = (deletingActive ? threadsRef.current : flushActiveThread())
      .filter((t) => t.id !== threadId);

    if (!deletingActive) {
      commitThreads(remaining);
      return;
    }

    const next = remaining[0] ?? createFreshThread();
    commitThreads(remaining.length > 0 ? remaining : [next]);
    chat.setMessages(toRuntimeMessages(next.messages));
    setActiveThreadId(next.id);
    await Storage.set(ACTIVE_THREAD_KEY, next.id);
  }, [activeThreadId, chat, commitThreads, dismissPendingConfirmation, flushActiveThread]);

  // -------------------------------------------------------------------------
  // Wrapped sendMessage — auto-cancels pending confirmation
  // Auth + context injection is handled by transport (headers/body callbacks)
  // -------------------------------------------------------------------------
  const sendMessage = useCallback(
    async (text: string) => {
      // Auto-cancel any pending destructive confirmation before new message
      dismissPendingConfirmation();
      setToolLoopStopped(null);
      await chat.sendMessage({ text });
    },
    [chat, dismissPendingConfirmation]
  );

  // -------------------------------------------------------------------------
  // Confirmation handlers
  // -------------------------------------------------------------------------
  const confirmAction = useCallback((options?: { alwaysAllowIntegrations?: boolean }) => {
    if (options?.alwaysAllowIntegrations) {
      void AIService.getSettings()
        .then((settings) => AIService.saveSettings({ ...settings, alwaysAllowIntegrationActions: true }))
        .catch((err) => console.error('[BlueTab][AI] could not save always-allow:', err));
    }
    if (confirmResolveRef.current) {
      setPendingConfirmation((prev) =>
        prev ? { ...prev, status: 'confirmed' } : null
      );
      confirmResolveRef.current(true);
      confirmResolveRef.current = null;
      // Clear confirmation card after brief delay to show "completed" state
      setTimeout(() => setPendingConfirmation(null), 1500);
    }
  }, []);

  const cancelAction = useCallback(() => {
    if (confirmResolveRef.current) {
      setPendingConfirmation((prev) =>
        prev ? { ...prev, status: 'cancelled' } : null
      );
      confirmResolveRef.current(false);
      confirmResolveRef.current = null;
      // Clear confirmation card after brief delay to show "cancelled" state
      setTimeout(() => setPendingConfirmation(null), 1500);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------
  return {
    messages: chat.messages,
    sendMessage,
    isLoading: chat.status === 'submitted' || chat.status === 'streaming',
    error: chat.error,
    pendingConfirmation,
    confirmAction,
    cancelAction,
    chat: runtimeChat,
    currentToolName,
    toolLoopStopped,
    threads,
    activeThreadId,
    newChat,
    switchThread,
    deleteThread,
  };
}
