// MV3 service workers have no document global, but Vite's bundled
// preload-helper injects <link rel="modulepreload"> via
// document.head.appendChild() before every dynamic await import(...)
// resolves. Without this shim, every SW-side dynamic import throws
// "ReferenceError: document is not defined" — which is why
// rebuildIntegrationContextMenus, integration mirror sync, and the
// generated-deltas handler all silently fail in production. A minimal
// no-op document satisfies the helper without affecting anything else.
if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  (globalThis as unknown as { document: unknown }).document = {
    head: { appendChild: () => {} },
    createElement: () => ({
      rel: '',
      as: '',
      href: '',
      crossOrigin: null,
      onload: null,
      onerror: null,
    }),
    querySelector: () => null,
    getElementsByTagName: () => [],
  };
}

if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = {
    dispatchEvent: () => true,
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
  };
}

import { Storage } from '../utils/storage';
import { getBrainDumpPresentation } from './brain-dump-presentation';
import { formatTime, getLocaleWeekInfo } from '@/i18n/format';
import { getLanguageDirection, initI18n, t as translate } from '@/i18n';
import { normalizeUrl } from '../utils/normalize';
import { deduplicateTabs, filterDuplicatesBySettings } from '../utils/dedupe';
import { getDefaultSettings } from '../utils/sorting';
import { AuthService } from '../services/auth-service';
import { getAccessToken } from '../utils/auth-state';
import { SyncEngine } from '../services/sync-engine';
import { MCPServerService } from '../services/mcp-server-service';
import { BluetBridgeService, findChangedGroupIds, debouncedBluetSync } from '../services/bluet-bridge-service';
import { ALARM_NAMES } from '../config/alarms';
import { ensureCoreAlarms as reconcileCoreAlarms, watchCoreAlarmChanges } from './core-alarms';
import { runAutoArchive } from '../services/auto-archive-service';
import { computeNextRecurringFireAt } from '../utils/reminder-recurrence';
import { normalizeFocusSettings } from '../config/focus-presets';
import { PomodoroService } from '../services/pomodoro-service';
import { ReminderService } from '../services/reminder-service';
import { BackupService } from '../services/backup-service';
import { buildIntegrationContextMenuDispatch } from '../services/integration-context-menu';
import {
    scheduleMirrorSync,
    dispatchVerb,
    getBrainDumpDestinations,
    routeBrainDumpToNotionDestination,
    type BrainDumpDestinationOption,
} from '../services/integration-service';
import { listConnectedAccounts } from '../services/integration-token-storage';
import {
    getIntegrationUnavailableMessage,
    INTEGRATION_REGISTRY_MAP,
} from '../services/integrations/registry';
import { FocusService } from '../services/focus-service';
import { StatsService } from '../services/stats-service';
import { RSSService } from '../services/rss-service';
import { AutoSuspendService } from '../services/auto-suspend-service';
import { ENABLE_READINGS } from '../config/feature-flags';
import { AdhdTabActivityTracker } from './adhd-activity-tracker';
import { ADHDService } from '../services/adhd-service';
import { BrainDumpService, skipsConfiguredRouting } from '../services/brain-dump-service';
import { getBrainDumpSiteMatchForUrl } from '../services/brain-dump-site-indicator';
import { AIPageSummaryError, AIPageSummaryService } from '../services/ai-page-summary-to-dump';
import { KillSwitchService } from '../services/kill-switch-service';
import { VisibleTabLimitService, isHiddenGroupTitle, onHiddenGroupUserExpanded, forgetRemovedGroup } from '../services/visible-tab-limit-service';
import { HardFocusService, HARD_FOCUS_STATE_KEY } from '../services/hard-focus-service';
import { ensureReason as ensureOffscreenReason } from '../services/offscreen-manager';
import { IS_FIREFOX } from '../platform/browser-target';
import {
    configureToolbarOpensSidePanel,
    isBrowserNewTabUrl,
    openSidePanel,
    playBundledSound,
    RESTRICTED_STORE_HOSTS,
} from '../platform/extension-platform';
import { LinearAutoSyncService } from '../services/linear-auto-sync';
import { TodoistAutoSyncService } from '../services/todoist-auto-sync';
import { SlackAutoSyncService } from '../services/slack-auto-sync';
import { config } from '../config/config';
import { hasSeenAINotice } from '../services/ai-notice';
import { DiscordAutoSyncService } from '../services/discord-auto-sync';
import { ensureFloatingButtonContentScript } from '../services/floating-button-content-script';
import {
    ensureManagerTabOpenBeforeClosing,
    saveBrowserTabsSelection,
    saveCurrentWindowTabs,
    shouldCloseTabsAfterSaving,
} from '../services/save-current-window-tabs';
import { saveLinkToBlueTab } from '../services/save-link-to-bluetab';
import { addTabToExistingGroup } from '../services/saved-tab-actions';
import type { TabGroup, TabItem, Settings, Project } from '../types/models';
import type { FocusSettings, HardFocusState, PomodoroSettings, PomodoroState, Reminder, ReminderSettings } from '../types/productivity';
import type { ADHDSettings as ADHDSettingsType } from '../types/adhd';
import { DEFAULT_REMINDER_SETTINGS } from '../types/productivity';
import type { RSSSettings, RSSNotificationFilter } from '../types/rss';
import { RSS_STORAGE_KEYS } from '../types/rss';

type RssNotificationMeta = { type: 'single'; link: string } | { type: 'multi' };
const RSS_NOTIFICATION_META_KEY = 'rss_notification_meta';
const CONTEXT_MENU_BOOTSTRAP_SESSION_KEY = 'context_menu_bootstrapped_at';
const MCP_SNAPSHOT_SOURCE_KEYS = new Set([
    'groups',
    'projects',
    'brain_dump_inbox',
    'mcp_server_toolset_prefs',
]);
const MCP_STARTUP_SNAPSHOT_MIN_INTERVAL_MS = 5 * 60 * 1000;

function getUnknownErrorLabel(value: string | null | undefined): string {
    return value ?? translate('common.unknownError');
}

async function createBasicNotification(message: string, title?: string): Promise<void> {
    await initI18n();
    await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'src/assets/icon48.png',
        title: title ?? translate('notifications.appTitle'),
        message,
    });
}

async function scheduleMcpSnapshotRefresh(reason: string): Promise<void> {
    try {
        const status = await Storage.get<{ lastPushAt?: number; lastPushOk?: boolean }>('mcp_server_status');
        const lastPushAt = typeof status?.lastPushAt === 'number' ? status.lastPushAt : 0;
        const stale = Date.now() - lastPushAt > MCP_STARTUP_SNAPSHOT_MIN_INTERVAL_MS;
        if (stale || status?.lastPushOk === false) {
            MCPServerService.scheduleSnapshotPush();
        }
    } catch (err) {
        console.warn(`[BlueTab][MCP] Startup snapshot refresh skipped (${reason}):`, err);
    }
}

async function getRssNotificationMeta(notificationId: string): Promise<RssNotificationMeta | null> {
    if (!chrome.storage?.session) return null;
    const result = await Promise.resolve(chrome.storage.session.get(RSS_NOTIFICATION_META_KEY)).catch(() => null);
    const map = result?.[RSS_NOTIFICATION_META_KEY] as Record<string, RssNotificationMeta> | undefined;
    return map?.[notificationId] ?? null;
}

async function setRssNotificationMeta(notificationId: string, meta: RssNotificationMeta): Promise<void> {
    if (!chrome.storage?.session) return;
    const result = await Promise.resolve(chrome.storage.session.get(RSS_NOTIFICATION_META_KEY)).catch(() => null);
    const map = (result?.[RSS_NOTIFICATION_META_KEY] as Record<string, RssNotificationMeta> | undefined) ?? {};
    map[notificationId] = meta;
    await Promise.resolve(chrome.storage.session.set({ [RSS_NOTIFICATION_META_KEY]: map })).catch(() => {});
}

async function deleteRssNotificationMeta(notificationId: string): Promise<void> {
    if (!chrome.storage?.session) return;
    const result = await Promise.resolve(chrome.storage.session.get(RSS_NOTIFICATION_META_KEY)).catch(() => null);
    const map = (result?.[RSS_NOTIFICATION_META_KEY] as Record<string, RssNotificationMeta> | undefined) ?? {};
    delete map[notificationId];
    await Promise.resolve(chrome.storage.session.set({ [RSS_NOTIFICATION_META_KEY]: map })).catch(() => {});
}

function ensureCoreAlarms(): void {
    void Promise.all([BackupService.ensureScheduled(), reconcileCoreAlarms()]).catch((error) => {
        console.warn('[BlueTab][Alarms] Scheduling failed:', error);
    });
}

watchCoreAlarmChanges();

async function ensureFloatingButtonRegistered(settings?: Settings | null): Promise<void> {
    try {
        await ensureFloatingButtonContentScript(settings);
    } catch (err) {
        console.warn('[BlueTab][FloatingButton] content script registration failed:', err);
    }
}

async function getFloatingButtonPresentation() {
    const language = await initI18n();
    return {
        language,
        direction: getLanguageDirection(language),
        titles: {
            saveThisTab: translate('components.floatingButton.saveThisTab'),
            matchingDump: translate('components.floatingButton.matchingDump'),
            saveTabsLeft: translate('components.floatingButton.saveTabsLeft'),
            summarizePage: translate('components.floatingButton.summarizePage'),
            saveAllOtherTabs: translate('components.floatingButton.saveAllOtherTabs'),
            saveTabsRight: translate('components.floatingButton.saveTabsRight'),
            hide: translate('components.floatingButton.hide'),
            relatedDumpBubble: translate('components.floatingButton.relatedDumpBubble'),
            // The content script cannot run i18next; it swaps __N__ for the count.
            relatedDumpMore: translate('components.floatingButton.relatedDumpMore', { n: '__N__' }),
            relatedDumpOpen: translate('components.floatingButton.relatedDumpOpen'),
            summarizeProblem: translate('components.floatingButton.summarizeProblem'),
        },
    };
}

async function notifyFloatingButtonSettings(settings?: Settings | null): Promise<void> {
    const effectiveSettings = settings ?? await Storage.getSettings();
    const [canSummarizePageToDump, floatingButtonPresentation] = await Promise.all([
        canUseAiPageSummary(),
        getFloatingButtonPresentation(),
    ]);
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(
        tabs
            .filter((tab) => {
                const url = tab.url ?? tab.pendingUrl ?? '';
                return Boolean(tab.id) && (url.startsWith('http://') || url.startsWith('https://'));
            })
            .map((tab) =>
                chrome.tabs.sendMessage(tab.id!, {
                    type: 'FLOATING_BUTTON_SETTINGS_CHANGED',
                    settings: {
                        ...effectiveSettings,
                        canSummarizePageToDump,
                        floatingButtonTitles: floatingButtonPresentation.titles,
                        floatingButtonLanguage: floatingButtonPresentation.language,
                        floatingButtonDirection: floatingButtonPresentation.direction,
                    },
                }).catch(() => {}),
            ),
    );
}

async function getFloatingButtonDumpMatch(pageUrl: string): Promise<{
    hasRelatedDump: boolean;
    relatedDumpPreview: string;
    relatedDumpCount: number;
}> {
    const [prefs, match] = await Promise.all([
        BrainDumpService.getPrefs(),
        getBrainDumpSiteMatchForUrl(pageUrl),
    ]);
    const show = prefs?.enabled !== false && prefs?.linkedPageIndicatorEnabled !== false && match.count > 0;
    return {
        hasRelatedDump: show,
        relatedDumpPreview: show ? match.preview : '',
        relatedDumpCount: show ? match.count : 0,
    };
}

async function notifyFloatingButtonUrlChange(tabId: number, pageUrl: string): Promise<void> {
    if (!pageUrl.startsWith('http://') && !pageUrl.startsWith('https://')) {
        return;
    }

    try {
        const dumpMatch = await getFloatingButtonDumpMatch(pageUrl);

        await chrome.tabs.sendMessage(tabId, {
            type: 'FLOATING_BUTTON_URL_CHANGED',
            pageUrl,
            ...dumpMatch,
        }).catch(() => {});
    } catch (error) {
        console.warn('[BlueTab][FloatingButton] URL change notify failed:', error);
    }
}

/**
 * Ensure the offscreen document is provisioned for AUDIO_PLAYBACK and send
 * a message to play a notification sound.
 *
 * Phase 13: lifecycle delegated to offscreen-manager so the same offscreen
 * document can coexist with DOM_PARSER (offline reading) and the MCP client
 * runtime reason (Plan 13-02 SPIKE — WORKERS or IFRAME_SCRIPTING).
 */
async function playNotificationDing(sound = 'ping'): Promise<void> {
    if (IS_FIREFOX) {
        // Firefox background is an event page with DOM access: no offscreen document.
        playBundledSound(sound);
        return;
    }
    try {
        await ensureOffscreenReason(chrome.offscreen.Reason.AUDIO_PLAYBACK);
        await chrome.runtime.sendMessage({ type: 'PLAY_NOTIFICATION_DING', sound });
    } catch (err) {
        console.error('[BlueTab][RSS] Failed to play notification sound:', err);
    }
}

// Reminder recurrence lives in src/utils/reminder-recurrence.ts.

// ---------------------------------------------------------------------------
// Notification filter helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether a feed should produce any notifications at all.
 * Category-level mute/allow filters are evaluated here.
 */
function shouldNotifyFeed(
    feedCategory: string | undefined,
    filters: RSSNotificationFilter[],
): boolean {
    const categoryMutes = filters.filter(f => f.type === 'category' && f.mode === 'mute');
    const categoryAllows = filters.filter(f => f.type === 'category' && f.mode === 'allow');

    // Mute: if feed's category matches any mute filter, skip entire feed
    if (feedCategory && categoryMutes.some(f => f.value.toLowerCase() === feedCategory.toLowerCase())) {
        return false;
    }

    // Allow: if category allow filters exist, feed must match at least one
    if (categoryAllows.length > 0) {
        if (!feedCategory) return false;
        if (!categoryAllows.some(f => f.value.toLowerCase() === feedCategory.toLowerCase())) {
            return false;
        }
    }

    return true;
}

/**
 * Filters article titles based on keyword-level mute/allow filters.
 * Returns only the titles that pass all active keyword filters.
 */
