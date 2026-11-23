import { shouldShowGroupMemoryNotice, showGroupMemoryNotice } from '@/services/group-memory-notice';
import { consumeManagerWelcome } from '@/services/manager-welcome';
import { ManagerWelcome } from './components/ManagerWelcome';
import { GroupMemoryNotice } from '@/components/GroupMemoryNotice';
import { deleteGroupsWithUndo } from '@/services/group-deletion';
import { createBrowserTabGroup } from '@/platform/create-browser-tab-group';
import { useState, useEffect, useMemo, useCallback, useTransition } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { Storage } from '../utils/storage';
import { getDefaultSettings } from '../utils/sorting';
import { ThemeManager } from '../utils/theme';
import { textSizeService } from '../utils/TextSizeService';
import { ToastManager } from '../components/Toast';
import { CWSReviewPrompt } from '../components/CWSReviewPrompt';
import { Toaster, toast } from '@/components/Toast';
import { LocaleDirectionProvider } from '@/components/LocaleDirectionProvider';
import { initI18n, setDocumentTitle, t as translate } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { useDirection } from '@radix-ui/react-direction';
import { AIAllowanceService, formatAllowancePercent } from '../services/ai-allowance-service';
import { AIGroupOrganizerService } from '../services/ai-group-organizer';
import { OfflineReadingService } from '../services/offline-reading-service';
import type { OfflineArticle, OfflineFailureRecord } from '../types/offline-reading';
import { migrateFromPersistentState, loadCollapsedStates, saveGroupState, removeGroupState, cleanupOrphanedStates } from '../utils/collapsed-state';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import { recordGroupActivity } from '../utils/group-activity';
import usePinManagement from '../hooks/usePinManagement';
import { AppSidebar } from '../components/app-sidebar';
import { Button } from '../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../components/ui/dialog';
import { useAINotice } from '../components/ai/AINoticeDialog';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '../components/ui/sidebar';
import { Separator } from '../components/ui/separator';
import { TabSelectionProvider, useTabSelectionContext } from '../contexts/TabSelectionContext';
import { TabSelectionToolbar } from '../components/TabSelectionToolbar';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useClickOutside } from '../hooks/useClickOutside';
import { useAuth } from '../components/auth/useAuth';
import { BluetBridgeService } from '../services/bluet-bridge-service';
import { CWSReviewPromptService } from '../services/cws-review-prompt-service';
import { saveCurrentWindowTabs, saveSuspendedTabsFromCurrentWindow } from '../services/save-current-window-tabs';
import { useSimplifyMode } from '@/hooks/useSimplifyMode';
import type { TabGroup, Tag, Settings, Project } from '../types/models';
import type { BluetSharedRef } from '../types/bluet';
import { bluetErrorMessage } from '../components/bluet/bluet-error-message';
import type { ActivePage } from '../components/app-sidebar';
import type { OrganizePreview, OrganizeProgress } from '../services/ai-group-organizer';

// Extracted components
import { StatsDashboard } from './components/StatsDashboard';
import { HelpPage } from './components/HelpPage';
import { GroupListView } from './components/GroupListView';
import { NotesModal } from './components/NotesModal';
import { DeleteConfirmModal } from './components/DeleteConfirmModal';
import { TagManagerModal } from './components/TagManagerModal';
import { useArchivePanel } from './components/ArchivePanel';
import { useBulkEditToolbar } from './components/BulkEditToolbar';
import { useDragDrop } from './components/DragDropOverlay';
import { useProjectPanel } from './components/ProjectPanel';
import { BluetShareSuccessModal } from './components/BluetShareSuccessModal';
import { OfflineReadingPage } from './components/OfflineReadingPage';
import { WrappedExperience } from './components/WrappedExperience';
import { PastWrappedSection } from './components/PastWrappedSection';
import { WrappedService } from '../services/wrapped-service';
import { ENABLE_READINGS, ENABLE_WRAPPED } from '../config/feature-flags';

import '../styles/tailwind.css';
import '../styles/pin-indicators.css';
import '../styles/options-layout.css';

const ORGANIZE_WARNING_ACK_KEY = 'ai_organize_warning_ack';

// Wrapper component that provides TabSelectionContext
function TabManager() {
    const [groups, setGroups] = useState<TabGroup[]>([]);

    return (
        <TabSelectionProvider groups={groups}>
            <TabManagerContent groups={groups} setGroups={setGroups} />
        </TabSelectionProvider>
    );
}

interface TabManagerContentProps {
    groups: TabGroup[];
    setGroups: React.Dispatch<React.SetStateAction<TabGroup[]>>;
}

