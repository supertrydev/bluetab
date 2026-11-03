/**
 * @module services/offline-reading-service
 *
 * WHY:  Phase 10 OFFL-01..10 ship opt-in offline article caching backed by
 *       IndexedDB. OfflineReadingService is the single authority that:
 *       (a) opens and upgrades the `bluetab_offline` IDB database,
 *       (b) saves article metadata + hero image Blob atomically in one
 *           transaction so a partial write never corrupts the store,
 *       (c) exposes retrieval, deletion, and quota helpers consumed by the
 *           Offline Reading page (Wave 3),
 *       (d) validates content via contentGate (<500 chars OR <200 words
 *           triggers a non-silent failure) and classifies failures into one
 *           of three distinguishable buckets (OFFL-06),
 *       (e) guards storage via getOfflineQuota() (warn >=80%, block >=95%,
 *           OFFL-08).
 *
 *       MOD-04 note: whenever a Bluetab group is deleted, callers MUST call
 *       OfflineReadingService.deleteByGroupId(groupId) to cascade-delete
 *       orphaned offline articles. This service does not observe group
 *       deletions autonomously.
 *
 * WHAT: Static OfflineReadingService class exposing:
 *       Database: openOfflineDB
 *       Writes:   saveArticleAtomic, markRead, setPinned
 *       Reads:    getArticlesByGroup, getAllArticles, getArticle, getHeroBlob,
 *                 getOldestUnread, getOfflineQuota
 *       Deletes:  deleteByGroupId, deleteArticle, deleteAll
 *       Logic:    contentGate, pickFailureBucket
 *       Stubs:    enqueueExtraction (Wave 2 fills this in)
 *
 * HOW:  - Uses `idb` v8 TypeScript generics for compile-time store/index
 *           type safety.
 *       - DB name: `bluetab_offline`, schema version 1.
 *       - Two stores: `articles` (keyPath `id`) and `heroImages` (keyPath
 *           `articleId`). Articles indexed by `sourceGroupId` (by-group),
 *           `savedAt` (by-saved-at), and `pinned` (by-pinned).
 *       - Atomic save: article + optional heroBlob written in a single
 *           readwrite tx; `await tx.done` commits both.
 *       - navigator.storage.estimate() is called from options-page context
 *           (see RESEARCH.md Pitfall 2). getOfflineQuota() is safe from any
 *           context that has `navigator.storage`.
 *       - Log prefix: `[BlueTab][OfflineReading]`.
 *
 * NOT:  Does not call chrome.scripting.executeScript against any tab the
 *       user opened (OFFL-02 refined — see 10-CONTEXT.md §Extraction).
 *       Does not query existing open tabs via chrome.tabs API (OFFL-02 contract).
 *       Does not run a daily eviction alarm (OFFL-09 refined — see
 *       10-CONTEXT.md §Storage). Cleanup is user-approved.
 *       Does not implement the extraction dispatch / retry queue — Wave 2.
 */

import { sendOffscreenMessage } from '@/platform/offscreen-bridge';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  OfflineArticle,
  OfflineExtractionFailureBucket,
  OfflineExtractionResult,
  OfflineFailureRecord,
  OfflineQuota,
  ExtractionStatusSnapshot,
} from '@/types/offline-reading';
import {
  ensureReason as ensureOffscreenReason,
  releaseReason as releaseOffscreenReason,
} from '@/services/offscreen-manager';

const LOG_PREFIX = '[BlueTab][OfflineReading]';

// ---------------------------------------------------------------------------
// Wave 2 — Queue + concurrency + offscreen lifecycle constants
// ---------------------------------------------------------------------------

const CONCURRENCY_CAP = 3;
const BACKOFF_MS = [5000, 15000];
const QUEUE_KEY = 'offline_extraction_queue';
type ExtractionJob = {
  batchId: string;
  groupId: string;
  tabId: string;
  url: string;
  attempts: number;
  lastError?: string;
};

/**
 * Per-batch progress state. Each enqueueExtraction call owns its own BatchState
 * keyed by batchId; retries (even via setTimeout) carry the same batchId so
 * the counters stay scoped to the original user action.
 *
 * `pending` = jobs awaiting a retry setTimeout (not in-flight, not counted yet).
 * Batch lifecycle ends when completed + failed >= total AND pending === 0,
 * at which point the entry is removed on the next tick.
 */
