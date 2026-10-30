/**
 * @module background/adhd-activity-tracker
 *
 * WHY:  Phase 9 ADHD-05 requires a per-tab "last active" timestamp so
 *       AutoSuspendService.findEligible can gate on the user's configured
 *       inactivity threshold. chrome.idle is system-wide (user-at-keyboard)
 *       and insufficient. The SW must maintain its own per-tab map AND
 *       survive SW sleep — Pitfall 9 from 09-RESEARCH: a SW restart
 *       without rehydrate would lose every timestamp and drive
 *       false-positive suspensions on next scan.
 *
 * WHAT: A module-scope Map<tabId, lastActiveTs> with:
 *       - onActivated / onUpdated(complete) → stamp the tab as active now
 *       - onRemoved → drop the entry
 *       - debounced 5s persistence to chrome.storage.local['adhd_tab_activity']
 *         (a pending-write flag; no setTimeout so we don't rely on MV3 timers)
 *       - rehydrate() to read the persisted map on SW wake; wired into
 *         BOTH onStartup and onInstalled in service-worker.ts
 *       - 200-entry oldest-first eviction cap — SAFE because
 *         AutoSuspendService.findEligible treats a missing record as
 *         ACTIVE (never suspended), so eviction is eligibility-relaxing,
 *         never eligibility-tightening.
 *
 * HOW:  - Storage key: ADHD_TAB_ACTIVITY_STORAGE_KEY from auto-suspend-service
 *       - Persistence strategy: every stamp + every delete triggers a
 *         flushIfStale() check; if now - lastFlush >= 5000ms, write the
 *         whole map and bump lastFlush. Lossless eventual consistency
 *         — worst case on SW crash is 5s of unrecorded activity.
 *       - Registration is idempotent via a module-scope flag (SW code
 *         may call register() from both onInstalled and onStartup).
 *
 * NOT:  Does not schedule the scan alarm — service-worker.ts owns that.
 *       Does not run the scan — AutoSuspendService.runScan() owns that.
 *       Does not modify chrome.action badges — AutoSuspendService owns that.
 */

import { Storage } from '@/utils/storage';
import {
  ADHD_TAB_ACTIVITY_STORAGE_KEY,
  type TabActivityMap,
} from '@/services/auto-suspend-service';

const LOG_PREFIX = '[BlueTab][ADHDActivityTracker]';
const FLUSH_DEBOUNCE_MS = 5000;
const MAX_ENTRIES = 200;

const activity = new Map<number, number>();
let lastFlushAt = 0;
let pendingFlushPromise: Promise<void> | null = null;
let listenersRegistered = false;

/**
 * Write the current in-memory map to chrome.storage.local. De-duplicates
 * concurrent calls via pendingFlushPromise so a burst of tab events can't
 * trigger overlapping writes.
 */
async function flush(): Promise<void> {
  if (pendingFlushPromise) return pendingFlushPromise;
  pendingFlushPromise = (async () => {
    try {
      // Oldest-first eviction: if we somehow grew past MAX_ENTRIES (e.g.
      // a user with 250+ tabs), drop the least-recently-active entries.
      // SAFE by construction: missing record ⇒ ACTIVE in findEligible.
      if (activity.size > MAX_ENTRIES) {
        const sorted = Array.from(activity.entries()).sort((a, b) => a[1] - b[1]);
        const toRemove = sorted.slice(0, activity.size - MAX_ENTRIES);
        for (const [id] of toRemove) activity.delete(id);
      }
      const snapshot: TabActivityMap = {};
      for (const [id, ts] of activity.entries()) snapshot[String(id)] = ts;
      await Storage.set(ADHD_TAB_ACTIVITY_STORAGE_KEY, snapshot);
      lastFlushAt = Date.now();
    } catch (err) {
      console.debug(`${LOG_PREFIX} flush skipped:`, err);
    } finally {
      pendingFlushPromise = null;
    }
  })();
  return pendingFlushPromise;
}

function flushIfStale(): void {
  if (Date.now() - lastFlushAt >= FLUSH_DEBOUNCE_MS) {
    // Fire-and-forget; listeners can't await.
    void flush();
  }
}

function stamp(tabId: number, ts: number = Date.now()): void {
  activity.set(tabId, ts);
  flushIfStale();
}

/**
 * Public entry point for the SW init block. Idempotent (repeat calls from
 * onInstalled + onStartup are expected and harmless).
 */
export const AdhdTabActivityTracker = {
  /**
   * Read the persisted map from chrome.storage.local and populate the
   * in-memory Map. Called on SW onStartup AND onInstalled to survive
   * MV3 SW sleep (Pitfall 9).
   */
  async rehydrate(): Promise<void> {
    try {
      const stored = (await Storage.get<TabActivityMap>(ADHD_TAB_ACTIVITY_STORAGE_KEY)) ?? {};
      activity.clear();
      for (const [id, ts] of Object.entries(stored)) {
        const n = Number(id);
        if (Number.isFinite(n) && typeof ts === 'number') {
          activity.set(n, ts);
        }
      }
      lastFlushAt = Date.now();
    } catch (err) {
      console.debug(`${LOG_PREFIX} rehydrate skipped:`, err);
    }
  },

  /**
   * Register the tab event listeners. Idempotent — subsequent calls
   * after the first are no-ops. The service-worker init block calls
   * this on both onInstalled and onStartup.
   */
  register(): void {
    if (listenersRegistered) return;
    listenersRegistered = true;

    chrome.tabs.onActivated.addListener((activeInfo) => {
      stamp(activeInfo.tabId);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'complete') stamp(tabId);
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      activity.delete(tabId);
      flushIfStale();
    });
  },

  /** Test-only: read the current in-memory size. */
  _size(): number {
    return activity.size;
  },

  /** Test-only: force a flush (bypasses debounce). */
  async _flushNow(): Promise<void> {
    lastFlushAt = 0;
    await flush();
  },
};
