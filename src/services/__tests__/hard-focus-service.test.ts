/**
 * HardFocusService tests (ADHD-13, HF1 post-human-verify snapshot model)
 *
 * HF1 semantic: whitelist is a SNAPSHOT at start() time — no reactive updates.
 *
 * Key invariants (updated for HF1):
 *   - At Start: rules always contain ID 20000 (block), 20001 (chrome-extension allow),
 *     20002 (chrome allow), then 20003+ for each snapshot entry.
 *   - No dynamic regeneration post-Start (scheduleWhitelistUpdate / updateWhitelist removed).
 *   - Rule set is deterministic from the current-window tab snapshot taken at start().
 *   - stop() clears everything; next start() takes a fresh snapshot.
 */

import {
  HardFocusService,
  HARD_FOCUS_BLOCK_ID,
  HARD_FOCUS_EXTENSION_ALLOW_ID,
  HARD_FOCUS_CHROME_ALLOW_ID,
  HARD_FOCUS_ALLOW_START,
  HARD_FOCUS_ALLOW_END,
} from '@/services/hard-focus-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTab(url: string, groupId: number): chrome.tabs.Tab {
  return {
    id: Math.floor(Math.random() * 10000),
    url,
    groupId,
    active: false,
    pinned: false,
    highlighted: false,
    windowId: 1,
    index: 0,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
  } as chrome.tabs.Tab;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  (chrome.tabGroups.query as jest.Mock).mockResolvedValue([]);
  (chrome.tabs.query as jest.Mock).mockResolvedValue([]);
  (chrome.declarativeNetRequest.updateDynamicRules as jest.Mock).mockResolvedValue(undefined);
  (chrome.storage.local.get as jest.Mock).mockImplementation((_key, callback) => {
    if (callback) callback({});
    return Promise.resolve({});
  });
  (chrome.storage.local.set as jest.Mock).mockImplementation((_data, callback) => {
    if (callback) callback();
    return Promise.resolve();
  });
});

// ---------------------------------------------------------------------------
// buildWhitelistRules — rule construction (ADHD-13, HF1)
// ---------------------------------------------------------------------------