interface BatchState {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
}

// Phase 13: offscreen lifecycle moved to src/services/offscreen-manager.ts.
// The module-level `activeOffscreenReason` flag was removed; the manager
// owns the Set<Reason> and serializes createDocument across all callers
// (service-worker playNotificationDing + this service + Plan 13-02 MCP
// client runtime). Per-extraction ensureReason('DOM_PARSER') is idempotent
// against the manager's set; the reason is released only when the last
// batch finalizes (see `maybeFinalizeBatch`).
const statusSubscribers = new Set<(s: ExtractionStatusSnapshot) => void>();
const batches = new Map<string, BatchState>();
const batchSubscribers = new Map<string, Set<(s: ExtractionStatusSnapshot) => void>>();
const inFlight = new Set<string>();

/**
 * Failure records persist through `chrome.storage.local['offline_failures']`
 * so the global banner and row badges survive an options-page refresh (the
 * service is a module in each execution context — without storage, failures
 * live only in the current page load). IDB stays clean; failures are small
 * metadata records, not full article bodies.
 *
 * Lifecycle:
 *   - `clearFailures()` wipes both the in-memory map and the storage key.
 *   - A successful extraction removes the matching entry and persists.
 *   - On module init we hydrate from storage once.
 */
const FAILURES_KEY = 'offline_failures';
const failureMap = new Map<string, OfflineFailureRecord>();
let failureHydrated = false;

async function hydrateFailures(): Promise<void> {
  if (failureHydrated) return;
  failureHydrated = true;
  try {
    const raw = await chrome.storage.local.get(FAILURES_KEY);
    const stored = (raw?.[FAILURES_KEY] as OfflineFailureRecord[] | undefined) ?? [];
    for (const f of stored) failureMap.set(f.id, f);
  } catch {
    /* fresh extension install or storage unavailable — start empty */
  }
}

async function persistFailures(): Promise<void> {
  try {
    await chrome.storage.local.set({ [FAILURES_KEY]: Array.from(failureMap.values()) });
  } catch {
    /* non-fatal — banner will still work for this session */
  }
}

function nextBatchId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

// ---------------------------------------------------------------------------
// Wave 2 — Module-private helpers
// ---------------------------------------------------------------------------

async function loadQueue(): Promise<ExtractionJob[]> {
  const raw = await chrome.storage.local.get(QUEUE_KEY);
  return (raw?.[QUEUE_KEY] as ExtractionJob[]) ?? [];
}

async function saveQueue(jobs: ExtractionJob[]): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: jobs });
}

/**
 * Serializes queue mutations across the 3 drain workers + any concurrent
 * enqueueExtraction calls. Without this, two workers can load the same
 * queue, both shift the head, both saveQueue with the tail — same job
 * runs twice. Two concurrent enqueueExtraction calls can likewise read an
 * empty queue, merge with their own jobs, and the second save wipes the
 * first. User-visible symptom: batch counters exceed total ("4/4" shown
 * while a tab actually failed) and/or saved jobs vanish.
 */
let queueLock: Promise<void> = Promise.resolve();
async function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = queueLock;
  let release: () => void = () => {};
  queueLock = new Promise<void>(r => { release = r; });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function dequeueJob(): Promise<ExtractionJob | undefined> {
  return withQueueLock(async () => {
    const queue = await loadQueue();
    const next = queue.shift();
    if (!next) return undefined;
    await saveQueue(queue);
    return next;
  });
}

async function enqueueJobs(jobs: ExtractionJob[]): Promise<void> {
  return withQueueLock(async () => {
    const existing = await loadQueue();
    await saveQueue([...existing, ...jobs]);
  });
}

/**
 * Phase 13: serialization is owned by `services/offscreen-manager`. The
 * manager's `setupLock` covers the same race the prior `offscreenSetupLock`
 * covered (3 drain workers calling ensureReason in the same tick) and the
 * Set<Reason> semantics make repeat-add a no-op so the lifecycle is
 * idempotent. We only forward the call here.
 *
 * Local helper retained as a thin shim so call sites stay readable and
 * the `'DOM_PARSER'` literal stays scoped — the broader plan in Phase 13
 * may eventually inline this once the MCP client wiring is settled.
 */