function filterArticleTitles(
    titles: string[],
    filters: RSSNotificationFilter[],
): string[] {
    const keywordMutes = filters.filter(f => f.type === 'keyword' && f.mode === 'mute');
    const keywordAllows = filters.filter(f => f.type === 'keyword' && f.mode === 'allow');

    return titles.filter(title => {
        const lower = title.toLowerCase();

        // Mute: skip if any keyword mute matches
        if (keywordMutes.some(f => lower.includes(f.value.toLowerCase()))) {
            return false;
        }

        // Allow: if keyword allow filters exist, must match at least one
        if (keywordAllows.length > 0) {
            if (!keywordAllows.some(f => lower.includes(f.value.toLowerCase()))) {
                return false;
            }
        }

        return true;
    });
}

function isHttpUrl(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
}

function isUrlAllowedByHardFocusSnapshot(url: string, state: HardFocusState): boolean {
    if (!state.snapshotUrls || state.snapshotUrls.length === 0) return false;

    if (state.domainMode) {
        try {
            const hostname = new URL(url).hostname.replace(/^www\./, '');
            const allowed = new Set<string>();
            for (const snapshotUrl of state.snapshotUrls) {
                try {
                    allowed.add(new URL(snapshotUrl).hostname.replace(/^www\./, ''));
                } catch {
                    // skip invalid snapshot URL
                }
            }
            return allowed.has(hostname);
        } catch {
            return false;
        }
    }

    const candidate = url.replace(/[?#].*$/, '').replace(/\/$/, '');
    for (const snapshotUrl of state.snapshotUrls) {
        const normalized = snapshotUrl.replace(/[?#].*$/, '').replace(/\/$/, '');
        const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(`^${escaped}(/)?([?#].*)?$`, 'i');
        if (rx.test(candidate) || rx.test(url)) {
            return true;
        }
    }
    return false;
}

type BrainDumpDestinationOverride = {
    integrationId: string;
    accountId: string;
    target?: string | null;
} | null | undefined;

async function canUseAiPageSummary(): Promise<boolean> {
    const [brainDumpEnabled, token, isPro] = await Promise.all([
        BrainDumpService.isEnabled(),
        getAccessToken(),
        AuthService.isPro(),
    ]);

    return brainDumpEnabled && Boolean(token) && isPro;
}

function getAiPageSummaryFailureMessage(error: unknown): string {
    if (error instanceof AIPageSummaryError) {
        switch (error.code) {
            case 'auth_required':
                return translate('notifications.aiSummary.authRequired');
            case 'allowance_exhausted':
                return translate('notifications.aiSummary.allowanceExhausted');
            case 'rate_limited':
                return translate('notifications.aiSummary.rateLimited');
            case 'no_article_structure':
                return translate('notifications.aiSummary.noArticleStructure');
            case 'limited_content':
                return translate('notifications.aiSummary.limitedContent');
            case 'network_error':
                return translate('notifications.aiSummary.networkError');
            case 'empty_summary':
            case 'backend_error':
            default:
                return translate('notifications.aiSummary.generic');
        }
    }

    return translate('notifications.aiSummary.generic');
}

async function notifyAiPageSummaryFailure(error: unknown): Promise<void> {
    try {
        await initI18n();
        await createBasicNotification(getAiPageSummaryFailureMessage(error));
    } catch (notificationError) {
        console.error('[BlueTab][AIPageSummary] Notification error:', notificationError);
    }
}

async function saveBrainDumpEntryWithRouting(options: {
    text: string;
    tabContext?: { url: string; title: string; favicon?: string };
    destinationOverride?: BrainDumpDestinationOverride;
    calendarStartIso?: string;
    calendarDurationMinutes?: number;
}): Promise<void> {
    const dest = options.destinationOverride;
    const unavailableMessage = dest
        ? getIntegrationUnavailableMessage(dest.integrationId)
        : null;
    if (unavailableMessage) {
        throw new Error(unavailableMessage);
    }

    const inboxAfter = await BrainDumpService.add({
        text: options.text,
        tabContext: options.tabContext,
        skipConfiguredRouting: skipsConfiguredRouting(dest),
    });

    if (dest && dest.integrationId && dest.accountId) {
        try {
            const existing = await BrainDumpService.getPrefs();
            await BrainDumpService.setPrefs({
                ...existing,
                destinationOverride: {
                    integrationId: dest.integrationId,
                    accountId: dest.accountId,
                    target: dest.target ?? null,
                },
            });
        } catch {
            // best-effort
        }

        void (async () => {
            try {
                const verb = `push_brain_dump_to_${dest.integrationId.replace('-', '_')}`;
                const savedId = inboxAfter[inboxAfter.length - 1]?.id;
                const args: Record<string, unknown> = { entryId: savedId, text: options.text };
                if (options.calendarStartIso) args.start_iso = options.calendarStartIso;
                if (options.calendarDurationMinutes) args.duration_minutes = options.calendarDurationMinutes;
                if (dest.integrationId === 'github' && dest.target) {
                    if (dest.target === 'gist') {
                        args.kind = 'gist';
                    } else {
                        const [owner, repo] = dest.target.split('/');
                        args.kind = 'issue';
                        args.owner = owner;
                        args.repo = repo;
                    }
                }
                if (dest.integrationId === 'notion') {
                    await routeBrainDumpToNotionDestination({
                        accountId: dest.accountId,
                        text: options.text,
                        tabUrl: options.tabContext?.url,
                    });
                } else {
                    await dispatchVerb(
                        dest.integrationId as never,
                        verb,
                        args,
                        dest.accountId,
                    );
                }
            } catch (err) {
                console.debug('[BlueTab][BrainDump] integration dispatch failed', err);
            }
        })();
        return;
    }

    if (dest === null) {
        try {
            const existing = await BrainDumpService.getPrefs();
            await BrainDumpService.setPrefs({ ...existing, destinationOverride: null });
        } catch {
            // best-effort
        }
    }
}

async function enforceHardFocusOnUrlChange(tabId: number, nextUrl?: string): Promise<void> {
    if (!nextUrl) return;

    const blockedPageBase = chrome.runtime.getURL('src/blocked/index.html');
    if (nextUrl.startsWith(blockedPageBase)) return;
    if (
        nextUrl.startsWith('chrome-extension://') ||
        nextUrl.startsWith('chrome://') ||
        nextUrl.startsWith('moz-extension://') ||
        nextUrl.startsWith('about:')
    ) return;
    if (!isHttpUrl(nextUrl)) return;

    const state = await Storage.get<HardFocusState>(HARD_FOCUS_STATE_KEY);
    if (!state?.isActive) return;

    const allowed = isUrlAllowedByHardFocusSnapshot(nextUrl, state);
    if (allowed) return;

    const redirectUrl = `${blockedPageBase}#url=${encodeURIComponent(nextUrl)}`;
    await chrome.tabs.update(tabId, { url: redirectUrl });
}

// Setup recurring alarms idempotently. This avoids resetting delayInMinutes
// every time MV3 wakes the service worker.
ensureCoreAlarms();

// Uninstall survey: Chrome opens this page after the extension is removed.
// The URL carries only the extension version and browser UI language.
function registerUninstallSurvey(): void {
    try {
        const url = new URL(config.uninstallSurvey.url);
        url.searchParams.set('version', chrome.runtime.getManifest().version);
        url.searchParams.set('lang', chrome.i18n.getUILanguage());
        chrome.runtime.setUninstallURL(url.toString(), () => {
            if (chrome.runtime.lastError) {
                console.warn('[BlueTab][UninstallSurvey] setUninstallURL failed:', chrome.runtime.lastError.message);
            }
        });
    } catch (err) {
        console.warn('[BlueTab][UninstallSurvey] skipped:', err);
    }
}
registerUninstallSurvey();

// Phase 9 — register AutoSuspendService listeners (idempotent) + rehydrate
// the per-tab activity map from chrome.storage.local. Pitfall 9 mandates
// rehydrate on both onStartup AND onInstalled — done in those handlers
// below as well; this top-level call covers the "module load after SW
// wake from sleep" case that onStartup may not fire for.
AutoSuspendService.registerListeners();
AdhdTabActivityTracker.register();
AdhdTabActivityTracker.rehydrate().catch((err) => {
    console.debug('[BlueTab][ADHDActivityTracker] initial rehydrate skipped:', err);
});

// Initialize sync engine on startup
initializeSyncEngine();
scheduleMcpSnapshotRefresh('service-worker-load').catch(() => {});

// Initialize Linear auto-sync service
LinearAutoSyncService.start().catch((err) => {
    console.warn('[BlueTab][LinearAutoSync] Failed to start:', err);
});

// Initialize Todoist auto-sync service
TodoistAutoSyncService.start().catch((err) => {
    console.warn('[BlueTab][TodoistAutoSync] Failed to start:', err);
});

// Initialize Slack auto-sync service
SlackAutoSyncService.initialize().catch((err) => {
    console.warn('[BlueTab][SlackAutoSync] Failed to initialize:', err);
});

// Initialize Discord auto-sync service
DiscordAutoSyncService.initialize().catch((err) => {
    console.warn('[BlueTab][DiscordAutoSync] Failed to initialize:', err);
});

// Clean up stale focus rules on service worker startup
FocusService.cleanupStaleRules().catch((err) => {
    console.error('[BlueTab][FocusService] Stale rule cleanup failed:', err);
});

// Phase 12 — Clean up stale Hard Focus rules on service worker startup.
// If Hard Focus was active when the SW was discarded, re-apply the whitelist.
HardFocusService.cleanupStaleRules().catch((err) => {
    console.warn('[BlueTab][HardFocusService] cleanupStaleRules failed on SW load:', err);
});

async function initializeSyncEngine(): Promise<void> {
    try {
        await SyncEngine.initialize();
        console.log('[BlueTab][Sync] Engine initialized');
    } catch (error) {
        console.error('[BlueTab][Sync] Failed to initialize:', error);
    }
}

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAMES.GROUP_AUTO_ARCHIVE_SCAN) {
        try {
            const result = await runAutoArchive();
            if (result.archivedCount > 0) {
                await initI18n();
                await createBasicNotification(
                    translate('notifications.autoArchived', { count: result.archivedCount }),
                ).catch(() => {});
            }
        } catch (error) {
            console.warn('[BlueTab][AutoArchive] Scan failed', error);
        }
        return;
    }
    if (alarm.name.startsWith(ALARM_NAMES.BRAIN_DUMP_BADGE_CLEAR_PREFIX)) {
        const tabId = Number(alarm.name.replace(ALARM_NAMES.BRAIN_DUMP_BADGE_CLEAR_PREFIX, ''));
        await chrome.action.setBadgeText({
            text: '',
            ...(Number.isFinite(tabId) ? { tabId } : {}),
        }).catch(() => {});
    } else if (alarm.name === ALARM_NAMES.AUTH_REFRESH) {
        console.log('[BlueTab][Auth] Running scheduled token refresh');
        const refreshed = await AuthService.refreshTokenIfNeeded();
        if (refreshed) {
            // Token is valid — clear any stale auth suspension and resume sync
            SyncEngine.clearAuthSuspension();
            if (SyncEngine.isReady() && SyncEngine.isOnline()) {
                SyncEngine.handleOnline(true).catch((err: unknown) => {
                    console.error('[BlueTab][Sync] Resume after refresh failed:', err);
                });
            }
        }
    } else if (alarm.name === ALARM_NAMES.SUBSCRIPTION_CHECK) {
        console.log('[BlueTab][Auth] Running scheduled subscription check');
        await AuthService.checkSubscription();
    } else if (alarm.name === ALARM_NAMES.BLUET_BRIDGE_HEARTBEAT) {
        // Periodic check: prunes stale refs, detects revocation/expiry, renews Bluet Pro
        // from Bluetab Pro, then catches up on deletions and failed re-syncs.
        const connected = await BluetBridgeService.isConnected();
        if (connected) {
            console.log('[BlueTab][BluetBridge] Running heartbeat status check');
            const status = await BluetBridgeService.getStatus();
            if (status.connected && !status.unreachable && status.access !== false) {
                await BluetBridgeService.reconcileSharedRefs().catch((err: unknown) => {
                    console.error('[BlueTab][BluetBridge] Reconcile failed:', err);
                });
            }
        }
    } else if (alarm.name === ALARM_NAMES.SYNC_POLL) {
        // A poll alarm left over from an older version: sync is not set up here.
        if (!(await SyncEngine.isSetup())) {
            await chrome.alarms.clear(ALARM_NAMES.SYNC_POLL);
            return;
        }
        console.log('[BlueTab][Sync] Running scheduled sync poll');
        // Bilateral sync: push local changes, then pull remote changes
        await SyncEngine.sync();
    } else if (alarm.name === ALARM_NAMES.POMODORO_END) {
        try {
            console.log('[BlueTab][Pomodoro] Session ended');
            await PomodoroService.handleSessionEnd();
        } catch (err) {
            console.error('[BlueTab][Pomodoro] handleSessionEnd error:', err);
        }
    } else if (alarm.name === ALARM_NAMES.POMODORO_TICK || alarm.name === 'pomodoro-badge-sync') {
        await PomodoroService.updateBadge();
    } else if (alarm.name.startsWith(ALARM_NAMES.REMINDER_PREFIX)) {
        try {
            console.log('[BlueTab][Reminder] Fired:', alarm.name);
            await ReminderService.handleFired(alarm.name);

            // Play reminder sound
            const reminderSettings = await Storage.get<ReminderSettings>('reminderSettings');
            const settings = { ...DEFAULT_REMINDER_SETTINGS, ...reminderSettings };
            if (settings.soundEnabled) {
                await playNotificationDing(settings.sound);
            }

            // Handle recurring reminders
            const reminderId = alarm.name.replace(ALARM_NAMES.REMINDER_PREFIX, '');
            const allReminders = (await Storage.get<Reminder[]>('reminders')) || [];
            const firedReminder = allReminders.find((r) => r.id === reminderId);
            if (firedReminder?.recurring) {
                // From the scheduled time (not "now"), with the locale's weekend for "weekdays".
                await initI18n();
                const nextFireAt = computeNextRecurringFireAt(firedReminder, Date.now(), getLocaleWeekInfo().weekend);
                if (nextFireAt) {
                    await ReminderService.reschedule(reminderId, nextFireAt);
                    console.log('[BlueTab][Reminder] Recurring reschedule:', new Date(nextFireAt).toISOString());
                }
            }
        } catch (err) {
            console.error('[BlueTab][Reminder] handleFired error:', err);
        }
    } else if (alarm.name === ALARM_NAMES.SESSION_BACKUP) {
        try {
            console.log('[BlueTab][Backup] Running scheduled backup');
            if ((await BackupService.getSettings()).enabled) await BackupService.capture();
        } catch (err) {
            console.error('[BlueTab][Backup] capture error:', err);
        }
    } else if (alarm.name === ALARM_NAMES.RSS_REFRESH) {
        try {
            console.log('[BlueTab][RSSService] Running scheduled feed refresh');
            const results = await RSSService.refreshAllFeeds();
            const feeds = await RSSService.getFeeds();

            // Load RSS settings to check sound preference and notification filters
            const rssSettings = await Storage.get<RSSSettings>(RSS_STORAGE_KEYS.SETTINGS);
            const soundEnabled = rssSettings?.notificationSoundEnabled !== false;
            const notificationFilters = (rssSettings?.notificationFilters ?? []).filter(f => f.enabled);

            let anyNotificationCreated = false;

            for (const [feedId, result] of Object.entries(results)) {
                if (result.count > 0) {
                    const feed = feeds.find(f => f.id === feedId);
                    if (feed?.notificationsEnabled) {
                        // Apply category-level filters (skips entire feed)
                        if (!shouldNotifyFeed(feed.category, notificationFilters)) continue;

                        // Apply keyword-level filters to individual article titles
                        const filteredTitles = filterArticleTitles(result.titles, notificationFilters);
                        if (filteredTitles.length === 0) continue;

                        const notifId = filteredTitles.length === 1
                            ? `rss-single-${feedId}-${Date.now()}`
                            : `rss-multi-${feedId}-${Date.now()}`;

                        let message: string;
                        if (filteredTitles.length === 1) {
                            // Single article: show title as message
                            message = filteredTitles[0] ?? 'New article';
                            await setRssNotificationMeta(notifId, { type: 'single', link: result.firstLink! });
                        } else {
                            // Multiple articles: list titles with bullet dashes
                            const listedTitles = filteredTitles.map(t => `- ${t}`).join('\n');
                            message = `${filteredTitles.length} new articles:\n${listedTitles}`;
                            await setRssNotificationMeta(notifId, { type: 'multi' });
                        }

                        chrome.notifications.create(notifId, {
                            type: 'basic',
                            iconUrl: chrome.runtime.getURL('src/assets/icon128.png'),
                            title: feed.title,
                            message,
                        });
                        anyNotificationCreated = true;
                    }
                }
            }

            // Play sound once per batch if any notification was created and sound is enabled
            if (anyNotificationCreated && soundEnabled) {
                await playNotificationDing(rssSettings?.notificationSound || 'ping');
            }
        } catch (err) {
            console.error('[BlueTab][RSSService] refreshAllFeeds error:', err);
        }
    } else if (alarm.name === ALARM_NAMES.ADHD_AUTOSUSPEND_SCAN) {
        // Phase 9 — Safe Auto-Suspend periodic scan. runScan is a no-op
        // when the feature is off (ADHDService.isFeatureActive gate).
        try {
            await AutoSuspendService.runScan();
        } catch (err) {
            console.error('[BlueTab][AutoSuspendService] scan error:', err);
        }
    } else if (alarm.name === ALARM_NAMES.V3_KILL_SWITCH_REFRESH) {
        // Phase 11 — Periodic AI kill-switch refresh (4h cadence, INFRA-07).
        // Fail-open: error is swallowed, cached state or default (enabled) is used.
        // Decrypt the Supertry access token — it lives AES-GCM-encrypted under
        // 'bluetab_auth_token' as a StoredAuthData object, NOT a plain string.
        // Reading it via Storage.get<string> would coerce the object to
        // '[object Object]' in the Bearer header and Supertry would 401.
        const token = await getAccessToken().catch(() => null);
        if (token) {
            KillSwitchService.fetchConfig(token).catch(() => {});
        }
    }
});

// Update badge and manage Focus Mode whenever pomodoroState or focusSettings change
chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.pomodoroState) {
        const newState = changes.pomodoroState.newValue as PomodoroState | undefined;
        const oldState = changes.pomodoroState.oldValue as PomodoroState | undefined;

        // Update Pomodoro badge first
        PomodoroService.updateBadge().catch((err: unknown) => {
            console.error('[BlueTab][Pomodoro] Badge update from storage change failed:', err);
        });

        // Play session transition sounds
        if (newState && oldState) {
            (async () => {
                try {
                    const pomSettings = await Storage.get<PomodoroSettings>('pomodoroSettings');
                    // Default: sounds enabled with preset defaults when settings missing
                    const sounds = pomSettings?.sounds ?? {
                        enabled: true,
                        workStart: 'blip' as const,
                        shortBreak: 'soft-chime' as const,
                        longBreak: 'crystal' as const,
                    };
                    if (!sounds.enabled) return;

                    // Work session started (was not active/work, now is active work and not paused)
                    if (newState.isActive && newState.sessionType === 'work' && !newState.isPaused) {
                        if (!oldState.isActive || oldState.sessionType !== 'work' || oldState.isPaused) {
                            await playNotificationDing(sounds.workStart || 'blip');
                        }
                    }
                    // Short break started
                    else if (newState.isActive && newState.sessionType === 'shortBreak' && !newState.isPaused) {
                        if (!oldState.isActive || oldState.sessionType !== 'shortBreak') {
                            await playNotificationDing(sounds.shortBreak || 'soft-chime');
                        }
                    }
                    // Long break started
                    else if (newState.isActive && newState.sessionType === 'longBreak' && !newState.isPaused) {
                        if (!oldState.isActive || oldState.sessionType !== 'longBreak') {
                            await playNotificationDing(sounds.longBreak || 'crystal');
                        }
                    }
                } catch (err) {
                    console.error('[BlueTab][Pomodoro] Session sound playback error:', err);
                }
            })();
        }

        // Focus Mode integration: enable/disable based on Pomodoro and Flowtime transitions.
        if (newState) {
            (async () => {
                try {
                    const focusState = await FocusService.getState();

                    if (newState.mode === 'flowtime') {
                        const adhd = await ADHDService.getSettings();
                        const flowtimeAutoFocusEnabled =
                            adhd.masterEnabled &&
                            (adhd.flowtimeTimer?.enabled ?? false) &&
                            (adhd.flowtimeTimer?.autoFocusEnabled ?? false);

                        if (focusState.source === 'manual') {
                            await PomodoroService.updateBadge();
                            return;
                        }

                        if (newState.isActive && !newState.isPaused && flowtimeAutoFocusEnabled) {
                            if (!focusState.isActive || focusState.source !== 'flowtime' || oldState?.isPaused) {
                                await FocusService.enable({ force: true, source: 'flowtime', resetCounting: true });
                            }
                            await PomodoroService.updateBadge();
                        } else if (focusState.source === 'flowtime') {
                            await FocusService.disable();
                            await PomodoroService.updateBadge();
                        }
                        return;
                    }

                    if (focusState.source === 'flowtime') {
                        await FocusService.disable();
                        await PomodoroService.updateBadge();
                    }

                    if (newState.mode === 'flowtime-break') {
                        return;
                    }

                    const focusSettings = await Storage.get<FocusSettings>('focusSettings');
                    // If auto-enable with Pomodoro is off, Pomodoro does not touch Focus at all
                    if (!(focusSettings?.autoEnableWithPomodoro ?? true)) return;

                    // Manual focus stays manual; Pomodoro should not hijack its timing.
                    if (focusState.isActive && focusState.source === 'manual') {
                        await FocusService.updateBadge();
                        return;
                    }

                    // Work session started or resumed from pause
                    if (newState.isActive && newState.sessionType === 'work' && !newState.isPaused) {
                        if (!oldState?.isActive || oldState.sessionType !== 'work' || oldState.isPaused) {
                            if (focusState.isActive && focusState.source === 'pomodoro') {
                                await FocusService.resumePomodoroCounting();
                            } else {
                                await FocusService.enable({ force: true, source: 'pomodoro', resetCounting: true });
                            }
                            await FocusService.updateBadge();
                        }
                    }
                    // Break started -- disable unless blockDuringBreaks
                    else if (newState.isActive && newState.sessionType !== 'work') {
                        if (focusState.source !== 'pomodoro') return;
                        if (!focusSettings?.blockDuringBreaks) {
                            await FocusService.disable();
                        } else {
                            await FocusService.pausePomodoroCounting();
                            await FocusService.updateBadge();
                        }
                        // If blockDuringBreaks is on, keep focus active (badge stays orange)
                    }
                    // Stopped or paused
                    else if (!newState.isActive || newState.isPaused) {
                        if (focusState.source === 'pomodoro') {
                            await FocusService.disable();
                        }
                    }
                } catch (err) {
                    console.error('[BlueTab][ServiceWorker] Focus state change error:', err);
                }
            })();
        }
    }

    // Handle focusSettings changes: if master toggle turned off, disable immediately
    if (changes.focusSettings) {
        const newFocusSettings = changes.focusSettings.newValue as FocusSettings | undefined;
        const oldFocusSettings = changes.focusSettings.oldValue as FocusSettings | undefined;

        FocusService.syncActiveRulesForSettingsChange(oldFocusSettings, newFocusSettings).catch((err) => {
            console.error('[BlueTab][ServiceWorker] Focus settings sync error:', err);
        });

        if ((oldFocusSettings?.autoEnableWithPomodoro ?? true) && newFocusSettings?.autoEnableWithPomodoro === false) {
            void (async () => {
                try {
                    const focusState = await FocusService.getState();
                    if (focusState.source === 'pomodoro') {
                        await FocusService.disable();
                    }
                } catch (err) {
                    console.error('[BlueTab][ServiceWorker] Pomodoro-managed focus disable error:', err);
                }
            })();
        }
    }

    if (changes.adhd_settings) {
        const newAdhd = changes.adhd_settings.newValue as ADHDSettingsType | undefined;
        const oldAdhd = changes.adhd_settings.oldValue as ADHDSettingsType | undefined;
        const oldAutoFocus =
            (oldAdhd?.masterEnabled ?? false) &&
            (oldAdhd?.flowtimeTimer?.enabled ?? false) &&
            (oldAdhd?.flowtimeTimer?.autoFocusEnabled ?? false);
        const newAutoFocus =
            (newAdhd?.masterEnabled ?? false) &&
            (newAdhd?.flowtimeTimer?.enabled ?? false) &&
            (newAdhd?.flowtimeTimer?.autoFocusEnabled ?? false);

        if (oldAutoFocus !== newAutoFocus) {
            void (async () => {
                try {
                    const [focusState, pomodoroState] = await Promise.all([
                        FocusService.getState(),
                        Storage.get<PomodoroState>('pomodoroState'),
                    ]);

                    if (!pomodoroState?.isActive || pomodoroState.isPaused || pomodoroState.mode !== 'flowtime') {
                        if (!newAutoFocus && focusState.source === 'flowtime') {
                            await FocusService.disable();
                        }
                        return;
                    }

                    if (!newAutoFocus) {
                        if (focusState.source === 'flowtime') {
                            await FocusService.disable();
                            await PomodoroService.updateBadge();
                        }
                        return;
                    }

                    if (!focusState.isActive) {
                        await FocusService.enable({ force: true, source: 'flowtime', resetCounting: true });
                        await PomodoroService.updateBadge();
                    }
                } catch (err) {
                    console.error('[BlueTab][ServiceWorker] Flowtime auto-focus sync error:', err);
                }
            })();
        }
    }
});