describe('HardFocusService — buildWhitelistRules (HF1 snapshot model)', () => {
  test('T1: always emits redirect(20000) + chrome-extension-allow(20001) + chrome-allow(20002)', () => {
    const rules = HardFocusService.buildWhitelistRules([], false);
    expect(rules).toHaveLength(3);

    const blockRule = rules[0];
    expect(blockRule.id).toBe(HARD_FOCUS_BLOCK_ID);
    expect(blockRule.priority).toBe(1);
    // T1-fix: action is redirect (to our block page), not ERR_BLOCKED_BY_CLIENT
    expect(blockRule.action.type).toBe('redirect');
    // Catch-all uses regexFilter '^.*$' (required with regexSubstitution).
    const blockCond = blockRule.condition as chrome.declarativeNetRequest.RuleCondition;
    expect(blockCond.urlFilter).toBeUndefined();
    expect(blockCond.regexFilter).toBe('^.*$');
    // regexSubstitution carries original URL as #url=\0
    const redirect = (blockRule.action as chrome.declarativeNetRequest.RuleAction).redirect;
    expect(redirect?.regexSubstitution).toBeDefined();
    expect(redirect?.regexSubstitution).toContain('#url=\\0');
    expect(redirect?.regexSubstitution).toContain('blocked/index.html');
    // Must NOT use extensionPath (which doesn't carry original URL)
    expect(redirect?.extensionPath).toBeUndefined();

    const extRule = rules[1];
    expect(extRule.id).toBe(HARD_FOCUS_EXTENSION_ALLOW_ID);
    expect(extRule.priority).toBe(3);
    expect(extRule.action.type).toBe('allow');
    // H-fix: pipe-anchor prefix `|chrome-extension://` (left-anchored, no wildcard)
    expect((extRule.condition as chrome.declarativeNetRequest.RuleCondition).urlFilter).toBe('|chrome-extension://');

    const chromeRule = rules[2];
    expect(chromeRule.id).toBe(HARD_FOCUS_CHROME_ALLOW_ID);
    expect(chromeRule.priority).toBe(3);
    expect(chromeRule.action.type).toBe('allow');
    // H-fix: pipe-anchor prefix `|chrome://` (left-anchored, no wildcard)
    expect((chromeRule.condition as chrome.declarativeNetRequest.RuleCondition).urlFilter).toBe('|chrome://');
  });

  test('per-URL snapshot rules start at ID 20003 (not 20002)', () => {
    const urls = ['https://a.com/x', 'https://b.com/y'];
    const rules = HardFocusService.buildWhitelistRules(urls, false);
    // block(1) + ext-allow(1) + chrome-allow(1) + 2 per-URL = 5
    expect(rules).toHaveLength(5);

    const urlRule1 = rules[3];
    expect(urlRule1.id).toBe(HARD_FOCUS_ALLOW_START); // 20003
    expect(urlRule1.priority).toBe(2);

    const urlRule2 = rules[4];
    expect(urlRule2.id).toBe(HARD_FOCUS_ALLOW_START + 1); // 20004
  });

  test('T3-fix: URL mode uses regexFilter ^<escaped>(/)?([?#].*)?$ — no sub-path leakage', () => {
    // T3: regexFilter prevents sub-path matching.
    // google.com/search must NOT match when only google.com is whitelisted.
    const urls = ['https://google.com'];
    const rules = HardFocusService.buildWhitelistRules(urls, false);
    const urlRule = rules.find((r) => r.priority === 2);
    expect(urlRule).toBeDefined();
    const cond = urlRule!.condition as chrome.declarativeNetRequest.RuleCondition;
    // Must use regexFilter, not urlFilter
    expect(cond.urlFilter).toBeUndefined();
    expect(cond.regexFilter).toBeDefined();
    // Pattern must start with ^ and end with $ for exact matching
    expect(cond.regexFilter!.startsWith('^')).toBe(true);
    expect(cond.regexFilter!.endsWith('$')).toBe(true);
    // Must allow optional trailing slash + optional query/fragment only
    expect(cond.regexFilter).toContain('(/)?([?#].*)?$');
    // Verify it does NOT match sub-paths via the regex
    const rx = new RegExp(cond.regexFilter!);
    expect(rx.test('https://google.com')).toBe(true);         // exact — allow
    expect(rx.test('https://google.com/')).toBe(true);        // trailing slash — allow
    expect(rx.test('https://google.com?q=x')).toBe(true);    // query — allow
    expect(rx.test('https://google.com#x')).toBe(true);      // fragment — allow
    expect(rx.test('https://google.com/search')).toBe(false); // sub-path — block
    expect(rx.test('https://google.com/search?q=x')).toBe(false); // sub-path + query — block
    expect(rx.test('https://google.comx')).toBe(false);      // different domain — block
  });

  test('T3-fix: URL mode strips query/fragment AND trailing slash from snapshot URL', () => {
    // Snapshot URL may itself have a query or fragment — strip these before building regex
    const urls = ['https://example.com/path?existing=param'];
    const rules = HardFocusService.buildWhitelistRules(urls, false);
    const urlRule = rules.find((r) => r.priority === 2);
    const cond = urlRule!.condition as chrome.declarativeNetRequest.RuleCondition;
    // Should normalize to just https://example.com/path (query stripped)
    expect(cond.regexFilter).not.toContain('existing');
    expect(cond.regexFilter).toContain('example\\.com/path');
  });

  test('domainMode:true builds requestDomains rules, strips www.', () => {
    const urls = ['https://a.com/x', 'https://www.b.com/y'];
    const rules = HardFocusService.buildWhitelistRules(urls, true);
    expect(rules).toHaveLength(5);

    const domainRule1 = rules[3];
    expect((domainRule1.condition as chrome.declarativeNetRequest.RuleCondition).requestDomains).toEqual(['a.com']);

    const domainRule2 = rules[4];
    expect((domainRule2.condition as chrome.declarativeNetRequest.RuleCondition).requestDomains).toEqual(['b.com']);
  });

  test('domainMode:true deduplicates hostnames', () => {
    const urls = ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'];
    const rules = HardFocusService.buildWhitelistRules(urls, true);
    // block + ext-allow + chrome-allow + exactly 1 domain rule
    expect(rules).toHaveLength(4);
  });

  test('never exceeds HARD_FOCUS_ALLOW_END; all IDs in [20000..24999]', () => {
    const urls = Array.from({ length: 5000 }, (_, i) => `https://domain${i}.com/page`);
    const rules = HardFocusService.buildWhitelistRules(urls, false);

    for (const rule of rules) {
      expect(rule.id).toBeGreaterThanOrEqual(HARD_FOCUS_BLOCK_ID);
      expect(rule.id).toBeLessThanOrEqual(HARD_FOCUS_ALLOW_END);
    }
  });
});