async function ensureOffscreenForReason(
  reason: 'DOM_PARSER' | 'AUDIO_PLAYBACK',
): Promise<void> {
  await ensureOffscreenReason(reason as chrome.offscreen.Reason);
}

function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    function listener(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function buildBatchSnapshot(b: BatchState): ExtractionStatusSnapshot {
  return {
    total: b.total,
    completed: b.completed,
    failed: b.failed,
    inFlight: Array.from(inFlight),
    lastUpdate: Date.now(),
    failures: Array.from(failureMap.values()),
  };
}

function publishStatus(): void {
  // Global subscribers get the UNION across all active batches — keeps the
  // "refresh article list on any extraction activity" use-case working.
  let total = 0;
  let completed = 0;
  let failed = 0;
  for (const b of batches.values()) {
    total += b.total;
    completed += b.completed;
    failed += b.failed;
  }
  const union: ExtractionStatusSnapshot = {
    total,
    completed,
    failed,
    inFlight: Array.from(inFlight),
    lastUpdate: Date.now(),
    failures: Array.from(failureMap.values()),
  };
  statusSubscribers.forEach((cb) => {
    try {
      cb(union);
    } catch {
      /* swallow subscriber errors */
    }
  });

  // Batch-scoped subscribers see only their own batch.
  for (const [batchId, subs] of batchSubscribers.entries()) {
    const b = batches.get(batchId);
    if (!b) continue;
    const snap = buildBatchSnapshot(b);
    subs.forEach((cb) => {
      try {
        cb(snap);
      } catch {
        /* swallow subscriber errors */
      }
    });
  }
}

/**
 * Re-queue a single job for retry WITHOUT touching batch counters.
 * Caller already decremented `pending` and set `attempts` before calling.
 */
async function requeueForRetry(job: ExtractionJob): Promise<void> {
  await enqueueJobs([job]);
  // Spawn one drain worker for this job (and any others queued).
  void (async function drainOnce() {
    while (true) {
      const next = await dequeueJob();
      if (!next) return;
      try {
        await processJob(next);
      } catch (err) {
        console.error(`${LOG_PREFIX} processJob failed`, err);
      }
    }
  })();
}

function maybeFinalizeBatch(b: BatchState): void {
  if (b.completed + b.failed >= b.total && b.pending === 0) {
    // Defer so subscribers see the terminal snapshot before cleanup.
    setTimeout(() => {
      batches.delete(b.batchId);
      // Phase 13: release the DOM_PARSER reason once no batches remain.
      // The offscreen-manager closes the document only when its full
      // reason set empties — if AUDIO_PLAYBACK or the MCP-client reason
      // is still active, the document stays open with those.
      if (batches.size === 0) {
        void releaseOffscreenReason('DOM_PARSER' as chrome.offscreen.Reason);
      }
    }, 0);
  }
}

async function extractOnceViaOffscreen(job: ExtractionJob): Promise<OfflineExtractionResult> {
  await ensureOffscreenForReason('DOM_PARSER');
  return sendOffscreenMessage<OfflineExtractionResult>({
    type: 'EXTRACT_OFFLINE_ARTICLE',
    url: job.url,
  });
}

async function extractViaBackgroundTab(job: ExtractionJob): Promise<OfflineExtractionResult> {
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: job.url, active: false });
    tabId = tab.id!;
    await waitForTabComplete(tabId, 30_000);

    // SPAs (X/Twitter, Reddit, modern news sites) fire status:'complete' on
    // the shell before React/Vue/etc. hydrate the actual content. Extracting
    // outerHTML immediately captures only nav chrome. Inside the tab, poll
    // for readyState=complete AND enough visible text, capped at 5s so we
    // never hang on genuinely empty pages. Total ceiling is 30s (tab load)
    // + 5s (settle) = 35s per bg-tab fallback.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => new Promise<string>((resolve) => {
        const MAX_WAIT_MS = 5000;
        const POLL_MS = 250;
        const MIN_TEXT = 500;
        const start = Date.now();
        const tick = () => {
          const elapsed = Date.now() - start;
          const bodyText = document.body?.innerText ?? '';
          const enough = bodyText.trim().length >= MIN_TEXT;
          const ready = document.readyState === 'complete' && enough;
          if (ready || elapsed >= MAX_WAIT_MS) {
            resolve(document.documentElement.outerHTML);
          } else {
            setTimeout(tick, POLL_MS);
          }
        };
        tick();
      }),
    });
    const html = results[0]?.result as string | undefined;
    if (!html) {
      return {
        success: false,
        failureBucket: 'no_article_structure',
        error: 'Empty tab HTML',
      };
    }
    await ensureOffscreenForReason('DOM_PARSER');
    return await sendOffscreenMessage<OfflineExtractionResult>({
      type: 'EXTRACT_OFFLINE_ARTICLE',
      url: job.url,
      html,
    });
  } catch (err) {
    return { success: false, failureBucket: 'network_error', error: String(err) };
  } finally {
    if (tabId !== undefined) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* tab may already be gone */
      }
    }
  }
}

