/**
 * SAFETY-01 — Architectural contract test for AutoSuspendService.
 *
 * This is the single most important test in v3 (per 09-02-PLAN.md).
 * Object-permanence panic (CRIT-04) is abandonment-grade for ADHD users;
 * if Safe Auto-Suspend ever "looks like" a tab was closed or replaced,
 * trust is lost. This file mechanically verifies the never-closes
 * invariant by invoking EVERY public method of AutoSuspendService against
 * a synthetic tab fixture and asserting:
 *
 *   1. chrome.tabs.remove is NEVER called
 *   2. chrome.tabs.update is NEVER called with a chrome-extension:// URL
 *   3. chrome.tabGroups.remove is NEVER called
 *   4. chrome.tabs.discard IS called for every eligible tab (never remove)
 *   5. setBadgeText is called BEFORE discard (Pitfall 4)
 *
 * Per Pitfall 7 (09-RESEARCH.md): the contract test MUST actually invoke
 * the service — imports-only passes are a bug. Each test below exercises
 * runScan → findEligible → suspend across a 3-tab fixture.
 *
 * If this file fails, DO NOT "fix" it by loosening assertions. Fix the
 * service to never call the forbidden API.
 */

import { AutoSuspendService } from './auto-suspend-service';
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

const NOW = 1_700_000_000_000;
const PAST = NOW - 2 * 60 * 60 * 1000; // 2 hours ago — past any threshold

/**
 * 3-tab fixture: all eligible (not active, not pinned, not audible, not
 * discarded, past threshold). The contract test invokes runScan which
 * calls findEligible + suspend for each — exactly the paths most likely
 * to reach a tab-destruction API if a future commit regresses.
 */
function mkFixture(): chrome.tabs.Tab[] {
  return [
    {
      id: 1,
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
      url: 'https://alpha.example.com/',
      title: 'Alpha',
      favIconUrl: 'https://alpha.example.com/favicon.ico',
    },
    {
      id: 2,
      index: 1,
      windowId: 1,
      highlighted: false,
      active: false,
      pinned: false,
      audible: false,
      discarded: false,
      autoDiscardable: true,
      incognito: false,
      selected: false,
      url: 'https://beta.example.com/',
      title: 'Beta',
      favIconUrl: 'https://beta.example.com/favicon.ico',
    },
    {
      id: 3,
      index: 2,
      windowId: 1,
      highlighted: false,
      active: false,
      pinned: false,
      audible: false,
      discarded: false,
      autoDiscardable: true,
      incognito: false,
      selected: false,
      url: 'https://gamma.example.com/',
      title: 'Gamma',
      favIconUrl: 'https://gamma.example.com/favicon.ico',
    },
  ] as chrome.tabs.Tab[];
}

function activeSettings(): ADHDSettings {
  return {
    ...DEFAULT_ADHD_SETTINGS,
    masterEnabled: true,
    autoSuspend: {
      ...DEFAULT_ADHD_SETTINGS.autoSuspend,
      enabled: true,
      thresholdMin: 30,
      whitelistDomains: [],
    },
  };
}