// Handle notification button clicks (Snooze / Dismiss)
// Firefox has no notification buttons (the event is missing there).
chrome.notifications.onButtonClicked?.addListener(async (notificationId, buttonIndex) => {
    try {
        if (notificationId.startsWith('pomodoro-')) {
            // Pomodoro notifications are informational; just clear
            await chrome.notifications.clear(notificationId);
        } else if (notificationId.startsWith('reminder-')) {
            const reminderId = notificationId.replace('reminder-', '');
            if (buttonIndex === 0) {
                // Snooze 15 minutes
                await ReminderService.snooze(reminderId, 15);
                console.log('[BlueTab][Reminder] Snoozed:', reminderId);
            } else {
                // Dismiss
                await ReminderService.dismiss(reminderId);
                console.log('[BlueTab][Reminder] Dismissed:', reminderId);
            }
            await chrome.notifications.clear(notificationId);
        }
    } catch (error) {
        console.error('[BlueTab][Notification] Button click handler error:', error);
    }
});

// Handle notification body clicks (deep link / clear)
chrome.notifications.onClicked.addListener(async (notificationId) => {
    try {
        if (notificationId.startsWith('pomodoro-')) {
            await chrome.notifications.clear(notificationId);
        } else if (notificationId.startsWith('reminder-')) {
            const reminderId = notificationId.replace('reminder-', '');
            console.log('[BlueTab][Reminder] Clicked, dismissing:', reminderId);
            // Tabs are already opened by handleFired; just dismiss the reminder
            await ReminderService.dismiss(reminderId);
            await chrome.notifications.clear(notificationId);
        } else if (notificationId.startsWith('rss-')) {
            const meta = await getRssNotificationMeta(notificationId);
            if (meta?.type === 'single' && meta.link) {
                await chrome.tabs.create({ url: meta.link });
            } else {
                // Multi-article or unknown: open feeds page directly
                await chrome.tabs.create({ url: chrome.runtime.getURL('src/feeds/index.html') });
            }
            await deleteRssNotificationMeta(notificationId);
            await chrome.notifications.clear(notificationId);
        }
    } catch (error) {
        console.error('[BlueTab][Notification] Click handler error:', error);
    }
});

// Toggle side panel when extension icon is clicked (open if closed, close if open)
configureToolbarOpensSidePanel();

// Firefox has no offscreen document. Settings pages and other extension
// pages send these messages to the background, which has DOM access there.
if (IS_FIREFOX) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (sender.id && sender.id !== chrome.runtime.id) return false;
        if (message?.type !== 'PLAY_NOTIFICATION_DING' && message?.type !== 'EXTRACT_OFFLINE_ARTICLE') return false;
        void import('./offscreen-handlers')
            .then(({ handleOffscreenMessage }) => handleOffscreenMessage(message))
            .then(sendResponse);
        return true;
    });
}