async function buildArticleFromResult(
  job: ExtractionJob,
  result: OfflineExtractionResult,
): Promise<OfflineArticle> {
  const id = `${job.groupId}::${job.tabId}`;
  if (result.success) {
    return {
      id,
      groupId: job.groupId,
      tabId: job.tabId,
      url: job.url,
      title: result.title ?? '',
      byline: result.byline ?? null,
      contentHtml: result.contentHtml ?? '',
      contentLength: result.contentLength ?? 0,
      wordCount: result.wordCount ?? 0,
      savedAt: Date.now(),
      readAt: null,
      pinned: 0,
      failureBucket: null,
      sourceGroupId: job.groupId,
    };
  }
  return {
    id,
    groupId: job.groupId,
    tabId: job.tabId,
    url: job.url,
    title: '',
    byline: null,
    contentHtml: '',
    contentLength: 0,
    wordCount: 0,
    savedAt: Date.now(),
    readAt: null,
    pinned: 0,
    failureBucket: result.failureBucket ?? 'network_error',
    sourceGroupId: job.groupId,
  };
}

async function processJob(job: ExtractionJob): Promise<void> {
  const id = `${job.groupId}::${job.tabId}`;
  const batch = batches.get(job.batchId);
  inFlight.add(id);
  publishStatus();

  try {
    await processJobInner(job, id, batch);
  } catch (err) {
    // Defense in depth: never let a batch hang because extractOnce threw
    // (offscreen race, SW timeout mid-extract, etc.). Treat as terminal
    // network_error so counters finalize and the toast terminalizes.
    console.error(`${LOG_PREFIX} processJob unhandled`, err);
    inFlight.delete(id);
    failureMap.set(id, {
      id,
      groupId: job.groupId,
      tabId: job.tabId,
      url: job.url,
      failureBucket: 'network_error',
      at: Date.now(),
    });
    void persistFailures();
    if (batch) {
      batch.failed++;
      maybeFinalizeBatch(batch);
    }
    publishStatus();
  }
}

async function processJobInner(job: ExtractionJob, id: string, batch: BatchState | undefined): Promise<void> {
  let result = await extractOnceViaOffscreen(job);
  const online = isOnline();

  // Content-gate failure on first attempt → try bg-tab fallback once.
  // Skip fallback entirely when offline — opening tabs with no network is
  // wasteful and, on many machines, load-heavy enough to feel like a freeze.
  if (
    !result.success &&
    (result.failureBucket === 'limited_content' ||
      result.failureBucket === 'no_article_structure') &&
    job.attempts === 0 &&
    online
  ) {
    result = await extractViaBackgroundTab(job);
  }

  // Network error with remaining retries → schedule retry via backoff.
  // Offline guard: when navigator.onLine is false, treat as terminal so we
  // don't stack setTimeout retries waiting for a connection that isn't there.
  if (
    !result.success &&
    result.failureBucket === 'network_error' &&
    job.attempts < 2 &&
    online
  ) {
    const delay = BACKOFF_MS[job.attempts] ?? 15000;
    inFlight.delete(id);
    if (batch) batch.pending++;
    publishStatus();
    setTimeout(() => {
      if (batch) batch.pending--;
      void requeueForRetry({ ...job, attempts: job.attempts + 1 });
    }, delay);
    return;
  }

  if (result.success) {
    const article = await buildArticleFromResult(job, result);
    await OfflineReadingService.saveArticleAtomic(article, result.heroBlob ?? null);
    // Successful extraction clears any prior failure record for this article.
    if (failureMap.delete(id)) void persistFailures();
  } else {
    // Terminal failure: record persistently via chrome.storage.local so the
    // banner + row badges survive a page refresh. Never write failures to IDB
    // — the library stays clean.
    failureMap.set(id, {
      id,
      groupId: job.groupId,
      tabId: job.tabId,
      url: job.url,
      failureBucket: result.failureBucket ?? 'network_error',
      at: Date.now(),
    });
    void persistFailures();
  }

  inFlight.delete(id);
  if (batch) {
    if (result.success) {
      batch.completed++;
    } else {
      batch.failed++;
    }
    maybeFinalizeBatch(batch);
  }
  publishStatus();
}

