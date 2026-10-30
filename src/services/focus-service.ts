/**
 * @module services/focus-service
 *
 * WHY:  Users need distraction blocking during Pomodoro focus sessions. Chrome's
 *       declarativeNetRequest API with dynamic rules is the MV3-sanctioned way
 *       to intercept navigation and redirect to a custom block page. This service
 *       manages the full lifecycle: building rules from user-configured presets
 *       and custom domains, applying/removing them via updateDynamicRules, and
 *       persisting focus state across service worker restarts.
 *
 * WHAT: Static FocusService class with enable/disable lifecycle, domain resolution
 *       from preset categories + custom domains, rule building for declarativeNetRequest,
 *       badge color updates, and stale rule cleanup on service worker startup.
 *
 * HOW:  - enable() reads FocusSettings from Storage, resolves blocked domains,
 *         builds redirect rules, and applies them via updateDynamicRules
 *       - disable() queries existing dynamic rules, filters to focus ID range,
 *         and removes them
 *       - Rules use a reserved ID range (10000-19999) to avoid collision
 *       - Focus state persisted to storage so it survives service worker restarts
 *
 * NOT:  Does not render the block page UI (see blocked/BlockedPage.tsx).
 *       Does not hook into Pomodoro state transitions (see service-worker.ts).
 *       Does not manage the Settings UI for configuring presets.
 */

import {
  FOCUS_PRESETS,
  FOCUS_RULE_ID_START,
  FOCUS_RULE_ID_END,
  BLOCK_PAGE_PATH,
  normalizeFocusSettings,
} from '@/config/focus-presets';
import { Storage } from '@/utils/storage';
import { StatsService } from '@/services/stats-service';
import { ADHDService } from '@/services/adhd-service';
import type { FocusSettings, FocusState, PomodoroState } from '@/types/productivity';

const LOG_PREFIX = '[BlueTab][FocusService]';
const DEFAULT_FOCUS_STATE: FocusState = { isActive: false, activatedAt: 0 };

function escapeForDnrRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFocusDomainRegex(domain: string): string {
  const escaped = escapeForDnrRegex(domain.replace(/^www\./, ''));
  return `^https?://(?:[^./?#]+\\.)*${escaped}(?::\\d+)?(?:[/?#].*)?$`;
}

