/**
 * Unit tests for auto-suspend-service.ts.
 *
 * Covers ADHD-04 / ADHD-05 / ADHD-07 / ADHD-08 behavior:
 *   - findEligible filter chain (active / pinned / audible / discarded /
 *     whitelisted / threshold)
 *   - the missing-activity-record ⇒ ACTIVE correctness guarantee that makes
 *     the 200-entry cap safe
 *   - suspend() pipeline ordering (badge → overlay → discard)
 *   - suspend() graceful-degradation on badge / executeScript throws
 *   - onTabRestored clears the badge
 *   - SuspendedSessionCache CRUD
 *
 * The SAFETY-01 architectural contract is enforced in a separate file
 * (auto-suspend-service.safety.test.ts).
 */

import {
  AutoSuspendService,
  SuspendedSessionCache,
  ADHD_TAB_ACTIVITY_STORAGE_KEY,
} from './auto-suspend-service';
import { ADHDService } from '@/services/adhd-service';
import { Storage } from '@/utils/storage';
import { DEFAULT_ADHD_SETTINGS, type ADHDSettings } from '@/types/adhd';

jest.mock('@/services/adhd-service', () => ({
  ADHDService: {
    getSettings: jest.fn(),
    isFeatureActive: jest.fn(),
  },
}));

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

const mockGetSettings = ADHDService.getSettings as jest.Mock;
const mockIsFeatureActive = ADHDService.isFeatureActive as jest.Mock;
const mockStorageGet = Storage.get as jest.Mock;

/**
 * Favicon-overlay handshake shim.
 *
 * AutoSuspendService.suspend() subscribes to chrome.runtime.onMessage for
 * the 'bluetab:favicon-overlay-ready' ping emitted by the content script
 * once its composite-favicon pipeline settles, and waits up to ~500ms
 * before calling chrome.tabs.discard. In unit tests there is no real
 * content script, so these helpers capture the listener registered by
 * suspend() and fire a synthetic ready message — keeping tests fast and
 * preserving the true badge → executeScript → discard ordering.
 */
type OverlayListener = (msg: unknown, sender: chrome.runtime.MessageSender) => void;
let capturedOverlayListeners: OverlayListener[] = [];

function wireOverlayHandshake(): void {
  capturedOverlayListeners = [];

  (chrome.runtime.onMessage.addListener as jest.Mock).mockImplementation(
    (fn: OverlayListener) => {
      capturedOverlayListeners.push(fn);
    },
  );
  (chrome.runtime.onMessage.removeListener as jest.Mock).mockImplementation(
    (fn: OverlayListener) => {
      capturedOverlayListeners = capturedOverlayListeners.filter((l) => l !== fn);
    },
  );

  // When executeScript resolves (simulating successful content-script
  // injection), fire the ready message to any waiting listener for the
  // injected tab. Mirrors the real flow where the content script's
  // sendMessage follows executeScript within the same turn.
  (chrome.scripting.executeScript as jest.Mock).mockImplementation(
    async (injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => {
      const tabId = injection.target.tabId;
      // Defer one microtask so suspend() can reach its await before the
      // synthetic handshake lands — mimics real timing where the IIFE's
      // async work completes after executeScript resolves.
      queueMicrotask(() => {
        for (const fn of capturedOverlayListeners) {
          fn(
            { type: 'bluetab:favicon-overlay-ready' },
            { tab: { id: tabId } } as chrome.runtime.MessageSender,
          );
        }
      });
      return undefined;
    },
  );
}

/**
 * Build an ADHDSettings object with auto-suspend enabled by default so each
 * test case can override just what it needs.
 */
function settings(overrides: Partial<ADHDSettings['autoSuspend']> = {}): ADHDSettings {
  return {
    ...DEFAULT_ADHD_SETTINGS,
    masterEnabled: true,
    autoSuspend: {
      ...DEFAULT_ADHD_SETTINGS.autoSuspend,
      enabled: true,
      thresholdMin: 30,
      whitelistDomains: [],
      ...overrides,
    },
  };
}

function makeTab(id: number, overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id,
    index: 0,
    windowId: 1,
    highlighted: false,
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    autoDiscardable: true,
    incognito: false,
    selected: false,
    url: 'https://example.com/',
    title: 'Example',
    favIconUrl: 'https://example.com/favicon.ico',
    ...overrides,
  } as chrome.tabs.Tab;
}