// ---------------------------------------------------------------------------
// IndexedDB Schema
// ---------------------------------------------------------------------------

interface OfflineReadingDB extends DBSchema {
  articles: {
    key: string; // id — `${groupId}::${tabId}`
    value: OfflineArticle;
    indexes: {
      'by-group': string;    // sourceGroupId
      'by-saved-at': number; // savedAt
      'by-pinned': 0 | 1;   // pinned as number for IDB indexability
    };
  };
  heroImages: {
    key: string; // articleId
    value: { articleId: string; blob: Blob; mimeType: string };
  };
}

// ---------------------------------------------------------------------------
// OfflineReadingService
// ---------------------------------------------------------------------------

export class OfflineReadingService {
  // -------------------------------------------------------------------------
  // Database lifecycle
  // -------------------------------------------------------------------------

  /**
   * Open (and upgrade) the `bluetab_offline` IndexedDB database.
   * Creates both object stores and their indexes on first open (v1 schema).
   */
  static openOfflineDB(): Promise<IDBPDatabase<OfflineReadingDB>> {
    return openDB<OfflineReadingDB>('bluetab_offline', 1, {
      upgrade(db) {
        const articleStore = db.createObjectStore('articles', { keyPath: 'id' });
        articleStore.createIndex('by-group', 'sourceGroupId');
        articleStore.createIndex('by-saved-at', 'savedAt');
        articleStore.createIndex('by-pinned', 'pinned');

        db.createObjectStore('heroImages', { keyPath: 'articleId' });
      },
    });
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * Persist an article + optional hero image Blob in a single readwrite
   * transaction (OFFL-05 atomic write). If heroBlob is null the hero store
   * record is omitted — the article still saves successfully.
   */
  static async saveArticleAtomic(
    article: OfflineArticle,
    heroBlob: Blob | null,
  ): Promise<void> {
    const db = await OfflineReadingService.openOfflineDB();
    const tx = db.transaction(['articles', 'heroImages'], 'readwrite');
    await tx.objectStore('articles').put(article);
    if (heroBlob) {
      await tx.objectStore('heroImages').put({
        articleId: article.id,
        blob: heroBlob,
        mimeType: heroBlob.type || 'image/jpeg',
      });
    }
    await tx.done;
    console.debug(`${LOG_PREFIX} saveArticleAtomic complete: ${article.id} heroBlob=${heroBlob !== null}`);
  }

  /**
   * Mark an article as read by setting readAt = Date.now().
   * Used by the reader view (Wave 3) when an article is opened.
   */
  static async markRead(id: string): Promise<void> {
    const db = await OfflineReadingService.openOfflineDB();
    const tx = db.transaction('articles', 'readwrite');
    const store = tx.objectStore('articles');
    const article = await store.get(id);
    if (article) {
      article.readAt = Date.now();
      await store.put(article);
    }
    await tx.done;
  }

  /**
   * Set the pinned state of an article. Pinned articles (pinned=1) are
   * exempt from the oldest-unread cleanup suggestion pool (OFFL-09).
   */
  static async setPinned(id: string, pinned: boolean): Promise<void> {
    const db = await OfflineReadingService.openOfflineDB();
    const tx = db.transaction('articles', 'readwrite');
    const store = tx.objectStore('articles');
    const article = await store.get(id);
    if (article) {
      article.pinned = pinned ? 1 : 0;
      await store.put(article);
    }
    await tx.done;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * Return all articles belonging to the given Bluetab group, ordered by
   * insertion order (IDB by-group index, natural order).
   */
  static async getArticlesByGroup(groupId: string): Promise<OfflineArticle[]> {
    const db = await OfflineReadingService.openOfflineDB();
    return db.getAllFromIndex('articles', 'by-group', groupId);
  }

  /** Return all stored articles regardless of group. */
  static async getAllArticles(): Promise<OfflineArticle[]> {
    const db = await OfflineReadingService.openOfflineDB();
    return db.getAll('articles');
  }

  /** Return a single article by id, or undefined if not found. */
  static async getArticle(id: string): Promise<OfflineArticle | undefined> {
    const db = await OfflineReadingService.openOfflineDB();
    return db.get('articles', id);
  }

  /**
   * Return the hero image Blob for an article, or null if no hero was saved.
   * Called by the reader view to render the hero image.
   */
  static async getHeroBlob(articleId: string): Promise<Blob | null> {
    const db = await OfflineReadingService.openOfflineDB();
    const record = await db.get('heroImages', articleId);
    return record?.blob ?? null;
  }

  /**
   * Return the oldest unread, unpinned articles up to `limit` entries,
   * ordered oldest-first by savedAt. Used by the 80% quota cleanup flow
   * (OFFL-09 refined) to suggest candidates for user-approved deletion.
   *
   * Filters: readAt === null AND pinned !== 1.
   */
  static async getOldestUnread(limit: number): Promise<OfflineArticle[]> {
    const db = await OfflineReadingService.openOfflineDB();
    const tx = db.transaction('articles', 'readonly');
    const index = tx.store.index('by-saved-at');
    const all = await index.getAll();
    return all
      .filter((a) => a.readAt === null && a.pinned !== 1)
      .slice(0, limit);
  }

  /**
   * Report current IndexedDB storage usage via navigator.storage.estimate().
   * Returns warning/blocked flags based on OFFL-08 thresholds (80% / 95%).
   *
   * NOTE: Call this from options-page context (window context). navigator.storage
   * in MV3 service workers has non-standard behavior — see RESEARCH.md Pitfall 2.
   */
  static async getOfflineQuota(): Promise<OfflineQuota> {
    const estimate = await navigator.storage.estimate();
    const used = estimate.usage ?? 0;
    // Guard against div-by-zero; fall back to max safe integer so pct stays 0.
    const quota = (estimate.quota != null && estimate.quota > 0)
      ? estimate.quota
      : Number.MAX_SAFE_INTEGER;
    const pct = used / quota;
    return {
      usedBytes: used,
      quotaBytes: quota,
      percentUsed: pct,
      isWarning: pct >= 0.80,
      isBlocked: pct >= 0.95,
    };
  }

  // -------------------------------------------------------------------------
  // Deletes
  // -------------------------------------------------------------------------

  /**
   * Delete all articles for a Bluetab group AND their hero images.
   * Must be called whenever a group is deleted to prevent orphaned IDB records
   * (MOD-04: delete MUST cascade via OfflineReadingService.deleteByGroupId —
   * never delete groups directly without calling this).
   */
  static async deleteByGroupId(groupId: string): Promise<void> {
    const db = await OfflineReadingService.openOfflineDB();
    const tx = db.transaction(['articles', 'heroImages'], 'readwrite');
    const articleStore = tx.objectStore('articles');
    const heroStore = tx.objectStore('heroImages');
    const index = articleStore.index('by-group');

    let cursor = await index.openCursor(groupId);
    while (cursor) {
      const articleId = cursor.value.id;
      await cursor.delete();
      await heroStore.delete(articleId);
      cursor = await cursor.continue();
    }

    await tx.done;
    console.debug(`${LOG_PREFIX} deleteByGroupId complete: ${groupId}`);
  }

  /**
   * Delete a single article and its hero image.
   * Used by per-article delete actions in the Offline Reading library (Wave 3).
   */
  static async deleteArticle(id: string): Promise<void> {
    const db = await OfflineReadingService.openOfflineDB();
    const tx = db.transaction(['articles', 'heroImages'], 'readwrite');
    await tx.objectStore('articles').delete(id);
    await tx.objectStore('heroImages').delete(id);
    await tx.done;
  }

  /**
   * Clear ALL offline articles and hero images (OFFL-10).
   * The Offline Reading page "Clear everything" button calls this after an
   * explicit confirm dialog that warns about pinned articles.
   */
  static async deleteAll(): Promise<void> {
    const db = await OfflineReadingService.openOfflineDB();
    const tx = db.transaction(['articles', 'heroImages'], 'readwrite');
    await tx.objectStore('articles').clear();
    await tx.objectStore('heroImages').clear();
    await tx.done;
    console.debug(`${LOG_PREFIX} deleteAll complete`);
  }

  // -------------------------------------------------------------------------
  // Content gate + failure bucket logic (OFFL-06)
  // -------------------------------------------------------------------------

  /**
   * Returns true if article content meets the minimum quality threshold
   * (>=500 characters AND >=200 words). Articles below either threshold
   * are rejected with a 'limited_content' failure bucket.
   */
  static contentGate(contentLength: number, wordCount: number): boolean {
    return contentLength >= 500 && wordCount >= 200;
  }

  /**
   * Classify an extraction failure into one of three distinguishable buckets:
   *   network_error      — HTTP fetch failed or threw
   *   no_article_structure — fetch succeeded but Readability returned null
   *   limited_content    — Readability succeeded but content is below gate
   *
   * The three buckets map to UI labels: "Network error" / "No article
   * structure" / "Limited content" (OFFL-06). We deliberately avoid claiming
   * "paywall" since Readability cannot prove it.
   */
  static pickFailureBucket({
    fetchOk,
    readabilityNull,
    contentLength,
    wordCount,
  }: {
    fetchOk: boolean;
    readabilityNull: boolean;
    contentLength: number;
    wordCount: number;
  }): OfflineExtractionFailureBucket {
    if (!fetchOk) return 'network_error';
    if (readabilityNull) return 'no_article_structure';
    // fetchOk && !readabilityNull && contentGate failed
    void contentLength;
    void wordCount;
    return 'limited_content';
  }

  // -------------------------------------------------------------------------
  // Wave 2 — Extraction dispatch, retry queue, lifecycle
  // -------------------------------------------------------------------------

  /**
   * Enqueue a set of tabs for background offline extraction.
   *
   * Processing: offscreen-document fetch first; on content-gate failure
   * (limited_content / no_article_structure on attempt 0) retries once via
   * background-tab fallback (chrome.tabs.create({active:false}) + scripting.
   * executeScript to get rendered HTML). Network errors auto-retry twice
   * with 5s / 15s backoff via setTimeout. Terminal failures save a failure
   * record to IDB so the UI can show the error state.
   *
   * Concurrency cap: at most CONCURRENCY_CAP (3) jobs run in parallel.
   * Queue persisted to chrome.storage.local[QUEUE_KEY] — SW termination
   * does not lose pending jobs (they reload on next SW wake).
   *
   * Does not query existing open tabs via chrome.tabs API (OFFL-02 contract).
   */
  static async enqueueExtraction(
    tabs: Array<{ groupId: string; tabId: string; url: string }>,
    opts?: { batchId?: string },
  ): Promise<string> {
    if (tabs.length === 0) return '';

    // Pre-register or reuse batch state. Callers that want to subscribe to
    // progress BEFORE enqueueExtraction starts draining can reserve the
    // batchId via generateBatchId(total) first; otherwise we generate it
    // here. A pre-reserved batch already carries its `total` — trust it and
    // do not increment (the caller-provided total and tabs.length match by
    // construction at the UI layer).
    const batchId = opts?.batchId ?? nextBatchId();
    if (!batches.has(batchId)) {
      batches.set(batchId, {
        batchId,
        total: tabs.length,
        completed: 0,
        failed: 0,
        pending: 0,
      });
    }

    const freshJobs: ExtractionJob[] = tabs.map((t) => ({
      ...t,
      batchId,
      attempts: 0,
    }));
    await enqueueJobs(freshJobs);

    publishStatus();

    // Drain queue with at most CONCURRENCY_CAP concurrent workers. Each
    // worker dequeues through a mutex so two workers can't pick the same
    // job (which would double-count counters and inflate "Saved N/N").
    const workers: Promise<void>[] = [];
    for (let i = 0; i < CONCURRENCY_CAP; i++) {
      workers.push(
        (async function drain() {
          while (true) {
            const next = await dequeueJob();
            if (!next) return;
            try {
              await processJob(next);
            } catch (err) {
              console.error(`${LOG_PREFIX} processJob failed`, err);
            }
          }
        })(),
      );
    }
    await Promise.allSettled(workers);
    return batchId;
  }

  /**
   * Reserve a batchId ahead of time so callers can subscribe to progress
   * BEFORE enqueueExtraction starts draining. The returned id must be passed
   * back via `enqueueExtraction(tabs, { batchId })` so jobs land in the same
   * batch. `total` may be 0 here — enqueueExtraction will add to it.
   */
  static generateBatchId(total: number): string {
    const batchId = nextBatchId();
    batches.set(batchId, {
      batchId,
      total,
      completed: 0,
      failed: 0,
      pending: 0,
    });
    return batchId;
  }

  /**
   * Subscribe to a single batch's progress snapshots. The callback fires
   * immediately with the current state (if the batch exists), then on every
   * subsequent mutation. Returns an unsubscribe function.
   *
   * Unlike `subscribeExtractionStatus` (which sees a UNION across all active
   * batches), this is scoped to one save action — safe for a sonner toast
   * that needs to track exactly one batch without interference from later
   * saves.
   */
  static subscribeBatch(
    batchId: string,
    cb: (s: ExtractionStatusSnapshot) => void,
  ): () => void {
    let set = batchSubscribers.get(batchId);
    if (!set) {
      set = new Set();
      batchSubscribers.set(batchId, set);
    }
    set.add(cb);
    const b = batches.get(batchId);
    if (b) {
      try {
        cb(buildBatchSnapshot(b));
      } catch {
        /* swallow */
      }
    }
    return () => {
      const s = batchSubscribers.get(batchId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) batchSubscribers.delete(batchId);
    };
  }

  /**
   * Subscribe to extraction status snapshots.
   * The callback fires immediately with the current status, then on every
   * queue mutation (job starts, completes, or fails).
   *
   * @returns An unsubscribe function.
   */
  static subscribeExtractionStatus(
    cb: (s: ExtractionStatusSnapshot) => void,
  ): () => void {
    statusSubscribers.add(cb);
    publishStatus();
    return () => {
      statusSubscribers.delete(cb);
    };
  }

  /**
   * Re-enqueue a failed article for retry.
   * Looks up the article in the transient failureMap; if found, re-enqueues
   * it as a single-item batch and returns the batchId.
   *
   * Callers that want a live progress toast MUST pre-reserve the batchId
   * via `generateBatchId(1)` and pass it here via `opts.batchId`, then
   * subscribe BEFORE awaiting this method — otherwise the drain pump can
   * finalize and delete the batch before the subscription attaches, which
   * leaves the toast stuck at "Saving 0/1" forever.
   */
  static async retryFailed(articleId: string, opts?: { batchId?: string }): Promise<string> {
    const failure = failureMap.get(articleId);
    if (!failure) return '';
    return OfflineReadingService.enqueueExtraction(
      [{ groupId: failure.groupId, tabId: failure.tabId, url: failure.url }],
      opts,
    );
  }

  /**
   * Re-enqueue many failed articles as a single batch. Same subscribe-first
   * contract as retryFailed when the caller wants a live progress toast.
   */
  static async retryFailedMany(articleIds: string[], opts?: { batchId?: string }): Promise<string> {
    const descriptors: Array<{ groupId: string; tabId: string; url: string }> = [];
    for (const id of articleIds) {
      const f = failureMap.get(id);
      if (f) descriptors.push({ groupId: f.groupId, tabId: f.tabId, url: f.url });
    }
    if (descriptors.length === 0) return '';
    const batchId = opts?.batchId ?? OfflineReadingService.generateBatchId(descriptors.length);
    await OfflineReadingService.enqueueExtraction(descriptors, { batchId });
    return batchId;
  }

  /** Return the current failure records (newest first). */
  static getFailures(): OfflineFailureRecord[] {
    return Array.from(failureMap.values()).sort((a, b) => b.at - a.at);
  }

  /**
   * Hydrate failureMap from `chrome.storage.local['offline_failures']`.
   * Idempotent — only loads once per module lifetime. Callers that render
   * the failure banner on mount should await this.
   */
  static async hydrateFailures(): Promise<void> {
    await hydrateFailures();
    publishStatus();
  }

  /**
   * Clear ALL failure records (banner dismissal). Does not delete any
   * articles from IndexedDB — failures are metadata, not library entries.
   */
  static clearFailures(): void {
    if (failureMap.size === 0) return;
    failureMap.clear();
    void persistFailures();
    publishStatus();
  }

  /** Clear a single failure record (used when the user dismisses one row). */
  static clearFailure(articleId: string): void {
    if (failureMap.delete(articleId)) {
      void persistFailures();
      publishStatus();
    }
  }
}
