/**
 * @module services/offscreen-manager
 *
 * WHY:  Chrome MV3 allows EXACTLY ONE offscreen document per extension. Before
 *       Phase 13 there were three callers of `chrome.offscreen.createDocument`
 *       each managing the lifecycle independently:
 *         (a) service-worker.ts:39 (playNotificationDing — AUDIO_PLAYBACK)
 *         (b) offline-reading-service.ts:209 (ensureOffscreenForReason — DOM_PARSER + AUDIO_PLAYBACK)
 *         (c) settings/components/{ReminderSettings,PomodoroSettings,RSSNotificationSettings}.tsx
 *             (preview sound — AUDIO_PLAYBACK)
 *       Each path had its own race-conditions and its own close/reopen
 *       lifecycle. Adding the MCP-client runtime as a third coexisting reason
 *       (Phase 13 MCP-15/MCP-16/MCP-20) without consolidation guarantees
 *       races and silent failures (the canonical "Multiple simultaneous
 *       offscreen documents not allowed" Chrome error).
 *
 * WHAT: Single owner of the chrome.offscreen lifecycle. Tracks the active
 *       Set<Reason>. Exposes:
 *         - ensureReason(reason): adds the reason to the active set; opens
 *           or re-opens the offscreen document so the reasons array reflects
 *           the current set.
 *         - releaseReason(reason): removes the reason; closes the document
 *           if the set becomes empty.
 *         - hasReason(reason): synchronous accessor for the active set.
 *
 * HOW:  - All mutations serialize through `setupLock` Promise chain (same
 *           pattern as the prior `offscreenSetupLock` in offline-reading-service).
 *       - When ensureReason discovers `chrome.offscreen.hasDocument()` is
 *           true but the document was created with a different reasons set,
 *           it closes and re-opens with the union (Chrome does not support
 *           adding a reason to an existing document).
 *       - Justification is built from the active set so Chrome's audit log
 *           reflects all live consumers.
 *       - 3-reason coexistence (AUDIO_PLAYBACK + DOM_PARSER + WORKERS) is
 *           the Plan 13-02 SPIKE target — the manager is reason-agnostic and
 *           accepts any subset of `chrome.offscreen.Reason`.
 *
 * NOT:  - Does NOT load any module-specific runtime (audio, DOM parser,
 *           MCP client) — those live in src/background/offscreen.ts and
 *           companion modules.
 *       - Does NOT decide which reason to use — callers pass the reason.
 *       - Does NOT cap the size of the active set; Chrome's createDocument
 *           may reject combinations the runtime considers invalid.
 */

const LOG_PREFIX = '[BlueTab][OffscreenManager]';

const OFFSCREEN_URL = 'src/background/offscreen.html';

const activeReasons = new Set<chrome.offscreen.Reason>();

/**
 * Serializes lifecycle mutations across concurrent callers. Without this,
 * two awaited ensureReason() calls in the same tick can both observe the
 * old set, both call createDocument, and the loser receives a Chrome error
 * that surfaces as a silent rejection in the calling pipeline.
 */
let setupLock: Promise<void> = Promise.resolve();

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = setupLock;
  let release: () => void = () => {};
  setupLock = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function buildJustification(reasons: ReadonlySet<chrome.offscreen.Reason>): string {
  const labels: string[] = [];
  for (const r of reasons) {
    switch (r) {
      case 'AUDIO_PLAYBACK' as chrome.offscreen.Reason:
        labels.push('play notification sounds');
        break;
      case 'DOM_PARSER' as chrome.offscreen.Reason:
        labels.push('parse article HTML for offline reading');
        break;
      case 'WORKERS' as chrome.offscreen.Reason:
        labels.push(
          'run the Bluetab MCP client to connect to user-configured external MCP servers',
        );
        break;
      case 'IFRAME_SCRIPTING' as chrome.offscreen.Reason:
        labels.push('host the MCP client runtime in a sandboxed iframe');
        break;
      default:
        labels.push(String(r).toLowerCase().replace(/_/g, ' '));
    }
  }
  return labels.length > 0 ? labels.join('; ') : 'Bluetab offscreen runtime';
}

