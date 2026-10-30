/**
 * @module services/auto-suspend-service
 *
 * WHY:  Phase 9 ADHD-05 / SAFETY-01 — inactive tabs past the user's threshold
 *       must be QUIETED without being closed, navigated, or replaced.
 *       Object-permanence panic (CRIT-04) is abandonment-grade for ADHD users;
 *       if a tab "disappears" trust is lost. This service is the SINGLE
 *       entry point for auto-suspension and is contract-tested to guarantee
 *       it never destroys user state.
 *
 * WHAT: Static AutoSuspendService class with:
 *       - findEligible(now)   — returns tab IDs where:
 *         not active, not pinned, not audible, not already-discarded,
 *         not whitelisted, and past the threshold (ADHD-05 / ADHD-08).
 *         Tabs without an activity record are treated as just-now-active
 *         (SAFE — the 200-entry cap on the activity map can never cause
 *         an eligible tab to become INCORRECTLY suspended).
 *       - suspend(tabId)      — orchestrates, IN ORDER:
 *         1) per-tab chrome.action badge "Zz" (authoritative post-discard cue)
 *         2) chrome.scripting.executeScript favicon-overlay injection
 *            (best-effort; restricted pages like chrome:// throw and degrade
 *            silently — badge still paints)
 *         3) chrome.tabs.discard (the never-closes invariant)
 *         4) SuspendedSessionCache.record for sidepanel UI
 *       - runScan()           — gated on ADHDService.isFeatureActive('autoSuspend');
 *         iterates findEligible and calls suspend for each.
 *       - onTabRestored(id)   — clears the per-tab badge and marks the
 *         sidepanel record restored when a user re-activates a discarded tab.
 *       - registerListeners() — idempotent chrome.tabs.onUpdated /
 *         onRemoved listeners for restore detection + cache cleanup.
 *       - SuspendedSessionCache — in-memory Map (MODULE scope) of records
 *         accumulated since the SW last woke; wipes on SW suspend. Matches
 *         CONTEXT.md decision: no dedicated activity log for Phase 9.
 *
 * HOW:  Reads settings via ADHDService.isFeatureActive() and getSettings().
 *       Reads per-tab activity from chrome.storage.local['adhd_tab_activity']
 *       (maintained by the service-worker activity tracker in Task 9-02-02).
 *       Whitelist matches against URL-containment of bare domain strings,
 *       mirroring FocusSettings.normalizeDomain convention — the domain
 *       exclusion is URL-level (no protocol parse) which matches the way
 *       FocusService filters blocked domains (chromium URL substring match).
 *
 * NOT:  SAFETY-01: NEVER call chrome.tabs.remove, chrome.tabs.update with a
 *       chrome-extension://... URL, or chrome.tabGroups.remove from this
 *       module. This is architectural. The auto-suspend-service.safety.test.ts
 *       contract test mechanically enforces the invariant on every commit.
 *
 *       Does not persist the SuspendedSessionCache — session-scoped only.
 *       Does not render UI — see SuspendedTabsSection.tsx (Task 9-02-03).
 *       Does not schedule its own periodic scan — the service-worker alarm
 *       dispatch wires ALARM_NAMES.ADHD_AUTOSUSPEND_SCAN to runScan() in
 *       Task 9-02-02.
 */

import { ADHDService } from '@/services/adhd-service';
import { Storage } from '@/utils/storage';
import type { SuspendedTabRecord } from '@/types/adhd';

const LOG_PREFIX = '[BlueTab][AutoSuspendService]';

/**
 * Content-script handshake message type — matches the string emitted by
 * src/content/favicon-overlay.ts after it finishes the composite+apply
 * pipeline. The service worker uses this to bridge the gap between
 * chrome.scripting.executeScript resolving (as soon as the script STARTS
 * when injected via `files:`) and the async IIFE inside actually
 * finishing its DOM mutation.
 */
const OVERLAY_READY_MESSAGE_TYPE = 'bluetab:favicon-overlay-ready';

/**
 * Upper bound on how long suspend() will wait for the content script to
 * finish the composite favicon pipeline. 500ms is generous for
 * fetch-from-cache + canvas composite + toDataURL on modern machines;
 * past this we proceed with discard regardless. The MutationObserver
 * inside the content script will re-apply the favicon next time the page
 * is visible if the mutation raced the discard.
 */
