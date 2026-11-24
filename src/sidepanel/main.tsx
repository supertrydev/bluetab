import { GroupMemoryNotice } from '@/components/GroupMemoryNotice';
import { StrictMode, Suspense, lazy, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeManager } from '../utils/theme';
import { Storage } from '../utils/storage';
import { textSizeService } from '../utils/TextSizeService';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { TabsPanel } from './components/TabsPanel';
import { SidepanelHeader } from './components/SidepanelHeader';
import { GroupsPanel } from './components/GroupsPanel';
import { PomodoroBar } from './components/PomodoroBar';
import { WrappedService } from '../services/wrapped-service';
import { BrainDumpService } from '@/services/brain-dump-service';
import { useSimplifyMode } from '@/hooks/useSimplifyMode';
import { ENABLE_WRAPPED } from '@/config/feature-flags';
import { saveCurrentWindowTabsFromSidepanel } from './save-current-window-tabs';
import { Loader2, PanelTop, Layers, Sparkles, Gift, Users, StickyNote } from 'lucide-react';
import { Toaster, toast } from '@/components/Toast';
import { LocaleDirectionProvider } from '@/components/LocaleDirectionProvider';
import { getLanguageDirection, initI18n, setDocumentTitle } from '@/i18n';
import { useTranslation } from 'react-i18next';
// Plan 14-07 — INTEG-07. Reauth banner mounted above the sidepanel so any
// 401 from any integration during AI tool calls / sidepanel buttons /
// auto-sync surfaces a Reconnect affordance without forcing the user into
// Settings → Integrations to fix it.
import { IntegrationReauthBanner } from '../settings/components/integrations/IntegrationReauthBanner';
import { PanelErrorBoundary, importWithRetry } from './components/PanelErrorBoundary';
import '../styles/pin-indicators.css';
import '../styles/tailwind.css';
import '../styles/aui-overrides.css';

const SIDEPANEL_TAB_KEY = 'sidepanelActiveTab';
// Lazy tabs retry a failed chunk import once; PanelErrorBoundary handles
// the rest (stale chunk after a rebuild reloads the panel once).
const AIPanel = lazy(importWithRetry(() => import('./components/AIPanel').then((mod) => ({ default: mod.AIPanel }))));
const TeamsPanel = lazy(importWithRetry(() => import('./components/TeamsPanel').then((mod) => ({ default: mod.TeamsPanel }))));
const BrainDumpPanel = lazy(importWithRetry(() => import('./components/BrainDumpPanel').then((mod) => ({ default: mod.BrainDumpPanel }))));

function PanelFallback() {
    const { t } = useTranslation();

    return (
        <div
            className="h-full flex items-center justify-center px-4"
            role="status"
            aria-live="polite"
        >
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-1/70 px-3 py-2 text-xs text-muted-foreground shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>{t('labels.loadingPanel')}</span>
            </div>
        </div>
    );
}