// Handle messages from popup and other extension pages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id && sender.id !== chrome.runtime.id) {
        sendResponse({ success: false, error: 'Untrusted sender' });
        return false;
    }

    // Phase 9 — Brain Dump save path. Content-script modal sends this on
    // Enter; BrainDumpService.add trims + validates + persists via the
    // RingBuffer(200). Returns {success: true} or {success: false, error}.
    //
    // Plan 14-07 (INTEG-11): the message MAY also carry a destinationOverride
    // = {integrationId, accountId}. After local save, if present, the SW
    // dispatches push_brain_dump_to_<integration> via integrationService.
    // Local save is authoritative — integration push is fire-and-forget and
    // never blocks the response.
    if (message?.action === 'brain-dump:save') {
        saveBrainDumpEntryWithRouting({
            text: String(message.text ?? ''),
            tabContext: message.tabContext,
            destinationOverride: message.destinationOverride as BrainDumpDestinationOverride,
            calendarStartIso: typeof message.calendarStartIso === 'string' ? message.calendarStartIso : undefined,
            calendarDurationMinutes: typeof message.calendarDurationMinutes === 'number'
                ? message.calendarDurationMinutes
                : undefined,
        })
            .then(() => sendResponse({ success: true }))
            .catch((err: unknown) =>
                sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }),
            );
        return true; // async response
    }

    if (message?.action === 'brain-dump:summarize-page') {
        void (async () => {
            try {
                if (!await canUseAiPageSummary()) {
                    await initI18n();
                    sendResponse({
                        success: false,
                        error: translate('notifications.aiSummary.requiresPro'),
                        code: 'entitlement_required',
                    });
                    return;
                }

                if (!await hasSeenAINotice()) {
                    // The SW cannot show a dialog: open AI settings, where the
                    // one-time notice appears, and ask the user to try again.
                    await initI18n();
                    void chrome.tabs.create({ url: chrome.runtime.getURL('src/settings/index.html#ai') });
                    sendResponse({
                        success: false,
                        error: translate('notifications.aiSummary.noticeRequired'),
                        code: 'ai_notice_required',
                    });
                    return;
                }

                const result = await AIPageSummaryService.summarizePage({
                    url: String(message.url ?? ''),
                    title: String(message.title ?? message.tabContext?.title ?? message.url ?? ''),
                    html: typeof message.html === 'string' ? message.html : undefined,
                });

                await saveBrainDumpEntryWithRouting({
                    text: result.summary,
                    tabContext: message.tabContext,
                    destinationOverride: message.destinationOverride as BrainDumpDestinationOverride,
                    calendarStartIso: typeof message.calendarStartIso === 'string' ? message.calendarStartIso : undefined,
                    calendarDurationMinutes: typeof message.calendarDurationMinutes === 'number'
                        ? message.calendarDurationMinutes
                        : undefined,
                });

                sendResponse({ success: true, summary: result.summary });
            } catch (error) {
                await notifyAiPageSummaryFailure(error);
                sendResponse({
                    success: false,
                    error: getAiPageSummaryFailureMessage(error),
                    code: error instanceof AIPageSummaryError ? error.code : 'backend_error',
                });
            }
        })();
        return true;
    }

    // Plan 14-07 (INTEG-11): brain-dump-modal asks the SW for the list of
    // connected integrations + accounts so it can render the destination
    // picker without bundling listConnectedAccounts into the content
    // script. Returns { accounts: IntegrationAccount[], destinationOverride
    // } — both stripped of secrets (TOKEN-01 contract).
    if (message?.action === 'brain-dump:get-integrations') {
        void (async () => {
            try {
                const destinations: BrainDumpDestinationOption[] = await getBrainDumpDestinations();
                const prefs = await BrainDumpService.getPrefs();
                const destinationOverride = (prefs as {
                    destinationOverride?: { integrationId: string; accountId: string; target?: string | null } | null;
                }).destinationOverride ?? null;
                const unavailableDestinationMessage = destinationOverride
                    ? getIntegrationUnavailableMessage(destinationOverride.integrationId)
                    : null;
                sendResponse({ destinations, destinationOverride, unavailableDestinationMessage });
            } catch (err) {
                sendResponse({ destinations: [], destinationOverride: null, error: err instanceof Error ? err.message : String(err) });
            }
        })();
        return true;
    }

    // Phase 9 — Brain Dump prefs read. Content-script modal seeds the
    // attach/detach chip state from this on mount (ADHD-22 remembers-last-choice).
    if (message?.action === 'brain-dump:get-presentation') {
        getBrainDumpPresentation().then(sendResponse).catch(() => sendResponse(null));
        return true;
    }

    if (message?.action === 'brain-dump:get-prefs') {
        Promise.all([BrainDumpService.getPrefs(), canUseAiPageSummary()])
            .then(([prefs, canSummarizePageToDump]) => sendResponse({ prefs, canSummarizePageToDump }))
            .catch(() => sendResponse({ prefs: { enabled: true, tabContextDefault: true }, canSummarizePageToDump: false }));
        return true;
    }

    // Phase 9 — Brain Dump prefs write. Modal fires this after a successful
    // save so the next capture defaults to the same attach state.
    //
    // Plan 14-07 — preserve destinationOverride if the caller did not send
    // one. The content-script modal currently only writes tabContextDefault
    // here; the destinationOverride is updated via the picker change event
    // routed through `brain-dump:save` (the SW is the source of truth).
    if (message?.action === 'brain-dump:set-prefs') {
        void (async () => {
            try {
                const existing = await BrainDumpService.getPrefs();
                const next = { ...existing, tabContextDefault: !!message.tabContextDefault };
                await BrainDumpService.setPrefs(next);
                sendResponse({ success: true });
            } catch (err: unknown) {
                sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
        })();
        return true;
    }

    // Phase 9 — restricted-page fallback toast broadcast. The SW itself
    // sends this when the active tab is chrome:// / chrome-extension:// /
    // view-source: / chromewebstore.google.com. Any open Bluetab surface
    // (sidepanel is the preferred listener) catches it and calls toast.info.
    // No sendResponse — the SW fires this as a broadcast, not a request.
    if (message?.action === 'brain-dump:restricted-toast') {
        return false;
    }

    if (message.type === 'OPEN_BLUETAB_PAGE') {
        const pagePath = message.pagePath || 'src/options/index.html';
        openBlueTabPage(pagePath).then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            console.error('[BlueTab] Failed to open page:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    // Floating button settings request
    if (message.type === 'GET_FLOATING_BUTTON_SETTINGS') {
        Promise.all([
            Storage.getSettings(),
            canUseAiPageSummary(),
            getFloatingButtonDumpMatch(typeof message.pageUrl === 'string' ? message.pageUrl : ''),
            getFloatingButtonPresentation(),
        ]).then(([settings, canSummarizePageToDump, dumpMatch, floatingButtonPresentation]) => {
            sendResponse({
                floatingButtonEnabled: settings.floatingButtonEnabled ?? true,
                floatingButtonPosition: settings.floatingButtonPosition ?? 'bottom-right',
                floatingButtonConfirmSaveAll: settings.floatingButtonConfirmSaveAll ?? true,
                canSummarizePageToDump,
                ...dumpMatch,
                floatingButtonTitles: floatingButtonPresentation.titles,
                floatingButtonLanguage: floatingButtonPresentation.language,
                floatingButtonDirection: floatingButtonPresentation.direction,
            });
        });
        return true;
    }

    if (message.type === 'GET_FLOATING_BUTTON_SITE_MATCH') {
        getFloatingButtonDumpMatch(typeof message.pageUrl === 'string' ? message.pageUrl : '')
            .then((dumpMatch) => sendResponse(dumpMatch))
            .catch(() => {
                sendResponse({ hasRelatedDump: false, relatedDumpPreview: '', relatedDumpCount: 0 });
            });
        return true;
    }

    // Bubble click in the floating button: open the side panel on the Dump tab.
    // sidePanel.open must run synchronously inside the user-gesture message,
    // so nothing is awaited before it.
    if (message.type === 'OPEN_SIDEPANEL_BRAIN_DUMP') {
        chrome.storage.local.set({ sidepanelActiveTab: 'dump' });
        chrome.runtime.sendMessage({ type: 'SIDEPANEL_SHOW_TAB', tab: 'dump' }).catch(() => {});
        const tabId = sender.tab?.id;
        const windowId = sender.tab?.windowId;
        const openOptions = typeof tabId === 'number'
            ? { tabId }
            : typeof windowId === 'number' ? { windowId } : null;
        if (!openOptions) {
            sendResponse({ success: false });
            return false;
        }
        openSidePanel(openOptions)
            .then(() => sendResponse({ success: true }))
            .catch((error: unknown) => {
                console.warn('[BlueTab][FloatingButton] Could not open side panel:', error);
                sendResponse({ success: false });
            });
        return true;
    }

    if (message.type === 'FLOATING_BUTTON_SYNC_CONTENT_SCRIPT') {
        void (async () => {
            try {
                await ensureFloatingButtonRegistered(message.settings as Settings | undefined);
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        })();
        return true;
    }

    // Floating button save actions
    if (message.type === 'FLOATING_BUTTON_SAVE_THIS_TAB' && sender.tab) {
        saveThisTab(sender.tab);
        return false;
    }

    if (message.type === 'FLOATING_BUTTON_SAVE_TABS_LEFT' && sender.tab) {
        saveTabsToLeft(sender.tab);
        return false;
    }

    if (message.type === 'FLOATING_BUTTON_SAVE_TABS_RIGHT' && sender.tab) {
        saveTabsToRight(sender.tab);
        return false;
    }

    if (message.type === 'FLOATING_BUTTON_SAVE_ALL_OTHER' && sender.tab) {
        saveAllOtherTabs(sender.tab);
        return false;
    }

    if (message.type === 'FLOATING_BUTTON_SAVE_ALL_TABS') {
        saveAllTabs();
        return false;
    }

    // Sync message handlers
    if (message.type === 'SYNC_UI_ACTIVE') {
        SyncEngine.notifyUIActive().then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_UI_INACTIVE') {
        SyncEngine.notifyUIInactive();
        sendResponse({ success: true });
        return false;
    }

    if (message.type === 'SYNC_MANUAL_TRIGGER') {
        SyncEngine.sync().then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_GET_STATE') {
        SyncEngine.getState().then((state) => {
            sendResponse({ success: true, state });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_SETUP') {
        SyncEngine.setupSync(message.password, message.deviceName).then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_RESTORE') {
        SyncEngine.restoreSync(message.password).then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_UPLOAD_SNAPSHOTS') {
        SyncEngine.uploadSnapshots().then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, uploaded: 0, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_DOWNLOAD_SNAPSHOTS') {
        SyncEngine.downloadSnapshots(message.keys).then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, restored: 0, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_GET_DEVICES') {
        SyncEngine.getDevices().then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, devices: [], error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_DELETE_DEVICE') {
        SyncEngine.deleteDevice(message.deviceId).then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_DISCONNECT_CURRENT_DEVICE') {
        SyncEngine.disconnectCurrentDevice().then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    // Clear sync data on logout (called from auth-service via message)
    if (message.type === 'SYNC_CLEAR_ON_LOGOUT') {
        SyncEngine.clearSyncOnLogout().then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    // Pause or resume sync (user toggle in settings)
    if (message.type === 'SYNC_SET_PAUSED') {
        const action = message.paused
            ? SyncEngine.pause()
            : SyncEngine.resume();
        action.then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    // Auto-setup sync (called after login or manually).
    // Also clears any stale authSuspended state in the SW context.
    if (message.type === 'SYNC_AUTO_SETUP') {
        SyncEngine.clearAuthSuspension();
        SyncEngine.autoSetup(message.deviceName, message.password, message.resetCloudData === true).then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'ENABLE_FOCUS') {
        // Idempotent counterpart of TOGGLE_FOCUS, used by the AI block_site tool.
        (async () => {
            try {
                const state = await FocusService.getState();
                if (!state.isActive) {
                    await FocusService.enable({ source: 'manual' });
                }
                await FocusService.updateBadge();
                sendResponse({ success: true, isActive: true });
            } catch (error) {
                console.error('[BlueTab][ServiceWorker] ENABLE_FOCUS error:', error);
                sendResponse({ success: false });
            }
        })();
        return true; // async response
    }

    if (message.type === 'TOGGLE_FOCUS') {
        (async () => {
            try {
                const state = await FocusService.getState();
                if (state.isActive) {
                    await FocusService.disable();
                } else {
                    await FocusService.enable({ source: 'manual' });
                }
                await FocusService.updateBadge();
                sendResponse({ success: true, isActive: !state.isActive });
            } catch (error) {
                console.error('[BlueTab][ServiceWorker] TOGGLE_FOCUS error:', error);
                sendResponse({ success: false });
            }
        })();
        return true; // async response
    }

    // Phase 12 — VTL_RECONCILE: ADHDSettings Visible Tab Limit slider dispatches
    // this on value change so VisibleTabLimitService.reconcile() runs immediately
    // (instead of waiting for the next tab event). Fire-and-forget; sendResponse not needed.
    if (message.type === 'VTL_RECONCILE') {
        (async () => {
            try {
                const adhdSettings = await ADHDService.getSettings();
                if (adhdSettings.masterEnabled && adhdSettings.visibleTabLimit?.enabled) {
                    await VisibleTabLimitService.reconcile();
                }
            } catch (error) {
                console.error('[BlueTab][ServiceWorker] VTL_RECONCILE error:', error);
            }
        })();
        return false; // no async sendResponse needed
    }
});

// Intercept new tab pages and redirect to BlueTab (avoids Brave's NTP footer)
chrome.tabs.onCreated.addListener(async (tab) => {
    // Check if custom new tab is enabled
    const settings = await Storage.getSettings();
    if (!settings.customNewTabEnabled) {
        return; // Don't intercept if disabled
    }

    // Check multiple URL patterns that indicate a new tab
    // IMPORTANT: Don't intercept extension pages or other valid URLs
    // Firefox has no pendingUrl: every tab (also links opened in a new tab)
    // starts as about:blank there, so only about:newtab/about:home count.
    const isNewTab = isBrowserNewTabUrl(tab.pendingUrl) ||
        isBrowserNewTabUrl(tab.url) ||
        (!IS_FIREFOX && tab.url === 'about:blank' && !tab.pendingUrl);

    if (tab.id && isNewTab) {
        const bluetabUrl = chrome.runtime.getURL('src/newtab/index.html');
        try {
            await chrome.tabs.update(tab.id, { url: bluetabUrl });
        } catch (error) {
            console.error('Failed to update new tab:', error);
        }
    }
});

// Phase 9 — Brain Dump restricted-page URL set. Matches chrome://,
// chrome-extension://, view-source:, and the Chrome Web Store. These tabs
// cannot have content scripts injected; the shortcut falls back to a toast.
const BRAIN_DUMP_RESTRICTED_URL_RE = /^(chrome|chrome-extension|edge|about|view-source|moz-extension|resource):/i;
const BRAIN_DUMP_RESTRICTED_HOSTS = RESTRICTED_STORE_HOSTS;

function isBrainDumpRestricted(url: string | undefined): boolean {
    if (!url) return true;
    if (BRAIN_DUMP_RESTRICTED_URL_RE.test(url)) return true;
    try {
        const parsed = new URL(url);
        if (BRAIN_DUMP_RESTRICTED_HOSTS.has(parsed.hostname)) return true;
    } catch {
        return true; // Unparseable URL — treat as restricted.
    }
    return false;
}

async function handleBrainDumpCommand(): Promise<void> {
    await initI18n();
    const active = await BrainDumpService.isEnabled();
    if (!active) {
        console.debug('[BlueTab][ServiceWorker] brain-dump command fired while feature is inactive; ignoring');
        return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    if (isBrainDumpRestricted(tab.url)) {
        // Restricted-page fallback (09-CONTEXT.md locked): surface a toast
        // in any open Bluetab surface that's listening, and set a short
        // badge on the action icon. NO dedicated popup page.
        const message = translate('notifications.brainDumpRestricted');
        try {
            await chrome.runtime.sendMessage({
                action: 'brain-dump:restricted-toast',
                message,
            });
        } catch {
            // No Bluetab surface open to receive the toast — the badge path
            // below still signals the user via the action icon.
        }
        await chrome.action.setBadgeText({ text: '!', tabId: tab.id }).catch(() => {});
        await chrome.action
            .setBadgeBackgroundColor({ color: '#F59E0B', tabId: tab.id })
            .catch(() => {});
        await chrome.alarms.create(`${ALARM_NAMES.BRAIN_DUMP_BADGE_CLEAR_PREFIX}${tab.id}`, {
            when: Date.now() + 3000,
        });
        return;
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['src/content/brain-dump-modal.js'],
        });
    } catch (err) {
        console.debug('[BlueTab][ServiceWorker] brain-dump inject error', err);
    }
}

async function saveSelectedTextToBrainDump(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab,
): Promise<void> {
    await initI18n();
    const selectedText = info.selectionText?.trim();
    if (!selectedText) {
        return;
    }

    const enabled = await BrainDumpService.isEnabled();
    if (!enabled) {
        try {
            await createBasicNotification(translate('notifications.brainDumpDisabled'));
        } catch {
            // notification best-effort
        }
        return;
    }

    const candidateUrl = typeof info.pageUrl === 'string' ? info.pageUrl : tab?.url;
    const tabContext = candidateUrl && !isBrainDumpRestricted(candidateUrl)
        ? {
            url: candidateUrl,
            title: String(tab?.title ?? candidateUrl),
            favicon: tab?.favIconUrl,
        }
        : undefined;

    await saveBrainDumpEntryWithRouting({
        text: selectedText,
        tabContext,
    });

    try {
        await createBasicNotification(translate('notifications.brainDumpSaved'));
    } catch {
        // notification best-effort
    }
}

chrome.commands.onCommand.addListener(async (command) => {
    switch (command) {
        case 'save-all-tabs':
            await saveAllTabs();
            break;
        case 'save-current-tab': {
            // No default key (Chrome allows four suggested shortcuts and
            // all four are taken); users assign one in chrome://extensions/shortcuts.
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab) await saveThisTab(activeTab);
            break;
        }
        case 'restore-last-group':
            await restoreLastGroup();
            break;
        case 'open-manager':
            await openBlueTabManager();
            break;
        case 'brain-dump':
            await handleBrainDumpCommand();
            break;
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // Plan 14-07 — INTEG-10 / INTEG-12: integration-shaped menu IDs.
    // ID grammar:
    //   integration:save:<integrationId>:<accountId>[:link]
    //     -> dispatchVerb via buildIntegrationContextMenuDispatch() using
    //        selection/page/link-specific verbs and payloads.
    //   integration:mirror:<integrationId>
    //     -> broadcast OPEN_GROUP_MIRROR_PICKER to sidepanel.
    const menuId = info.menuItemId?.toString() ?? '';
    if (menuId.startsWith('integration:')) {
        try {
            const saveMatch = menuId.match(/^integration:save:([^:]+):([^:]+?)(?::link)?$/);
            if (saveMatch) {
                const integrationId = saveMatch[1];
                const accountId = saveMatch[2];
                const integrationSettings = await Storage.get<{ default_sync_target?: Record<string, string> }>('integration_settings');
                const selectionText = info.selectionText?.trim();
                const dispatch = buildIntegrationContextMenuDispatch({
                    integrationId: integrationId as never,
                    kind: selectionText ? 'selection' : (info.linkUrl ? 'link' : 'page'),
                    selectionText,
                    pageTitle: tab?.title,
                    pageUrl: info.pageUrl || tab?.url,
                    linkUrl: info.linkUrl,
                    defaultSyncTarget: integrationSettings?.default_sync_target?.[integrationId],
                });

                if (!dispatch) {
                    await createBasicNotification(
                        translate('notifications.quickSendUnsupported', { integration: integrationId }),
                    );
                    return;
                }

                const result = await dispatchVerb(
                    integrationId as never,
                    dispatch.verb,
                    dispatch.args,
                    accountId,
                );
                try {
                    if (result.success) {
                        await createBasicNotification(
                            translate('notifications.quickSendSuccess', { integration: integrationId }),
                        );
                    } else {
                        await createBasicNotification(
                            translate('notifications.quickSendError', {
                                integration: integrationId,
                                message: getUnknownErrorLabel(result.error),
                            }),
                        );
                    }
                } catch { /* notification optional */ }
                return;
            }

            // integration:mirror:* removed — Save-to now auto-creates the
            // mirror in one step (Batch 3).
        } catch (err) {
            console.error('[BlueTab][Integrations] context menu click error', err);
        }
        return;
    }

    try {
        switch (info.menuItemId) {
            case 'save-all-tabs':
            case 'save-all-tabs-page':
                await saveAllTabs();
                break;
            case 'save-selection-to-brain-dump':
                await saveSelectedTextToBrainDump(info, tab);
                break;
            case 'save-this-tab':
                if (tab) await saveThisTab(tab);
                break;
            case 'save-tabs-right':
                if (tab) await saveTabsToRight(tab);
                break;
            case 'save-tabs-left':
                if (tab) await saveTabsToLeft(tab);
                break;
            case 'save-all-other-tabs':
                if (tab) await saveAllOtherTabs(tab);
                break;
            case 'open-manager':
            case 'open-manager-link':
                await openBlueTabManager();
                break;
            case 'save-link':
                if (info.linkUrl) {
                    await saveLinkToNewGroup(info.linkUrl, info.linkUrl);
                }
                break;
            case 'save-this-tab-link':
                if (tab) await saveThisTab(tab);
                break;
            case 'save-tabs-right-link':
                if (tab) await saveTabsToRight(tab);
                break;
            case 'save-tabs-left-link':
                if (tab) await saveTabsToLeft(tab);
                break;
            case 'save-all-other-tabs-link':
                if (tab) await saveAllOtherTabs(tab);
                break;
            case 'save-all-tabs-link':
                await saveAllTabs();
                break;
            case 'open-offline-reader':
                if (!ENABLE_READINGS) break;
                // OFFL-07: Route click to the extension's own options page at the
                // Offline Reading route with the article URL in the hash.
                // NOTE: chrome.tabs.query here targets the extension's OWN options page
                // URL — NOT a user's browsing tab. OFFL-02 forbids tabs.query only in
                // OfflineReadingService (see 10-02-PLAN.md §process_discipline).
                if (info.linkUrl) {
                    const optionsUrl = chrome.runtime.getURL('src/options/index.html') +
                        `#offline-reading?articleUrl=${encodeURIComponent(info.linkUrl)}`;
                    const existing = await chrome.tabs.query({
                        url: chrome.runtime.getURL('src/options/index.html') + '*',
                    });
                    if (existing[0]?.id !== undefined) {
                        await chrome.tabs.update(existing[0].id, { active: true, url: optionsUrl });
                    } else {
                        await chrome.tabs.create({ url: optionsUrl, active: true });
                    }
                }
                break;
            default:
                // Handle adding tabs to existing groups
                const menuId = info.menuItemId?.toString();

                if (menuId && tab) {
                    if (menuId.startsWith('add-this-to-group-')) {
                        const groupId = menuId.replace('add-this-to-group-', '');
                        await addCurrentTabToExistingGroup(tab, groupId);
                    } else if (menuId.startsWith('add-right-to-group-')) {
                        const groupId = menuId.replace('add-right-to-group-', '');
                        await addTabsToExistingGroup(tab, groupId, 'right');
                    } else if (menuId.startsWith('add-left-to-group-')) {
                        const groupId = menuId.replace('add-left-to-group-', '');
                        await addTabsToExistingGroup(tab, groupId, 'left');
                    } else if (menuId.startsWith('add-other-to-group-')) {
                        const groupId = menuId.replace('add-other-to-group-', '');
                        await addTabsToExistingGroup(tab, groupId, 'other');
                    } else if (menuId.startsWith('add-all-to-group-link-')) {
                        const groupId = menuId.replace('add-all-to-group-link-', '');
                        await addTabsToExistingGroup(tab, groupId, 'all');
                    } else if (menuId.startsWith('add-all-to-group-')) {
                        const groupId = menuId.replace('add-all-to-group-', '');
                        await addTabsToExistingGroup(tab, groupId, 'all');
                    } else if (menuId.startsWith('add-this-to-group-link-')) {
                        const groupId = menuId.replace('add-this-to-group-link-', '');
                        await addCurrentTabToExistingGroup(tab, groupId);
                    } else if (menuId.startsWith('add-right-to-group-link-')) {
                        const groupId = menuId.replace('add-right-to-group-link-', '');
                        await addTabsToExistingGroup(tab, groupId, 'right');
                    } else if (menuId.startsWith('add-left-to-group-link-')) {
                        const groupId = menuId.replace('add-left-to-group-link-', '');
                        await addTabsToExistingGroup(tab, groupId, 'left');
                    } else if (menuId.startsWith('add-other-to-group-link-')) {
                        const groupId = menuId.replace('add-other-to-group-link-', '');
                        await addTabsToExistingGroup(tab, groupId, 'other');
                    } else if (menuId.startsWith('add-link-to-group-') && info.linkUrl) {
                        const groupId = menuId.replace('add-link-to-group-', '');
                        await addLinkToExistingGroup(info.linkUrl, groupId);
                    } else if (menuId.startsWith('save-all-to-project-link-')) {
                        const projectId = menuId.replace('save-all-to-project-link-', '');
                        await saveAllTabsToProject(projectId);
                    } else if (menuId.startsWith('save-all-to-project-')) {
                        const projectId = menuId.replace('save-all-to-project-', '');
                        await saveAllTabsToProject(projectId);
                    }
                }
                break;
        }
    } catch (error) {
        console.error('Context menu error:', error);
    }
});

chrome.runtime.onStartup.addListener(async () => {
    ensureCoreAlarms();
    await ensureFloatingButtonRegistered();
    await createContextMenus('runtime-startup');
    await scheduleMcpSnapshotRefresh('runtime-startup');

    // Phase 9 — rehydrate per-tab activity map (Pitfall 9: MV3 SW sleep
    // loses in-memory state; persisted map is the source of truth on wake).
    AutoSuspendService.registerListeners();
    AdhdTabActivityTracker.register();
    await AdhdTabActivityTracker.rehydrate();

    // Phase 12 — Visible Tab Limit onStartup reconcile (RESEARCH finding #3:
    // Chrome tab groups do NOT reliably persist across browser restarts; any
    // tabs that were in H:* groups will have re-appeared as regular tabs after
    // a restart. Reconcile re-evaluates and re-creates H:* groups as needed).
    try {
        const adhdSettings = await ADHDService.getSettings();
        if (adhdSettings.masterEnabled && adhdSettings.visibleTabLimit?.enabled) {
            const windows = await chrome.windows.getAll();
            for (const win of windows) {
                if (win.id !== undefined) {
                    await VisibleTabLimitService.reconcile(win.id);
                }
            }
        }
    } catch (err) {
        console.warn('[BlueTab][SW] VTL onStartup reconcile failed:', err);
    }

    // Phase 12 — Hard Focus: re-apply whitelist if active when SW restarted.
    try {
        await HardFocusService.cleanupStaleRules();
    } catch (err) {
        console.warn('[BlueTab][HardFocusService] cleanupStaleRules (onStartup) failed:', err);
    }

    const settings = await Storage.get<Settings>('settings');
    const startupBehavior = settings?.startupBehavior || 'manual';

    if (startupBehavior === 'show') {
        await openBlueTabPage('src/options/index.html');
    }

    // Phase 11 — kill-switch startup fetch. Fail-open.
    void (async () => {
        // Decrypt the Supertry access token — it lives AES-GCM-encrypted under
        // 'bluetab_auth_token' as a StoredAuthData object, NOT a plain string.
        // Reading it via Storage.get<string> would coerce the object to
        // '[object Object]' in the Bearer header and Supertry would 401.
        const token = await getAccessToken().catch(() => null);
        if (token) {
            KillSwitchService.fetchConfig(token).catch(() => {});
        }
    })();
});

const INTEGRATION_REAUTH_FLAG_PREFIX = 'integration_reauth_required:';
const INTEGRATION_REAUTH_RESET_KEY = 'integration_reauth_flags_reset_v1';

/**
 * One-time cleanup: flags written before transient cloud errors were told
 * apart from dead grants are mostly stale and keep a "reconnect" banner up
 * for connections that work. A really dead grant is flagged again on its
 * next call.
 */
async function resetStaleIntegrationReauthFlags(): Promise<void> {
    try {
        const all = await chrome.storage.local.get(null);
        if (all[INTEGRATION_REAUTH_RESET_KEY]) return;
        const keys = Object.keys(all).filter((key) => key.startsWith(INTEGRATION_REAUTH_FLAG_PREFIX));
        if (keys.length > 0) await chrome.storage.local.remove(keys);
        await chrome.storage.local.set({ [INTEGRATION_REAUTH_RESET_KEY]: Date.now() });
    } catch (err) {
        console.warn('[BlueTab][Integrations] reauth flag reset skipped:', err);
    }
}

chrome.runtime.onInstalled.addListener(async (details) => {
    ensureCoreAlarms();
    if (details.reason === 'update') {
        await resetStaleIntegrationReauthFlags();
    }
    await ensureFloatingButtonRegistered();
    await scheduleMcpSnapshotRefresh('runtime-installed');
    await createContextMenus(`runtime-installed:${details.reason}`);

    // Phase 9 — re-register on install/update. rehydrate is harmless on
    // first install (empty map), essential on update (preserve history).
    AutoSuspendService.registerListeners();
    AdhdTabActivityTracker.register();
    await AdhdTabActivityTracker.rehydrate();

    // Phase 12 — Visible Tab Limit reconcile on install/update.
    // Covers the "extension update wakes service worker" case where previously
    // managed H:* group state may be stale or the settings have changed.
    try {
        const adhdSettings = await ADHDService.getSettings();
        if (adhdSettings.masterEnabled && adhdSettings.visibleTabLimit?.enabled) {
            const windows = await chrome.windows.getAll();
            for (const win of windows) {
                if (win.id !== undefined) {
                    await VisibleTabLimitService.reconcile(win.id);
                }
            }
        }
    } catch (err) {
        console.warn('[BlueTab][SW] VTL onInstalled reconcile failed:', err);
    }

    // Phase 12 — Hard Focus: clear any orphan rules on install/update.
    try {
        await HardFocusService.cleanupStaleRules();
    } catch (err) {
        console.warn('[BlueTab][HardFocusService] cleanupStaleRules (onInstalled) failed:', err);
    }

    if (details.reason === 'install') {
        const onboardingState = await Storage.get<{ completed: boolean }>('onboarding_state');
        if (!onboardingState?.completed) {
            await chrome.tabs.create({
                url: chrome.runtime.getURL('src/onboarding/index.html')
            });
        }
    }

    // Phase 11 — kill-switch fetch on install/update. Fail-open.
    void (async () => {
        // Decrypt the Supertry access token — it lives AES-GCM-encrypted under
        // 'bluetab_auth_token' as a StoredAuthData object, NOT a plain string.
        // Reading it via Storage.get<string> would coerce the object to
        // '[object Object]' in the Bearer header and Supertry would 401.
        const token = await getAccessToken().catch(() => null);
        if (token) {
            KillSwitchService.fetchConfig(token).catch(() => {});
        }
    })();
});

// Listen for storage changes to update context menus when groups, settings or projects change
chrome.storage.onChanged.addListener(async (changes) => {
    if (Object.keys(changes).some((key) => MCP_SNAPSHOT_SOURCE_KEYS.has(key))) {
        MCPServerService.scheduleSnapshotPush();
    }

    if (changes.groups || changes.settings || changes.projects) {
        await createContextMenus('storage:groups-settings-projects');
    }

    if (changes.settings) {
        const settings = changes.settings.newValue as Settings | undefined;
        await ensureFloatingButtonRegistered(settings);
        await notifyFloatingButtonSettings(settings);
    }

    if (changes.bluetab_auth_token || changes.bluetab_subscription || changes.brain_dump_prefs) {
        await notifyFloatingButtonSettings();
    }

    // Plan 14-07 — INTEG-10. Integration tokens connect/disconnect must
    // refresh the context menu so Save-to entries stay in sync without a
    // full extension reload. createContextMenus already calls
    // rebuildIntegrationContextMenus at its tail; no need to call separately.
    if (changes.integration_tokens) {
        await createContextMenus('storage:integration_tokens');
    }

    // Bluet Bridge auto re-sync: detect tabGroups changes and re-sync shared groups
    if (changes.projects) {
        // Renamed or deleted projects: syncIfShared updates or removes the Bluet page
        const oldProjects: Project[] = changes.projects.oldValue || [];
        const newProjects: Project[] = changes.projects.newValue || [];
        for (const oldProject of oldProjects) {
            const current = newProjects.find(p => p.id === oldProject.id);
            if (!current || current.name !== oldProject.name) debouncedBluetSync(oldProject.id);
        }
    }
    if (changes.groups) {
        const oldGroups: TabGroup[] = changes.groups.oldValue || [];
        const newGroups: TabGroup[] = changes.groups.newValue || [];
        console.log('[BlueTab][BluetBridge] Storage groups changed, old:', oldGroups.length, 'new:', newGroups.length);
        const changedGroupIds = findChangedGroupIds(oldGroups, newGroups);
        console.log('[BlueTab][BluetBridge] Changed group IDs:', changedGroupIds);

        // Linear auto-sync — diff old/new groups and sync changes to Linear
        // (runs its own detection, independent of findChangedGroupIds)
        LinearAutoSyncService.handleGroupsChanged(oldGroups, newGroups).catch((err) => {
            console.warn('[BlueTab][LinearAutoSync] sync failed', err);
        });

        // Todoist auto-sync — same pattern as Linear
        TodoistAutoSyncService.handleGroupsChanged(oldGroups, newGroups).catch((err) => {
            console.warn('[BlueTab][TodoistAutoSync] sync failed', err);
        });

        // Slack auto-sync — same pattern
        SlackAutoSyncService.handleGroupsChanged(oldGroups, newGroups).catch((err) => {
            console.warn('[BlueTab][SlackAutoSync] sync failed', err);
        });

        // Discord auto-sync — same pattern
        DiscordAutoSyncService.handleGroupsChanged(oldGroups, newGroups).catch((err) => {
            console.warn('[BlueTab][DiscordAutoSync] sync failed', err);
        });

        if (changedGroupIds.length > 0) {
            // Integration mirror sync (Batch 6) — for every group that has an
            // auto_sync_groups mapping, schedule a debounced Notion push so
            // the mirror database tracks the local edits.
            try {
                console.log('[BlueTab][Mirror] storage groups changed → scheduleMirrorSync', changedGroupIds);
                scheduleMirrorSync(changedGroupIds);
            } catch (err) {
                console.warn('[BlueTab][Integrations] scheduleMirrorSync failed', err);
            }

            for (const groupId of changedGroupIds) {
                // Direct group share check
                debouncedBluetSync(groupId);

                // Also check if the group belongs (or belonged, when deleted or moved) to a shared project
                const group = newGroups.find(g => g.id === groupId);
                const previous = oldGroups.find(g => g.id === groupId);
                for (const projectId of new Set([group?.projectId, previous?.projectId])) {
                    if (projectId) debouncedBluetSync(projectId);
                }
            }
        }

        // Phase 3: Track group saves (when new groups are added to the array)
        const newLen = (changes.groups.newValue || []).length;
        const oldLen = (changes.groups.oldValue || []).length;
        if (newLen > oldLen) {
            StatsService.recordGroupSaved(newLen - oldLen).catch(() => {});
        }
    }
});

// --- Phase 3: Statistics tab event listeners ---
chrome.tabs.onCreated.addListener((tab) => {
    StatsService.recordTabEvent('created', tab.url || tab.pendingUrl).catch(() => {});

    // Phase 12 — VTL: a new tab may push the visible count over the limit.
    if (tab.windowId !== undefined) {
        void (async () => {
            try {
                const adhd = await ADHDService.getSettings();
                if (adhd.masterEnabled && adhd.visibleTabLimit?.enabled) {
                    VisibleTabLimitService.scheduleReconcile(tab.windowId);
                }
            } catch { /* non-critical */ }
        })();
    }

    // HF1: Hard Focus whitelist is SNAPSHOT — onCreated does NOT trigger HF rebuild.
});

chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
    StatsService.recordTabEvent('removed').catch(() => {});

    // Phase 12 — VTL: a removed tab may free up a slot (H:* tabs may graduate).
    if (!removeInfo.isWindowClosing) {
        void (async () => {
            try {
                const adhd = await ADHDService.getSettings();
                if (adhd.masterEnabled && adhd.visibleTabLimit?.enabled) {
                    VisibleTabLimitService.scheduleReconcile(removeInfo.windowId);
                }
            } catch { /* non-critical */ }
        })();
    }

    // HF1: Hard Focus whitelist is SNAPSHOT — onRemoved does NOT trigger HF rebuild.
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab?.url) {
            await StatsService.recordTabEvent('activated', tab.url);
        }
    } catch {
        // Tab may have already closed — ignore
    }

    // Phase 12 — VTL: activation may trigger tab movement out of H:* (non-displacing).
    try {
        const adhd = await ADHDService.getSettings();
        if (adhd.masterEnabled && adhd.visibleTabLimit?.enabled) {
            await VisibleTabLimitService.onTabActivated(activeInfo.tabId, activeInfo.windowId);
        }
    } catch (err) {
        console.warn('[BlueTab][SW] VTL onTabActivated failed:', err);
    }
});

// Phase 12 — VTL: chrome.tabs.onUpdated handles manual drag-out of H:* groups.
// When changeInfo.groupId changes, the user may have moved a tab between groups.
// HF1: Hard Focus whitelist is SNAPSHOT (no reactive updates on tab events).
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (typeof changeInfo.url === 'string') {
        void notifyFloatingButtonUrlChange(tabId, changeInfo.url);
    }

    if (changeInfo.groupId === undefined) {
        // Hard Focus fallback guard for URL updates that may bypass dNR
        // (e.g. history.pushState / SPA route transitions).
        const candidateUrl = typeof changeInfo.url === 'string' ? changeInfo.url : tab.url;
        const candidateTitle = typeof changeInfo.title === 'string' ? changeInfo.title : tab.title;
        if (candidateUrl) {
            try {
                await enforceHardFocusOnUrlChange(tabId, candidateUrl);
            } catch (err) {
                console.warn('[BlueTab][HardFocusService] onUpdated URL enforce failed:', err);
            }
        }

        if (candidateUrl || candidateTitle) {
            try {
                const [focusState, focusSettings] = await Promise.all([
                    FocusService.getState(),
                    Storage.get<FocusSettings>('focusSettings'),
                ]);

                if (focusState.isActive && focusSettings) {
                    await FocusService.maybeRedirectTab(
                        tabId,
                        normalizeFocusSettings(focusSettings),
                        { url: candidateUrl, title: candidateTitle },
                    );
                }
            } catch (err) {
                console.warn('[BlueTab][FocusService] onUpdated phrase enforce failed:', err);
            }
        }

        // Non-group update (url, status, etc.) — debounced VTL reconcile only.
        if (tab.windowId !== undefined) {
            try {
                const adhd = await ADHDService.getSettings();
                if (adhd.masterEnabled && adhd.visibleTabLimit?.enabled) {
                    VisibleTabLimitService.scheduleReconcile(tab.windowId);
                }
            } catch { /* non-critical */ }
        }
        return;
    }

    // Group membership changed — may be a manual drag out of H:*.
    try {
        const adhd = await ADHDService.getSettings();
        if (adhd.masterEnabled && adhd.visibleTabLimit?.enabled && tab.windowId !== undefined) {
            await VisibleTabLimitService.onTabManualMoved(tabId, tab.windowId);
        }
    } catch (err) {
        console.warn('[BlueTab][SW] VTL onTabManualMoved failed:', err);
    }
});