const OVERLAY_READY_TIMEOUT_MS = 500;

/** chrome.storage.local key for the per-tab last-active timestamp map. */
export const ADHD_TAB_ACTIVITY_STORAGE_KEY = 'adhd_tab_activity' as const;

/** Per-tab last-active timestamp map. Missing entry ⇒ treat as just-active-now. */
export interface TabActivityMap {
  [tabId: string]: number;
}

// ============================================================================
// SuspendedSessionCache — in-memory, module-scope Map
// ============================================================================

/**
 * In-memory session cache of tabs suspended by AutoSuspendService during the
 * current SW lifetime. Wipes on SW suspend — matches CONTEXT.md decision to
 * defer a persistent Bluetab-wide activity log to a later feature.
 *
 * Sidepanel SuspendedTabsSection reads this to render the "Suspended" card
 * with user-initiated Close-all / Save-as-group-and-close batch actions
 * (each gated by a two-click inline confirmation — CRIT-04 mitigation).
 */
const sessionRecords = new Map<number, SuspendedTabRecord>();

/**
 * Subscribe to the favicon-overlay "ready" handshake for a specific tab.
 * Returns a controller with:
 *   - `wait(timeoutMs)` — promise that resolves when the handshake arrives
 *                         or `timeoutMs` elapses (whichever is first).
 *   - `cancel()`        — tear down the listener now (when we know no
 *                         handshake will ever arrive, e.g. executeScript
 *                         threw). Resolves any pending wait() immediately.
 *
 * Why the handshake is necessary: when injected via `files:` (not `func:`),
 * chrome.scripting.executeScript resolves as soon as the script STARTS
 * executing, NOT when its top-level async IIFE settles. Image-load +
 * canvas-composite + toDataURL is async work that outlives that
 * resolution. Discarding during that window would freeze a half-applied
 * DOM.
 *
 * Why listener-before-inject matters: chrome.runtime onMessage does NOT
 * buffer undelivered messages. Registering the listener BEFORE the
 * content script runs guarantees we catch the handshake even if the
 * content script sends it immediately on first tick.
 *
 * A timeout is NOT an error — the authoritative post-discard cue is the
 * per-tab action badge (already set), and the content script's
 * MutationObserver will re-apply the composite on the next page load
 * if the DOM mutation raced the discard.
 */
function subscribeOverlayReady(tabId: number): {
  wait: (timeoutMs: number) => Promise<void>;
  cancel: () => void;
} {
  let settled = false;
  let resolveWait: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const listener = (
    msg: unknown,
    sender: chrome.runtime.MessageSender,
  ): void => {
    if (!msg || typeof msg !== 'object') return;
    const type = (msg as { type?: unknown }).type;
    if (type !== OVERLAY_READY_MESSAGE_TYPE) return;
    if (sender.tab?.id !== tabId) return;
    finish();
  };

  const finish = (): void => {
    if (settled) return;
    settled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      chrome.runtime.onMessage.removeListener(listener);
    } catch {
      /* removeListener may throw if onMessage was unavailable — harmless. */
    }
    if (resolveWait) resolveWait();
  };

  try {
    chrome.runtime.onMessage.addListener(listener);
  } catch {
    // onMessage unavailable — subscriber becomes a no-op that resolves
    // immediately on wait() via the timeout path (or cancel()).
  }

  return {
    wait(timeoutMs: number): Promise<void> {
      if (settled) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveWait = resolve;
        timer = setTimeout(finish, timeoutMs);
      });
    },
    cancel(): void {
      finish();
    },
  };
}

export const SuspendedSessionCache = {
  record(record: SuspendedTabRecord): void {
    sessionRecords.set(record.tabId, record);
  },
  getAll(): SuspendedTabRecord[] {
    return Array.from(sessionRecords.values());
  },
  markRestored(tabId: number): void {
    const existing = sessionRecords.get(tabId);
    if (!existing) return;
    sessionRecords.set(tabId, { ...existing, restored: true });
  },
  forget(tabId: number): void {
    sessionRecords.delete(tabId);
  },
  clear(): void {
    sessionRecords.clear();
  },
};

