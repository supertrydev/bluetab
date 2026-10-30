/**
 * @module types/offline-reading
 *
 * WHY:  Phase 10 introduces opt-in offline article caching backed by
 *       IndexedDB. All code that reads, writes, or transmits offline
 *       article data must share the same type shapes so the service
 *       layer, offscreen document, options-shell UI, and test harness
 *       are always in sync.
 *
 * WHAT: Five exported declarations consumed across the codebase:
 *       - OfflineExtractionFailureBucket — discriminated union of the
 *         three distinguishable extraction failure modes
 *       - OfflineArticle — the full shape of an article record stored
 *         in IndexedDB (articles store); IDB-index-friendly field types
 *       - OfflineExtractionResult — the structured response returned by
 *         the offscreen document's EXTRACT_OFFLINE_ARTICLE handler
 *       - OfflineQuota — quota snapshot produced by
 *         navigator.storage.estimate() with computed warning/blocked flags
 *       - OffscreenMessage — discriminated union of ALL message types
 *         the offscreen document handles (audio + extraction)
 *
 * HOW:  Plain TypeScript types; no runtime dependencies. Field names
 *       mirror what the offscreen handler produces and what the service
 *       stores — no adapter layer required.
 *
 * NOT:  Does not contain IndexedDB schema types (those live in
 *       offline-reading-service.ts as a private OfflineReadingDB
 *       interface). Does not contain UI state types (Phase 10 Wave 3).
 */

// ---------------------------------------------------------------------------
// Failure buckets — three distinguishable extraction failure modes.
// Surfaced in the options-shell amber banner (OFFL-06) with honest labels:
//   network_error    → "Network error"
//   no_article_structure → "No article structure"
//   limited_content  → "Limited content"
// ---------------------------------------------------------------------------

export type OfflineExtractionFailureBucket =
  | 'network_error'
  | 'no_article_structure'
  | 'limited_content';

// ---------------------------------------------------------------------------
// OfflineArticle — persisted record in the `articles` IndexedDB store.
// All fields are IDB-index-friendly (numbers, not booleans, for indexed
// fields; string keys for range queries).
// ---------------------------------------------------------------------------

export interface OfflineArticle {
  /** Synthetic primary key: `${groupId}::${tabId}` */
  id: string;
  /** Source Bluetab group id */
  groupId: string;
  /** Source tab id within the Bluetab group */
  tabId: string;
  /** Original URL of the article */
  url: string;
  /** Readability-extracted title */
  title: string;
  /** Readability-extracted byline (author), or null */
  byline: string | null;
  /** DOMPurify-sanitized HTML from Readability */
  contentHtml: string;
  /** Character count of plain textContent (used by content gate) */
  contentLength: number;
  /** Word count of plain textContent (used by content gate) */
  wordCount: number;
  /** Date.now() at save time */
  savedAt: number;
  /** Date.now() when opened in reader mode, null if unread */
  readAt: number | null;
  /** 0 = not pinned, 1 = pinned. IDB index requires numeric type. */
  pinned: 0 | 1;
  /** null = successfully extracted; set when extraction failed */
  failureBucket: OfflineExtractionFailureBucket | null;
  /** Duplicate of groupId; explicit field required for the IDB by-group index */
  sourceGroupId: string;
}

// ---------------------------------------------------------------------------
// OfflineExtractionResult — response payload from the offscreen doc's
// EXTRACT_OFFLINE_ARTICLE handler. success=false paths omit content fields
// and include a failureBucket to identify the reason.
// ---------------------------------------------------------------------------

export interface OfflineExtractionResult {
  success: boolean;
  title?: string;
  byline?: string | null;
  contentHtml?: string;
  contentText?: string;
  contentLength?: number;
  wordCount?: number;
  /** Hero image Blob fetched via the OFFL-04 waterfall; null if no candidate found */
  heroBlob?: Blob | null;
  failureBucket?: OfflineExtractionFailureBucket;
  /** Human-readable error string for logging on the failure path */
  error?: string;
}

// ---------------------------------------------------------------------------
// OfflineQuota — snapshot from navigator.storage.estimate() with
// pre-computed warning and blocked flags.
// ---------------------------------------------------------------------------

export interface OfflineQuota {
  usedBytes: number;
  quotaBytes: number;
  /** Fraction 0..1; percentUsed = usedBytes / quotaBytes */
  percentUsed: number;
  /** true when percentUsed >= 0.80 — triggers soft-warning banner (OFFL-08) */
  isWarning: boolean;
  /** true when percentUsed >= 0.95 — blocks new saves (OFFL-08) */
  isBlocked: boolean;
}

// ---------------------------------------------------------------------------
// OffscreenMessage — union of ALL message types the offscreen document
// handles. The background service worker and OfflineReadingService
// dispatch these via chrome.runtime.sendMessage.
//
// html is optional on EXTRACT_OFFLINE_ARTICLE: when the Wave 2 background-
// tab fallback has already fetched the rendered HTML, it passes it in so
// the offscreen doc skips the fetch step (avoids a second network request).
// ---------------------------------------------------------------------------

export type OffscreenMessage =
  | { type: 'PLAY_NOTIFICATION_DING'; sound: string }
  | { type: 'EXTRACT_OFFLINE_ARTICLE'; url: string; html?: string };

// ---------------------------------------------------------------------------
// ExtractionStatusSnapshot — published by subscribeExtractionStatus on each
// queue mutation so Wave 3 live-progress toasts can react in real time.
// ---------------------------------------------------------------------------

export interface ExtractionStatusSnapshot {
  /** Total items enqueued in the current batch */
  total: number;
  /** Items that completed successfully */
  completed: number;
  /** Items that reached a terminal failure state */
  failed: number;
  /** Article IDs currently in-flight (extracting right now) */
  inFlight: string[];
  /** Date.now() at the time of this snapshot */
  lastUpdate: number;
  /**
   * Transient failure records across all batches. Failures are NOT persisted
   * to IndexedDB — they live in memory until the user dismisses them or a
   * subsequent successful extraction clears the matching entry. Service-worker
   * restart clears them naturally.
   */
  failures: OfflineFailureRecord[];
}

// ---------------------------------------------------------------------------
// OfflineFailureRecord — transient record for a tab whose extraction hit a
// terminal failure. Populates the global failure banner and the tab-row
// amber indicator. Not persisted.
// ---------------------------------------------------------------------------

export interface OfflineFailureRecord {
  /** Same shape as OfflineArticle.id so UI lookups match */
  id: string;
  groupId: string;
  tabId: string;
  url: string;
  failureBucket: OfflineExtractionFailureBucket;
  /** Date.now() when the failure was recorded */
  at: number;
}