// Phase 12 — VTL: chrome.tabGroups.onUpdated / onRemoved for debounced reconcile.
// A tab group collapsing, renaming, or being removed may change visibility counts.
// HF1: Hard Focus whitelist is SNAPSHOT — group events do NOT trigger HF rebuild.
//
// F1-fix: When an H:* group's collapsed state flips to false (expanded) via a
// Chrome-native user click on the group header, we mark it as user-expanded so
// that reconcile does NOT immediately re-collapse it. Re-collapse only happens
// when focus moves to a tab outside the group (via onTabActivated).
chrome.tabGroups.onUpdated.addListener(async (group) => {
    try {
        const adhd = await ADHDService.getSettings();
        if (adhd.masterEnabled && adhd.visibleTabLimit?.enabled) {
            // F1: Detect user-initiated expand of an H:* group.
            // collapsed:false on an H:* group means the user clicked the group header.
            // Without this guard, scheduleReconcile → _recollapseIdleHiddenGroups
            // would immediately fight Chrome's native expand.
            if (!group.collapsed && isHiddenGroupTitle(group.title)) {
                onHiddenGroupUserExpanded(group.id);
                // Do NOT schedule a reconcile for this event — let the user browse.
                return;
            }
            VisibleTabLimitService.scheduleReconcile(group.windowId);
        }
    } catch { /* non-critical */ }
});