// ============================================================================
// AutoSuspendService
// ============================================================================

let listenersRegistered = false;

export class AutoSuspendService {
  /**
   * Eligibility gate — ADHD-05 / ADHD-08.
   *
   * Returns the tab IDs that should be discarded on the next scan. Filters
   * out active / pinned / audible / already-discarded / whitelisted tabs,
   * and tabs whose last-active timestamp is within the configured threshold.
   *
   * SAFE DEFAULT: a tab with NO entry in the activity map is treated as
   * having been active "now" — so it is NEVER eligible. This makes the
   * 200-entry cap in the tracker safe: eviction of the oldest entries can
   * only ever move a tab from "might suspend" to "never suspend", never the
   * other direction.
   */
  static async findEligible(now: number = Date.now()): Promise<number[]> {
    const settings = await ADHDService.getSettings();
    if (!settings.masterEnabled) return [];
    if (!settings.autoSuspend.enabled) return [];

    // Fractional minutes are supported (e.g. 0.5 → 30000ms) so the ADHDSettings
    // dropdown can expose a 30-second debug preset without widening the stored
    // shape to seconds. See AutoSuspendSettings.thresholdMin JSDoc.
    const thresholdMs = settings.autoSuspend.thresholdMin * 60 * 1000;
    const activity = (await Storage.get<TabActivityMap>(ADHD_TAB_ACTIVITY_STORAGE_KEY)) ?? {};
    const whitelistDomains = settings.autoSuspend.whitelistDomains ?? [];

    const tabs = await chrome.tabs.query({});
    const eligible: number[] = [];

    for (const tab of tabs) {
      if (typeof tab.id !== 'number') continue;
      if (tab.active) continue;            // ADHD-05: not active
      if (tab.pinned) continue;            // ADHD-05: not pinned
      if (tab.audible) continue;           // ADHD-05: not audible
      if (tab.discarded) continue;         // already suspended — skip

      // Whitelist — ADHD-08. Substring match against the tab URL keeps the
      // check resilient to www. / protocol / port variants without pulling
      // in a full URL parser. FocusService uses the same pattern.
      const url = tab.url ?? '';
      if (url && whitelistDomains.some((d) => d && url.includes(d))) continue;

      // Inactivity gate — missing record ⇒ treat as just-active-now (SAFE).
      const last = activity[String(tab.id)] ?? now;
      if (now - last < thresholdMs) continue;

      eligible.push(tab.id);
    }

    return eligible;
  }

  /**
   * Suspend a tab — paints both indicators, THEN discards, THEN records.
   *
   * Order is load-bearing (Pitfall 4 from 09-RESEARCH): the per-tab action
   * badge must be set BEFORE chrome.tabs.discard so Chrome captures it
   * into the tab's own state and it survives the discard + re-activation
   * reload. Favicon overlay is best-effort — restricted pages (chrome://,
   * Chrome Web Store) throw and we degrade silently; the action badge is
   * the authoritative post-discard cue in that case.
   *
   * SAFETY-01: this method NEVER calls chrome.tabs.remove,
   * chrome.tabs.update({url: 'chrome-extension://...'}), or
   * chrome.tabGroups.remove. The safety contract test enforces this.
   */
  static async suspend(tabId: number): Promise<void> {
    // Capture title / url / favicon BEFORE discard — discard reloads the
    // page on re-activation and wipes runtime state; pre-capture gives
    // SuspendedTabsSection meaningful content to render.
    let title = '';
    let url = '';
    let favicon: string | undefined;
    try {
      const tab = await chrome.tabs.get(tabId);
      title = tab.title ?? '';
      url = tab.url ?? '';
      favicon = tab.favIconUrl ?? undefined;
    } catch (err) {
      console.debug(`${LOG_PREFIX} tab lookup skipped for`, tabId, err);
    }

    // 1. Per-tab action badge — BEFORE discard (Pitfall 4).
    try {
      await chrome.action.setBadgeText({ tabId, text: 'Zz' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#64748b' });
    } catch (err) {
      console.debug(`${LOG_PREFIX} badge skipped for`, tabId, err);
    }

    // 2. Favicon overlay content script — best-effort; restricted pages
    // (chrome://, chromewebstore.google.com, etc.) throw and degrade.
    //
    // The content script paints a COMPOSITE favicon (original + Zz
    // corner badge) via canvas (see src/content/favicon-overlay.ts).
    // The composite pipeline is async (image load + toDataURL), and
    // when injected via `files:` chrome.scripting.executeScript
    // resolves as soon as the script STARTS executing — NOT when its
    // async IIFE settles. We bridge that gap with an onMessage
    // handshake: the content script posts
    // 'bluetab:favicon-overlay-ready' after the <link> mutation is
    // applied, and we wait for it (capped by OVERLAY_READY_TIMEOUT_MS)
    // before discarding.
    //
    // Listener-before-inject ordering is load-bearing: chrome.runtime
    // onMessage does NOT buffer undelivered messages, so the listener
    // must be registered BEFORE the content script has any chance of
    // sending its handshake. We therefore subscribe first, then kick
    // off executeScript, then either await the handshake (injected
    // path) or cancel the subscription (restricted-page path — the
    // handshake will never arrive).
    const overlayReady = subscribeOverlayReady(tabId);

    let scriptInjected = false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/favicon-overlay.js'],
      });
      scriptInjected = true;
    } catch (err) {
      console.debug(`${LOG_PREFIX} favicon overlay skipped for`, tabId, err);
    }

