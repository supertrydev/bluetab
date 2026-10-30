/**
 * @module services/hard-focus-service
 *
 * WHY:  Hard Focus is a whitelist-mode companion to Phase 6's blocklist-mode
 *       FocusService. While active, the browser can only navigate to URLs (or
 *       hostnames, when domainMode: true) of tabs that were open in the current
 *       browser window AT THE MOMENT Hard Focus was started from the sidepanel.
 *
 * WHAT: Static HardFocusService class with:
 *       - start()  — snapshot current-window tabs, build rules, apply.
 *                    Whitelist is FROZEN for the session (no live updates).
 *       - stop()   — remove all Hard Focus dNR rules, clear state.
 *       - getState — reads persisted HardFocusState
 *       - cleanupStaleRules — called on SW startup; leaves persisted rules alone if active
 *                             (dynamic dNR rules persist on disk — no re-snapshot needed)
 *
 * HOW:  All dNR mutations route exclusively through
 *       chrome.declarativeNetRequest.updateDynamicRules — never direct tab navigation.
 *       Rule IDs are bounded to [20000, 24999]; no collision with Phase 6 [10000, 19999].
 *
 *       Rule layout (continuation 6 — quota guard + robust URL payload):
 *         ID 20000 — catch-all redirect to block page (priority 1, regexFilter: '^.*$')
 *                    regexSubstitution carries original URL as #url=\0 to block page.
 *         ID 20001 — chrome-extension://* allow (priority 3) — MANDATORY lock-out guard
 *         ID 20002 — chrome://* allow (priority 3) — covers browser native new-tab + settings
 *         IDs 20003–24999 — snapshot allow rules (priority 2), regexFilter: ^<escaped-url>(/)?([?#].*)?$
 *
 *       HF1 semantic: the whitelist is a SNAPSHOT captured at start().
 *       - domainMode=false (default): URLs of tabs in the current window at start time.
 *       - domainMode=true: hostnames of those tabs.
 *       - Changing domainMode while active has NO effect; takes effect on next Start.
 *       - No reactive listener rebuilds; no debounce timer.
 *
 *       Continuation 6 key fixes:
 *       - T1: catch-all uses regexFilter '^.*$' with regexSubstitution.
 *       - T2: regexSubstitution carries original URL via hash fragment (#url=\0)
 *         to avoid query-string splitting when blocked URL includes '?' or '&'.
 *       - T3: regexFilter '^<escaped>(/)?([?#].*)?$' on per-URL allows — prevents sub-path
 *         leakage: google.com/search is NOT allowed when only google.com is whitelisted.
 *
 * NOT:  Does not render any UI (see blocked/BlockedPage.tsx).
 *       Does not contain the confirm dialog (HardFocusButton.tsx).
 *       Does not manage Phase 6 Focus rules (see focus-service.ts).
 *       scheduleWhitelistUpdate and updateWhitelist REMOVED in HF1 revision.
 *
 * SAFETY:
 *   SAFETY contract test (safety-contracts.hardfocus.test.ts) enforces:
 *   1. No `chrome.tabs.update(.*url:` in this source file.
 *   2. At least one occurrence of `chrome.declarativeNetRequest.updateDynamicRules`.
 *   3. buildWhitelistRules always emits the chrome-extension://* allow rule.
 *   4. All rule IDs fall in [20000, 24999].
 */

import { Storage } from '@/utils/storage';
import type { HardFocusState } from '@/types/productivity';
import type { ADHDSettings } from '@/types/adhd';
import { ADHD_SETTINGS_STORAGE_KEY } from '@/types/adhd';

const LOG_PREFIX = '[BlueTab][HardFocusService]';

/**
 * Chrome dNR regex rule cap per dynamic ruleset.
 * One slot is always reserved for the catch-all redirect regex rule, so URL
 * mode may use at most (cap - 1) per-URL regex rules.
 */
const HARD_FOCUS_MAX_REGEX_RULES = 1000;
const HARD_FOCUS_MAX_URL_REGEX_RULES = HARD_FOCUS_MAX_REGEX_RULES - 1;

// ---------------------------------------------------------------------------
// Rule ID range constants (exported for tests and service-worker)
// ---------------------------------------------------------------------------

/** Catch-all block rule ID (priority 1). */
export const HARD_FOCUS_BLOCK_ID = 20000;