chrome.tabGroups.onRemoved.addListener(async (group) => {
    forgetRemovedGroup(group.id);
    try {
        const adhd = await ADHDService.getSettings();
        if (adhd.masterEnabled && adhd.visibleTabLimit?.enabled) {
            VisibleTabLimitService.scheduleReconcile(group.windowId);
        }
    } catch { /* non-critical */ }
});

// Omnibox search functionality
chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    if (!text) return;

    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const suggestions: chrome.omnibox.SuggestResult[] = [];
    const lowerText = text.toLowerCase();

    // Search groups
    const matchingGroups = groups.filter(group =>
        group.name.toLowerCase().includes(lowerText)
    );

    for (const group of matchingGroups) {
        suggestions.push({
            content: `group:${group.id}`,
            description: translate('components.omnibox.groupDescription', {
                name: escapeXml(group.name),
                count: group.tabs.length,
            })
        });
    }

    // Search tabs within groups
    for (const group of groups) {
        for (const tab of group.tabs) {
            if (tab.title.toLowerCase().includes(lowerText) || tab.url.toLowerCase().includes(lowerText)) {
                suggestions.push({
                    content: `tab:${tab.url}`,
                    description: translate('components.omnibox.tabDescription', {
                        title: escapeXml(tab.title),
                        url: escapeXml(tab.url),
                    })
                });
            }
        }
    }

    suggest(suggestions.slice(0, 10));
});

chrome.omnibox.onInputEntered.addListener(async (text) => {
    if (text.startsWith('group:')) {
        await openBlueTabManager();
    } else if (text.startsWith('tab:')) {
        const url = text.substring(4);
        // SECURITY: Validate URL before opening to prevent javascript:/data:/file: attacks
        if (isValidTabUrl(url)) {
            await chrome.tabs.create({ url });
        } else {
            console.warn('[BlueTab][Security] Blocked dangerous URL:', url.substring(0, 50));
        }
    } else {
        await openBlueTabManager();
    }
});

/**
 * SECURITY: Validate URL to prevent dangerous schemes
 * Blocks javascript:, data:, file:, vbscript: URLs that could execute code
 */
function isValidTabUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;

    const dangerousSchemes = ['javascript:', 'data:', 'file:', 'vbscript:'];
    const lowerUrl = url.toLowerCase().trim();

    // Block dangerous schemes
    if (dangerousSchemes.some(scheme => lowerUrl.startsWith(scheme))) {
        return false;
    }

    // Must be a valid URL with http/https or extension URL
    try {
        const parsed = new URL(url);
        const allowedProtocols = ['http:', 'https:', 'chrome-extension:'];
        return allowedProtocols.includes(parsed.protocol);
    } catch {
        return false;
    }
}

function escapeXml(str: string): string {
    return str.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

let contextMenuRebuildPromise: Promise<boolean> | null = null;
let contextMenuRebuildRequested = false;
let contextMenuRebuildReason = 'unknown';

function createContextMenuItem(props: chrome.contextMenus.CreateProperties): Promise<void> {
    return new Promise((resolve, reject) => {
        chrome.contextMenus.create(props, () => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(`[${String(props.id ?? 'unknown-menu')}] ${error.message}`));
                return;
            }
            resolve();
        });
    });
}

function removeAllContextMenuItems(): Promise<void> {
    return new Promise((resolve, reject) => {
        chrome.contextMenus.removeAll(() => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(`[removeAll] ${error.message}`));
                return;
            }
            resolve();
        });
    });
}

function getSafeContextMenuGroupLimit(value: number | undefined): number {
    if (!Number.isFinite(value)) return 25;
    const normalized = Math.trunc(value as number);
    return Math.min(Math.max(normalized, 5), 50);
}

async function maybeBootstrapContextMenusOnWorkerStart(): Promise<void> {
    if (!chrome.storage?.session) return;

    try {
        const result = await Promise.resolve(
            chrome.storage.session.get(CONTEXT_MENU_BOOTSTRAP_SESSION_KEY),
        ).catch(() => null);
        const bootstrappedAt = result?.[CONTEXT_MENU_BOOTSTRAP_SESSION_KEY];
        if (typeof bootstrappedAt === 'number') {
            return;
        }

        const rebuilt = await createContextMenus('worker-session-bootstrap');
        if (!rebuilt) return;

        await Promise.resolve(
            chrome.storage.session.set({
                [CONTEXT_MENU_BOOTSTRAP_SESSION_KEY]: Date.now(),
            }),
        ).catch(() => {});
    } catch (error) {
        console.warn('[BlueTab][ContextMenus] Worker-start bootstrap skipped:', error);
    }
}

async function createContextMenus(reason = 'manual'): Promise<boolean> {
    contextMenuRebuildRequested = true;
    contextMenuRebuildReason = reason;

    if (!contextMenuRebuildPromise) {
        contextMenuRebuildPromise = (async () => {
            let allRebuildsSucceeded = true;

            try {
                while (contextMenuRebuildRequested) {
                    const nextReason = contextMenuRebuildReason;
                    contextMenuRebuildRequested = false;
                    contextMenuRebuildReason = 'unknown';

                    const rebuilt = await createContextMenusInternal(nextReason);
                    allRebuildsSucceeded = rebuilt && allRebuildsSucceeded;
                }

                return allRebuildsSucceeded;
            } finally {
                contextMenuRebuildPromise = null;
            }
        })();
    }

    return contextMenuRebuildPromise;
}

async function createContextMenusInternal(reason: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
        await initI18n();
        await removeAllContextMenuItems();

        await createContextMenuItem({
            id: 'page-parent',
            title: translate('contextMenu.root'),
            contexts: ['page', 'selection']
        });

        await createContextMenuItem({
            id: 'open-manager',
            parentId: 'page-parent',
            title: translate('contextMenu.openManager'),
            contexts: ['page', 'selection']
        });

        await createContextMenuItem({
            id: 'save-all-tabs',
            title: translate('contextMenu.saveCurrentTabs'),
            contexts: ['action']
        });

        await createContextMenuItem({
            id: 'link-parent',
            title: translate('contextMenu.root'),
            contexts: ['link']
        });

        await createContextMenuItem({
            id: 'open-manager-link',
            parentId: 'link-parent',
            title: translate('contextMenu.openManager'),
            contexts: ['link']
        });

        await addExistingGroupsToContextMenu();
        await addExistingGroupsToLinkContextMenu();
        await addExistingGroupsToLinkContextMenuTabs();
        await addProjectsToContextMenu();

        await createContextMenuItem({
            id: 'separator-1',
            parentId: 'page-parent',
            type: 'separator',
            contexts: ['page', 'selection']
        });

        await createContextMenuItem({
            id: 'save-selection-to-brain-dump',
            parentId: 'page-parent',
            title: translate('contextMenu.sendSelectedTextToDump'),
            contexts: ['selection']
        });

        await createContextMenuItem({
            id: 'save-this-tab',
            parentId: 'page-parent',
            title: translate('contextMenu.saveThisTab'),
            contexts: ['page']
        });

        await createContextMenuItem({
            id: 'save-all-other-tabs',
            parentId: 'page-parent',
            title: translate('contextMenu.saveAllOtherTabs'),
            contexts: ['page']
        });

        await createContextMenuItem({
            id: 'save-tabs-right',
            parentId: 'page-parent',
            title: translate('contextMenu.saveTabsRight'),
            contexts: ['page']
        });

        await createContextMenuItem({
            id: 'save-tabs-left',
            parentId: 'page-parent',
            title: translate('contextMenu.saveTabsLeft'),
            contexts: ['page']
        });

        await createContextMenuItem({
            id: 'save-all-tabs-page',
            parentId: 'page-parent',
            title: translate('contextMenu.saveAllTabs'),
            contexts: ['page']
        });

        await createContextMenuItem({
            id: 'link-separator-1',
            parentId: 'link-parent',
            type: 'separator',
            contexts: ['link']
        });

        await createContextMenuItem({
            id: 'save-link',
            parentId: 'link-parent',
            title: translate('contextMenu.saveThisLink'),
            contexts: ['link']
        });

        await createContextMenuItem({
            id: 'save-this-tab-link',
            parentId: 'link-parent',
            title: translate('contextMenu.saveThisTab'),
            contexts: ['link']
        });

        await createContextMenuItem({
            id: 'save-all-other-tabs-link',
            parentId: 'link-parent',
            title: translate('contextMenu.saveAllOtherTabs'),
            contexts: ['link']
        });

        await createContextMenuItem({
            id: 'save-tabs-right-link',
            parentId: 'link-parent',
            title: translate('contextMenu.saveTabsRight'),
            contexts: ['link']
        });

        await createContextMenuItem({
            id: 'save-tabs-left-link',
            parentId: 'link-parent',
            title: translate('contextMenu.saveTabsLeft'),
            contexts: ['link']
        });

        await createContextMenuItem({
            id: 'save-all-tabs-link',
            parentId: 'link-parent',
            title: translate('contextMenu.saveAllTabs'),
            contexts: ['link']
        });

        if (ENABLE_READINGS) {
            await createContextMenuItem({
                id: 'open-offline-reader',
                parentId: 'link-parent',
                title: translate('contextMenu.openOffline'),
                contexts: ['link'],
            });
        }

            await rebuildIntegrationContextMenus();
            console.info(`[BlueTab][ContextMenus] Rebuild completed (${reason}, attempt ${attempt})`);
            return true;
        } catch (error) {
            console.error(`[BlueTab][ContextMenus] Rebuild failed (${reason}, attempt ${attempt}/2):`, error);
        }
    }

    await Promise.resolve(
        chrome.storage.session?.remove(CONTEXT_MENU_BOOTSTRAP_SESSION_KEY),
    ).catch(() => {});
    return false;
}

/**
 * Plan 14-07 — INTEG-10. Rebuild the integration-shaped context menu
 * entries from the current list of connected accounts. Menu IDs are encoded
 * so the onClicked listener can route them back to the right adapter:
 *   - integration:save:<integrationId>:<accountId>
 *     "Save to <integration> (<accountLabel>)" — invokes the
 *     integration-context-menu dispatcher. Visible on link/page/selection
 *     contexts.
 *   - integration:mirror:<integrationId>
 *     "Mirror to <integration>" — broadcasts OPEN_GROUP_MIRROR_PICKER to
 *     the sidepanel, which then opens GroupMirrorPicker preselected to
 *     this integration.
 *
 * Called from createContextMenus() (same removeAll pass) AND on
 * chrome.storage.onChanged for `integration_tokens` so the menu stays in
 * sync after connect/disconnect without a full extension reload.
 */
async function rebuildIntegrationContextMenus(): Promise<void> {
    try {
        await initI18n();
        const accounts = await listConnectedAccounts();
        const activeAccounts = accounts.filter((account) =>
            INTEGRATION_REGISTRY_MAP.has(account.integrationId as never)
            && account.integrationId !== 'github',
        );
        if (activeAccounts.length === 0) return;

        // First, a top-level submenu per page/link to keep entries grouped.
        await createContextMenuItem({
            id: 'integration:root:page',
            parentId: 'page-parent',
            title: translate('contextMenu.sendToIntegration'),
            contexts: ['page', 'selection'],
        });
        await createContextMenuItem({
            id: 'integration:root:link',
            parentId: 'link-parent',
            title: translate('contextMenu.sendToIntegration'),
            contexts: ['link'],
        });

        for (const account of activeAccounts) {
            const entry = INTEGRATION_REGISTRY_MAP.get(account.integrationId as never);
            if (!entry) continue;
            const display = entry.display_name;
            const safeAccountId = account.accountId;
            // Save-to entries (page + link contexts).
            await createContextMenuItem({
                id: `integration:save:${account.integrationId}:${safeAccountId}`,
                parentId: 'integration:root:page',
                title: translate('contextMenu.saveToIntegration', { integration: display, account: account.accountLabel }),
                contexts: ['page', 'selection'],
            });
            await createContextMenuItem({
                id: `integration:save:${account.integrationId}:${safeAccountId}:link`,
                parentId: 'integration:root:link',
                title: translate('contextMenu.saveToIntegration', { integration: display, account: account.accountLabel }),
                contexts: ['link'],
            });
        }

        // Mirror entries removed — Save-to now auto-creates the mirror in
        // a single step (Batch 3 / page picker → create database → register
        // auto-sync). The "Stop mirroring" action lives in the in-app group
        // 3-dot menu, not in the page-level browser context menu.
    } catch (err) {
        console.warn('[BlueTab][Integrations] rebuildIntegrationContextMenus error', err);
    }
}

async function addExistingGroupsToLinkContextMenu() {
    await initI18n();
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const storedSettings = await Storage.get<Settings>('settings');
    const settings = { ...getDefaultSettings(), ...storedSettings };
    const groupLimit = getSafeContextMenuGroupLimit(settings.contextMenuGroupLimit);

    if (groups.length > 0) {
        await createContextMenuItem({
            id: 'link-existing-groups-parent',
            parentId: 'link-parent',
            title: translate('contextMenu.addLinkToExistingGroup'),
            contexts: ['link']
        });

        // Sort groups by modified date (most recent first) and apply limit
        const recentGroups = groups
            .sort((a, b) => b.modified - a.modified)
            .slice(0, groupLimit);

        for (const group of recentGroups) {
            const truncatedName = group.name.length > 25 ?
                group.name.substring(0, 25) + '...' :
                group.name;

            await createContextMenuItem({
                id: `add-link-to-group-${group.id}`,
                parentId: 'link-existing-groups-parent',
                title: `${truncatedName} (${group.tabs.length})`,
                contexts: ['link']
            });
        }
    }
}

async function addExistingGroupsToContextMenu() {
    await initI18n();
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const storedSettings = await Storage.get<Settings>('settings');
    const settings = { ...getDefaultSettings(), ...storedSettings };
    const groupLimit = getSafeContextMenuGroupLimit(settings.contextMenuGroupLimit);

    if (groups.length > 0) {
        // Page context - Add Tab to Existing Group
        await createContextMenuItem({
            id: 'existing-groups-parent',
            parentId: 'page-parent',
            title: translate('contextMenu.addTabToExistingGroup'),
            contexts: ['page']
        });

        // Sort groups by modified date (most recent first) and apply limit from settings
        const recentGroups = groups
            .sort((a, b) => b.modified - a.modified)
            .slice(0, groupLimit);

        for (const group of recentGroups) {
            const truncatedName = group.name.length > 25 ?
                group.name.substring(0, 25) + '...' :
                group.name;

            await createContextMenuItem({
                id: `add-this-to-group-${group.id}`,
                parentId: 'existing-groups-parent',
                title: `${truncatedName} (${group.tabs.length})`,
                contexts: ['page']
            });
        }
    }
}

// Add projects to context menu
async function addProjectsToContextMenu() {
    await initI18n();
    const projects = await Storage.getProjects();

    if (projects.length > 0) {
        // Page context - Save All Tabs to Project
        await createContextMenuItem({
            id: 'save-to-project-parent',
            parentId: 'page-parent',
            title: translate('contextMenu.addAllTabsToProject'),
            contexts: ['page']
        });

        for (const project of projects) {
            await createContextMenuItem({
                id: `save-all-to-project-${project.id}`,
                parentId: 'save-to-project-parent',
                title: project.name,
                contexts: ['page']
            });
        }

        // Link context - Save All Tabs to Project
        await createContextMenuItem({
            id: 'save-to-project-parent-link',
            parentId: 'link-parent',
            title: translate('contextMenu.addAllTabsToProject'),
            contexts: ['link']
        });

        for (const project of projects) {
            await createContextMenuItem({
                id: `save-all-to-project-link-${project.id}`,
                parentId: 'save-to-project-parent-link',
                title: project.name,
                contexts: ['link']
            });
        }
    }
}

// Save all tabs to a specific project
async function saveAllTabsToProject(projectId: string): Promise<void> {
    await initI18n();
    const result = await saveCurrentWindowTabs({ now: Date.now(), projectId });
    if (!result || result.processedCount === 0) return;

    await openBlueTabManagerIfEnabled();

    const project = (await Storage.getProjects()).find(p => p.id === projectId);
    try {
        await createBasicNotification(
            translate('notifications.savedToProject', {
                count: result.processedCount,
                project: project?.name || 'Unknown',
            }),
        );
    } catch (notificationError) {
        console.error('Notification error:', notificationError);
    }
}