const NOW = 1_700_000_000_000;
const THIRTY_MIN_MS = 30 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  SuspendedSessionCache.clear();

  // Default: feature active, no whitelist, default 30m threshold.
  mockGetSettings.mockResolvedValue(settings());
  mockIsFeatureActive.mockResolvedValue(true);
  mockStorageGet.mockResolvedValue({});

  (chrome.tabs.query as jest.Mock).mockResolvedValue([]);
  (chrome.tabs.get as jest.Mock).mockResolvedValue(
    makeTab(1, { title: 'Example', url: 'https://example.com/' }),
  );
  (chrome.tabs.discard as jest.Mock).mockResolvedValue(undefined);
  (chrome.action.setBadgeText as jest.Mock).mockResolvedValue(undefined);
  (chrome.action.setBadgeBackgroundColor as jest.Mock).mockResolvedValue(undefined);

  // Wire the favicon-overlay handshake so suspend() does not dead-wait
  // the 500ms timeout in tests. See wireOverlayHandshake for details.
  wireOverlayHandshake();
});

// ============================================================================
// findEligible — filter chain (ADHD-05)
// ============================================================================

describe('AutoSuspendService.findEligible', () => {
  const farPastActivity = { '1': NOW - 2 * THIRTY_MIN_MS };

  it('filters out active tabs (ADHD-05)', async () => {
    (chrome.tabs.query as jest.Mock).mockResolvedValue([makeTab(1, { active: true })]);
    mockStorageGet.mockResolvedValue(farPastActivity);

    const eligible = await AutoSuspendService.findEligible(NOW);

    expect(eligible).toEqual([]);
  });

  it('filters out pinned tabs (ADHD-05)', async () => {
    (chrome.tabs.query as jest.Mock).mockResolvedValue([makeTab(1, { pinned: true })]);
    mockStorageGet.mockResolvedValue(farPastActivity);

    const eligible = await AutoSuspendService.findEligible(NOW);

    expect(eligible).toEqual([]);
  });

  it('filters out audible tabs (ADHD-05)', async () => {
    (chrome.tabs.query as jest.Mock).mockResolvedValue([makeTab(1, { audible: true })]);
    mockStorageGet.mockResolvedValue(farPastActivity);

    const eligible = await AutoSuspendService.findEligible(NOW);

    expect(eligible).toEqual([]);
  });

  it('filters out already-discarded tabs', async () => {
    (chrome.tabs.query as jest.Mock).mockResolvedValue([makeTab(1, { discarded: true })]);
    mockStorageGet.mockResolvedValue(farPastActivity);

    const eligible = await AutoSuspendService.findEligible(NOW);

    expect(eligible).toEqual([]);
  });

  it('respects the threshold — returns a tab past threshold, drops a tab within threshold', async () => {
    (chrome.tabs.query as jest.Mock).mockResolvedValue([
      makeTab(1, { url: 'https://old.example.com/' }),
      makeTab(2, { url: 'https://fresh.example.com/' }),
    ]);
    mockStorageGet.mockResolvedValue({
      '1': NOW - 2 * THIRTY_MIN_MS, // 1 hour ago — past 30m threshold
      '2': NOW - 5 * 60 * 1000, // 5 minutes ago — within threshold
    });

    const eligible = await AutoSuspendService.findEligible(NOW);

    expect(eligible).toEqual([1]);
  });

  it('returns [] when master is OFF even if autoSuspend sub-toggle is ON', async () => {
    mockGetSettings.mockResolvedValue({
      ...settings(),
      masterEnabled: false,
    });
    (chrome.tabs.query as jest.Mock).mockResolvedValue([makeTab(1)]);
    mockStorageGet.mockResolvedValue(farPastActivity);

    const eligible = await AutoSuspendService.findEligible(NOW);

    expect(eligible).toEqual([]);
  });

  it('returns [] when autoSuspend.enabled is OFF even if master is ON', async () => {
    mockGetSettings.mockResolvedValue(settings({ enabled: false }));
    (chrome.tabs.query as jest.Mock).mockResolvedValue([makeTab(1)]);
    mockStorageGet.mockResolvedValue(farPastActivity);

    const eligible = await AutoSuspendService.findEligible(NOW);

    expect(eligible).toEqual([]);
  });

  it('excludes whitelisted domains by URL containment (ADHD-08)', async () => {
    mockGetSettings.mockResolvedValue(settings({ whitelistDomains: ['github.com'] }));
    (chrome.tabs.query as jest.Mock).mockResolvedValue([
      makeTab(1, { url: 'https://github.com/anthropic/bluetab' }),
      makeTab(2, { url: 'https://news.ycombinator.com/' }),
    ]);
    mockStorageGet.mockResolvedValue({
      '1': NOW - 2 * THIRTY_MIN_MS,
      '2': NOW - 2 * THIRTY_MIN_MS,
    });

    const eligible = await AutoSuspendService.findEligible(NOW);

    expect(eligible).toEqual([2]);
  });

  it('treats a tab with NO activity record as ACTIVE — never suspended (cap-eviction safety)', async () => {
    // This is the correctness guarantee that makes the 200-entry cap safe.
    // A tab whose timestamp is missing could only legitimately be "ancient",
    // but we bias toward "just now active" so cap eviction can never cause
    // a false-positive suspension.
    (chrome.tabs.query as jest.Mock).mockResolvedValue([makeTab(1)]);
    mockStorageGet.mockResolvedValue({}); // empty — tab 1 has no record

    const eligible = await AutoSuspendService.findEligible(NOW);

    expect(eligible).toEqual([]);
  });

  it('reads the activity map from the canonical storage key', async () => {
    (chrome.tabs.query as jest.Mock).mockResolvedValue([makeTab(1)]);
    mockStorageGet.mockResolvedValue({});

    await AutoSuspendService.findEligible(NOW);

    expect(mockStorageGet).toHaveBeenCalledWith(ADHD_TAB_ACTIVITY_STORAGE_KEY);
  });

  it('supports fractional thresholdMin (0.5 = 30 seconds debug preset)', async () => {
    // Debug preset from ADHDSettings dropdown — 30-second threshold so
    // developers can verify the suspend/restore cycle without waiting 15 min.
    // The eligibility math (thresholdMin * 60 * 1000) must treat 0.5 as 30000ms.
    mockGetSettings.mockResolvedValue(settings({ thresholdMin: 0.5 }));
    (chrome.tabs.query as jest.Mock).mockResolvedValue([
      makeTab(1, { url: 'https://past.example.com/' }), // 31s ago — past 30s threshold
      makeTab(2, { url: 'https://recent.example.com/' }), // 20s ago — within threshold
    ]);
    mockStorageGet.mockResolvedValue({
      '1': NOW - 31 * 1000,
      '2': NOW - 20 * 1000,
    });

    const eligible = await AutoSuspendService.findEligible(NOW);

    expect(eligible).toEqual([1]);
  });
});