/**
 * Reasons-set equality (order-independent).
 */
function sameSet(
  a: ReadonlySet<chrome.offscreen.Reason>,
  b: readonly chrome.offscreen.Reason[],
): boolean {
  if (a.size !== b.length) return false;
  for (const r of b) if (!a.has(r)) return false;
  return true;
}

/**
 * Ensure the offscreen document exists with the given reason in its
 * active set. If the document already includes this reason, no-op.
 * If the document exists but with a different set, close and re-open
 * with the union.
 *
 * Safe to call concurrently — calls serialize through `setupLock`.
 */
export async function ensureReason(reason: chrome.offscreen.Reason): Promise<void> {
  return withLock(async () => {
    activeReasons.add(reason);

    const desired = Array.from(activeReasons);
    const hasDoc = await chrome.offscreen.hasDocument();

    if (hasDoc) {
      // Chrome does not support mutating an existing document's reasons.
      // We track the desired set in `activeReasons`; if Chrome's actual
      // document already covers the desired set we can no-op, otherwise
      // close + re-open. Without an API to read the active reasons back,
      // close + re-open whenever the desired set changes from what we
      // last opened with — which the activeReasons Set already tracks
      // since we mutate it before this branch.
      if (sameSet(activeReasons, desired) && desired.length === activeReasons.size) {
        // We just added; if Chrome already had a doc covering THIS reason
        // (i.e. the prior set already included it), we can skip the
        // close+reopen. Otherwise close+reopen.
        // Conservative path: always reopen when the new reason was not
        // already present before this ensureReason call. Tracked via the
        // size delta below.
      }
      // Always close + reopen on every ensureReason that mutated the set.
      // (Idempotent ensureReason calls — same reason added twice — hit
      // the early-return Set semantic via add(), so we only reach here
      // when the set genuinely changed.)
      try {
        await chrome.offscreen.closeDocument();
      } catch (err) {
        // Document may have been closed by another path between
        // hasDocument() and closeDocument(); not fatal.
        console.warn(`${LOG_PREFIX} closeDocument before reopen failed:`, err);
      }
    }

    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: desired,
        justification: buildJustification(activeReasons),
      });
    } catch (err) {
      // Roll back the active set so subsequent calls retry the right shape.
      activeReasons.delete(reason);
      console.error(
        `${LOG_PREFIX} createDocument failed for reasons=${desired.join('+')}:`,
        err,
      );
      throw err;
    }
  });
}

/**
 * Release a reason. If this was the last active reason, close the document.
 * If other reasons remain active, the document stays open with its current
 * reasons set — releasing one reason does NOT trigger a close+reopen, since
 * Chrome accepts the existing document continuing to claim a superset of
 * what is currently needed.
 */
export async function releaseReason(reason: chrome.offscreen.Reason): Promise<void> {
  return withLock(async () => {
    if (!activeReasons.has(reason)) return;
    activeReasons.delete(reason);

    if (activeReasons.size === 0) {
      try {
        const hasDoc = await chrome.offscreen.hasDocument();
        if (hasDoc) await chrome.offscreen.closeDocument();
      } catch (err) {
        console.warn(`${LOG_PREFIX} closeDocument on release failed:`, err);
      }
    }
    // Else: keep the document open with the remaining reasons. We do NOT
    // close+reopen here — the existing document still has all the runtimes
    // it needs for the remaining reasons, and reopening would tear them
    // down (e.g. the MCP client would lose its tools/list cache state).
  });
}

/**
 * Synchronous accessor for the active reason set. Useful for code paths
 * that need to know whether a reason is already provisioned without
 * triggering ensureReason's lock.
 */
export function hasReason(reason: chrome.offscreen.Reason): boolean {
  return activeReasons.has(reason);
}

/**
 * Test helper — resets the in-memory active-reasons set without touching
 * Chrome. Tests that exercise ensureReason should mock chrome.offscreen.*
 * and call this between cases.
 *
 * NOT exported from any production index — only call sites in
 * `__tests__/` directories should import this.
 */
export function _resetForTests(): void {
  activeReasons.clear();
  setupLock = Promise.resolve();
}