async function addExistingGroupsToLinkContextMenuTabs() {
    await initI18n();
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const storedSettings = await Storage.get<Settings>('settings');
    const settings = { ...getDefaultSettings(), ...storedSettings };
    const groupLimit = getSafeContextMenuGroupLimit(settings.contextMenuGroupLimit);

    if (groups.length > 0) {
        // Link context - Add Tab to Existing Group
        await createContextMenuItem({
            id: 'existing-groups-parent-link',
            parentId: 'link-parent',
            title: translate('contextMenu.addTabToExistingGroup'),
            contexts: ['link']
        });

        const recentGroups = groups
            .sort((a, b) => b.modified - a.modified)
            .slice(0, groupLimit);

        for (const group of recentGroups) {
            const truncatedName = group.name.length > 25 ?
                group.name.substring(0, 25) + '...' :
                group.name;

            await createContextMenuItem({
                id: `add-this-to-group-link-${group.id}`,
                parentId: 'existing-groups-parent-link',
                title: `${truncatedName} (${group.tabs.length})`,
                contexts: ['link']
            });
        }
    }
}

// Helper function to process tabs according to settings
async function processTabsWithSettings(tabs: chrome.tabs.Tab[], _groupName: string): Promise<{ processedTabs: TabItem[], tabsToClose: chrome.tabs.Tab[] }> {
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const storedSettings = await Storage.get<Settings>('settings');
    const settings = { ...getDefaultSettings(), ...storedSettings };

    // Filter out extension pages and apply pinned tabs setting
    let filteredTabs = tabs.filter(tab =>
        tab.url &&
        !tab.url.startsWith('chrome-extension://') &&
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('edge://') &&
        !tab.url.startsWith('about:') &&
        !tab.url.startsWith('moz-extension://') &&
        tab.url !== 'about:blank'
    );

    // Apply pinned tabs filter
    if (settings.pinnedTabsMode === 'exclude') {
        filteredTabs = filteredTabs.filter(tab => !tab.pinned);
    }

    const tabItems: TabItem[] = filteredTabs.map(tab => ({
        id: crypto.randomUUID(),
        url: normalizeUrl(tab.url || ''),
        title: tab.title || '',
        favicon: tab.favIconUrl,
        timestamp: Date.now(),
        groupId: crypto.randomUUID(),
        pinned: tab.pinned
    }));

    // Apply duplicate filtering based on settings
    const filteredTabItems = filterDuplicatesBySettings(tabItems, groups, settings);
    const dedupedTabs = deduplicateTabs(filteredTabItems);

    return { processedTabs: dedupedTabs, tabsToClose: filteredTabs };
}

async function saveAllTabs(): Promise<void> {
    await initI18n();
    const result = await saveCurrentWindowTabs({ now: Date.now() });
    if (!result || result.processedCount === 0) return;

    await openBlueTabManagerIfEnabled();

    const parts: string[] = [];
    if (result.memoryRestoredCount > 0) {
        parts.push(translate('notifications.restoredViaMemory', { count: result.memoryRestoredCount }));
    }
    if (result.flowMatchedCount > 0) {
        parts.push(translate('notifications.savedViaFlow', { count: result.flowMatchedCount }));
    }
    if (result.defaultGroupedCount > 0) {
        parts.push(translate('notifications.savedToNewGroup', { count: result.defaultGroupedCount }));
    }
    if (parts.length === 0) {
        parts.push(translate('notifications.savedTabsFallback', { count: result.processedCount }));
    }

    try {
        await createBasicNotification(parts.join(' · '));
    } catch (notificationError) {
        console.error('Notification error:', notificationError);
    }
}

function buildSaveResultMessage(
    result: {
        processedCount: number;
        memoryRestoredCount: number;
        flowMatchedCount: number;
        defaultGroupedCount: number;
    },
    fallbackMessage?: string,
): string {
    const parts: string[] = [];
    if (result.memoryRestoredCount > 0) {
        parts.push(translate('notifications.restoredViaMemory', { count: result.memoryRestoredCount }));
    }
    if (result.flowMatchedCount > 0) {
        parts.push(translate('notifications.savedViaFlow', { count: result.flowMatchedCount }));
    }
    if (result.defaultGroupedCount > 0) {
        parts.push(translate('notifications.savedToNewGroup', { count: result.defaultGroupedCount }));
    }

    if (parts.length === 0) {
        return fallbackMessage ?? translate('notifications.savedTabsFallback', { count: result.processedCount });
    }

    return parts.join(' · ');
}

async function notifySaveResult(
    result: {
        processedCount: number;
        memoryRestoredCount: number;
        flowMatchedCount: number;
        defaultGroupedCount: number;
    },
    fallbackMessage?: string,
): Promise<void> {
    try {
        await initI18n();
        await createBasicNotification(buildSaveResultMessage(result, fallbackMessage));
    } catch (notificationError) {
        console.error('Notification error:', notificationError);
    }
}

async function restoreLastGroup(): Promise<void> {
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    if (groups.length === 0) return;

    const lastGroup = groups[groups.length - 1];
    for (const tab of lastGroup.tabs) {
        await chrome.tabs.create({ url: tab.url });
    }
}

async function saveThisTab(currentTab: chrome.tabs.Tab): Promise<void> {
    await initI18n();
    const groupName = translate('contextMenu.generatedGroups.singleTab', {
        title: String(currentTab.title),
    });
    const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
    const result = await saveBrowserTabsSelection({
        tabs: [currentTab],
        currentWindowTabs,
        defaultGroupName: groupName,
        now: Date.now(),
    });
    if (!result || result.processedCount === 0) return;

    await openBlueTabManagerIfEnabled();
    await notifySaveResult(result, translate('notifications.savedOneTab'));
}

async function saveTabsToRight(currentTab: chrome.tabs.Tab): Promise<void> {
    await initI18n();
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const currentIndex = currentTab.index;
    const tabsToRight = allTabs.filter(tab => tab.index > currentIndex);
    const groupName = translate('contextMenu.generatedGroups.tabsRight', {
        count: tabsToRight.length,
        time: formatTime(Date.now()),
    });
    const result = await saveBrowserTabsSelection({
        tabs: tabsToRight,
        currentWindowTabs: allTabs,
        defaultGroupName: groupName,
        now: Date.now(),
    });
    if (!result || result.processedCount === 0) return;

    await openBlueTabManagerIfEnabled();
    await notifySaveResult(result);
}

async function saveTabsToLeft(currentTab: chrome.tabs.Tab): Promise<void> {
    await initI18n();
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const currentIndex = currentTab.index;
    const tabsToLeft = allTabs.filter(tab => tab.index < currentIndex);
    const groupName = translate('contextMenu.generatedGroups.tabsLeft', {
        count: tabsToLeft.length,
        time: formatTime(Date.now()),
    });
    const result = await saveBrowserTabsSelection({
        tabs: tabsToLeft,
        currentWindowTabs: allTabs,
        defaultGroupName: groupName,
        now: Date.now(),
    });
    if (!result || result.processedCount === 0) return;

    await openBlueTabManagerIfEnabled();
    await notifySaveResult(result);
}

async function saveAllOtherTabs(currentTab: chrome.tabs.Tab): Promise<void> {
    await initI18n();
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const otherTabs = allTabs.filter(tab => tab.id !== currentTab.id);
    const groupName = translate('contextMenu.generatedGroups.allOtherTabs', {
        count: otherTabs.length,
        time: formatTime(Date.now()),
    });
    const result = await saveBrowserTabsSelection({
        tabs: otherTabs,
        currentWindowTabs: allTabs,
        defaultGroupName: groupName,
        now: Date.now(),
    });
    if (!result || result.processedCount === 0) return;

    await openBlueTabManagerIfEnabled();
    await notifySaveResult(result);
}

async function addCurrentTabToExistingGroup(currentTab: chrome.tabs.Tab, groupId: string): Promise<void> {
    try {
        const result = await addTabToExistingGroup(currentTab, groupId);
        if (!result) return;

        if (await shouldCloseTabsAfterSaving()) {
            const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
            await ensureManagerTabOpenBeforeClosing(currentWindowTabs, [currentTab]);
            if (currentTab.id) {
                await chrome.tabs.remove(currentTab.id);
            }
        }

        // Open BlueTab manager if enabled
        await openBlueTabManagerIfEnabled();

        // Show notification
        try {
            await createBasicNotification(
                translate('notifications.tabAddedToGroup', { group: result.targetGroup.name }),
            );
        } catch (notificationError) {
            console.error('Notification error:', notificationError);
        }
    } catch (error) {
        console.error('Error in addTabToExistingGroup:', error);
    }
}

void maybeBootstrapContextMenusOnWorkerStart();

async function addTabsToExistingGroup(currentTab: chrome.tabs.Tab, groupId: string, action: 'right' | 'left' | 'other' | 'all'): Promise<void> {
    try {
        const groups = await Storage.get<TabGroup[]>('groups') || [];
        const targetGroup = groups.find(group => group.id === groupId);

        if (!targetGroup) return;

        const allTabs = await chrome.tabs.query({ currentWindow: true });
        let tabsToAdd: chrome.tabs.Tab[] = [];

        switch (action) {
            case 'right':
                tabsToAdd = allTabs.filter(tab => tab.index > currentTab.index);
                break;
            case 'left':
                tabsToAdd = allTabs.filter(tab => tab.index < currentTab.index);
                break;
            case 'other':
                tabsToAdd = allTabs.filter(tab => tab.id !== currentTab.id);
                break;
            case 'all':
                tabsToAdd = allTabs;
                break;
        }

        const { processedTabs, tabsToClose } = await processTabsWithSettings(tabsToAdd, targetGroup.name);

        if (processedTabs.length === 0) return;

        // Update the target group
        const updatedGroups = groups.map(group => {
            if (group.id === groupId) {
                return {
                    ...group,
                    tabs: [...group.tabs, ...processedTabs.map(tab => ({ ...tab, groupId }))],
                    modified: Date.now()
                };
            }
            return group;
        });

        await Storage.set('groups', updatedGroups);

        if (await shouldCloseTabsAfterSaving()) {
            await ensureManagerTabOpenBeforeClosing(allTabs, tabsToClose);
            const tabIdsToClose = tabsToClose.map(tab => tab.id).filter(id => id !== undefined) as number[];
            if (tabIdsToClose.length > 0) {
                await chrome.tabs.remove(tabIdsToClose);
            }
        }

        // Open BlueTab manager if enabled
        await openBlueTabManagerIfEnabled();

        // Show notification
        try {
            await createBasicNotification(
                translate('notifications.tabsAddedToGroup', {
                    count: processedTabs.length,
                    group: targetGroup.name,
                }),
            );
        } catch (notificationError) {
            console.error('Notification error:', notificationError);
        }
    } catch (error) {
        console.error('Error in addTabsToExistingGroup:', error);
    }
}

/**
 * Opens a BlueTab extension page ensuring only one instance exists.
 * If the page is already open, focuses it. Otherwise, creates a new tab.
 * Also closes any duplicate tabs of the same page.
 */
async function openBlueTabPage(pagePath: string): Promise<void> {
    const pageUrl = chrome.runtime.getURL(pagePath);

    // Check if this page is already open
    const existingTabs = await chrome.tabs.query({ url: pageUrl });

    if (existingTabs.length > 0) {
        // Page exists, focus the first one
        const existingTab = existingTabs[0];
        await chrome.tabs.update(existingTab.id!, { active: true });
        await chrome.windows.update(existingTab.windowId!, { focused: true });

        // Close any duplicate tabs (keep only the first one)
        if (existingTabs.length > 1) {
            const duplicateIds = existingTabs.slice(1).map(t => t.id!).filter(id => id !== undefined);
            if (duplicateIds.length > 0) {
                await chrome.tabs.remove(duplicateIds);
                console.log(`[BlueTab] Closed ${duplicateIds.length} duplicate tabs of ${pagePath}`);
            }
        }
    } else {
        // Page doesn't exist, create one
        await chrome.tabs.create({ url: pageUrl });
    }
}

async function openBlueTabManager(): Promise<void> {
    await openBlueTabPage('src/options/index.html');
}

/**
 * Opens BlueTab manager only if the setting is enabled.
 * Used after save operations to respect user preference.
 */
async function openBlueTabManagerIfEnabled(): Promise<void> {
    const settings = await Storage.getSettings();
    if (settings.openManagerAfterSave !== false) {
        await openBlueTabManager();
    }
}

async function saveLinkToNewGroup(linkUrl: string, linkText: string): Promise<void> {
    try {
        // Validate URL
        if (!isValidTabUrl(linkUrl)) {
            console.warn('[BlueTab][Security] Blocked dangerous link URL:', linkUrl.substring(0, 50));
            return;
        }
        const result = await saveLinkToBlueTab({
            linkUrl,
            linkText,
            now: Date.now(),
        });
        if (!result || result.processedCount === 0) return;

        await openBlueTabManagerIfEnabled();
        await notifySaveResult(result, translate('notifications.savedLink'));
    } catch (error) {
        console.error('Error saving link:', error);
    }
}

async function addLinkToExistingGroup(linkUrl: string, groupId: string): Promise<void> {
    try {
        // Validate URL
        if (!isValidTabUrl(linkUrl)) {
            console.warn('[BlueTab][Security] Blocked dangerous link URL:', linkUrl.substring(0, 50));
            return;
        }

        const groups = await Storage.get<TabGroup[]>('groups') || [];
        const targetGroup = groups.find(group => group.id === groupId);

        if (!targetGroup) return;

        // Apply settings for duplicate handling
        const storedSettings = await Storage.get<Settings>('settings');
        const settings = { ...getDefaultSettings(), ...storedSettings };

        const newTabItem: TabItem = {
            id: crypto.randomUUID(),
            url: normalizeUrl(linkUrl),
            title: linkUrl, // Use URL as title since we don't have the link text
            favicon: undefined,
            timestamp: Date.now(),
            groupId: groupId
        };

        // Check for duplicates if setting is enabled
        if (settings.duplicateHandling === 'reject') {
            const isDuplicate = targetGroup.tabs.some(tab =>
                normalizeUrl(tab.url) === normalizeUrl(newTabItem.url)
            );
            if (isDuplicate) {
                return; // Silently reject duplicate
            }
        }

        // Add link to the target group
        const updatedGroups = groups.map(group => {
            if (group.id === groupId) {
                return {
                    ...group,
                    tabs: [...group.tabs, newTabItem],
                    modified: Date.now()
                };
            }
            return group;
        });

        await Storage.set('groups', updatedGroups);
        await openBlueTabManagerIfEnabled();

        // Show notification
        try {
            await createBasicNotification(
                translate('notifications.linkAddedToGroup', { group: targetGroup.name }),
            );
        } catch (notificationError) {
            console.error('Notification error:', notificationError);
        }
    } catch (error) {
        console.error('Error adding link to group:', error);
    }
}