// ============================================================================
// suspend — pipeline ordering + graceful degradation
// ============================================================================

describe('AutoSuspendService.suspend', () => {
  it('calls setBadgeText THEN executeScript THEN discard in that order (Pitfall 4)', async () => {
    await AutoSuspendService.suspend(42);

    const badgeCall = (chrome.action.setBadgeText as jest.Mock).mock.invocationCallOrder[0];
    const scriptCall = (chrome.scripting.executeScript as jest.Mock).mock.invocationCallOrder[0];
    const discardCall = (chrome.tabs.discard as jest.Mock).mock.invocationCallOrder[0];

    expect(badgeCall).toBeLessThan(scriptCall);
    expect(scriptCall).toBeLessThan(discardCall);

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 42, text: 'Zz' });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ['src/content/favicon-overlay.js'],
    });
    expect(chrome.tabs.discard).toHaveBeenCalledWith(42);
  });

  it('still discards even when executeScript throws (restricted-page degradation)', async () => {
    (chrome.scripting.executeScript as jest.Mock).mockRejectedValueOnce(
      new Error('Cannot access a chrome:// URL'),
    );

    await AutoSuspendService.suspend(7);

    expect(chrome.tabs.discard).toHaveBeenCalledWith(7);
  });

  it('still discards even when setBadgeText throws', async () => {
    (chrome.action.setBadgeText as jest.Mock).mockRejectedValueOnce(new Error('no tab'));

    await AutoSuspendService.suspend(9);

    expect(chrome.tabs.discard).toHaveBeenCalledWith(9);
  });

  it('records the suspended tab into SuspendedSessionCache for the sidepanel', async () => {
    (chrome.tabs.get as jest.Mock).mockResolvedValueOnce({
      id: 11,
      title: 'Docs',
      url: 'https://docs.example.com/',
      favIconUrl: 'https://docs.example.com/favicon.ico',
    });

    await AutoSuspendService.suspend(11);

    const all = SuspendedSessionCache.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      tabId: 11,
      title: 'Docs',
      url: 'https://docs.example.com/',
      favicon: 'https://docs.example.com/favicon.ico',
      restored: false,
    });
  });
});

