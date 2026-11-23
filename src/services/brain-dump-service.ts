import { findSearchMatch, normalizeForSearch } from '@/utils/search-text';
/**
 * @module services/brain-dump-service
 *
 * WHY:  Phase 9 ADHD-21..23 ship a zero-friction thought capture Inbox.
 *       Users press a shortcut, type a thought, hit Enter — the entry lands
 *       here. The service is the single authority that (a) enforces the
 *       "text is the only required field" contract, (b) bounds the Inbox
 *       via RingBuffer(200) so the BRAIN_DUMP storage budget is never
 *       exceeded, and (c) persists the modal's last attach/detach choice
 *       so subsequent captures default to whatever the user chose last,
 *       and owns the first-class feature gate now that Brain Dump no
 *       longer lives under ADHD Mode.
 *
 * WHAT: Static BrainDumpService class with:
 *       - add({ text, tabContext? }) — trims, rejects empty/whitespace
 *         text, generates id + createdAt, pushes through RingBuffer(200),
 *         persists, returns the full new array
 *       - list() — returns the stored entries or []
 *       - delete(id) — filters, persists, returns the new array
 *       - getPrefs() — returns { enabled: true, tabContextDefault: true } when unset
 *       - setPrefs(partial) — merges and persists feature preferences
 *       - isEnabled() — returns the feature gate; default true
 *
 * HOW:  - Reads/writes chrome.storage.local via the existing Storage wrapper.
 *       - RingBuffer capacity BRAIN_DUMP_CAPACITY (200) with oldest-evicted
 *         semantics — matches STORAGE_BUDGETS.BRAIN_DUMP (200KB) at ~1KB
 *         per entry upper bound.
 *       - id generated via crypto.randomUUID() when available; falls back
 *         to Date.now() + Math.random() in contexts where randomUUID is
 *         missing (older service-worker runtimes, some jsdom shims).
 *
 * NOT:  Does not dispatch the shortcut or inject the content-script modal
 *         — the service worker does that (service-worker.ts handles
 *         chrome.commands.onCommand('brain-dump') and the
 *         chrome.scripting.executeScript injection).
 *       Does not validate with Zod — the shape is narrow and the TS
 *         contract covers the wire protocol.
 *       Does not sync Brain Dump preferences — destination overrides and
 *         integration choices stay device-local. Inbox entries sync through
 *         the encrypted normal sync pipeline when sync is enabled.
 */

import { Storage } from '@/utils/storage';
import { RingBuffer } from '@/utils/ring-buffer';
import {
  BRAIN_DUMP_INBOX_KEY,
  BRAIN_DUMP_PREFS_KEY,
  BRAIN_DUMP_CAPACITY,
  type BrainDumpEntry,
  type BrainDumpPrefs,
} from '@/types/adhd';
import { getValidToken } from './integration-token-storage';
import { getBrainDumpDestination, routeBrainDumpIfConfigured } from './integration-service';
import { executeProviderRequest } from './integrations/cloud-operation-client';

const LOG_PREFIX = '[BlueTab][BrainDumpService]';

const inboxBuffer = new RingBuffer<BrainDumpEntry>(BRAIN_DUMP_CAPACITY);

const DEFAULT_PREFS: BrainDumpPrefs = {
  enabled: true,
  tabContextDefault: true,
  linkedPageIndicatorEnabled: true,
};

/**
 * Separator inserted between the existing text and the newly-captured
 * text when two captures on the same tabContext.url are merged. Picked
 * to read cleanly in the inline edit textarea: blank line, visual
 * divider, blank line. Exported for test assertions.
 */
export const BRAIN_DUMP_MERGE_SEPARATOR = '\n\n---\n\n';