function SidePanel() {
    const { t, i18n } = useTranslation();
    const direction = getLanguageDirection(i18n.resolvedLanguage ?? i18n.language);
    const [activeTab, setActiveTab] = useState<string>('tabs');
    const [isSeasonalWindow, setIsSeasonalWindow] = useState(false);
    // Brain Dump is default-on and first-class. When a user disables it,
    // the tab bar hides the Dump trigger and its content panel.
    const [brainDumpActive, setBrainDumpActive] = useState(true);

    // Phase 9 Plan 09-04 — flip data-simplify / data-simplify-aggressive on
    // <html> based on ADHD Mode settings so simplify.css cascades across
    // the sidepanel surface.
    useSimplifyMode();

    // Load persisted tab on mount and check seasonal window
    useEffect(() => {
        const loadActiveTab = async () => {
            const savedTab = await Storage.get<string>(SIDEPANEL_TAB_KEY);
            if (savedTab) {
                setActiveTab(savedTab);
            }
        };
        loadActiveTab();
        setIsSeasonalWindow(ENABLE_WRAPPED && WrappedService.isSeasonalWindowOpen());
    }, []);

    // Listen for theme changes from settings
    useEffect(() => {
        const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.settings) {
                const newSettings = changes.settings.newValue;
                if (newSettings?.theme) {
                    ThemeManager.applyTheme(newSettings.theme);
                }
            }
        };
        chrome.storage.local.onChanged.addListener(listener);
        return () => chrome.storage.local.onChanged.removeListener(listener);
    }, []);

    // Phase 9 — Brain Dump restricted-page toast listener.
    // The service worker broadcasts this action when the user fires the
    // brain-dump shortcut on a chrome:// / chrome-extension:// / view-source: /
    // chromewebstore.google.com tab (content-script injection is not allowed
    // there). Any open Bluetab surface picks it up; the sidepanel is the
    // most reliable listener because it's often already open.
    useEffect(() => {
        const listener = (
            message: { action?: string; message?: string; type?: string; integrationId?: string; tab?: string },
        ): boolean => {
            if (message?.action === 'brain-dump:restricted-toast' && message.message) {
                toast.info(message.message);
            }
            // Plan 14-07 — INTEG-12 broadcast from context menu.
            // The SW emits OPEN_GROUP_MIRROR_PICKER without a groupId because
            // a page/link context menu has no group binding. Direct the user
            // to the group menu where the picker has full context.
            if (message?.type === 'OPEN_GROUP_MIRROR_PICKER') {
                toast.info({ key: 'feedback.groupMirrorSetupHint' });
                setActiveTab('groups');
                Storage.set(SIDEPANEL_TAB_KEY, 'groups');
            }
            // Floating-button note bubble: jump to the Dump tab.
            if (message?.type === 'SIDEPANEL_SHOW_TAB' && message.tab === 'dump') {
                setActiveTab('dump');
            }
            return false;
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    // Track whether Brain Dump is active so the tab bar renders 4 or 5 tabs.
    useEffect(() => {
        let cancelled = false;
        BrainDumpService.isEnabled().then((active) => {
            if (!cancelled) {
                setBrainDumpActive(active);
                if (!active) {
                    setActiveTab((current) => (current === 'dump' ? 'tabs' : current));
                }
            }
        });

        const unsubscribe = BrainDumpService.subscribePrefs((prefs) => {
            const active = prefs.enabled !== false;
            if (!cancelled) {
                setBrainDumpActive(active);
                // If the feature flipped off while the user was viewing the
                // Dump tab, bounce them back to Tabs.
                if (!active) {
                    setActiveTab((current) => (current === 'dump' ? 'tabs' : current));
                }
            }
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, []);

    // Save tab when it changes
    const handleTabChange = async (value: string) => {
        setActiveTab(value);
        await Storage.set(SIDEPANEL_TAB_KEY, value);
    };

    const handleSaveAllTabs = async () => {
        try {
            await saveCurrentWindowTabsFromSidepanel();
        } catch (err) {
            console.error('Failed to save tabs:', err);
        }
    };

    const handleOpenManager = () => {
        chrome.runtime.sendMessage({ type: 'OPEN_BLUETAB_PAGE', pagePath: 'src/options/index.html' });
    };

    const handleOpenWrapped = () => {
        if (!ENABLE_WRAPPED) return;
        const optionsUrl = chrome.runtime.getURL('src/options/index.html#wrapped');
        chrome.tabs.create({ url: optionsUrl, active: true });
    };

    return (
        <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
            {/* Header with Logo + Actions + Tabs */}
            <div className="sticky top-0 z-10 backdrop-blur-md bg-bg-0/80 border-b border-border-glass px-3 py-2">
                <SidepanelHeader
                    onSaveAllTabs={handleSaveAllTabs}
                    onOpenManager={handleOpenManager}
                />
                {/* Plan 14-07 — INTEG-07. Reauth banner above the tab bar so any
                    integration 401 surfaces a Reconnect button without forcing
                    the user into Settings. Renders nothing when no integration
                    has the integration_reauth_required flag set. */}
                <IntegrationReauthBanner />
                <PomodoroBar />
                {ENABLE_WRAPPED && isSeasonalWindow && (
                    <button
                        onClick={handleOpenWrapped}
                        className="flex items-center gap-2 w-full mt-2 px-3 py-2 rounded-full bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-300 text-xs font-semibold transition-colors hover-lift"
                    >
                        <Gift className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{t('sidepanel.wrappedReady')}</span>
                        <span className="ms-auto h-2 w-2 rounded-full bg-warning animate-pulse flex-shrink-0" />
                    </button>
                )}
                <div className="pb-2" />
                {/*
                 * Post-ship iteration — when Brain Dump is active, the bar
                 * hosts 5 tabs which causes "Teams" to truncate in the
                 * narrow sidepanel. In that mode we render icons only and
                 * expose the label via `title` + `aria-label` so screen
                 * readers and tooltips still carry the semantics.
                 */}
                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                    <TabsList className="w-full">
                        <TabsTrigger
                            value="tabs"
                            className="flex-1 gap-1.5"
                            aria-label={t('sidepanel.tabs')}
                            title={t('sidepanel.tabs')}
                        >
                            <PanelTop className="w-4 h-4" />
                            {!brainDumpActive && <span>{t('sidepanel.tabs')}</span>}
                        </TabsTrigger>
                        <TabsTrigger
                            value="groups"
                            className="flex-1 gap-1.5"
                            aria-label={t('sidepanel.groups')}
                            title={t('sidepanel.groups')}
                        >
                            <Layers className="w-4 h-4" />
                            {!brainDumpActive && <span>{t('sidepanel.groups')}</span>}
                        </TabsTrigger>
                        <TabsTrigger
                            value="ai"
                            className="flex-1 gap-1.5"
                            aria-label={t('settingsTabs.ai')}
                            title={t('settingsTabs.ai')}
                        >
                            <Sparkles className="w-4 h-4" />
                            {!brainDumpActive && <span>{t('settingsTabs.ai')}</span>}
                        </TabsTrigger>
                        {brainDumpActive && (
                            <TabsTrigger
                                value="dump"
                                className="flex-1 gap-1.5"
                                aria-label={t('sidepanel.brainDump')}
                                title={t('sidepanel.brainDump')}
                            >
                                <StickyNote className="w-4 h-4" />
                            </TabsTrigger>
                        )}
                        <TabsTrigger
                            value="teams"
                            className="flex-1 gap-1.5"
                            aria-label={t('sidepanel.teams')}
                            title={t('sidepanel.teams')}
                        >
                            <Users className="w-4 h-4" />
                            {!brainDumpActive && <span>{t('sidepanel.teams')}</span>}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {/* Content - flex-1 with min-h-0 ensures proper height constraint for scrollable children */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <Tabs value={activeTab} className="h-full flex flex-col">
                    <TabsContent value="tabs" className="mt-0 flex-1 min-h-0 overflow-hidden p-2">
                        <PanelErrorBoundary panel="tabs">
                            <TabsPanel />
                        </PanelErrorBoundary>
                    </TabsContent>
                    <TabsContent value="groups" className="mt-0 flex-1 min-h-0 overflow-hidden">
                        <PanelErrorBoundary panel="groups">
                            <GroupsPanel />
                        </PanelErrorBoundary>
                    </TabsContent>
                    <TabsContent value="ai" className="mt-0 flex-1 min-h-0 overflow-hidden">
                        <PanelErrorBoundary panel="ai">
                            <Suspense fallback={<PanelFallback />}>
                                <AIPanel />
                            </Suspense>
                        </PanelErrorBoundary>
                    </TabsContent>
                    {brainDumpActive && (
                        <TabsContent value="dump" className="mt-0 flex-1 min-h-0 overflow-hidden">
                            <PanelErrorBoundary panel="dump">
                                <Suspense fallback={<PanelFallback />}>
                                    <BrainDumpPanel />
                                </Suspense>
                            </PanelErrorBoundary>
                        </TabsContent>
                    )}
                    <TabsContent value="teams" className="mt-0 flex-1 min-h-0 overflow-hidden">
                        <PanelErrorBoundary panel="teams">
                            <Suspense fallback={<PanelFallback />}>
                                <TeamsPanel />
                            </Suspense>
                        </PanelErrorBoundary>
                    </TabsContent>
                </Tabs>
            </div>
            <GroupMemoryNotice />
            <Toaster richColors position={direction === 'rtl' ? 'bottom-left' : 'bottom-right'} />
        </div>
    );
}

async function mountSidepanel(): Promise<void> {
    await initI18n();
    setDocumentTitle('document.sidepanelTitle');
    ThemeManager.initializeTheme();

    try {
        await textSizeService.initialize();
    } catch (error) {
        console.error('Failed to initialize text size service:', error);
    }

    const root = document.getElementById('root');
    if (!root) {
        return;
    }

    createRoot(root).render(
        <StrictMode>
            <LocaleDirectionProvider>
                {/* Outer boundary: a crash in the header or tab bar still
                    leaves a recovery card instead of a blank panel. */}
                <PanelErrorBoundary panel="shell">
                    <SidePanel />
                </PanelErrorBoundary>
            </LocaleDirectionProvider>
        </StrictMode>
    );
}

void mountSidepanel();