/** Allow rule for chrome-extension://* (priority 3 — MANDATORY lock-out guard). */
export const HARD_FOCUS_EXTENSION_ALLOW_ID = 20001;

/**
 * Allow rule for chrome://* (priority 3).
 * Covers Chrome's native new-tab page, settings, error pages, etc.
 * Added in HF1 post-human-verify revision.
 */
export const HARD_FOCUS_CHROME_ALLOW_ID = 20002;

/** First per-URL/domain snapshot allow rule ID (priority 2). */
export const HARD_FOCUS_ALLOW_START = 20003;

/** Last per-URL/domain snapshot allow rule ID (inclusive). 4,997 slots available. */
export const HARD_FOCUS_ALLOW_END = 24999;

/** chrome.storage.local key for Hard Focus runtime state. */
export const HARD_FOCUS_STATE_KEY = 'hardFocusState' as const;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Escape special regex characters for use in Chrome dNR regexFilter.
 * Chrome dNR uses a subset of RE2. Escape all special chars so literal URLs
 * can be safely embedded as regex patterns.
 */
function escapeForDnrRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate the full array of rule IDs in the Hard Focus range [20000..24999].
 * Used as the removeRuleIds list on every updateDynamicRules call so old rules
 * are always fully evicted before new rules are added (idempotent start/update).
 */
function allHardFocusIds(): number[] {
  const count = HARD_FOCUS_ALLOW_END - HARD_FOCUS_BLOCK_ID + 1; // 5000
  return Array.from({ length: count }, (_, i) => HARD_FOCUS_BLOCK_ID + i);
}

/**
 * Collect URLs from current-window tabs at the current moment.
 * This is a SNAPSHOT — called once at start() and not updated reactively.
 * Filters out non-http(s) URLs.
 */