// ============================================================================
// Favicon-overlay handshake — AutoSuspendService waits for the content
// script's 'bluetab:favicon-overlay-ready' ping (or times out) before
// calling chrome.tabs.discard. The composite favicon pipeline is async
// (image load + canvas.toDataURL), and chrome.scripting.executeScript
// resolves as soon as the script STARTS when injected via `files:`, so
// a handshake is required to avoid racing the discard against the
// composite DOM mutation.
// ============================================================================

describe('AutoSuspendService.suspend favicon-overlay handshake', () => {
  it('registers an onMessage listener BEFORE executeScript is invoked', async () => {
    // Listener-before-inject is load-bearing — chrome.runtime.onMessage
    // does not buffer undelivered messages. If the listener registered
    // AFTER the content script ran, a fast handshake could be missed.
    await AutoSuspendService.suspend(101);

    const addOrder = (chrome.runtime.onMessage.addListener as jest.Mock).mock
      .invocationCallOrder[0];
    const scriptOrder = (chrome.scripting.executeScript as jest.Mock).mock
      .invocationCallOrder[0];

    expect(addOrder).toBeDefined();
    expect(scriptOrder).toBeDefined();
    expect(addOrder).toBeLessThan(scriptOrder);
  });

  it('removes the onMessage listener after the handshake arrives (no leak)', async () => {
    await AutoSuspendService.suspend(102);

    // Default wireOverlayHandshake fires the ready message on executeScript
    // resolve, which should trigger teardown before discard.
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
  });

  it('still discards and tears down the listener when executeScript throws', async () => {
    // Restricted-page path — no handshake will ever arrive. Service must
    // cancel the subscription immediately rather than waiting 500ms.
    (chrome.scripting.executeScript as jest.Mock).mockRejectedValueOnce(
      new Error('Cannot access a chrome:// URL'),
    );

    await AutoSuspendService.suspend(103);

    expect(chrome.tabs.discard).toHaveBeenCalledWith(103);
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
  });

  it('times out gracefully when no handshake arrives (discard still fires)', async () => {
    // Simulate a content-script that loaded but never sent the ready
    // message (e.g. its async pipeline hung on a slow image fetch).
    // suspend() must still complete — the per-tab action badge is the
    // authoritative cue in that case.
    jest.useFakeTimers();
    (chrome.scripting.executeScript as jest.Mock).mockImplementation(
      async () => undefined, // overrides wireOverlayHandshake: no ready fire
    );

    const pending = AutoSuspendService.suspend(104);

    // Flush microtasks so suspend reaches its wait(), then fast-forward
    // past the 500ms timeout.
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(500);
    jest.useRealTimers();

    await pending;

    expect(chrome.tabs.discard).toHaveBeenCalledWith(104);
  });

  it('ignores handshake messages from a different tab', async () => {
    // The listener must filter by sender.tab.id — a handshake from tab 999
    // (unrelated) should not prematurely unblock the wait for tab 200.
    jest.useFakeTimers();
    (chrome.scripting.executeScript as jest.Mock).mockImplementation(
      async () => {
        // Fire a decoy ready message from a DIFFERENT tab id.
        queueMicrotask(() => {
          for (const fn of capturedOverlayListeners) {
            fn(
              { type: 'bluetab:favicon-overlay-ready' },
              { tab: { id: 999 } } as chrome.runtime.MessageSender,
            );
          }
        });
        return undefined;
      },
    );

    const pending = AutoSuspendService.suspend(200);

    // The wrong-tab handshake should be ignored — wait stays pending.
    await Promise.resolve();
    await Promise.resolve();

    // Discard should NOT have fired yet.
    expect(chrome.tabs.discard).not.toHaveBeenCalled();

    // Advance past the timeout to unblock.
    jest.advanceTimersByTime(500);
    jest.useRealTimers();
    await pending;

    expect(chrome.tabs.discard).toHaveBeenCalledWith(200);
  });

  it('ignores handshake messages of the wrong type', async () => {
    // A non-overlay runtime message (e.g. OPEN_BLUETAB_PAGE) must not be
    // interpreted as the overlay ready signal.
    jest.useFakeTimers();
    (chrome.scripting.executeScript as jest.Mock).mockImplementation(
      async (injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => {
        queueMicrotask(() => {
          for (const fn of capturedOverlayListeners) {
            fn(
              { type: 'OPEN_BLUETAB_PAGE' },
              { tab: { id: injection.target.tabId } } as chrome.runtime.MessageSender,
            );
          }
        });
        return undefined;
      },
    );

    const pending = AutoSuspendService.suspend(201);

    await Promise.resolve();
    await Promise.resolve();
    expect(chrome.tabs.discard).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    jest.useRealTimers();
    await pending;

    expect(chrome.tabs.discard).toHaveBeenCalledWith(201);
  });
});

// ============================================================================
// onTabRestored — badge clears + session record flipped
// ============================================================================

describe('AutoSuspendService.onTabRestored', () => {
  it('clears the per-tab badge and marks the session record restored', async () => {
    SuspendedSessionCache.record({
      tabId: 3,
      title: 'x',
      url: 'https://x/',
      suspendedAt: NOW,
      restored: false,
    });

    await AutoSuspendService.onTabRestored(3);

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 3, text: '' });
    const rec = SuspendedSessionCache.getAll().find((r) => r.tabId === 3);
    expect(rec?.restored).toBe(true);
  });
});

// ============================================================================
// SuspendedSessionCache — CRUD
// ============================================================================

describe('SuspendedSessionCache', () => {
  it('record / getAll / markRestored / forget / clear roundtrip', () => {
    SuspendedSessionCache.record({
      tabId: 1,
      title: 'A',
      url: 'https://a/',
      suspendedAt: NOW,
      restored: false,
    });
    SuspendedSessionCache.record({
      tabId: 2,
      title: 'B',
      url: 'https://b/',
      suspendedAt: NOW + 1,
      restored: false,
    });

    expect(SuspendedSessionCache.getAll()).toHaveLength(2);

    SuspendedSessionCache.markRestored(1);
    expect(SuspendedSessionCache.getAll().find((r) => r.tabId === 1)?.restored).toBe(true);

    SuspendedSessionCache.forget(1);
    expect(SuspendedSessionCache.getAll()).toHaveLength(1);

    SuspendedSessionCache.clear();
    expect(SuspendedSessionCache.getAll()).toHaveLength(0);
  });
});