function normalizeBlockedPhrase(phrase: string): string | null {
  const normalized = phrase.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function getNormalizedHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function isHttpUrl(url: string | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

type FocusTabSnapshot = {
  url?: string;
  title?: string;
};

type FocusBlockMatch = {
  type: 'domain' | 'phrase';
  value: string;
  displayDomain: string;
};

async function recordCountedMinutes(focusState: FocusState): Promise<void> {
  const startedAt = focusState.countingStartedAt ?? focusState.activatedAt;
  if (!focusState.isActive || startedAt <= 0) return;

  const elapsedMs = Date.now() - startedAt;
  const minutes = Math.round(elapsedMs / 60000);
  if (minutes > 0) {
    await StatsService.recordFocusMinutes(minutes);
  }
}

export class FocusService {
  static async syncActiveRulesForSettingsChange(
    previousSettings: FocusSettings | undefined,
    nextSettings: FocusSettings | undefined,
  ): Promise<void> {
    if (previousSettings?.enabled && !nextSettings?.enabled) {
      await this.disable();
      return;
    }
    if (!nextSettings) return;

    const previousDomains = previousSettings ? this.resolveBlockedDomains(previousSettings) : [];
    const nextDomains = this.resolveBlockedDomains(nextSettings);
    const previousPhrases = previousSettings ? this.resolveBlockedPhrases(previousSettings) : [];
    const nextPhrases = this.resolveBlockedPhrases(nextSettings);
    if (
      previousDomains.join('|') === nextDomains.join('|')
      && previousPhrases.join('|') === nextPhrases.join('|')
    ) return;

    const [focusState, pomodoroState] = await Promise.all([
      this.getState(),
      Storage.get<PomodoroState>('pomodoroState'),
    ]);
    const pomodoroIntent = Boolean(
      nextSettings.autoEnableWithPomodoro
      && pomodoroState?.isActive
      && !pomodoroState.isPaused
      && pomodoroState.mode !== 'flowtime'
      && pomodoroState.mode !== 'flowtime-break'
      && (pomodoroState.sessionType === 'work' || nextSettings.blockDuringBreaks),
    );
    const manualIntent = nextSettings.enabled;
    const shouldRefresh = focusState.isActive || manualIntent || pomodoroIntent;
    if (!shouldRefresh) return;

    if (nextDomains.length === 0 && nextPhrases.length === 0) {
      if (focusState.isActive) {
        await this.clearRuntimeRulesPreservingIntent();
      }
      return;
    }

    await this.enable({
      force: true,
      source: focusState.source ?? (pomodoroIntent ? 'pomodoro' : 'manual'),
      resetCounting: false,
    });
  }

  /**
   * Enable focus blocking: build rules from stored blocklist, apply via updateDynamicRules.
   * Called when Pomodoro work session starts (or break starts if blockDuringBreaks enabled).
   * No-op if focusSettings.enabled is false.
   */
  static async enable(options?: { force?: boolean; source?: 'manual' | 'pomodoro' | 'flowtime'; resetCounting?: boolean }): Promise<void> {
    const settings = normalizeFocusSettings(await Storage.get<FocusSettings>('focusSettings'));
    if (!options?.force && !settings?.enabled) return;

    const domains = this.resolveBlockedDomains(settings);
    const phrases = this.resolveBlockedPhrases(settings);
    if (domains.length === 0 && phrases.length === 0) return;

    await this.replaceDynamicRules(domains);

    const now = Date.now();
    const currentState = (await Storage.get<FocusState>('focusState')) ?? DEFAULT_FOCUS_STATE;
    const requestedSource = options?.source ?? 'manual';
    const shouldPreserveManual =
      currentState.isActive &&
      currentState.source === 'manual' &&
      requestedSource !== 'manual';
    const nextSource = shouldPreserveManual ? 'manual' : requestedSource;
    const shouldResetCounting = options?.resetCounting === true
      || !currentState.isActive
      || !currentState.countingStartedAt;

    const nextState: FocusState = {
      isActive: true,
      activatedAt: currentState.isActive ? currentState.activatedAt : now,
      source: nextSource,
      countingStartedAt: currentState.countingStartedAt,
    };

    if (nextSource === 'manual') {
      if (!currentState.isActive || currentState.source !== 'manual' || !currentState.countingStartedAt) {
        nextState.countingStartedAt = now;
      }
    } else if (shouldResetCounting || currentState.source !== nextSource) {
      nextState.countingStartedAt = now;
    }

    await Storage.set('focusState', nextState);

    // Redirect existing tabs that are on blocked domains
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab.id) continue;
        await this.maybeRedirectTab(tab.id, settings, { url: tab.url, title: tab.title });
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to redirect existing tabs:`, err);
    }

    console.log(
      `${LOG_PREFIX} Enabled with ${domains.length} blocked domains and ${phrases.length} blocked phrases`,
    );
  }

  /**
   * Disable focus blocking: remove all dynamic rules in the focus ID range.
   * Records elapsed focus time to StatsService before clearing state.
   */
  static async disable(): Promise<void> {
    await this.disableInternal();
  }

  static async clearRuntimeRulesPreservingIntent(): Promise<void> {
    await this.disableInternal({ preserveManualSetting: true });
  }

  static async pausePomodoroCounting(): Promise<void> {
    const focusState = await Storage.get<FocusState>('focusState');
    if (!focusState?.isActive || focusState.source !== 'pomodoro') return;

    await recordCountedMinutes(focusState);
    await Storage.set('focusState', {
      ...focusState,
      countingStartedAt: undefined,
    });
  }

  static async resumePomodoroCounting(): Promise<void> {
    const focusState = await Storage.get<FocusState>('focusState');
    if (!focusState?.isActive || focusState.source !== 'pomodoro') return;

    await Storage.set('focusState', {
      ...focusState,
      countingStartedAt: Date.now(),
    });
  }

  private static async disableInternal(options?: { skipStats?: boolean; preserveManualSetting?: boolean }): Promise<void> {
    const focusState = await Storage.get<FocusState>('focusState');
    if (focusState?.isActive && !options?.skipStats && focusState.source !== 'flowtime') {
      await recordCountedMinutes(focusState);
    }

    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const focusRuleIds = existingRules
      .filter((r: { id: number }) => r.id >= FOCUS_RULE_ID_START && r.id <= FOCUS_RULE_ID_END)
      .map((r: { id: number }) => r.id);

    if (focusRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: focusRuleIds,
      });
    }

    await Storage.set('focusState', {
      isActive: false,
      activatedAt: 0,
      source: undefined,
      countingStartedAt: undefined,
    });

    // Manual focus toggle mirrors only manual sessions; timer-managed focus is runtime-only.
    const settings = await Storage.get<FocusSettings>('focusSettings');
    if (
      !options?.preserveManualSetting &&
      focusState?.source !== 'pomodoro' &&
      focusState?.source !== 'flowtime' &&
      settings?.enabled
    ) {
      await Storage.set('focusSettings', normalizeFocusSettings({ ...settings, enabled: false }));
    }

    console.log(`${LOG_PREFIX} Disabled, removed ${focusRuleIds.length} rules`);
  }

  /**
   * Resolve the complete list of blocked domains from enabled presets + custom domains.
   * Returns a deduplicated, sorted array of bare domains.
   */
  static resolveBlockedDomains(settings: FocusSettings): string[] {
    const domainSet = new Set<string>();

    if (settings.presets.socialMedia) {
      for (const d of FOCUS_PRESETS.socialMedia) domainSet.add(d);
    }
    if (settings.presets.newsMedia) {
      for (const d of FOCUS_PRESETS.newsMedia) domainSet.add(d);
    }
    if (settings.presets.entertainment) {
      for (const d of FOCUS_PRESETS.entertainment) domainSet.add(d);
    }
    if (settings.presets.shopping) {
      for (const d of FOCUS_PRESETS.shopping) domainSet.add(d);
    }

    for (const d of settings.customDomains) {
      domainSet.add(d);
    }

    return Array.from(domainSet).sort();
  }

  static resolveBlockedPhrases(settings: FocusSettings): string[] {
    const phraseSet = new Set<string>();

    for (const phrase of settings.blockedPhrases) {
      const normalized = normalizeBlockedPhrase(phrase);
      if (normalized) {
        phraseSet.add(normalized);
      }
    }

    return Array.from(phraseSet).sort();
  }

  /**
   * Build declarativeNetRequest redirect rules for the given domains.
   * Each rule redirects MAIN_FRAME navigation to the block page with:
   * - ?domain=<blocked-domain> for display text
   * - #url=\0 carrying the original blocked URL for exact restore after focus ends
   */
  static buildRules(domains: string[]): chrome.declarativeNetRequest.Rule[] {
    return domains.map((domain, index) => ({
      id: FOCUS_RULE_ID_START + index,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT as chrome.declarativeNetRequest.RuleActionType,
        redirect: {
          regexSubstitution: `${chrome.runtime.getURL(
            `${BLOCK_PAGE_PATH}?domain=${encodeURIComponent(domain)}`,
          )}#url=\\0`,
        },
      },
      condition: {
        regexFilter: buildFocusDomainRegex(domain),
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.MAIN_FRAME as chrome.declarativeNetRequest.ResourceType,
        ],
      },
    }));
  }

  private static async replaceDynamicRules(domains: string[]): Promise<void> {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const focusRuleIds = existingRules
      .filter((r: { id: number }) => r.id >= FOCUS_RULE_ID_START && r.id <= FOCUS_RULE_ID_END)
      .map((r: { id: number }) => r.id);

    const rules = this.buildRules(domains);
    if (focusRuleIds.length === 0 && rules.length === 0) {
      return;
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: focusRuleIds,
      ...(rules.length > 0 ? { addRules: rules } : {}),
    });
  }

  private static getTabBlockMatch(
    settings: FocusSettings,
    tab: FocusTabSnapshot,
  ): FocusBlockMatch | null {
    if (!isHttpUrl(tab.url)) return null;
    if (tab.url.startsWith(chrome.runtime.getURL(BLOCK_PAGE_PATH))) return null;

    const hostname = getNormalizedHostname(tab.url);
    if (hostname) {
      for (const domain of this.resolveBlockedDomains(settings)) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
          return { type: 'domain', value: domain, displayDomain: hostname };
        }
      }
    }

    const haystacks = [tab.url, tab.title ?? '']
      .map((value) => value.toLowerCase());

    for (const phrase of this.resolveBlockedPhrases(settings)) {
      if (haystacks.some((value) => value.includes(phrase))) {
        return {
          type: 'phrase',
          value: phrase,
          displayDomain: hostname ?? '',
        };
      }
    }

    return null;
  }

  private static buildBlockedPageUrl(originalUrl: string, match: FocusBlockMatch): string {
    const blockedUrl = new URL(chrome.runtime.getURL(BLOCK_PAGE_PATH));
    blockedUrl.searchParams.set('domain', match.displayDomain);
    if (match.type === 'phrase') {
      blockedUrl.searchParams.set('phrase', match.value);
    }
    blockedUrl.hash = `url=${encodeURIComponent(originalUrl)}`;
    return blockedUrl.toString();
  }

  static async maybeRedirectTab(
    tabId: number,
    settings: FocusSettings,
    tab: FocusTabSnapshot,
  ): Promise<boolean> {
    const match = this.getTabBlockMatch(settings, tab);
    if (!match || !isHttpUrl(tab.url)) {
      return false;
    }

    const blockUrl = this.buildBlockedPageUrl(tab.url, match);
    if (tab.url === blockUrl) {
      return false;
    }

    await chrome.tabs.update(tabId, { url: blockUrl });
    return true;
  }

  /**
   * Update the extension badge color when focus is active.
   * Sets orange (#f97316) when active; does nothing when inactive (lets PomodoroService handle).
   */
  static async updateBadge(): Promise<void> {
    const focusState = await Storage.get<FocusState>('focusState');
    if (focusState?.isActive) {
      await chrome.action.setBadgeBackgroundColor({ color: '#f97316' });
    }
    // If not active, do nothing — PomodoroService handles badge colors
  }

  /**
   * Clean up stale focus rules on service worker startup.
   * If focusState is not active but rules exist, remove them.
   */
  static async cleanupStaleRules(): Promise<void> {
    const focusState = await Storage.get<FocusState>('focusState');
    if (!focusState?.isActive) {
      await this.disableInternal({ skipStats: true });
      return;
    }

    if (focusState.source !== 'pomodoro' && focusState.source !== 'flowtime') {
      return;
    }

    if (focusState.source === 'flowtime') {
      const adhdSettings = await ADHDService.getSettings();
      const pomodoroState = await Storage.get<PomodoroState>('pomodoroState');
      const autoFocusEnabled =
        adhdSettings.masterEnabled &&
        (adhdSettings.flowtimeTimer?.enabled ?? false) &&
        (adhdSettings.flowtimeTimer?.autoFocusEnabled ?? false);

      if (!autoFocusEnabled || !pomodoroState?.isActive || pomodoroState.isPaused || pomodoroState.mode !== 'flowtime') {
        await this.disableInternal({ skipStats: true });
      }
      return;
    }

    const [pomodoroState, focusSettings] = await Promise.all([
      Storage.get<PomodoroState>('pomodoroState'),
      Storage.get<FocusSettings>('focusSettings'),
    ]);

    const autoEnableWithPomodoro = focusSettings?.autoEnableWithPomodoro ?? true;
    if (!autoEnableWithPomodoro || !pomodoroState?.isActive || pomodoroState.isPaused || pomodoroState.mode === 'flowtime' || pomodoroState.mode === 'flowtime-break') {
      await this.disableInternal({ skipStats: true });
      return;
    }

    if (pomodoroState.sessionType !== 'work') {
      if (focusSettings?.blockDuringBreaks) {
        if (focusState.countingStartedAt !== undefined) {
          await this.pausePomodoroCounting();
        }
      } else {
        await this.disableInternal({ skipStats: true });
      }
    }
  }

  /**
   * Get the current FocusState from storage.
   * Returns default inactive state if nothing stored.
   */
  static async getState(): Promise<FocusState> {
    const state = await Storage.get<FocusState>('focusState');
    return state ?? DEFAULT_FOCUS_STATE;
  }

  /**
   * Add custom domains to the Focus blocklist.
   * Used by FocusSettings.tsx when user types in the custom domain input.
   * Also used by DistractionDetectorService.approve() with { source: 'ai' } tag.
   *
   * The optional `options.source` parameter is for observability only — it is NOT
   * persisted into the customDomains array (which remains string[]). Existing callers
   * that pass one argument continue to work unchanged (backwards compatible).
   *
   * @param domains   Domains to add to the custom blocklist
   * @param options   Optional metadata — source 'manual' (default) or 'ai'
   */
  static async addCustomDomains(
    domains: string[],
    options?: { source?: 'manual' | 'ai' }
  ): Promise<void> {
    const source = options?.source ?? 'manual';
    console.log(`${LOG_PREFIX} addCustomDomains`, { count: domains.length, source });

    if (domains.length === 0) return;

    const settings = normalizeFocusSettings(await Storage.get<FocusSettings>('focusSettings'));

    const existing = new Set(settings.customDomains);
    for (const domain of domains) {
      existing.add(domain);
    }

    await Storage.set('focusSettings', {
      ...normalizeFocusSettings(settings),
      customDomains: Array.from(existing).sort(),
    });
  }
}