async function snapshotWhitelistUrls(): Promise<string[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const urls: string[] = [];
  for (const tab of tabs) {
    if (!tab.url) continue;
    try {
      const parsed = new URL(tab.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    } catch {
      continue;
    }
    urls.push(tab.url);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// HardFocusService
// ---------------------------------------------------------------------------

export class HardFocusService {
  /**
   * Activate Hard Focus: SNAPSHOT current-window tabs NOW, build rules, apply.
   *
   * HF1: The whitelist is frozen at start time. No reactive updates after this.
   * Always clears the full [20000..24999] ID range first (idempotent).
   */
  static async start(): Promise<void> {
    const adhdSettings = await Storage.get<ADHDSettings>(ADHD_SETTINGS_STORAGE_KEY);
    const domainMode = adhdSettings?.hardFocus?.domainMode ?? false;

    // HF1: snapshot at start time
    const urls = await snapshotWhitelistUrls();
    let effectiveDomainMode = domainMode;

    // Guard against Chrome's MAX_NUMBER_OF_REGEX_RULES limit in URL mode.
    // URL mode creates one regexFilter allow rule per URL, and one regex rule
    // is always used by the catch-all redirect.
    if (!effectiveDomainMode && urls.length > HARD_FOCUS_MAX_URL_REGEX_RULES) {
      effectiveDomainMode = true;
      console.warn(
        `${LOG_PREFIX} start(): ${urls.length} URLs exceed URL-regex cap ${HARD_FOCUS_MAX_URL_REGEX_RULES}; ` +
          'falling back to domainMode=true for this session.',
      );
    }

    const rules = HardFocusService.buildWhitelistRules(urls, effectiveDomainMode);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: allHardFocusIds(),
      addRules: rules,
    });

    // T5: persist snapshot URL list for observability / audit log.
    // NOT used for rule reconstruction — dNR rules persist on disk.
    await Storage.set(HARD_FOCUS_STATE_KEY, {
      isActive: true,
      activatedAt: Date.now(),
      domainMode: effectiveDomainMode,
      snapshotUrls: urls,
    } satisfies HardFocusState);

    console.log(`${LOG_PREFIX} Started (snapshot): ${urls.length} URLs (domainMode=${effectiveDomainMode})`);
  }

  /**
   * Deactivate Hard Focus: remove all rules in the [20000..24999] range and
   * clear persisted state.
   */
  static async stop(): Promise<void> {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: allHardFocusIds(),
      addRules: [],
    });

    await Storage.set(HARD_FOCUS_STATE_KEY, {
      isActive: false,
      activatedAt: 0,
      domainMode: false,
    } satisfies HardFocusState);

    console.log(`${LOG_PREFIX} Stopped, all Hard Focus dNR rules removed`);
  }

  /**
   * Pure helper — returns the complete declarativeNetRequest rule set for a
   * given set of whitelisted URLs.
   *
    * Rule layout (continuation 6 — quota guard + robust URL payload):
    *   ID 20000 — catch-all redirect to block page (priority 1):
    *              regexFilter: '^.*$' (required with regexSubstitution).
    *              regexSubstitution carries original URL via fragment: blockPageBase + '#url=\\0'.
   *   ID 20001 — chrome-extension://* allow (priority 3): MANDATORY lock-out guard.
   *   ID 20002 — chrome://* allow (priority 3): browser native pages (new-tab, settings).
   *   IDs 20003–24999 — per-URL or per-hostname snapshot allow (priority 2).
   *
   * Priority ordering ensures:
   *   chrome-extension/chrome allows (3) > per-URL allow (2) > catch-all redirect (1).
   *
   * Cap: at most HARD_FOCUS_ALLOW_END - HARD_FOCUS_ALLOW_START + 1 = 4,997 per-URL rules.
   *
   * domainMode=false (default): per-URL regexFilter rules using:
   *   '^<escaped-url>(/)?([?#].*)?$'
   *   — matches exact URL + optional trailing slash + optional query/fragment.
   *   — does NOT match sub-paths (google.com/search is blocked when google.com is whitelisted).
   * domainMode=true: per-hostname requestDomains rules; www. stripped; deduplicated.
   */
  static buildWhitelistRules(
    urls: string[],
    domainMode: boolean,
  ): chrome.declarativeNetRequest.Rule[] {
    const rules: chrome.declarativeNetRequest.Rule[] = [];

    // Rule 1: catch-all redirect-to-block-page (priority 1)
    // Catch-all redirect must use regexFilter with regexSubstitution.
    // This consumes one of Chrome's regex slots; start() guards URL mode by
    // reserving one slot for this rule.
    //
    // regexSubstitution carries the original URL in the hash fragment (#url=\0)
    // instead of query (?url=\0). This avoids query-string splitting when the
    // original URL itself contains '?' or '&'.
    //
    // \0 in regexSubstitution is the full regex match (entire blocked URL).
    // BlockedPage reads #url= first, and keeps legacy ?url= as backward-compat.
    //
    // The chrome-extension://* and chrome://* allow rules at priority 3 ensure the
    // extension itself is always reachable even with this catch-all in place.
    const blockPageBase = chrome.runtime.getURL('src/blocked/index.html');
    rules.push({
      id: HARD_FOCUS_BLOCK_ID,
      priority: 1,
      action: {
        type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
        redirect: { regexSubstitution: `${blockPageBase}#url=\\0` },
      },
      condition: {
        regexFilter: '^.*$',
        resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType],
      },
    });

    // Rule 2: chrome-extension://* allow (priority 3) — MANDATORY lock-out guard
    // H-fix: Use pipe-anchor `|chrome-extension://` (left-anchor only) — matches any
    // chrome-extension:// URL. The `*` wildcard in dNR urlFilter syntax matches
    // arbitrary characters INCLUDING protocol separators, so `chrome-extension://*`
    // would also match `http://attacker.com/chrome-extension://...` paths. The
    // left-anchor pipe ensures only URLs whose full URL starts with the scheme.
    rules.push({
      id: HARD_FOCUS_EXTENSION_ALLOW_ID,
      priority: 3,
      action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType },
      condition: {
        urlFilter: '|chrome-extension://',
        resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType],
      },
    });

    // Rule 3: chrome://* allow (priority 3) — browser native pages (new-tab, settings, etc.)
    // H-fix: Same pipe-anchor pattern for chrome:// scheme.
    rules.push({
      id: HARD_FOCUS_CHROME_ALLOW_ID,
      priority: 3,
      action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType },
      condition: {
        urlFilter: '|chrome://',
        resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType],
      },
    });

    // Rules 4+: per-URL or per-hostname snapshot allow (priority 2)
    const maxAllowRules = HARD_FOCUS_ALLOW_END - HARD_FOCUS_ALLOW_START + 1; // 4,997

    if (domainMode) {
      const hostnameSet = new Set<string>();
      for (const url of urls) {
        try {
          const hostname = new URL(url).hostname.replace(/^www\./, '');
          hostnameSet.add(hostname);
        } catch {
          // skip
        }
      }
      const hostnames = Array.from(hostnameSet);
      if (hostnames.length > maxAllowRules) {
        console.warn(
          `${LOG_PREFIX} buildWhitelistRules: ${hostnames.length} hostnames exceeds cap ${maxAllowRules}; truncating.`,
        );
      }
      hostnames.slice(0, maxAllowRules).forEach((hostname, index) => {
        rules.push({
          id: HARD_FOCUS_ALLOW_START + index,
          priority: 2,
          action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType },
          condition: {
            requestDomains: [hostname],
            resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType],
          },
        });
      });
    } else {
      if (urls.length > maxAllowRules) {
        console.warn(
          `${LOG_PREFIX} buildWhitelistRules: ${urls.length} URLs exceeds cap ${maxAllowRules}; truncating.`,
        );
      }
      urls.slice(0, maxAllowRules).forEach((url, index) => {
        // T3-fix (continuation 5): Use regexFilter instead of urlFilter to get
        // exact-URL-only matching without sub-path leakage.
        //
        // Problem with previous '|url^': the ^ separator in dNR urlFilter matches /
        // (slash is a separator character), so '|https://google.com^' also matched
        // 'https://google.com/search' — the snapshot URL allowed sub-paths that were
        // NOT whitelisted (user reported: google.com in group → google.com/search not blocked).
        //
        // Fix: regexFilter '^<escaped>(/)?([?#].*)?$' matches ONLY:
        //   - https://google.com            (exact)
        //   - https://google.com/           (trailing slash only)
        //   - https://google.com?q=foo      (query string)
        //   - https://google.com/?q=foo     (trailing slash + query)
        //   - https://google.com#section    (fragment)
        //   - https://google.com/#section   (trailing slash + fragment)
        // Does NOT match:
        //   - https://google.com/search     (sub-path — correctly blocked)
        //   - https://google.comx           (different domain)
        //
        // Strip existing query/fragment AND trailing slash from snapshot URL before
        // building the regex (snapshot URL may itself have these; we want the base).
        const normalized = url.replace(/[?#].*$/, '').replace(/\/$/, '');
        const escaped = escapeForDnrRegex(normalized);
        rules.push({
          id: HARD_FOCUS_ALLOW_START + index,
          priority: 2,
          action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType },
          condition: {
            regexFilter: `^${escaped}(/)?([?#].*)?$`,
            resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType],
          },
        });
      });
    }

    return rules;
  }

  /**
   * Read current Hard Focus state from storage.
   * Returns default inactive state if nothing is stored.
   */
  static async getState(): Promise<HardFocusState> {
    const state = await Storage.get<HardFocusState>(HARD_FOCUS_STATE_KEY);
    return state ?? { isActive: false, activatedAt: 0, domainMode: false };
  }

  /**
   * On service-worker startup — determine whether to preserve or clear Hard Focus rules.
   *
   * Q-fix (root cause): Dynamic dNR rules persist on disk across service worker
   * suspension/restart AND across browser restarts (Chrome stores them in the
   * browser profile). Re-calling start() on every SW wake-up would take a NEW
   * snapshot of the current open tabs, which defeats the static-snapshot semantics
   * of Hard Focus: the user expected the whitelist to be frozen at the moment they
   * clicked Hard Focus, not updated every time Chrome decides to restart the SW.
   *
   * New behavior:
   *   - If state.isActive: rules are ALREADY on disk — leave them alone. Log only.
   *   - If state.isInactive: clear any orphan rules defensively.
   */
  static async cleanupStaleRules(): Promise<void> {
    const state = await HardFocusService.getState();
    if (state.isActive) {
      // Dynamic dNR rules persist across SW suspension and browser restarts.
      // Do NOTHING here — the rules are already in place from the original start().
      // Re-snapshotting would defeat the static snapshot semantics and cause
      // intermittent block/allow behavior on SW wake-up (continuation 4 root cause).
      console.log(`${LOG_PREFIX} cleanupStaleRules: state isActive — leaving persisted rules alone`);
      return;
    }
    // State says inactive — clear any orphan rules (defensive).
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: allHardFocusIds(),
      addRules: [],
    });
    console.log(`${LOG_PREFIX} cleanupStaleRules: cleared orphan Hard Focus rules`);
  }
}