function TabManagerContent({ groups, setGroups }: TabManagerContentProps) {
    const direction = useDirection();
    const [welcomeKind, setWelcomeKind] = useState<'sample' | 'existing' | null>(null);
    // Phase 9 Plan 09-04 — Simplify Mode attribute wiring for Options shell.
    useSimplifyMode();

    const [tags, setTags] = useState<Tag[]>([]);
    const [settings, setSettings] = useState<Settings>(getDefaultSettings());
    const [collapsedGroups, setCollapsedGroups] = useState<Map<string, boolean>>(new Map());
    const [_isStateLoaded, setIsStateLoaded] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState<boolean | null>(null);

    // Active page state for in-shell navigation — read hash on mount
    const [activePage, setActivePage] = useState<ActivePage>(() => {
        const hash = window.location.hash.replace(/^#/, '');
        const validPages: ActivePage[] = [
            'groups',
            'statistics',
            'help',
            'feeds',
            'flow',
            'settings',
            'account',
            ...(ENABLE_WRAPPED ? ['wrapped' as const] : []),
            ...(ENABLE_READINGS ? ['offline-reading' as const] : []),
        ];
        // Handle hash with query params like "#offline-reading?articleUrl=..."
        const pagePart = hash.split('?')[0] as ActivePage;
        return validPages.includes(pagePart) ? pagePart : 'groups';
    });

    // Parse initialArticleUrl from hash when offline-reading route is active
    // e.g. #offline-reading?articleUrl=https%3A%2F%2Fexample.com
    const initialArticleUrl = (() => {
        if (!ENABLE_READINGS) return null;
        const hash = window.location.hash.replace(/^#/, '');
        if (!hash.startsWith('offline-reading')) return null;
        const qIdx = hash.indexOf('?');
        if (qIdx < 0) return null;
        const params = new URLSearchParams(hash.slice(qIdx + 1));
        const raw = params.get('articleUrl');
        return raw ? decodeURIComponent(raw) : null;
    })();

    useEffect(() => {
        if (activePage === 'feeds') {
            window.location.replace(chrome.runtime.getURL('src/feeds/index.html'));
        }
    }, [activePage]);

    // Project state
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
        const hash = window.location.hash;
        if (hash.startsWith('#project=')) {
            return hash.replace('#project=', '');
        }
        return null;
    });
    const [, startPageTransition] = useTransition();

    const navigateToPage = useCallback((page: ActivePage, options: { clearProject?: boolean } = {}) => {
        startPageTransition(() => {
            if (options.clearProject) {
                setActiveProjectId(null);
            }
            setActivePage(page);
        });
    }, [startPageTransition]);

    const navigateToProject = useCallback((projectId: string | null) => {
        startPageTransition(() => {
            setActiveProjectId(projectId);
            if (projectId) {
                setActivePage('groups');
            }
        });
    }, [startPageTransition]);

    // Notes modal state
    const [notesModalGroupId, setNotesModalGroupId] = useState<string | null>(null);

    // Delete modal state
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteModalType, setDeleteModalType] = useState<'group' | 'selected' | 'tag'>('group');
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    // Tag modal state
    const [showTagModal, setShowTagModal] = useState(false);
    const [tagModalGroupId, setTagModalGroupId] = useState<string | null>(null);

    // Wrapped overlay state
    const [wrappedOverlay, setWrappedOverlay] = useState<{ year: number } | null>(null);
    const [wrappedBadgeVisible] = useState(() => ENABLE_WRAPPED && WrappedService.isSeasonalWindowOpen());

    const openWrapped = (year: number) => {
        if (!ENABLE_WRAPPED) return;
        setWrappedOverlay({ year });
    };

    // Handle #wrapped URL hash: auto-open Wrapped on mount if hash present
    useEffect(() => {
        if (window.location.hash === '#wrapped') {
            history.replaceState(null, '', window.location.pathname + window.location.search);
            if (ENABLE_WRAPPED) {
                openWrapped(WrappedService.getWrappedYear());
            }
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Bluet share success modal state
    const [bluetShareModal, setBluetShareModal] = useState<{
        group: TabGroup | null;
        bluetUrl: string;
        isUpdate: boolean;
    } | null>(null);

    // Auth & Bluet Bridge
    const { isPro } = useAuth();
    const [bluet_sharedRefs, setBluetSharedRefs] = useState<BluetSharedRef[]>([]);
    const [organizePreview, setOrganizePreview] = useState<OrganizePreview | null>(null);
    const [organizeWarningOpen, setOrganizeWarningOpen] = useState(false);
    const [organizeProgressOpen, setOrganizeProgressOpen] = useState(false);
    const [organizeAllowanceLabel, setOrganizeAllowanceLabel] = useState<string | null>(null);
    const [organizeProgress, setOrganizeProgress] = useState<OrganizeProgress | null>(null);
    const [organizeRunning, setOrganizeRunning] = useState(false);
    const [organizeFailureMessage, setOrganizeFailureMessage] = useState<string | null>(null);
    const { showNoticeOnce: showAINoticeOnce, noticeDialog: aiNoticeDialog } = useAINotice();
    const [reviewPromptOpen, setReviewPromptOpen] = useState(false);
    const organizePhaseLabels = {
        analyzing: translate('options.manager.organizeProgress.phases.analyzing'),
        organizing: translate('options.manager.organizeProgress.phases.organizing'),
        applying: translate('options.manager.organizeProgress.phases.applying'),
    } as const;

    const maybeShowReviewPrompt = useCallback(async () => {
        if (reviewPromptOpen) return;
        try {
            const decision = await CWSReviewPromptService.evaluateAfterValueAction();
            if (decision.shouldShow) {
                setReviewPromptOpen(true);
            }
        } catch (error) {
            console.warn('Failed to evaluate Chrome Web Store review prompt:', error);
        }
    }, [reviewPromptOpen]);

    useEffect(() => {
        BluetBridgeService.getSharedRefs().then(setBluetSharedRefs);
    }, []);

    useEffect(() => {
        Storage.get<boolean>('bluetab_sidebar_open').then((saved) => {
            setSidebarOpen(saved ?? true);
        });
    }, []);

    // Pin management
    const pinManagement = usePinManagement(groups);

    // Tab selection from context
    const tabSelection = useTabSelectionContext();
    const { state: { isSelectionMode: tabSelectionMode }, exitSelectionMode } = tabSelection;

    useEscapeKey({ enabled: tabSelectionMode, onEscape: exitSelectionMode });
    useClickOutside({ enabled: tabSelectionMode, onClickOutside: exitSelectionMode });

    // --- Extracted hooks ---

    const archive = useArchivePanel({ groups, setGroups });

    const dragDrop = useDragDrop({ groups, setGroups, bluet_sharedRefs });

    const bulkEdit = useBulkEditToolbar({
        groups,
        setGroups,
        tags,
        projects,
        filteredGroupIds: groups.map(g => g.id),
        bluet_sharedRefs,
        onArchiveSelected: (groupIds) => archive.openArchiveForGroups(groupIds),
        onDeleteSelected: (selectedGroups) => {
            const lockedGroups = groups.filter(g => selectedGroups.has(g.id) && g.locked);
            if (lockedGroups.length > 0) {
                ToastManager.getInstance().warning(
                    translate('options.manager.cannotDeleteLockedGroups', { count: lockedGroups.length })
                );
                return;
            }
            setDeleteModalType('selected');
            setDeleteTarget(`${selectedGroups.size}`);
            setShowDeleteModal(true);
        },
        onSaveOfflineSelected: ENABLE_READINGS ? (groupIds) => { void handleSaveOfflineSelected(groupIds); } : undefined,
    });

    const projectPanel = useProjectPanel({
        groups,
        setGroups,
        projects,
        setProjects,
        activeProjectId,
        setActiveProjectId,
        saveAllTabs,
    });

    // --- Initialization ---

    const loadCollapsedState = useCallback(async (currentGroups?: TabGroup[]) => {
        try {
            const allStates = await loadCollapsedStates();
            setCollapsedGroups(allStates);
            if (currentGroups) {
                const validIds = new Set(currentGroups.map(g => g.id));
                await cleanupOrphanedStates(validIds);
            }
            setIsStateLoaded(true);
        } catch (error) {
            console.error('Failed to load collapsed state:', error);
            setIsStateLoaded(true);
        }
    }, []);

    const loadGroups = useCallback(async () => {
        const stored = await Storage.get<TabGroup[]>('groups') || [];
        const storedTags = await Storage.get<Tag[]>('tags') || [];
        const storedProjects = await Storage.getProjects();
        const migratedGroups = await Storage.migrateExistingGroups(stored);
        const storedSettings = await Storage.get<Settings>('settings');
        const defaultSettings = getDefaultSettings();

        setProjects(storedProjects);

        const mergedSettings = { ...defaultSettings, ...storedSettings };
        ThemeManager.initializeTheme(mergedSettings);

        if (JSON.stringify(storedSettings) !== JSON.stringify(mergedSettings)) {
            await Storage.set('settings', mergedSettings);
        }

        setGroups(migratedGroups);
        setTags(storedTags);
        setSettings(mergedSettings);
        await loadCollapsedState(migratedGroups);
    }, [setGroups, loadCollapsedState]);

    const initializeApp = useCallback(async () => {
        try {
            await textSizeService.initialize();
        } catch (error) {
            console.error('Failed to initialize text size service:', error);
        }

        try {
            await migrateFromPersistentState();
        } catch (error) {
            console.error('Migration failed (non-critical):', error);
        }

        const welcome = await consumeManagerWelcome();
        if (welcome) setWelcomeKind(welcome);
        await loadGroups();
    }, [loadGroups]);

    useEffect(() => {
        void initializeApp();

        const handleStorageChange = async (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.groups) {
                const newGroups = changes.groups.newValue || [];
                const migratedGroups = await Storage.migrateExistingGroups(newGroups);
                setGroups(migratedGroups);
                const validIds = new Set(migratedGroups.map(g => g.id));
                await cleanupOrphanedStates(validIds);
            }
            if (changes.tags) {
                setTags(changes.tags.newValue || []);
            }
            if (changes.pinSettings) {
                await loadGroups();
            }
            if (changes.settings) {
                const newSettings = changes.settings.newValue || getDefaultSettings();
                setSettings(newSettings);
            }
            if (changes.collapsedGroups) {
                const newCollapsedGroups = changes.collapsedGroups.newValue || {};
                setCollapsedGroups(new Map(Object.entries(newCollapsedGroups)));
            }
            if (changes.layoutMode) {
                // Layout mode is now managed by GroupListView
            }
            if (changes.projects) {
                setProjects(changes.projects.newValue || []);
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);
        return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }, [initializeApp, loadGroups, setGroups]);

    // --- Offline Reading state ---

    const [offlineArticles, setOfflineArticles] = useState<OfflineArticle[]>([]);
    const [offlineInFlight, setOfflineInFlight] = useState<Set<string>>(new Set());
    const [offlineFailures, setOfflineFailures] = useState<Map<string, OfflineFailureRecord>>(new Map());

    useEffect(() => {
        if (!ENABLE_READINGS) return;
        void OfflineReadingService.getAllArticles().then(setOfflineArticles);
        const unsubscribe = OfflineReadingService.subscribeExtractionStatus(snap => {
            void OfflineReadingService.getAllArticles().then(setOfflineArticles);
            setOfflineInFlight(new Set(snap.inFlight));
            const fmap = new Map<string, OfflineFailureRecord>();
            for (const f of snap.failures) fmap.set(f.id, f);
            setOfflineFailures(fmap);
        });
        return unsubscribe;
    }, []);

    const offlineArticlesMap = useMemo(() => {
        const m = new Map<string, OfflineArticle>();
        for (const a of offlineArticles) m.set(a.id, a);
        return m;
    }, [offlineArticles]);

    function offlineStateForGroup(groupId: string, totalTabs: number): 'none' | 'partial' | 'all' {
        // Failures are no longer persisted in IDB; every article here is a
        // successful extraction. Comparing against totalTabs still gives the
        // 'partial' state when extraction is still in progress.
        const count = offlineArticles.filter(a => a.groupId === groupId).length;
        if (count === 0) return 'none';
        if (count >= totalTabs) return 'all';
        return 'partial';
    }

    async function showDisclosureIfNeeded(): Promise<void> {
        const res = await chrome.storage.local.get('offline_disclosure_shown');
        if (res?.offline_disclosure_shown) return;
        toast.message(translate('options.manager.offlineDisclosureTitle'), {
            description: translate('options.manager.offlineDisclosureDescription'),
            duration: 6000,
        });
        await chrome.storage.local.set({ offline_disclosure_shown: true });

        // RESEARCH.md Pitfall 6 — belt-and-suspenders: request persistent storage on
        // first offline save. unlimitedStorage + persist() are independent mechanisms.
        // Fire-and-forget; do NOT block UX on the result.
        void navigator.storage.persist()
            .then((ok) => { console.debug('[BlueTab][OfflineReading] persist():', ok); })
            .catch((err) => { console.debug('[BlueTab][OfflineReading] persist() rejected:', err); });
    }

    // Shared helper: wire subscribeExtractionStatus to a single sonner toast that
    // updates live during the batch. CONTEXT.md-locked behavior: the toast must
    // auto-update ('Saving K/N') as snapshots arrive, then resolve to success.
    function startOfflineProgressToast(toastId: string, batchId: string, total: number): () => void {
        toast.loading(translate('options.manager.offlineSavingProgress', { done: 0, total }), { id: toastId });
        const unsub = OfflineReadingService.subscribeBatch(batchId, (snap) => {
            const done = snap.completed + snap.failed;
            if (done >= snap.total) {
                const msg = snap.failed
                    ? translate('options.manager.offlineSavedSummaryWithFailed', {
                        completed: snap.completed,
                        total: snap.total,
                        failed: snap.failed,
                    })
                    : translate('options.manager.offlineSavedSummary', {
                        completed: snap.completed,
                        total: snap.total,
                    });
                // Terminal colouring by outcome:
                //   all failed → error (red) — nothing was saved offline
                //   mixed → warning (amber) — partial success
                //   all succeeded → success (green)
                if (snap.completed === 0 && snap.failed > 0) {
                    toast.error(msg, { id: toastId });
                } else if (snap.failed > 0) {
                    toast.warning(msg, { id: toastId });
                } else {
                    toast.success(msg, { id: toastId });
                }
                unsub();
            } else {
                toast.loading(translate('options.manager.offlineSavingProgress', { done, total: snap.total }), { id: toastId });
            }
        });
        return unsub;
    }

    async function handleSaveOfflineGroup(groupId: string): Promise<void> {
        const group = groups.find(g => g.id === groupId);
        if (!group) return;
        const state = offlineStateForGroup(groupId, group.tabs.length);
        if (state === 'all') {
            await OfflineReadingService.deleteByGroupId(groupId);
            setOfflineArticles(await OfflineReadingService.getAllArticles());
            toast.success(translate('options.manager.offlineCopyRemoved'));
            return;
        }
        const quota = await OfflineReadingService.getOfflineQuota();
        if (quota.isBlocked) {
            toast.error(translate('options.manager.storageFull'), {
                action: ENABLE_READINGS
                    ? { label: translate('options.manager.openAction'), onClick: () => navigateToPage('offline-reading') }
                    : undefined,
            });
            return;
        }
        await showDisclosureIfNeeded();

        // Reserve batchId first so the toast subscribes BEFORE workers start
        // draining — otherwise a fast batch could complete before we attach.
        const batchId = OfflineReadingService.generateBatchId(group.tabs.length);
        const toastId = `offline-progress-${groupId}-${Date.now()}`;
        startOfflineProgressToast(toastId, batchId, group.tabs.length);

        await OfflineReadingService.enqueueExtraction(
            group.tabs.map(t => ({ groupId, tabId: t.id, url: t.url })),
            { batchId },
        );
        setOfflineArticles(await OfflineReadingService.getAllArticles());
    }

    async function handleSaveOfflineSelected(groupIds: string[]): Promise<void> {
        const quota = await OfflineReadingService.getOfflineQuota();
        if (quota.isBlocked) {
            toast.error(translate('options.manager.storageFull'), {
                action: ENABLE_READINGS
                    ? { label: translate('options.manager.openAction'), onClick: () => navigateToPage('offline-reading') }
                    : undefined,
            });
            return;
        }
        await showDisclosureIfNeeded();
        const tabs: Array<{ groupId: string; tabId: string; url: string }> = [];
        for (const gid of groupIds) {
            const g = groups.find(x => x.id === gid);
            if (!g) continue;
            for (const t of g.tabs) tabs.push({ groupId: gid, tabId: t.id, url: t.url });
        }
        if (tabs.length === 0) return;

        const batchId = OfflineReadingService.generateBatchId(tabs.length);
        const toastId = `offline-progress-bulk-${Date.now()}`;
        startOfflineProgressToast(toastId, batchId, tabs.length);

        await OfflineReadingService.enqueueExtraction(tabs, { batchId });
        setOfflineArticles(await OfflineReadingService.getAllArticles());
    }

    async function handleRetryOffline(articleId: string): Promise<void> {
        // Short-circuit if the failure already cleared between badge click and
        // handler (e.g. a concurrent retry succeeded). Avoids creating an
        // orphan batch + stuck toast.
        const hasFailure = OfflineReadingService.getFailures().some(f => f.id === articleId);
        if (!hasFailure) return;

        // Pre-reserve batchId + subscribe BEFORE awaiting the retry — otherwise
        // the drain pump finalizes and deletes the batch before subscribeBatch
        // attaches, leaving the toast stuck at "Saving 0/1".
        const batchId = OfflineReadingService.generateBatchId(1);
        const toastId = `offline-progress-retry-${articleId}-${Date.now()}`;
        startOfflineProgressToast(toastId, batchId, 1);
        await OfflineReadingService.retryFailed(articleId, { batchId });
    }

    async function handleRetryOfflineMany(articleIds: string[]): Promise<void> {
        if (articleIds.length === 0) return;
        const presentIds = articleIds.filter(id =>
            OfflineReadingService.getFailures().some(f => f.id === id),
        );
        if (presentIds.length === 0) return;

        const batchId = OfflineReadingService.generateBatchId(presentIds.length);
        const toastId = `offline-progress-retry-bulk-${Date.now()}`;
        startOfflineProgressToast(toastId, batchId, presentIds.length);
        await OfflineReadingService.retryFailedMany(presentIds, { batchId });
    }

    function handleDismissOfflineFailures(): void {
        OfflineReadingService.clearFailures();
    }

    const toggleCollapse = async (groupId: string) => {
        const currentCollapsed = collapsedGroups.get(groupId) || false;
        const newCollapsed = !currentCollapsed;

        const newState = new Map(collapsedGroups);
        newState.set(groupId, newCollapsed);
        setCollapsedGroups(newState);

        try {
            await saveGroupState(groupId, newCollapsed);
        } catch (error) {
            console.error('Failed to save collapsed state:', error);
            ToastManager.getInstance().error(translate('options.manager.failedToSaveCollapseState'));
            const revertedState = new Map(collapsedGroups);
            revertedState.set(groupId, currentCollapsed);
            setCollapsedGroups(revertedState);
        }
    };

    // --- Core handlers ---

    async function saveAllTabs(projectId?: string | null) {
        try {
            const result = await saveCurrentWindowTabs({
                now: Date.now(),
                projectId: projectId ?? null,
            });

            if (!result || result.processedCount === 0) {
                ToastManager.getInstance().warning(translate('feedback.noTabsToSave'));
                return;
            }

            setGroups(result.savedGroups);

            const projectName = projectId ? projects.find(p => p.id === projectId)?.name : null;
            const message = projectName
                ? translate('notifications.savedToProject', { count: result.processedCount, project: isolateBidi(projectName) })
                : result.closedCount > 0
                    ? translate('options.manager.savedTabsAndClosed', { count: result.processedCount })
                    : translate('notifications.savedTabsFallback', { count: result.processedCount });
            ToastManager.getInstance().success(message);
            void maybeShowReviewPrompt();
        } catch (error) {
            console.error('Error in saveAllTabs:', error);
            ToastManager.getInstance().error(translate('feedback.failedToSaveTabs', { message: isolateBidi((error as Error).message) }));
        }
    }

    async function saveSuspendedTabs() {
        try {
            const result = await saveSuspendedTabsFromCurrentWindow({
                now: Date.now(),
            });

            if (!result || result.processedCount === 0) {
                ToastManager.getInstance().warning(translate('options.manager.noSuspendedTabsToSave'));
                return;
            }

            setGroups(result.savedGroups);

            const message = result.closedCount > 0
                ? translate('options.manager.savedSuspendedTabsAndClosed', { count: result.processedCount })
                : translate('options.manager.savedSuspendedTabs', { count: result.processedCount });
            ToastManager.getInstance().success(message);
            void maybeShowReviewPrompt();
        } catch (error) {
            console.error('Error in saveSuspendedTabs:', error);
            ToastManager.getInstance().error(translate('options.manager.failedToSaveSuspendedTabs', { message: isolateBidi((error as Error).message) }));
        }
    }

    async function startGroupOrganize(preview: OrganizePreview) {
        setOrganizeWarningOpen(false);
        setOrganizeProgressOpen(true);
        setOrganizeRunning(true);
        setOrganizeFailureMessage(null);
        setOrganizeProgress({
            phase: 'analyzing',
            bucketIndex: 0,
            totalBuckets: preview.bucketCount,
            batchIndex: 0,
            totalBatches: 0,
            projectId: null,
        });

        try {
            const result = await AIGroupOrganizerService.organizeSavedGroups({
                onProgress: setOrganizeProgress,
            });
            setGroups(result.groups);
            const allowance = await AIAllowanceService.refresh().catch(() => null);
            setOrganizeAllowanceLabel(
                allowance?.eligible ? formatAllowancePercent(allowance.percentUsed) : null,
            );
            setOrganizeRunning(false);
            setOrganizeProgressOpen(false);
            ToastManager.getInstance().success(
                translate('options.manager.organizeSuccess', {
                    tabs: result.organizedTabCount,
                    groups: result.createdGroupCount,
                    batches: result.batchCount,
                }),
            );
            if (result.skippedLockedGroupCount > 0 || result.fallbackTabCount > 0) {
                const details: string[] = [];
                if (result.skippedLockedGroupCount > 0) {
                    details.push(translate('options.manager.organizeLockedSkipped', { count: result.skippedLockedGroupCount }));
                }
                if (result.fallbackTabCount > 0) {
                    details.push(translate('options.manager.organizeFallbackKept', {
                        tabs: result.fallbackTabCount,
                        groups: result.fallbackGroupCount,
                    }));
                }
                ToastManager.getInstance().info(details.join(' • '));
            }
        } catch (error) {
            setOrganizeRunning(false);
            setOrganizeFailureMessage(error instanceof Error ? error.message : String(error));
        }
    }

    async function handleOrganizeGroups() {
        if (organizeRunning) return;
        const preview = AIGroupOrganizerService.summarizeGroups(groups);
        if (preview.eligibleTabCount === 0) {
            ToastManager.getInstance().warning(translate('options.manager.noUnlockedSavedTabs'));
            return;
        }

        setOrganizePreview(preview);
        setOrganizeFailureMessage(null);
        await showAINoticeOnce();
        const allowance = await AIAllowanceService.refresh().catch(() => null);
        setOrganizeAllowanceLabel(
            allowance?.eligible ? formatAllowancePercent(allowance.percentUsed) : null,
        );

        const warningState = await chrome.storage.local.get(ORGANIZE_WARNING_ACK_KEY);
        if (warningState?.[ORGANIZE_WARNING_ACK_KEY]) {
            await startGroupOrganize(preview);
            return;
        }

        setOrganizeWarningOpen(true);
    }

    async function handleConfirmOrganizeWarning() {
        if (!organizePreview) return;
        await chrome.storage.local.set({ [ORGANIZE_WARNING_ACK_KEY]: true });
        await startGroupOrganize(organizePreview);
    }

    function handleCloseOrganizeProgress() {
        if (organizeRunning) return;
        setOrganizeProgressOpen(false);
        setOrganizeFailureMessage(null);
    }

    const restoreGroup = async (group: TabGroup) => {
        try {
            const storedSettings = await Storage.get<Settings>('settings') || getDefaultSettings();
            const showNotice = await shouldShowGroupMemoryNotice(storedSettings);
            const restoreMode = storedSettings.restoreMode || 'smart';
            const tabGroupRestoreMode = storedSettings.tabGroupRestoreMode || 'normal';

            const currentTabs = await chrome.tabs.query({ currentWindow: true });
            let shouldCreateNewWindow = false;

            switch (restoreMode) {
                case 'newWindow':
                    shouldCreateNewWindow = true;
                    break;
                case 'currentWindow':
                    shouldCreateNewWindow = false;
                    break;
                case 'smart': {
                    const nonBlueTabTabs = currentTabs.filter(tab =>
                        tab.url && !tab.url.includes('src/options/index.html') && !tab.url.includes('src/settings/index.html')
                    );
                    shouldCreateNewWindow = nonBlueTabTabs.length > 0;
                    break;
                }
            }

            let createdTabIds: number[] = [];
            let targetWindowId: number | undefined;

            if (shouldCreateNewWindow) {
                if (group.tabs.length > 0) {
                    const newWindow = await chrome.windows.create({ url: group.tabs[0].url, focused: !showNotice });
                    targetWindowId = newWindow.id;
                    if (newWindow.tabs && newWindow.tabs[0].id) createdTabIds.push(newWindow.tabs[0].id);

                    for (let i = 1; i < group.tabs.length; i++) {
                        const newTab = await chrome.tabs.create({ url: group.tabs[i].url, windowId: newWindow.id, active: false });
                        if (newTab.id) createdTabIds.push(newTab.id);
                    }
                }
            } else {
                for (const tab of group.tabs) {
                    const newTab = await chrome.tabs.create({ url: tab.url, active: false });
                    if (newTab.id) createdTabIds.push(newTab.id);
                }
            }

            if (tabGroupRestoreMode === 'browserGroups' && createdTabIds.length > 0) {
                try {
                    await new Promise(resolve => setTimeout(resolve, 150));
                    if (targetWindowId && !showNotice) {
                        await chrome.windows.update(targetWindowId, { focused: true });
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    await createBrowserTabGroup({ tabIds: createdTabIds }, { title: group.name });
                } catch (groupError) {
                    console.error('Failed to create tab group:', groupError);
                    ToastManager.getInstance().warning(translate('options.manager.restoreGroupingFailed', { count: createdTabIds.length }));
                }
            }

            const restoreBehavior = storedSettings.restoreBehavior || 'removeFromList';
            void recordGroupActivity(group.id);
            if (restoreBehavior === 'removeFromList') {
                if (storedSettings.groupMemoryEnabled !== false && storedSettings.groupMemoryAutoRemember !== false) {
                    await GroupMemoryStorageService.rememberGroup(group);
                }
                const updatedGroups = groups.filter(g => g.id !== group.id);
                await Storage.set('groups', updatedGroups);
                setGroups(updatedGroups);
                ToastManager.getInstance().success(translate('options.manager.restoredAndRemoved', { count: group.tabs.length, name: isolateBidi(group.name) }));
                await showGroupMemoryNotice(storedSettings);
            } else {
                ToastManager.getInstance().success(translate('options.manager.restored', { count: group.tabs.length, name: isolateBidi(group.name) }));
            }
            void maybeShowReviewPrompt();
        } catch (error) {
            ToastManager.getInstance().error(translate('feedback.failedToRestoreTabs', { message: isolateBidi((error as Error).message) }));
        }
    };

    const toggleGroupLock = async (groupId: string) => {
        try {
            const updatedGroups = groups.map(g =>
                g.id === groupId ? { ...g, locked: !g.locked } : g
            );
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
            const group = updatedGroups.find(g => g.id === groupId);
            if (group) {
                ToastManager.getInstance().success(
                    group.locked
                        ? translate('options.manager.groupLocked', { name: isolateBidi(group.name) })
                        : translate('options.manager.groupUnlocked', { name: isolateBidi(group.name) }),
                );
            }
        } catch (error) {
            ToastManager.getInstance().error(translate('options.manager.failedToToggleLock', { message: isolateBidi((error as Error).message) }));
        }
    };

    const handleCopyGroupLinks = async (groupId: string) => {
        try {
            if (!navigator.clipboard || !navigator.clipboard.writeText) {
                ToastManager.getInstance().error(translate('options.manager.clipboardUnavailable'));
                return;
            }
            const group = groups.find(g => g.id === groupId);
            if (!group || group.tabs.length === 0) {
                ToastManager.getInstance().warning(translate('options.manager.noTabsToCopy'));
                return;
            }
            const linksText = group.tabs.map(tab => `${tab.url || ''} | ${tab.title || translate('settings.integrations.untitled')}`).join('\n');
            await navigator.clipboard.writeText(linksText);
            ToastManager.getInstance().success(translate('options.bulkEdit.copiedLinks', { count: group.tabs.length }));
        } catch (error) {
            console.error('Failed to copy links:', error);
            if (error instanceof DOMException && error.name === 'NotAllowedError') {
                ToastManager.getInstance().error(translate('options.manager.clipboardPermissionDenied'));
            } else {
                ToastManager.getInstance().error(translate('options.manager.copyLinksFailed'));
            }
        }
    };

    const handleShareToBluet = async (group: TabGroup) => {
        if (!isPro) {
            ToastManager.getInstance().warning(translate('options.manager.shareToBluetRequiresPro'));
            return;
        }
        const connected = await BluetBridgeService.isConnected();
        if (!connected) {
            ToastManager.getInstance().info(translate('options.manager.connectBluetFirst'));
            return;
        }
        const isAlreadyShared = bluet_sharedRefs.some(r => r.id === group.id);
        const result = await BluetBridgeService.shareTabGroup(group);
        if (result.success) {
            const url = result.fullUrl || result.pageUrl || '';
            setBluetSharedRefs(await BluetBridgeService.getSharedRefs());
            setBluetShareModal({ group, bluetUrl: url, isUpdate: isAlreadyShared });
            if (result.skippedCount) {
                ToastManager.getInstance().info(
                    translate('components.bluetConnection.skippedTabs', { count: result.skippedCount })
                );
            }
        } else {
            ToastManager.getInstance().error(translate('options.manager.shareFailed', {
                message: bluetErrorMessage(key => translate(key), result, translate('common.unknownError')),
            }));
        }
    };

    const showDeleteGroupModal = (groupId: string) => {
        const group = groups.find(g => g.id === groupId);
        if (group?.locked) {
            ToastManager.getInstance().warning(translate('options.manager.cannotDeleteLockedGroup'));
            return;
        }
        setDeleteModalType('group');
        setDeleteTarget(groupId);
        setShowDeleteModal(true);
    };

    const deleteGroup = async (groupId: string) => {
        try {
            const receipt = await deleteGroupsWithUndo([groupId]);
            const { updatedGroups } = receipt;
            setGroups(updatedGroups);
            if (receipt.count > 0) ToastManager.getInstance().undo({ key: 'options.manager.deletedGroups', values: { count: receipt.count } }, receipt);
            try {
                await removeGroupState(groupId);
                const newCollapsedState = new Map(collapsedGroups);
                newCollapsedState.delete(groupId);
                setCollapsedGroups(newCollapsedState);
            } catch (stateError) {
                console.error('Failed to remove group state:', stateError);
            }
        } catch (error) {
            ToastManager.getInstance().error(translate('feedback.failedToDeleteGroup', { message: isolateBidi((error as Error).message) }));
        }
    };

    const deleteTag = async (tagId: string) => {
        try {
            const updatedTags = tags.filter(tag => tag.id !== tagId);
            const updatedGroups = groups.map(group => ({
                ...group,
                tags: (group.tags || []).filter(id => id !== tagId),
                tabs: group.tabs.map(tab => ({ ...tab, tags: (tab.tags || []).filter(id => id !== tagId) }))
            }));
            await Storage.set('tags', updatedTags);
            await Storage.set('groups', updatedGroups);
            setTags(updatedTags);
            setGroups(updatedGroups);
            ToastManager.getInstance().success(translate('options.manager.tagDeleted'));
        } catch (error) {
            ToastManager.getInstance().error(translate('options.manager.failedToDeleteTag', { message: isolateBidi((error as Error).message) }));
        }
    };

    const bulkDeleteGroups = async () => {
        try {
            const { selectedGroups } = bulkEdit;
            const groupsToDelete = groups.filter(g => selectedGroups.has(g.id) && !g.locked);
            const lockedCount = Array.from(selectedGroups).filter(id => groups.find(g => g.id === id)?.locked).length;

            const receipt = await deleteGroupsWithUndo(groupsToDelete.map(group => group.id));
            setGroups(receipt.updatedGroups);
            bulkEdit.clearSelection();
            const message = lockedCount > 0
                ? translate('options.manager.deletedGroupsWithSkipped', { deleted: receipt.count, locked: lockedCount })
                : translate('options.manager.deletedGroups', { count: receipt.count });
            if (receipt.count > 0) ToastManager.getInstance().undo(message, receipt);
            else ToastManager.getInstance().warning(message);
        } catch (error) {
            ToastManager.getInstance().error(translate('options.manager.failedToDeleteGroups', { message: isolateBidi((error as Error).message) }));
        }
    };

    const handleDeleteConfirm = async () => {
        setShowDeleteModal(false);
        if (deleteModalType === 'group' && deleteTarget) {
            await deleteGroup(deleteTarget);
        } else if (deleteModalType === 'selected') {
            await bulkDeleteGroups();
        } else if (deleteModalType === 'tag' && deleteTarget) {
            await deleteTag(deleteTarget);
        }
        setDeleteTarget(null);
    };

    const handleDeleteCancel = () => {
        setShowDeleteModal(false);
        setDeleteTarget(null);
    };

    const openNotesModal = (groupId: string) => {
        setNotesModalGroupId(groupId);
    };

    const saveGroupNotes = async (groupId: string, notes: string) => {
        try {
            const updatedGroups = groups.map(g =>
                g.id === groupId ? { ...g, notes: notes.trim() || undefined, modified: Date.now() } : g
            );
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
            setNotesModalGroupId(null);
            ToastManager.getInstance().success(translate('options.manager.notesSaved'));
        } catch (error) {
            ToastManager.getInstance().error(translate('options.manager.failedToSaveNotes', { message: isolateBidi((error as Error).message) }));
        }
    };

    const openTagModal = (groupId: string) => {
        setTagModalGroupId(groupId);
        setShowTagModal(true);
    };

    const showArchiveModal = (groupId: string) => {
        archive.openArchiveForGroups([groupId]);
    };

    const handleSidebarOpenChange = (open: boolean) => {
        setSidebarOpen(open);
        Storage.set('bluetab_sidebar_open', open);
    };

    if (sidebarOpen === null) return null;

    return (
        <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
            <AppSidebar
                activePage={activePage}
                onSaveAllTabs={saveAllTabs}
                onSaveSuspendedTabs={saveSuspendedTabs}
                onOrganizeGroups={isPro ? handleOrganizeGroups : undefined}
                onNavigateToGroups={() => navigateToPage("groups", { clearProject: true })}
                onNavigate={(page: string) => navigateToPage(page as ActivePage, { clearProject: true })}
                onWrappedClick={ENABLE_WRAPPED ? () => openWrapped(WrappedService.getWrappedYear()) : undefined}
                wrappedBadgeVisible={wrappedBadgeVisible}
                projects={projects}
                activeProjectId={activeProjectId}
                onSelectProject={navigateToProject}
                onCreateProject={projectPanel.openCreateProject}
                onEditProject={projectPanel.openEditProject}
                onDeleteProject={projectPanel.handleDeleteProject}
            />
            <SidebarInset>
                <div className="min-h-screen bg-background text-foreground">
                    {activePage === "statistics" && (
                        <StatsDashboard
                            sidebarTrigger={<><SidebarTrigger className="-ms-1" /><Separator orientation="vertical" className="me-2 h-4" /></>}
                        />
                    )}
                    {activePage === "help" && (
                        <HelpPage
                            sidebarTrigger={<><SidebarTrigger className="-ms-1" /><Separator orientation="vertical" className="me-2 h-4" /></>}
                        />
                    )}
                    {activePage === "feeds" && null}
                    {ENABLE_READINGS && activePage === "offline-reading" && (
                        <OfflineReadingPage
                            sidebarTrigger={<><SidebarTrigger className="-ms-1" /><Separator orientation="vertical" className="me-2 h-4" /></>}
                            initialArticleUrl={initialArticleUrl}
                            failures={Array.from(offlineFailures.values())}
                            onRetryFailureMany={handleRetryOfflineMany}
                            onDismissFailures={handleDismissOfflineFailures}
                        />
                    )}
                    {activePage === "groups" && (
                        <>
                            <GroupListView
                                sidebarTrigger={<><SidebarTrigger className="-ms-1" /><Separator orientation="vertical" className="me-2 h-4" /></>}
                                bulkEditToolbar={bulkEdit.ToolbarElement}
                                groups={groups}
                                setGroups={setGroups}
                                tags={tags}
                                settings={settings}
                                projects={projects}
                                activeProjectId={activeProjectId}
                                isPro={isPro}
                                bluet_sharedRefs={bluet_sharedRefs}
                                collapsedGroups={collapsedGroups}
                                toggleCollapse={toggleCollapse}
                                isPinned={pinManagement.isPinned}
                                togglePin={(id) => pinManagement.togglePin(id)}
                                bulkMode={bulkEdit.bulkMode}
                                selectedGroups={bulkEdit.selectedGroups}
                                toggleBulkMode={bulkEdit.toggleBulkMode}
                                toggleGroupSelection={bulkEdit.toggleGroupSelection}
                                isDraggingTabs={dragDrop.isDraggingTabs}
                                dragOverGroupId={dragDrop.dragOverGroupId}
                                handleTabDragStart={dragDrop.handleTabDragStart}
                                handleTabDragEnd={dragDrop.handleTabDragEnd}
                                handleGroupDragEnter={dragDrop.handleGroupDragEnter}
                                handleGroupDragOver={dragDrop.handleGroupDragOver}
                                handleGroupDragLeave={dragDrop.handleGroupDragLeave}
                                handleGroupDrop={dragDrop.handleGroupDrop}
                                onOpenNotesModal={openNotesModal}
                                onOpenTagModal={openTagModal}
                                onArchiveGroup={showArchiveModal}
                                onDeleteGroup={showDeleteGroupModal}
                                onRestoreGroup={restoreGroup}
                                onToggleLock={toggleGroupLock}
                                onCopyGroupLinks={handleCopyGroupLinks}
                                onShareToBluet={handleShareToBluet}
                                onAssignToProject={projectPanel.handleAssignGroupToProject}
                                offlineArticles={ENABLE_READINGS ? offlineArticlesMap : undefined}
                                offlineInFlight={ENABLE_READINGS ? offlineInFlight : undefined}
                                offlineFailures={ENABLE_READINGS ? offlineFailures : undefined}
                                onRetryOffline={ENABLE_READINGS ? handleRetryOffline : undefined}
                                onSaveOfflineGroup={ENABLE_READINGS ? (groupId) => { void handleSaveOfflineGroup(groupId); } : undefined}
                                offlineStateForGroup={ENABLE_READINGS ? offlineStateForGroup : undefined}
                            />

                            {dragDrop.OverlayElement}

                            <TabSelectionToolbar groups={groups} setGroups={setGroups} isDraggingTabs={dragDrop.isDraggingTabs} />

                            {/* Floating Action Buttons */}
                            <div className={`fixed bottom-6 end-6 flex items-center gap-3 z-50 ${dragDrop.isDraggingTabs ? 'opacity-30 pointer-events-none' : ''}`}>
                                {projectPanel.ProjectFloatingButtons}
                                {archive.ArchiveFloatingButton}
                            </div>
                        </>
                    )}

                    {/* Past Wrapped section — shown on groups page for year-round history access */}
                    {ENABLE_WRAPPED && activePage === "groups" && (
                        <PastWrappedSection onReplay={(year) => openWrapped(year)} />
                    )}

                    {/* Modals — outside conditionals so they persist across page switches */}
                    <NotesModal
                        groups={groups}
                        groupId={notesModalGroupId}
                        onSave={saveGroupNotes}
                        onClose={() => setNotesModalGroupId(null)}
                    />

                    <DeleteConfirmModal
                        isOpen={showDeleteModal}
                        type={deleteModalType}
                        selectedCount={bulkEdit.selectedGroups.size}
                        bluet_linkedCount={
                            deleteModalType === 'group' && deleteTarget
                                ? (bluet_sharedRefs.some(r => r.id === deleteTarget) ? 1 : 0)
                                : deleteModalType === 'selected'
                                    ? [...bulkEdit.selectedGroups].filter(id => bluet_sharedRefs.some(r => r.id === id)).length
                                    : 0
                        }
                        onConfirm={handleDeleteConfirm}
                        onCancel={handleDeleteCancel}
                    />

                    <TagManagerModal
                        groups={groups}
                        tags={tags}
                        setTags={setTags}
                        setGroups={setGroups}
                        isOpen={showTagModal}
                        groupId={tagModalGroupId}
                        onClose={() => { setShowTagModal(false); setTagModalGroupId(null); }}
                    />

                    <BluetShareSuccessModal
                        isOpen={bluetShareModal !== null}
                        onClose={() => setBluetShareModal(null)}
                        group={bluetShareModal?.group ?? null}
                        bluetUrl={bluetShareModal?.bluetUrl ?? ''}
                        isUpdate={bluetShareModal?.isUpdate ?? false}
                    />

                    <CWSReviewPrompt
                        open={reviewPromptOpen}
                        onClose={() => setReviewPromptOpen(false)}
                    />

                    {archive.ArchiveBrowserModal}
                    {archive.CreateArchiveModalElement}
                    {projectPanel.ProjectModals}
                    {aiNoticeDialog}

                    <Dialog open={organizeWarningOpen} onOpenChange={setOrganizeWarningOpen}>
                        <DialogContent className="grid gap-4 sm:max-w-xl">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Sparkles className="h-5 w-5 text-primary" />
                                    {translate('options.manager.organizeDialog.title')}
                                </DialogTitle>
                                <DialogDescription>
                                    {translate('options.manager.organizeDialog.description')}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-xl border border-border bg-bg-1/60 p-4">
                                    <div className="text-micro uppercase tracking-wide text-text-muted">{translate('options.manager.organizeDialog.eligibleGroups')}</div>
                                    <div className="mt-1 text-lg font-semibold text-text-strong">{organizePreview?.eligibleGroupCount ?? 0}</div>
                                </div>
                                <div className="rounded-xl border border-border bg-bg-1/60 p-4">
                                    <div className="text-micro uppercase tracking-wide text-text-muted">{translate('options.manager.organizeDialog.eligibleTabs')}</div>
                                    <div className="mt-1 text-lg font-semibold text-text-strong">{organizePreview?.eligibleTabCount ?? 0}</div>
                                </div>
                                <div className="rounded-xl border border-border bg-bg-1/60 p-4">
                                    <div className="text-micro uppercase tracking-wide text-text-muted">{translate('options.manager.organizeDialog.lockedGroupsSkipped')}</div>
                                    <div className="mt-1 text-lg font-semibold text-text-strong">{organizePreview?.skippedLockedGroupCount ?? 0}</div>
                                </div>
                                <div className="rounded-xl border border-border bg-bg-1/60 p-4">
                                    <div className="text-micro uppercase tracking-wide text-text-muted">{translate('options.manager.organizeDialog.estimatedBatches')}</div>
                                    <div className="mt-1 text-lg font-semibold text-text-strong">{organizePreview?.batchCount ?? 0}</div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                                <div className="flex items-start gap-2">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                                    <div className="space-y-1.5">
                                        <p>{translate('options.manager.organizeDialog.allowanceWarning')}</p>
                                        {organizeAllowanceLabel && (
                                            <p className="text-amber-200/90">
                                                {translate('options.manager.organizeDialog.currentAllowance', { value: organizeAllowanceLabel })}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setOrganizeWarningOpen(false)}>
                                    {translate('options.manager.organizeDialog.notNow')}
                                </Button>
                                <Button onClick={() => { void handleConfirmOrganizeWarning(); }}>
                                    {translate('options.manager.organizeDialog.continue')}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Dialog
                        open={organizeProgressOpen}
                        onOpenChange={(open) => {
                            if (!open) handleCloseOrganizeProgress();
                        }}
                    >
                        <DialogContent className="sm:max-w-lg">
                            <DialogHeader className="space-y-3">
                                <DialogTitle className="flex items-center gap-2">
                                    <Sparkles className="h-5 w-5 text-primary" />
                                    {translate('options.manager.organizeProgress.title')}
                                </DialogTitle>
                                <DialogDescription>
                                    {organizeFailureMessage
                                        ? translate('options.manager.organizeProgress.noGroupsChanged')
                                        : translate('options.manager.organizeProgress.processing')}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-1">
                                <div className="rounded-xl border border-border bg-bg-1/60 p-4 text-sm text-text-muted">
                                    <div className="flex items-center justify-between">
                                        <span>{translate('options.manager.organizeProgress.phase')}</span>
                                        <span className="font-medium capitalize text-text-strong">
                                            {organizePhaseLabels[organizeProgress?.phase ?? 'analyzing']}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between">
                                        <span>{translate('options.manager.organizeProgress.bucket')}</span>
                                        <span dir="ltr" className="font-medium text-text-strong">
                                            {organizeProgress?.bucketIndex ?? 0} / {organizeProgress?.totalBuckets ?? organizePreview?.bucketCount ?? 0}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between">
                                        <span>{translate('options.manager.organizeProgress.batch')}</span>
                                        <span dir="ltr" className="font-medium text-text-strong">
                                            {organizeProgress?.batchIndex ?? 0} / {organizeProgress?.totalBatches ?? organizePreview?.batchCount ?? 0}
                                        </span>
                                    </div>
                                    {organizeProgress?.projectId && (
                                        <div className="mt-2 flex items-center justify-between">
                                            <span>{translate('options.manager.organizeProgress.projectBucket')}</span>
                                            <span className="font-medium text-text-strong">
                                                <bdi dir={projects.some((project) => project.id === organizeProgress.projectId) ? 'auto' : 'ltr'}>
                                                    {projects.find((project) => project.id === organizeProgress.projectId)?.name ?? organizeProgress.projectId}
                                                </bdi>
                                            </span>
                                        </div>
                                    )}
                                </div>
                                {!organizeFailureMessage && (
                                    <div className="space-y-2">
                                        <div className="h-2 overflow-hidden rounded-full bg-bg-1">
                                            <div
                                                className="h-full rounded-full bg-primary transition-all"
                                                style={{
                                                    width: `${Math.max(
                                                        8,
                                                        Math.round(
                                                            ((organizeProgress?.batchIndex ?? 0) / Math.max(organizePreview?.batchCount ?? 1, 1)) * 100,
                                                        ),
                                                    )}%`,
                                                }}
                                            />
                                        </div>
                                        <p className="text-sm text-text-muted">
                                            {translate('options.manager.organizeProgress.commitAfterSuccess')}
                                        </p>
                                    </div>
                                )}
                                {organizeFailureMessage && (
                                    <div dir="auto" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
                                        {organizeFailureMessage}
                                    </div>
                                )}
                            </div>
                            <DialogFooter className="gap-2 pt-2">
                                {!organizeRunning && (
                                    <Button variant={organizeFailureMessage ? 'primary' : 'outline'} onClick={handleCloseOrganizeProgress}>
                                        {organizeFailureMessage ? translate('common.close') : translate('sidepanel.actionBar.done')}
                                    </Button>
                                )}
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <ManagerWelcome kind={welcomeKind} onDone={() => setWelcomeKind(null)} />
                    <GroupMemoryNotice />
                    <Toaster richColors position={direction === 'rtl' ? 'bottom-left' : 'bottom-right'} />

                    {/* Wrapped full-screen overlay */}
                    {ENABLE_WRAPPED && wrappedOverlay && (
                        <WrappedExperience
                            year={wrappedOverlay.year}
                            onClose={() => setWrappedOverlay(null)}
                        />
                    )}
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}

async function mountOptionsPage(): Promise<void> {
    await initI18n();
    setDocumentTitle('document.optionsTitle');

    const rootElement = document.getElementById('root');
    if (!rootElement) {
        return;
    }

    const root = createRoot(rootElement);
    root.render(
        <LocaleDirectionProvider>
            <TabManager />
        </LocaleDirectionProvider>,
    );
}

void mountOptionsPage();