// ---------------------------------------------------------------------------
// start() — snapshot semantics (HF1)
// ---------------------------------------------------------------------------

describe('HardFocusService — start() snapshot semantics (HF1)', () => {
  test('HF1: start() snapshots current-window tabs at call time, including ungrouped tabs', async () => {
    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.currentWindow) {
        return [
          makeTab('https://work.com/a', -1),
          makeTab('https://github.com', -1),
          makeTab('chrome://newtab/', -1),
        ];
      }
      return [];
    });
    (chrome.storage.local.get as jest.Mock).mockImplementation((_key, callback) => {
      if (callback) callback({ adhd_settings: { hardFocus: { domainMode: false } } });
      return Promise.resolve({ adhd_settings: { hardFocus: { domainMode: false } } });
    });

    await HardFocusService.start();

    const updateDynamicRules = chrome.declarativeNetRequest.updateDynamicRules as jest.Mock;
    expect(updateDynamicRules).toHaveBeenCalledTimes(1);

    const callArgs = updateDynamicRules.mock.calls[0][0];
    // block + ext-allow + chrome-allow + 2 current-window http(s) URLs = 5
    expect(callArgs.addRules).toHaveLength(5);
    expect(callArgs.addRules[0].id).toBe(HARD_FOCUS_BLOCK_ID);
    expect(callArgs.addRules[1].id).toBe(HARD_FOCUS_EXTENSION_ALLOW_ID);
    expect(callArgs.addRules[2].id).toBe(HARD_FOCUS_CHROME_ALLOW_ID);
    expect(callArgs.addRules[3].id).toBe(HARD_FOCUS_ALLOW_START);
  });

  test('HF1: start() always includes chrome-extension://* and chrome://* allow rules', async () => {
    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([]);

    await HardFocusService.start();

    const rules = (chrome.declarativeNetRequest.updateDynamicRules as jest.Mock).mock.calls[0][0].addRules;
    const extAllow = rules.find((r: chrome.declarativeNetRequest.Rule) => r.id === HARD_FOCUS_EXTENSION_ALLOW_ID);
    const chromeAllow = rules.find((r: chrome.declarativeNetRequest.Rule) => r.id === HARD_FOCUS_CHROME_ALLOW_ID);

    expect(extAllow).toBeDefined();
    // H-fix: left-anchored pipe prefix; no trailing wildcard
    expect((extAllow!.condition as chrome.declarativeNetRequest.RuleCondition).urlFilter).toBe('|chrome-extension://');
    expect(chromeAllow).toBeDefined();
    // H-fix: left-anchored pipe prefix; no trailing wildcard
    expect((chromeAllow!.condition as chrome.declarativeNetRequest.RuleCondition).urlFilter).toBe('|chrome://');
  });

  test('HF1: current-window ungrouped tabs ARE in the whitelist', async () => {
    (chrome.tabs.query as jest.Mock).mockResolvedValue([makeTab('https://example.com', -1)]);

    await HardFocusService.start();

    const rules = (chrome.declarativeNetRequest.updateDynamicRules as jest.Mock).mock.calls[0][0].addRules;
    // 3 structural rules + 1 current-window URL rule
    expect(rules).toHaveLength(4);
    expect(rules[3].id).toBe(HARD_FOCUS_ALLOW_START);
  });

  test('HF1: start() is idempotent — second call removes full range then adds fresh snapshot', async () => {
    (chrome.tabs.query as jest.Mock).mockResolvedValue([makeTab('https://work.com', -1)]);

    await HardFocusService.start();
    await HardFocusService.start();

    const updateDynamicRules = chrome.declarativeNetRequest.updateDynamicRules as jest.Mock;
    expect(updateDynamicRules).toHaveBeenCalledTimes(2);
    for (const call of updateDynamicRules.mock.calls) {
      expect(call[0].removeRuleIds).toHaveLength(5000);
    }
  });

  test('HF1: NO dynamic rule update happens after start() (no updateWhitelist/scheduleWhitelistUpdate)', () => {
    // Since updateWhitelist and scheduleWhitelistUpdate were removed, this test
    // simply asserts these methods do not exist on the service.
    expect((HardFocusService as unknown as Record<string, unknown>).updateWhitelist).toBeUndefined();
    expect((HardFocusService as unknown as Record<string, unknown>).scheduleWhitelistUpdate).toBeUndefined();
  });

  test('HF1: start() persists state with isActive:true and domainMode from settings', async () => {
    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([]);
    const setMock = chrome.storage.local.set as jest.Mock;

    await HardFocusService.start();

    const stateCalls = setMock.mock.calls.filter((c) => c[0]?.hardFocusState);
    expect(stateCalls).toHaveLength(1);
    expect(stateCalls[0][0].hardFocusState.isActive).toBe(true);
  });

  test('start(): falls back to domainMode=true when URL snapshot exceeds URL-regex cap', async () => {
    const manyTabs = Array.from({ length: 1000 }, (_, i) => makeTab(`https://d${i}.example/path`, -1));
    (chrome.tabs.query as jest.Mock).mockResolvedValue(manyTabs);
    const setMock = chrome.storage.local.set as jest.Mock;

    await HardFocusService.start();

    const stateCalls = setMock.mock.calls.filter((c) => c[0]?.hardFocusState);
    expect(stateCalls).toHaveLength(1);
    expect(stateCalls[0][0].hardFocusState.domainMode).toBe(true);
  });

  test('T5: start() persists snapshotUrls in hardFocusState for observability', async () => {
    (chrome.tabs.query as jest.Mock).mockResolvedValue([
      makeTab('https://github.com/repo', -1),
      makeTab('https://docs.example.com', -1),
    ]);
    const setMock = chrome.storage.local.set as jest.Mock;

    await HardFocusService.start();

    const stateCalls = setMock.mock.calls.filter((c) => c[0]?.hardFocusState);
    expect(stateCalls).toHaveLength(1);
    const persisted = stateCalls[0][0].hardFocusState;
    expect(persisted.snapshotUrls).toBeDefined();
    expect(persisted.snapshotUrls).toHaveLength(2);
    expect(persisted.snapshotUrls).toContain('https://github.com/repo');
    expect(persisted.snapshotUrls).toContain('https://docs.example.com');
  });
});