    if (scriptInjected) {
      // Content script is running — wait for its ready handshake
      // (or the safety timeout, whichever comes first).
      await overlayReady.wait(OVERLAY_READY_TIMEOUT_MS);
    } else {
      // No script means no handshake will ever arrive. Tear down the
      // listener immediately so we don't leak it across many suspend
      // calls, and skip the 500ms dead wait.
      overlayReady.cancel();
    }

    // 3. Discard — the never-closes invariant. ADHD-05 / SAFETY-01.
    await chrome.tabs.discard(tabId);

    // 4. Record for the sidepanel session-scoped UI.
    SuspendedSessionCache.record({
      tabId,
      title,
      url,
      favicon,
      suspendedAt: Date.now(),
      restored: false,
    });
  }

  /**
   * Scheduled scan entry point — wired into the service-worker alarm
   * dispatch for ALARM_NAMES.ADHD_AUTOSUSPEND_SCAN in Task 9-02-02.
   *
   * No-op when master / sub-feature is off (gate mirrors findEligible).
   * Individual suspend() failures are swallowed with a debug log so one
   * bad tab cannot abort the rest of the scan.
   */
  static async runScan(now: number = Date.now()): Promise<void> {
    const active = await ADHDService.isFeatureActive('autoSuspend');
    if (!active) return;

    const eligible = await this.findEligible(now);
    for (const id of eligible) {
      try {
        await this.suspend(id);
      } catch (err) {
        console.debug(`${LOG_PREFIX} suspend skipped for`, id, err);
      }
    }
  }

  /**
   * Called when chrome.tabs.onUpdated fires with changeInfo.discarded === false
   * (the tab was discarded and is now being reloaded by the user's click).
   * Clears the per-tab Zz badge and marks the session record restored so
   * SuspendedTabsSection can hide that row.
   */
  static async onTabRestored(tabId: number): Promise<void> {
    try {
      await chrome.action.setBadgeText({ tabId, text: '' });
    } catch (err) {
      console.debug(`${LOG_PREFIX} badge clear skipped for`, tabId, err);
    }
    SuspendedSessionCache.markRestored(tabId);
  }

  /**
   * Idempotent listener registration. Wired from the service-worker init
   * block (Task 9-02-02) on both onInstalled and onStartup.
   *
   * - chrome.tabs.onUpdated — detects the discard→restore transition via
   *   changeInfo.discarded === false; clears the badge (Pitfall 2).
   * - chrome.tabs.onRemoved — forgets the session record so the sidepanel
   *   does not keep rendering rows for tabs that are really gone (tabs
   *   the user closed via the tab strip, NOT via this service).
   */
  static registerListeners(): void {
    if (listenersRegistered) return;
    listenersRegistered = true;

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.discarded === false) {
        void this.onTabRestored(tabId);
      }
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      SuspendedSessionCache.forget(tabId);
    });
  }
}