describe('AutoSuspendService — SAFETY-01 contract (architectural)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetSettings.mockResolvedValue(activeSettings());
    mockIsFeatureActive.mockResolvedValue(true);
    mockStorageGet.mockResolvedValue({ '1': PAST, '2': PAST, '3': PAST });

    (chrome.tabs.query as jest.Mock).mockResolvedValue(mkFixture());
    (chrome.tabs.get as jest.Mock).mockImplementation(async (id: number) => {
      const t = mkFixture().find((x) => x.id === id);
      if (!t) throw new Error(`no tab ${id}`);
      return t;
    });
    (chrome.tabs.discard as jest.Mock).mockResolvedValue(undefined);
    (chrome.tabs.remove as jest.Mock).mockResolvedValue(undefined);
    (chrome.tabs.update as jest.Mock).mockResolvedValue(undefined);
    // chrome.tabGroups.remove is not in @types/chrome but we defensively mock
    // it to prove the service NEVER calls it even via dynamic dispatch.
    ((chrome.tabGroups as unknown) as { remove: jest.Mock }).remove = jest
      .fn()
      .mockResolvedValue(undefined);
    (chrome.action.setBadgeText as jest.Mock).mockResolvedValue(undefined);
    (chrome.action.setBadgeBackgroundColor as jest.Mock).mockResolvedValue(undefined);

    // Favicon-overlay handshake shim — see auto-suspend-service.test.ts for
    // the full rationale. In short: suspend() subscribes to
    // chrome.runtime.onMessage and waits up to 500ms for the content
    // script's 'bluetab:favicon-overlay-ready' ping. Here we capture the
    // listener and fire a synthetic ready message on executeScript resolve
    // so the SAFETY-01 contract tests run without dead-waiting 500ms per
    // fixture tab (3 tabs × 500ms = 1.5s overhead per test otherwise).
    let listeners: Array<
      (msg: unknown, sender: chrome.runtime.MessageSender) => void
    > = [];
    (chrome.runtime.onMessage.addListener as jest.Mock).mockImplementation(
      (fn: (msg: unknown, sender: chrome.runtime.MessageSender) => void) => {
        listeners.push(fn);
      },
    );
    (chrome.runtime.onMessage.removeListener as jest.Mock).mockImplementation(
      (fn: (msg: unknown, sender: chrome.runtime.MessageSender) => void) => {
        listeners = listeners.filter((l) => l !== fn);
      },
    );
    (chrome.scripting.executeScript as jest.Mock).mockImplementation(
      async (injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => {
        const tabId = injection.target.tabId;
        queueMicrotask(() => {
          for (const fn of listeners) {
            fn(
              { type: 'bluetab:favicon-overlay-ready' },
              { tab: { id: tabId } } as chrome.runtime.MessageSender,
            );
          }
        });
        return undefined;
      },
    );
  });

  it('NEVER calls chrome.tabs.remove when suspending', async () => {
    await AutoSuspendService.runScan(NOW);
    // Belt-and-braces: also hammer findEligible + suspend directly.
    const eligible = await AutoSuspendService.findEligible(NOW);
    for (const id of eligible) await AutoSuspendService.suspend(id);

    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  it('NEVER navigates a tab to a Bluetab-branded URL (chrome-extension://)', async () => {
    await AutoSuspendService.runScan(NOW);
    const eligible = await AutoSuspendService.findEligible(NOW);
    for (const id of eligible) await AutoSuspendService.suspend(id);

    const brandedNavigations = (chrome.tabs.update as jest.Mock).mock.calls.filter((args) => {
      // chrome.tabs.update signature: (tabId, updateProperties, callback?)
      // updateProperties is the second positional argument.
      const props = args[1] ?? args[0];
      return typeof props?.url === 'string' && props.url.startsWith('chrome-extension://');
    });
    expect(brandedNavigations).toHaveLength(0);
  });

  it('NEVER calls chrome.tabGroups.remove', async () => {
    await AutoSuspendService.runScan(NOW);
    const eligible = await AutoSuspendService.findEligible(NOW);
    for (const id of eligible) await AutoSuspendService.suspend(id);

    const tabGroupsRemove = ((chrome.tabGroups as unknown) as { remove: jest.Mock }).remove;
    expect(tabGroupsRemove).not.toHaveBeenCalled();
  });

  it('calls chrome.tabs.discard (never remove) for every eligible tab', async () => {
    await AutoSuspendService.runScan(NOW);

    const discardIds = (chrome.tabs.discard as jest.Mock).mock.calls.map((args) => args[0]);
    expect(discardIds.sort()).toEqual([1, 2, 3]);
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  it('setBadgeText is invoked BEFORE chrome.tabs.discard (Pitfall 4)', async () => {
    await AutoSuspendService.suspend(1);

    const badgeOrder = (chrome.action.setBadgeText as jest.Mock).mock.invocationCallOrder[0];
    const discardOrder = (chrome.tabs.discard as jest.Mock).mock.invocationCallOrder[0];

    expect(badgeOrder).toBeDefined();
    expect(discardOrder).toBeDefined();
    expect(badgeOrder).toBeLessThan(discardOrder);
  });
});