function generateId(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface AddBrainDumpInput {
  text: string;
  tabContext?: BrainDumpEntry['tabContext'];
  skipConfiguredRouting?: boolean;
}

/**
 * The Settings "auto-route to Notion" toggle covers every capture, including
 * ones saved to "Bluetab inbox" (destination null) or to another integration.
 * Only an explicit Notion destination skips it so the entry is not written twice.
 */
export function skipsConfiguredRouting(
  destination: { integrationId?: string } | null | undefined,
): boolean {
  return destination?.integrationId === 'notion';
}

export interface BrainDumpSearchResult {
  id: string;
  snippet: string;
  createdAt: number;
  updatedAt?: number;
  tabTitle?: string;
  tabUrl?: string;
  fullText?: string;
}

export interface BrainDumpSearchResponse {
  results: BrainDumpSearchResult[];
  totalCount: number;
}

function normalizeSearchText(value: string): string {
  return normalizeForSearch(value)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchTokens(value: string): string[] {
  return normalizeSearchText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function sharesTokenStem(left: string, right: string): boolean {
  let sharedPrefixLength = 0;
  const max = Math.min(left.length, right.length);
  while (sharedPrefixLength < max && left[sharedPrefixLength] === right[sharedPrefixLength]) {
    sharedPrefixLength += 1;
  }

  if (sharedPrefixLength >= 4) {
    return true;
  }

  return sharedPrefixLength >= 3 && Math.min(left.length, right.length) >= 5;
}

function matchesSearchQuery(entry: BrainDumpEntry, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const haystack = [
    entry.text,
    entry.tabContext?.title ?? '',
    entry.tabContext?.url ?? '',
  ].join(' ');
  const normalizedHaystack = normalizeSearchText(haystack);
  if (normalizedHaystack.includes(normalizedQuery)) {
    return true;
  }

  const queryTokens = buildSearchTokens(query);
  if (queryTokens.length === 0) {
    return true;
  }

  const haystackTokens = buildSearchTokens(haystack);
  return queryTokens.some((queryToken) =>
    haystackTokens.some((haystackToken) =>
      (queryToken.length >= 3 && haystackToken.includes(queryToken))
      || sharesTokenStem(queryToken, haystackToken),
    ),
  );
}

function buildSnippet(text: string, query: string, maxLength: number = 180): string {
  if (!text) return '';
  if (!query.trim()) {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
  }

  const match = findSearchMatch(text, query);
  if (!match) {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
  }

  const start = Math.max(0, match.start - Math.floor((maxLength - (match.end - match.start)) / 2));
  const end = Math.min(text.length, start + maxLength);
  const raw = text.slice(start, end);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${raw}${suffix}`;
}

export class BrainDumpService {
  /**
   * Append a new entry to the Inbox. Throws if `text` is empty or
   * whitespace-only — the thought text is the one required field
   * (ADHD-21). Returns the full new array so callers can render the
   * update without a round-trip read.
   *
   * Post-ship iteration round 2 — dedup-on-capture: when the new input has
   * a tabContext.url AND an existing entry in the Inbox already has the
   * same URL, the two are MERGED instead of a new row being added. The
   * merge rules are:
   *   - text: existing + BRAIN_DUMP_MERGE_SEPARATOR + new (append, not
   *     replace — the user is adding context on the same page, not
   *     overwriting the original thought)
   *   - createdAt: keep earliest (the existing entry's)
   *   - updatedAt: stamp to Date.now()
   *   - tabContext: keep existing (already-captured title/favicon tends
   *     to be better than re-captures, where favicon may be missing)
   * Linkless captures (no tabContext.url) never dedupe — two linkless
   * thoughts are assumed to be distinct. This is the Inbox-hygiene
   * version of "if you paste the same link twice, you probably meant to
   * add a second thought to the first capture, not double-up."
   */
  static async add(input: AddBrainDumpInput): Promise<BrainDumpEntry[]> {
    const trimmed = input.text.trim();
    if (trimmed.length === 0) {
      throw new Error('Brain Dump entry requires thought text.');
    }

    const current = (await Storage.get<BrainDumpEntry[]>(BRAIN_DUMP_INBOX_KEY)) ?? [];

    // Dedup-on-capture path — only fires for captures that carry a URL.
    const newUrl = input.tabContext?.url;
    if (newUrl) {
      const existingIdx = current.findIndex(
        (e) => e.tabContext?.url === newUrl,
      );
      if (existingIdx !== -1) {
        const existing = current[existingIdx];
        const merged: BrainDumpEntry = {
          ...existing,
          text: `${existing.text}${BRAIN_DUMP_MERGE_SEPARATOR}${trimmed}`,
          updatedAt: Date.now(),
          // Preserve the original tabContext — first capture tends to
          // have the freshest favicon + title. If the existing entry
          // somehow lacked tabContext (legacy data) fall back to the
          // incoming one.
          ...(existing.tabContext
            ? {}
            : input.tabContext
              ? { tabContext: input.tabContext }
              : {}),
        };
        // Return the merged entry as the LAST element so callers that use
        // inboxAfter[inboxAfter.length - 1] always receive the correct entry,
        // regardless of where the original sits in the list.
        const rest = current.filter((_, i) => i !== existingIdx);
        const next = [...rest, merged];
        await Storage.set(BRAIN_DUMP_INBOX_KEY, next);
        console.log(
          `${LOG_PREFIX} merged duplicate-URL capture into existing entry (${next.length}/${BRAIN_DUMP_CAPACITY})`,
        );
        // Auto-route the merged entry as well so Notion mirrors the latest
        // text. The Notion side appends another row rather than mutating —
        // not ideal for dedupe, but acceptable for v1.
        if (!input.skipConfiguredRouting) {
          void (async () => {
            try {
              await routeBrainDumpIfConfigured(merged);
            } catch {
              /* fire-and-forget */
            }
          })();
        }
        return next;
      }
    }

    const entry: BrainDumpEntry = {
      id: generateId(),
      text: trimmed,
      createdAt: Date.now(),
      ...(input.tabContext ? { tabContext: input.tabContext } : {}),
    };

    const next = inboxBuffer.push(current, entry);
    await Storage.set(BRAIN_DUMP_INBOX_KEY, next);
    console.log(`${LOG_PREFIX} captured entry (${next.length}/${BRAIN_DUMP_CAPACITY})`);

    // Best-effort Notion auto-route. Off by default; only fires when the
    // user enabled the Settings checkbox + picked a destination. Errors
    // are swallowed so a Notion outage never blocks the local capture.
    if (!input.skipConfiguredRouting) {
      void (async () => {
        try {
          await routeBrainDumpIfConfigured(entry);
        } catch {
          /* fire-and-forget */
        }
      })();
    }

    return next;
  }

  /** Read the Inbox. Returns [] when storage is unset. */
  static async list(): Promise<BrainDumpEntry[]> {
    const stored = await Storage.get<BrainDumpEntry[]>(BRAIN_DUMP_INBOX_KEY);
    return stored ?? [];
  }

  /**
   * Search the Inbox by text, captured tab title, or captured tab URL.
   * Empty query returns newest entries first so callers can browse the inbox.
   */
  static async search(
    query: string,
    limit?: number,
    options: { includeFullText?: boolean } = {},
  ): Promise<BrainDumpSearchResponse> {
    const entries = await BrainDumpService.list();
    const browseAll = normalizeSearchText(query).length === 0;
    const normalizedLimit = Math.max(1, Math.min(limit ?? (browseAll ? 20 : 5), 20));

    const filtered = entries.filter((entry) => matchesSearchQuery(entry, query));
    const sorted = filtered
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    const page = sorted.slice(0, normalizedLimit);

    return {
      totalCount: filtered.length,
      results: page.map((entry) => ({
        id: entry.id,
        snippet: buildSnippet(entry.text, query),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        tabTitle: entry.tabContext?.title,
        tabUrl: entry.tabContext?.url,
        ...(options.includeFullText ? { fullText: entry.text } : {}),
      })),
    };
  }

  /** Fetch a single Inbox entry by id for full-content reads. */
  static async getEntry(id: string): Promise<BrainDumpEntry | null> {
    const entries = await BrainDumpService.list();
    return entries.find((entry) => entry.id === id) ?? null;
  }

  /** Remove an entry by id. Returns the full new array. */
  static async delete(id: string): Promise<BrainDumpEntry[]> {
    const current = (await Storage.get<BrainDumpEntry[]>(BRAIN_DUMP_INBOX_KEY)) ?? [];
    const entryToDelete = current.find((e) => e.id === id);
    const next = current.filter((e) => e.id !== id);
    await Storage.set(BRAIN_DUMP_INBOX_KEY, next);

    // Also delete from Notion if brain dump destination is configured
    if (entryToDelete) {
      void BrainDumpService.deleteFromNotion(entryToDelete);
    }

    return next;
  }

  /**
   * Update an existing entry's text in place. Used by the Dump panel's
   * inline click-to-edit affordance. Preserves `createdAt` (ordering stays
   * stable) and stamps `updatedAt` so the UI can surface "edited" state
   * later if needed. Rejects empty / whitespace-only text the same way
   * `add` does — the text field is still the one required field.
   * Returns the full new array; no-op write if the id is not found (the
   * entry may have been deleted in another surface between load and save).
   */
  static async updateEntry(
    id: string,
    patch: { text: string },
  ): Promise<BrainDumpEntry[]> {
    const trimmed = patch.text.trim();
    if (trimmed.length === 0) {
      throw new Error('Brain Dump entry requires thought text.');
    }

    const current = (await Storage.get<BrainDumpEntry[]>(BRAIN_DUMP_INBOX_KEY)) ?? [];
    let changed = false;
    const next = current.map((e) => {
      if (e.id !== id) return e;
      changed = true;
      return { ...e, text: trimmed, updatedAt: Date.now() };
    });
    if (!changed) return current;
    await Storage.set(BRAIN_DUMP_INBOX_KEY, next);
    return next;
  }

  /**
   * Read the capture-modal preferences. Falls back to
   * `{ enabled: true, tabContextDefault: true }` on first use. Brain Dump
   * is now a first-class, default-on feature; the tab-context default
   * remains attached on first use (ADHD-22).
   */
  static async getPrefs(): Promise<BrainDumpPrefs> {
    const stored = await Storage.get<BrainDumpPrefs>(BRAIN_DUMP_PREFS_KEY);
    if (!stored) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...stored };
  }

  static async isEnabled(): Promise<boolean> {
    const prefs = await BrainDumpService.getPrefs();
    return prefs.enabled !== false;
  }

  /**
   * Persist Brain Dump preferences. Merges with the current stored value
   * so single-field callers do not accidentally drop destinationOverride
   * or the default-on feature gate.
   */
  static async setPrefs(prefs: Partial<BrainDumpPrefs>): Promise<void> {
    const current = await BrainDumpService.getPrefs();
    await Storage.set(BRAIN_DUMP_PREFS_KEY, { ...current, ...prefs });
  }

  static subscribePrefs(listener: (prefs: BrainDumpPrefs) => void): () => void {
    const handleChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      const change = changes[BRAIN_DUMP_PREFS_KEY];
      if (!change) return;
      listener({ ...DEFAULT_PREFS, ...(change.newValue as Partial<BrainDumpPrefs> | undefined) });
    };

    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
  }

  /** Delete brain dump entry from Notion database if destination is configured */
  static async deleteFromNotion(entry: BrainDumpEntry): Promise<void> {
    try {
      const dest = await getBrainDumpDestination();
      if (!dest) return;

      const accessToken = await getValidToken('notion', dest.accountId);

      // Find the Notion page by title (first 100 chars of text)
      const title = entry.text.slice(0, 100);
      const query = {
        filter: {
          property: 'Name',
          title: { equals: title },
        },
        page_size: 10,
      };

      const response = await executeProviderRequest(
        accessToken,
        'notion.database.query',
        { databaseId: dest.databaseId, body: query },
        () => fetch(`https://api.notion.com/v1/databases/${dest.databaseId}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28',
          },
          body: JSON.stringify(query),
        }),
      );

      if (!response.ok) return;

      const data = await response.json();
      const pages = data.results || [];

      // Archive matching pages
      for (const page of pages) {
        if (page.id) {
          await executeProviderRequest(
            accessToken,
            'notion.page.update',
            { pageId: page.id, body: { archived: true } },
            () => fetch(`https://api.notion.com/v1/pages/${page.id}`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Notion-Version': '2022-06-28',
              },
              body: JSON.stringify({ archived: true }),
            }),
          );
        }
      }

      console.log(`[BlueTab][BrainDump] Deleted from Notion: ${title}`);
    } catch (err) {
      console.warn('[BlueTab][BrainDump] Notion delete did not complete:', err);
    }
  }
}