// ---------------------------------------------------------------------------
// stop() — clears everything
// ---------------------------------------------------------------------------

describe('HardFocusService — stop()', () => {
  test('stop() removes all [20000..24999] rules and clears state', async () => {
    (chrome.tabs.query as jest.Mock).mockResolvedValue([makeTab('https://example.com', -1)]);
    await HardFocusService.start();

    const updateDynamicRules = chrome.declarativeNetRequest.updateDynamicRules as jest.Mock;
    updateDynamicRules.mockClear();
    const setMock = chrome.storage.local.set as jest.Mock;
    setMock.mockClear();

    await HardFocusService.stop();

    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
    const stopCall = updateDynamicRules.mock.calls[0][0];
    expect(stopCall.removeRuleIds).toHaveLength(5000);
    expect(stopCall.addRules).toHaveLength(0);

    const stateCalls = setMock.mock.calls.filter((c) => c[0]?.hardFocusState);
    expect(stateCalls[0][0].hardFocusState.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cleanupStaleRules()
// ---------------------------------------------------------------------------

describe('HardFocusService — cleanupStaleRules()', () => {
  test('Q-fix: if state.isActive === true, does NOT call updateDynamicRules (persisted rules stay)', async () => {
    // Q-fix root cause: dynamic dNR rules persist across SW suspension and browser restarts.
    // Re-calling start() would take a new snapshot defeating static-snapshot semantics.
    (chrome.storage.local.get as jest.Mock).mockImplementation((_key, callback) => {
      const result = {
        hardFocusState: { isActive: true, activatedAt: Date.now(), domainMode: false },
      };
      if (callback) callback(result);
      return Promise.resolve(result);
    });
    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([]);

    await HardFocusService.cleanupStaleRules();
    // No re-snapshot: updateDynamicRules must NOT be called when state is active
    expect(chrome.declarativeNetRequest.updateDynamicRules).not.toHaveBeenCalled();
  });

  test('if state.isActive === false, clears orphan rules', async () => {
    await HardFocusService.cleanupStaleRules();

    expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledTimes(1);
    const call = (chrome.declarativeNetRequest.updateDynamicRules as jest.Mock).mock.calls[0][0];
    expect(call.removeRuleIds).toHaveLength(5000);
    expect(call.addRules).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Continuation 5: testMatchOutcome-style simulated dNR rule matching
//
// Chrome's declarativeNetRequest applies rules by matching urlFilter / regexFilter
// patterns and using priority ordering to determine the final action.
//
// Simulation contract (updated for continuation 6):
//   - regexFilter: '^.*$'             → matches ALL URLs (catch-all)
//   - regexFilter: '^<regex>$'        → evaluated as JavaScript RegExp (T3: per-URL allows)
//   - urlFilter: '|chrome-extension://' → matches chrome-extension:// URLs (left-anchored)
//   - urlFilter: '|chrome://'           → matches chrome:// URLs (left-anchored)
//   - requestDomains: [hostname]        → hostname match (domain mode)
//   - Priority: higher priority wins; ties broken by first match in sorted order
// ---------------------------------------------------------------------------

/**
 * Simulated dNR rule matcher (updated for continuation 5).
 *
 * Matches a URL against a set of declarativeNetRequest rules and returns
 * the action of the highest-priority matching rule, or 'allow' if none match.
 *
 * Supports:
 *   regexFilter   → evaluated as JavaScript RegExp (case-insensitive like dNR)
 *   urlFilter     → pipe-anchor + separator semantics (for chrome scheme allows)
 *   requestDomains → hostname equality + subdomain check
 *   (no filter)   → matches every URL (catch-all fallback)
 */
function simulateDnrMatch(
  url: string,
  rules: chrome.declarativeNetRequest.Rule[],
): 'allow' | 'redirect' | 'block' {
  // Sort rules by priority descending — highest priority first.
  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of sorted) {
    const condition = rule.condition as chrome.declarativeNetRequest.RuleCondition;

    // requestDomains: check if URL's hostname matches any domain
    if (condition.requestDomains && condition.requestDomains.length > 0) {
      try {
        const hostname = new URL(url).hostname;
        const matches = condition.requestDomains.some(
          (d) => hostname === d || hostname.endsWith(`.${d}`),
        );
        if (matches) return rule.action.type as 'allow' | 'redirect' | 'block';
      } catch {
        continue;
      }
      continue;
    }

    // regexFilter: evaluate as JavaScript RegExp (continuation 5 primary path)
    if (condition.regexFilter != null) {
      try {
        // dNR regexFilter matching is case-insensitive per spec
        const rx = new RegExp(condition.regexFilter, 'i');
        if (rx.test(url)) return rule.action.type as 'allow' | 'redirect' | 'block';
      } catch {
        continue;
      }
      continue;
    }

    // urlFilter: parse anchors (used for chrome scheme allows)
    const filter = condition.urlFilter;
    if (filter == null) {
      // No urlFilter AND no regexFilter AND no requestDomains → catch-all
      return rule.action.type as 'allow' | 'redirect' | 'block';
    }

    const leftAnchored = filter.startsWith('|');
    const rightAnchored = filter.endsWith('|') && filter.length > 1;

    let core = filter;
    if (leftAnchored) core = core.slice(1);
    if (rightAnchored) core = core.slice(0, -1);

    let matches = false;
    if (leftAnchored && rightAnchored) {
      matches = url === core || url.replace(/\/$/, '') === core;
    } else if (leftAnchored) {
      matches = url.startsWith(core);
    } else if (rightAnchored) {
      matches = url.endsWith(core);
    } else {
      matches = url.includes(core);
    }

    if (matches) return rule.action.type as 'allow' | 'redirect' | 'block';
  }

  // No rule matched → default allow
  return 'allow';
}

describe('Continuation 5: testMatchOutcome-style simulated dNR matching (regexFilter rules)', () => {
  // Snapshot: youtube.com/abc and x.com/abc are in the whitelist
  const snapshotUrls = ['https://youtube.com/abc', 'https://x.com/abc'];
  let rules: chrome.declarativeNetRequest.Rule[];

  beforeAll(() => {
    rules = HardFocusService.buildWhitelistRules(snapshotUrls, false);
  });

  test('T1-fix: catch-all redirect rule uses regexFilter matching all URLs', () => {
    const blockRule = rules[0];
    const condition = blockRule.condition as chrome.declarativeNetRequest.RuleCondition;
    expect(condition.regexFilter).toBe('^.*$');
    expect(condition.urlFilter).toBeUndefined();
    // Must NOT use the old '|http' approach or no-filter approach
    expect(condition.urlFilter).not.toBe('|http');
  });

  test('T1-fix: catch-all action is redirect with regexSubstitution carrying original URL', () => {
    const blockRule = rules[0];
    expect(blockRule.action.type).toBe('redirect');
    const redirect = (blockRule.action as chrome.declarativeNetRequest.RuleAction).redirect;
    // regexSubstitution carries original URL as #url=\0
    expect(redirect?.regexSubstitution).toBeDefined();
    expect(redirect?.regexSubstitution).toContain('#url=\\0');
    // Must NOT use extensionPath (which doesn't carry original URL)
    expect(redirect?.extensionPath).toBeUndefined();
  });

  // --- T3 table: 13 test cases ---

  test('T3-01: https://google.com [google.com] → allow', () => {
    const googleRules = HardFocusService.buildWhitelistRules(['https://google.com'], false);
    expect(simulateDnrMatch('https://google.com', googleRules)).toBe('allow');
  });

  test('T3-02: https://google.com/ [google.com] → allow (trailing slash)', () => {
    const googleRules = HardFocusService.buildWhitelistRules(['https://google.com'], false);
    expect(simulateDnrMatch('https://google.com/', googleRules)).toBe('allow');
  });

  test('T3-03: https://google.com?q=x [google.com] → allow (query string)', () => {
    const googleRules = HardFocusService.buildWhitelistRules(['https://google.com'], false);
    expect(simulateDnrMatch('https://google.com?q=x', googleRules)).toBe('allow');
  });

  test('T3-04: https://google.com#x [google.com] → allow (fragment)', () => {
    const googleRules = HardFocusService.buildWhitelistRules(['https://google.com'], false);
    expect(simulateDnrMatch('https://google.com#x', googleRules)).toBe('allow');
  });

  test('T3-05: https://google.com/search [google.com] → redirect (sub-path must be blocked)', () => {
    // This is the core bug from Continuation 5: |url^ allowed sub-paths via / separator
    const googleRules = HardFocusService.buildWhitelistRules(['https://google.com'], false);
    expect(simulateDnrMatch('https://google.com/search', googleRules)).toBe('redirect');
  });

  test('T3-06: https://google.com/search?q=x [google.com] → redirect (sub-path + query)', () => {
    const googleRules = HardFocusService.buildWhitelistRules(['https://google.com'], false);
    expect(simulateDnrMatch('https://google.com/search?q=x', googleRules)).toBe('redirect');
  });

  test('T3-07: https://x.com/abc [x.com/abc] → allow', () => {
    expect(simulateDnrMatch('https://x.com/abc', rules)).toBe('allow');
  });

  test('T3-08: https://x.com/abc?y=1 [x.com/abc] → allow (query string)', () => {
    expect(simulateDnrMatch('https://x.com/abc?y=1', rules)).toBe('allow');
  });

  test('T3-09: https://x.com/abcd [x.com/abc] → redirect (no false prefix match)', () => {
    // "abcd" starts with "abc" but has no separator — must not match
    expect(simulateDnrMatch('https://x.com/abcd', rules)).toBe('redirect');
  });

  test('T3-10: https://x.com/bbc [x.com/abc] → redirect (different path)', () => {
    // This is the second bug: catch-all was silently dropped, so x.com/bbc slipped through
    expect(simulateDnrMatch('https://x.com/bbc', rules)).toBe('redirect');
  });

  test('T3-11: https://youtube.com/abc [youtube.com/abc, x.com/abc] → allow', () => {
    expect(simulateDnrMatch('https://youtube.com/abc', rules)).toBe('allow');
  });

  test('T3-12: https://youtube.com [youtube.com/abc, x.com/abc] → redirect (domain root not whitelisted)', () => {
    expect(simulateDnrMatch('https://youtube.com', rules)).toBe('redirect');
  });

  test('T3-13: https://youtube.com/xyz [youtube.com/abc, x.com/abc] → redirect (different path)', () => {
    expect(simulateDnrMatch('https://youtube.com/xyz', rules)).toBe('redirect');
  });

  // --- Additional structural tests ---

  test('chrome://newtab/ → ALLOW (chrome:// allow rule at priority 3)', () => {
    expect(simulateDnrMatch('chrome://newtab/', rules)).toBe('allow');
  });

  test('chrome-extension://abc/popup.html → ALLOW (chrome-extension:// allow rule at priority 3)', () => {
    expect(simulateDnrMatch('chrome-extension://abc/popup.html', rules)).toBe('allow');
  });

  test('https://example.com → REDIRECT (not in snapshot; catch-all fires)', () => {
    expect(simulateDnrMatch('https://example.com', rules)).toBe('redirect');
  });

  test('http://insecure.example.com → REDIRECT (http:// not in snapshot; catch-all fires)', () => {
    expect(simulateDnrMatch('http://insecure.example.com', rules)).toBe('redirect');
  });
});
