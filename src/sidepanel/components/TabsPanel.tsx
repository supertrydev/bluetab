import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { stagger } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useBrowserTabs, type BrowserTab } from '../hooks/useBrowserTabs';
import { useBrowserGroups, type TabGroupColor } from '../hooks/useBrowserGroups';
import { useGroupMemory } from '../hooks/useGroupMemory';
import { useTabSearch } from '../hooks/useTabSearch';
import { PinnedTabsSection } from './PinnedTabsSection';
import { BrowserGroupCard } from './BrowserGroupCard';
import { UngroupedTabsSection } from './UngroupedTabsSection';
import { SearchBar } from './SearchBar';
import { ActionBar } from './ActionBar';
import { NewGroupModal } from './NewGroupModal';
import { Loader2, SearchX, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from '@/components/Toast';
import { useAuth } from '@/components/auth/useAuth';
import { t as translate } from '@/i18n';
import { formatDate, formatTime } from '@/i18n/format';
import { Storage } from '../../utils/storage';
import type { TabGroup, TabItem, Settings } from '../../types/models';
import type { BrowserGroup, TabGroupColor as BrowserGroupColor } from '../hooks/useBrowserGroups';
import { FlowService } from '../../services/flow-service';
import { FlowStorageService } from '../../utils/flow-storage';
import { ArchiveService } from '../../services/archive-service';
import { saveTabsToBlueTab } from '../../services/saved-tab-actions';

const listVariants: Variants = {
    visible: {
        transition: {
            delayChildren: stagger(0.03),
        }
    },
    hidden: {}
};

/**
 * Result shape for the "Save & close suspended tabs" flow. Exposed so the
 * unit test can assert the four discrete outcomes without mocking `sonner`.
 *
 * Unified save-and-close semantics: on the happy path we persist the
 * discarded subset as a new BlueTab group AND close the source Chrome tabs
 * in one motion. The `saved-but-close-failed` variant preserves trust when
 * `chrome.tabs.remove` rejects — the save already succeeded, so we report
 * that fact rather than pretending the whole operation failed.
 */
export type SaveSuspendedResult =
    | { kind: 'empty' }
    | { kind: 'saved'; count: number; groupName: string; closedCount: number }
    | { kind: 'saved-but-close-failed'; count: number; groupName: string; error: unknown }
    | { kind: 'error'; error: unknown };

/**
 * Pure side-effectful helper backing the menu-item handler. Filters the
 * group's tabs to the discarded subset, persists a new BlueTab group, then
 * closes the saved source tabs, and returns a discriminated result. Extracted
 * from the component so the component test can drive the decision logic
 * without jsdom / @testing-library (Option B per 09-VALIDATION.md).
 *
 * This is a user-initiated surface (the 3-dot menu). SAFETY-01 governs the
 * `AutoSuspendService` only — the invariant there is "the background scanner
 * never calls `chrome.tabs.remove`." This helper IS a close: the user
 * explicitly asked for "save & close" by picking that menu item.
 */
export async function saveSuspendedAsGroup(
    group: BrowserGroup,
    groupTabs: BrowserTab[],
    now: number = Date.now(),
): Promise<SaveSuspendedResult> {
    return saveSuspendedTabsAs(
        group.title || translate('sidepanel.tabsPanel.unnamedGroup'),
        groupTabs,
        now,
    );
}

/**
 * Ungrouped-path sibling to `saveSuspendedAsGroup`. The ungrouped tabs bucket
 * in the Tabs sidepanel has its own 3-dot menu (UngroupedTabsSection) and
 * needs the same "Save & close suspended tabs" entry — users with a lot of
 * ungrouped tabs benefit the most from corralling the suspended subset into
 * a saved BlueTab group while simultaneously tidying the Chrome tab strip.
 * Labels the resulting group "Suspended from 'Ungrouped'" so it's clearly
 * distinguishable from per-Chrome-group saves in the Groups list.
 *
 * Delegates to the shared `saveSuspendedTabsAs` core — same filter/persist
 * logic, same discriminated result shape, same save-then-close flow.
 */
export async function saveSuspendedFromUngrouped(
    tabs: BrowserTab[],
    now: number = Date.now(),
): Promise<SaveSuspendedResult> {
    return saveSuspendedTabsAs(translate('sidepanel.tabsPanel.ungroupedLabel'), tabs, now);
}

/**
 * Core of the "Save & close suspended tabs" flow — filters the candidate
 * tabs to the discarded subset, persists them as a new BlueTab group named
 * after `sourceLabel`, closes the saved source tabs, returns a discriminated
 * result.
 *
 * Partial-failure policy: if the save succeeds but `chrome.tabs.remove`
 * throws (tab already closed, invalid tab ID), the save is NOT undone. The
 * saved group remains intact and we surface `saved-but-close-failed` so the
 * handler can show a warning-flavored toast. Undoing a successful save to
 * preserve atomicity would be worse UX — the user loses the corralled group
 * they just asked for.
 */
async function saveSuspendedTabsAs(
    sourceLabel: string,
    candidateTabs: BrowserTab[],
    now: number,
): Promise<SaveSuspendedResult> {
    const suspendedTabs = candidateTabs.filter((t) => t.discarded);
    if (suspendedTabs.length === 0) return { kind: 'empty' };

    const groupName = translate('sidepanel.tabsPanel.suspendedGroupName', {
        name: sourceLabel,
        time: formatTime(now),
    });

    const blueTabGroupId = crypto.randomUUID();
    const tabItems: TabItem[] = suspendedTabs.map((t) => ({
        id: crypto.randomUUID(),
        url: t.url,
        title: t.title,
        favicon: t.favIconUrl,
        timestamp: now,
        groupId: blueTabGroupId,
        pinned: t.pinned,
    }));

    const newGroup: TabGroup = {
        id: blueTabGroupId,
        name: groupName,
        tabs: tabItems,
        created: now,
        modified: now,
    };

    try {
        const existing = (await Storage.get<TabGroup[]>('groups')) || [];
        await Storage.set('groups', [...existing, newGroup]);
    } catch (error) {
        return { kind: 'error', error };
    }

    // Save succeeded — now close the source Chrome tabs. User-initiated
    // remove, explicitly outside the AutoSuspendService SAFETY-01 scope.
    const tabIdsToClose = suspendedTabs
        .map((t) => t.id)
        .filter((id): id is number => typeof id === 'number');

    if (tabIdsToClose.length === 0) {
        return { kind: 'saved', count: suspendedTabs.length, groupName, closedCount: 0 };
    }

    try {
        await chrome.tabs.remove(tabIdsToClose);
        return {
            kind: 'saved',
            count: suspendedTabs.length,
            groupName,
            closedCount: tabIdsToClose.length,
        };
    } catch (error) {
        console.error('[BlueTab] Saved group but failed to close source tabs:', error);
        return {
            kind: 'saved-but-close-failed',
            count: suspendedTabs.length,
            groupName,
            error,
        };
    }
}

const itemVariants: Variants = {
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.2, ease: 'easeOut' }
    },
    hidden: { opacity: 0, y: 8 }
};

export function TabsPanel() {
    const { t } = useTranslation();
    const { isPro } = useAuth();
    const {
        tabs,
        pinnedTabs,
        groupedTabs,
        ungroupedTabs,
        loading: tabsLoading,
        error: tabsError,
        closeTab,
        activateTab
    } = useBrowserTabs();

    const {
        groups,
        loading: groupsLoading,
        error: groupsError,
        createGroup,
        updateGroup,
        collapseGroup,
        deleteGroup
    } = useBrowserGroups();

    const { memoryUrls, loading: memoryLoading } = useGroupMemory();

    const {
        searchQuery,
        setSearchQuery,
    } = useTabSearch({ tabs, groups, groupedTabs });

    const [matchIndex, setMatchIndex] = useState(0);
    const [focusedTabId, setFocusedTabId] = useState<number | null>(null);
    const activeTabId = useMemo(() => tabs.find((tab) => tab.active)?.id ?? null, [tabs]);
    const previousActiveTabIdRef = useRef<number | null>(null);
    const focusHighlightTimeoutRef = useRef<number | null>(null);

    const scrollTabIntoView = useCallback((tabId: number) => {
        window.requestAnimationFrame(() => {
            const el = document.querySelector(`[data-tab-id="${tabId}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }, []);

    // Collect all matching tab IDs across all sections
    const matchingTabIds = useMemo(() => {
        if (!searchQuery) return [];
        const q = searchQuery.toLowerCase();
        return tabs.filter(t =>
            t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)
        ).map(t => t.id);
    }, [tabs, searchQuery]);
    const matchingTabIdSet = useMemo(() => new Set(matchingTabIds), [matchingTabIds]);
    const searchExpandedGroupIds = useMemo(() => {
        if (!searchQuery.trim()) return new Set<number>();

        const expandedGroupIds = new Set<number>();
        groups.forEach((group) => {
            const groupTabs = groupedTabs.get(group.id) || [];
            if (groupTabs.some((tab) => matchingTabIdSet.has(tab.id))) {
                expandedGroupIds.add(group.id);
            }
        });
        return expandedGroupIds;
    }, [groupedTabs, groups, matchingTabIdSet, searchQuery]);

    // Reset match index when query changes
    useEffect(() => { setMatchIndex(0); }, [searchQuery]);

    // Scroll to current match
    useEffect(() => {
        if (matchingTabIds.length > 0 && matchIndex < matchingTabIds.length) {
            scrollTabIntoView(matchingTabIds[matchIndex]);
        }
    }, [matchIndex, matchingTabIds, scrollTabIntoView]);

    useEffect(() => {
        if (activeTabId === null) return;

        if (previousActiveTabIdRef.current === null) {
            previousActiveTabIdRef.current = activeTabId;
            return;
        }

        if (previousActiveTabIdRef.current === activeTabId) return;
        previousActiveTabIdRef.current = activeTabId;

        if (searchQuery) return;

        setFocusedTabId(activeTabId);
        scrollTabIntoView(activeTabId);

        if (focusHighlightTimeoutRef.current !== null) {
            window.clearTimeout(focusHighlightTimeoutRef.current);
        }

        focusHighlightTimeoutRef.current = window.setTimeout(() => {
            setFocusedTabId((current) => (current === activeTabId ? null : current));
        }, 1400);
    }, [activeTabId, searchQuery, scrollTabIntoView]);

    useEffect(() => {
        return () => {
            if (focusHighlightTimeoutRef.current !== null) {
                window.clearTimeout(focusHighlightTimeoutRef.current);
            }
        };
    }, []);

    // Settings
    const [browserSettings, setBrowserSettings] = useState({
        groupBorder: true,
        closeOnSave: true,
        showInactiveIndicator: true
    });

    useEffect(() => {
        const loadSettings = async () => {
            const s = await Storage.get<Settings>('settings');
            if (s) {
                setBrowserSettings({
                    groupBorder: s.browserTabsGroupBorder ?? true,
                    closeOnSave: s.browserTabsCloseOnSave ?? true,
                    showInactiveIndicator: s.browserTabsShowInactiveIndicator ?? true
                });
            }
        };
        loadSettings();

        const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.settings) {
                const s = changes.settings.newValue;
                if (s) {
                    setBrowserSettings({
                        groupBorder: s.browserTabsGroupBorder ?? true,
                        closeOnSave: s.browserTabsCloseOnSave ?? true,
                        showInactiveIndicator: s.browserTabsShowInactiveIndicator ?? true
                    });
                }
            }
        };
        chrome.storage.local.onChanged.addListener(listener);
        return () => chrome.storage.local.onChanged.removeListener(listener);
    }, []);

    // Selection state
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set());
    const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);

    // Native DnD state
    const [isDragging, setIsDragging] = useState(false);
    const [activeDropTarget, setActiveDropTarget] = useState<string | null>(null);
    const [dropIndicatorTabId, setDropIndicatorTabId] = useState<number | null>(null);
    const [dropIndicatorPos, setDropIndicatorPos] = useState<'above' | 'below' | null>(null);
    const dragDataRef = useRef<{ tab: BrowserTab; containerId: string } | null>(null);

    const handleTabDragStart = useCallback((e: React.DragEvent, tab: BrowserTab, containerId: string) => {
        dragDataRef.current = { tab, containerId };
        setIsDragging(true);
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleTabDragEnd = useCallback(() => {
        dragDataRef.current = null;
        setIsDragging(false);
        setActiveDropTarget(null);
        setDropIndicatorTabId(null);
        setDropIndicatorPos(null);
    }, []);

    const handleTabDragOver = useCallback((e: React.DragEvent, overTab: BrowserTab, containerId: string) => {
        if (!dragDataRef.current || dragDataRef.current.tab.id === overTab.id) {
            setDropIndicatorTabId(null);
            return;
        }
        // Block pinned <-> unpinned
        if ((dragDataRef.current.containerId === 'pinned') !== (containerId === 'pinned')) return;
        setActiveDropTarget(containerId);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
        setDropIndicatorTabId(overTab.id);
        setDropIndicatorPos(pos);
    }, []);

    const handleTabDrop = useCallback(async (_e: React.DragEvent, overTab: BrowserTab, targetContainer: string) => {
        const drag = dragDataRef.current;
        if (!drag || drag.tab.id === overTab.id) return;
        if ((drag.containerId === 'pinned') !== (targetContainer === 'pinned')) return;

        const targetIndex = dropIndicatorPos === 'above' ? overTab.index : overTab.index + 1;
        try {
            if (drag.containerId === targetContainer) {
                await chrome.tabs.move(drag.tab.id, { index: targetIndex });
            } else if (targetContainer === 'ungrouped') {
                await chrome.tabs.ungroup([drag.tab.id]);
                await chrome.tabs.move(drag.tab.id, { index: targetIndex });
            } else if (targetContainer.startsWith('group-')) {
                const groupId = parseInt(targetContainer.replace('group-', ''), 10);
                await chrome.tabs.group({ tabIds: [drag.tab.id], groupId });
                await chrome.tabs.move(drag.tab.id, { index: targetIndex });
            }
        } catch (err) {
            console.error('[BlueTab] Failed to move tab:', err);
        }
        handleTabDragEnd();
    }, [dropIndicatorPos, handleTabDragEnd]);

    const handleContainerDragOver = useCallback((e: React.DragEvent, containerId: string) => {
        if (!dragDataRef.current) return;
        if ((dragDataRef.current.containerId === 'pinned') !== (containerId === 'pinned')) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        setActiveDropTarget(containerId);
    }, []);

    const handleContainerDrop = useCallback(async (_e: React.DragEvent, targetContainer: string) => {
        const drag = dragDataRef.current;
        if (!drag || drag.containerId === targetContainer) { handleTabDragEnd(); return; }
        if ((drag.containerId === 'pinned') !== (targetContainer === 'pinned')) { handleTabDragEnd(); return; }
        try {
            if (targetContainer === 'ungrouped') {
                await chrome.tabs.ungroup([drag.tab.id]);
            } else if (targetContainer.startsWith('group-')) {
                const groupId = parseInt(targetContainer.replace('group-', ''), 10);
                await chrome.tabs.group({ tabIds: [drag.tab.id], groupId });
            }
        } catch (err) {
            console.error('[BlueTab] Failed to move tab:', err);
        }
        handleTabDragEnd();
    }, [handleTabDragEnd]);

    const loading = tabsLoading || groupsLoading || memoryLoading;
    const error = tabsError || groupsError;

    const handleTabSelect = useCallback((tabId: number) => {
        setSelectedTabIds(prev => {
            const next = new Set(prev);
            if (next.has(tabId)) {
                next.delete(tabId);
            } else {
                next.add(tabId);
            }
            return next;
        });
    }, []);

    const handleToggleSelectionMode = () => {
        if (isSelectionMode) {
            setSelectedTabIds(new Set());
        }
        setIsSelectionMode(!isSelectionMode);
    };

    const handleNewGroup = () => {
        if (selectedTabIds.size > 0) {
            setIsNewGroupModalOpen(true);
        }
    };

    const handleCreateGroup = async (tabIds: number[], title: string, color: TabGroupColor) => {
        await createGroup(tabIds, title, color);
        setSelectedTabIds(new Set());
        setIsSelectionMode(false);
    };

    const handleRenameGroup = async (groupId: number, title: string) => {
        await updateGroup(groupId, { title });
    };

    const handleChangeGroupColor = async (groupId: number, color: TabGroupColor) => {
        await updateGroup(groupId, { color });
    };

    const handleOrganize = async () => {
        try {
            const enabledRules = await FlowStorageService.getEnabledRules();
            if (enabledRules.length === 0) return;

            // Only process non-pinned, ungrouped tabs
            const tabsToOrganize = ungroupedTabs.filter(t => !t.pinned);
            if (tabsToOrganize.length === 0) return;

            // Match tabs to rules and group by target group name
            const groupMap = new Map<string, { color?: string; tabIds: number[] }>();

            for (const tab of tabsToOrganize) {
                const matchedRule = enabledRules.find(rule =>
                    FlowService.matchesRule(tab.url, rule, tab.title)
                );
                if (matchedRule) {
                    const groupName = matchedRule.action.newGroupName || matchedRule.name;
                    const existing = groupMap.get(groupName);
                    if (existing) {
                        existing.tabIds.push(tab.id);
                    } else {
                        groupMap.set(groupName, {
                            color: matchedRule.action.groupColor,
                            tabIds: [tab.id]
                        });
                    }
                }
            }

            // Create browser groups
            for (const [groupName, data] of groupMap) {
                // Check if a browser group with this name already exists
                const existingGroup = groups.find(
                    g => g.title.toLowerCase() === groupName.toLowerCase()
                );

                if (existingGroup) {
                    // Add to existing browser group
                    await chrome.tabs.group({ tabIds: data.tabIds, groupId: existingGroup.id });
                } else {
                    // Create new browser group
                    const groupId = await chrome.tabs.group({ tabIds: data.tabIds });
                    const validColors: BrowserGroupColor[] = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
                    const color = validColors.includes(data.color as BrowserGroupColor)
                        ? data.color as BrowserGroupColor
                        : 'blue';
                    await chrome.tabGroups.update(groupId, { title: groupName, color });
                }
            }
        } catch (err) {
            console.error('[BlueTab] Organize failed:', err);
        }
    };

    const handleDeleteAllTabs = async (_groupId: number, tabIds: number[]) => {
        for (const id of tabIds) {
            await closeTab(id);
        }
    };

    const handleDeleteTabsByIds = async (tabIds: number[]) => {
        for (const id of tabIds) {
            await closeTab(id);
        }
    };

    const handleNewPinnedTab = async () => {
        await chrome.tabs.create({ active: true, pinned: true });
    };

    const handleNewTabInGroup = async (groupId: number) => {
        const tab = await chrome.tabs.create({ active: true });
        if (tab.id) {
            await chrome.tabs.group({ tabIds: [tab.id], groupId });
        }
    };

    const handleNewUngroupedTab = async () => {
        await chrome.tabs.create({ active: true });
    };

    const handleCopyLinks = (sectionTabs: BrowserTab[]) => {
        const text = sectionTabs.map(t => `${t.title}\n${t.url}`).join('\n\n');
        navigator.clipboard.writeText(text);
    };

    const handleSaveToBlueTab = async (sectionTabs: BrowserTab[], groupName?: string) => {
        try {
            await saveTabsToBlueTab(sectionTabs, groupName || t('sidepanel.tabsPanel.defaultSavedGroup', { date: formatDate(Date.now()) }), {
                closeSourceTabs: browserSettings.closeOnSave,
                isPro,
            });
        } catch (error) {
            toast.error(t('sidepanel.tabsPanel.saveFailed'), {
                description: error instanceof Error ? error.message : String(error),
            });
        }
    };

    const handleSaveGroupToBlueTab = async (group: BrowserGroup, groupTabs: BrowserTab[]) => {
        await handleSaveToBlueTab(groupTabs, group.title || t('sidepanel.tabsPanel.unnamedGroup'));
    };

    /**
     * Phase 9 Safe Auto-Suspend surface — "Save & close suspended tabs" entry
     * in each Tabs-sidepanel group 3-dot menu. Filters the group's tabs to
     * the discarded subset, persists them as a new BlueTab group, and closes
     * the saved Chrome tabs in one motion. Empty-subset case toasts an
     * explanatory message rather than silently no-op'ing, so the menu item
     * is always discoverable.
     *
     * Replaces the scrapped sidepanel Suspended section (see commit 542213e
     * and 09-CONTEXT.md Deferred Ideas for the scope-reduction rationale).
     * This single menu item is the only Bluetab-UI surfacing of suspended
     * tabs — the primary cue remains Chrome's tab strip (favicon Zz +
     * per-tab action badge).
     */
    const handleSaveSuspendedAsGroup = async (group: BrowserGroup, groupTabs: BrowserTab[]) => {
        const result = await saveSuspendedAsGroup(group, groupTabs);
        if (result.kind === 'empty') {
            toast.info(t('sidepanel.tabsPanel.noSuspendedInGroup'));
        } else if (result.kind === 'saved') {
            toast.success(t('sidepanel.tabsPanel.savedAndClosed', {
                count: result.count,
                name: result.groupName,
            }));
        } else if (result.kind === 'saved-but-close-failed') {
            toast.warning(t('sidepanel.tabsPanel.savedCloseFailed', {
                count: result.count,
                name: result.groupName,
            }));
        } else {
            console.error('[BlueTab] Failed to save suspended tabs:', result.error);
            toast.error({ key: 'feedback.suspendedTabsSaveFailed' });
        }
    };

    /**
     * Ungrouped-path counterpart to `handleSaveSuspendedAsGroup`. The
     * UngroupedTabsSection 3-dot menu invokes this so users can corral the
     * suspended subset of their ungrouped tabs into a saved BlueTab group
     * and close them in one motion.
     */
    const handleSaveSuspendedFromUngrouped = async (sectionTabs: BrowserTab[]) => {
        const result = await saveSuspendedFromUngrouped(sectionTabs);
        if (result.kind === 'empty') {
            toast.info(t('sidepanel.tabsPanel.noSuspendedInUngrouped'));
        } else if (result.kind === 'saved') {
            toast.success(t('sidepanel.tabsPanel.savedAndClosed', {
                count: result.count,
                name: result.groupName,
            }));
        } else if (result.kind === 'saved-but-close-failed') {
            toast.warning(t('sidepanel.tabsPanel.savedCloseFailed', {
                count: result.count,
                name: result.groupName,
            }));
        } else {
            console.error('[BlueTab] Failed to save suspended tabs:', result.error);
            toast.error({ key: 'feedback.suspendedTabsSaveFailed' });
        }
    };

    const handleSaveTabToBlueTab = async (tab: BrowserTab) => {
        await handleSaveToBlueTab([tab], tab.title || t('sidepanel.tabsPanel.defaultSavedTab'));
    };

    const handleSaveToArchive = async (sectionTabs: BrowserTab[], groupName?: string) => {
        const groupId = crypto.randomUUID();
        const tabItems: TabItem[] = sectionTabs.map(t => ({
            id: crypto.randomUUID(),
            url: t.url,
            title: t.title,
            favicon: t.favIconUrl,
            timestamp: Date.now(),
            groupId,
            pinned: t.pinned
        }));

        const group: TabGroup = {
            id: groupId,
            name: groupName || t('sidepanel.tabsPanel.defaultArchivedGroup', { date: formatDate(Date.now()) }),
            tabs: tabItems,
            created: Date.now(),
            modified: Date.now()
        };

        const result = await ArchiveService.createArchive(group, {
            groupId: group.id,
            reason: t('sidepanel.tabsPanel.archiveReason')
        });

        if (result.success && browserSettings.closeOnSave) {
            const tabIdsToClose = sectionTabs.map(t => t.id).filter(id => id !== undefined);
            if (tabIdsToClose.length > 0) {
                await chrome.tabs.remove(tabIdsToClose);
            }
        }
    };

    const selectedTabs = tabs.filter(t => selectedTabIds.has(t.id));

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-64">
                <p className="text-sm text-danger">{t('sidepanel.tabsPanel.loadError', { message: error })}</p>
            </div>
        );
    }

    const totalTabs = pinnedTabs.length + ungroupedTabs.length +
        Array.from(groupedTabs.values()).reduce((sum, t) => sum + t.length, 0);

    return (
        <div className="flex flex-col h-full min-w-0">
            {/* Search Bar */}
            <div className="px-2 py-2">
                <SearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    ariaLabel={t('sidepanel.tabsPanel.searchAria')}
                    autoFocus
                />
            </div>

            {/* Action Bar */}
            <ActionBar
                selectedTabs={selectedTabs}
                isSelectionMode={isSelectionMode}
                groups={groups}
                onToggleSelectionMode={handleToggleSelectionMode}
                onClearSelection={() => setSelectedTabIds(new Set())}
                onNewGroup={handleNewGroup}
                onOrganize={handleOrganize}
                onSaveToBlueTab={(tabs) => handleSaveToBlueTab(tabs, translate('contextMenu.generatedGroups.selected', { date: formatDate(Date.now()) }))}
                onMoveToGroup={async (tabIds, groupId) => {
                    await chrome.tabs.group({ tabIds, groupId });
                    setSelectedTabIds(new Set());
                    setIsSelectionMode(false);
                }}
            />

            {/* Match Navigator */}
            {searchQuery && matchingTabIds.length > 0 && (
                <div className="flex items-center justify-between px-3 py-1 text-xs text-text-muted">
                    <span>{t('sidepanel.tabsPanel.matchCounter', { current: matchIndex + 1, total: matchingTabIds.length })}</span>
                    <div className="flex gap-1">
                        <button
                            onClick={() => setMatchIndex(i => (i - 1 + matchingTabIds.length) % matchingTabIds.length)}
                            className="p-0.5 rounded hover:bg-bg-2 transition-colors"
                        >
                            <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => setMatchIndex(i => (i + 1) % matchingTabIds.length)}
                            className="p-0.5 rounded hover:bg-bg-2 transition-colors"
                        >
                            <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            )}
            {searchQuery && matchingTabIds.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-text-muted">
                    <SearchX className="w-10 h-10 mb-3 opacity-50" />
                    <p className="text-sm font-medium">{t('sidepanel.tabsPanel.noTabsFound')}</p>
                    <p className="text-xs mt-1">{t('sidepanel.tabsPanel.tryDifferentSearch')}</p>
                </div>
            )}

            {/* Tabs List */}
            <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden scrollbar-transparent mt-1.5">
                <motion.div
                    key="tabs-list"
                    className="space-y-3 px-2 pb-4 min-w-0"
                    variants={listVariants}
                    initial="hidden"
                    animate="visible"
                >
                    {/* Pinned Tabs */}
                    <motion.div variants={itemVariants}>
                        <PinnedTabsSection
                            tabs={pinnedTabs}
                            groupMemoryUrls={memoryUrls}
                            selectedTabIds={selectedTabIds}
                            focusHighlightTabId={focusedTabId}
                            isSelectionMode={isSelectionMode}
                            isDndActive={isDragging}
                            dropIndicatorTabId={activeDropTarget === 'pinned' ? dropIndicatorTabId : null}
                            dropIndicatorPos={dropIndicatorPos}
                            onTabDragStart={handleTabDragStart}
                            onTabDragEnd={handleTabDragEnd}
                            onTabDragOver={handleTabDragOver}
                            onTabDrop={handleTabDrop}
                            onTabClose={(id) => closeTab(id)}
                            onTabActivate={(id) => activateTab(id)}
                            onTabSelect={handleTabSelect}
                            onNewTab={handleNewPinnedTab}
                            onSaveToBlueTab={(tabsToSave) => handleSaveToBlueTab(tabsToSave, t('sidepanel.tabsPanel.pinnedTabs'))}
                            onSaveToArchive={(tabsToSave) => handleSaveToArchive(tabsToSave, t('sidepanel.tabsPanel.pinnedTabs'))}
                            onCopyLinks={handleCopyLinks}
                            onDeleteAllTabs={handleDeleteTabsByIds}
                            onSaveTabToBlueTab={handleSaveTabToBlueTab}
                            showInactiveIndicator={browserSettings.showInactiveIndicator}
                            searchQuery={searchQuery}
                        />
                    </motion.div>

                    {/* Grouped Tabs */}
                    {groups.map(group => {
                        const groupTabs = groupedTabs.get(group.id) || [];
                        if (groupTabs.length === 0) return null;

                        return (
                            <motion.div key={group.id} variants={itemVariants}>
                                <BrowserGroupCard
                                    group={group}
                                    tabs={groupTabs}
                                    groupMemoryUrls={memoryUrls}
                                    selectedTabIds={selectedTabIds}
                                    focusHighlightTabId={focusedTabId}
                                    forceOpen={searchExpandedGroupIds.has(group.id)}
                                    isSelectionMode={isSelectionMode}
                                    onTabClose={(id) => closeTab(id)}
                                    onTabActivate={(id) => activateTab(id)}
                                    onTabSelect={handleTabSelect}
                                    onCollapseGroup={(id, c) => collapseGroup(id, c)}
                                    onRenameGroup={handleRenameGroup}
                                    onChangeGroupColor={handleChangeGroupColor}
                                    onSaveToBlueTab={handleSaveGroupToBlueTab}
                                    onSaveSuspendedAsGroup={handleSaveSuspendedAsGroup}
                                    onSaveToArchive={(tabsToSave) => handleSaveToArchive(tabsToSave, group.title || t('sidepanel.tabsPanel.unnamedGroup'))}
                                    onCopyLinks={handleCopyLinks}
                                    onNewTab={() => handleNewTabInGroup(group.id)}
                                    onDeleteGroup={(id) => deleteGroup(id)}
                                    onDeleteAllTabs={handleDeleteAllTabs}
                                    onSaveTabToBlueTab={handleSaveTabToBlueTab}
                                    showInactiveIndicator={browserSettings.showInactiveIndicator}
                                    showGroupBorder={browserSettings.groupBorder}
                                    isDndActive={isDragging}
                                    isDropTarget={activeDropTarget === `group-${group.id}`}
                                    dropIndicatorTabId={activeDropTarget === `group-${group.id}` ? dropIndicatorTabId : null}
                                    dropIndicatorPos={dropIndicatorPos}
                                    onTabDragStart={handleTabDragStart}
                                    onTabDragEnd={handleTabDragEnd}
                                    onTabDragOver={handleTabDragOver}
                                    onTabDrop={handleTabDrop}
                                    onContainerDragOver={handleContainerDragOver}
                                    onContainerDrop={handleContainerDrop}
                                    searchQuery={searchQuery}
                                />
                            </motion.div>
                        );
                    })}

                    {/* Ungrouped Tabs */}
                    <motion.div variants={itemVariants}>
                        <UngroupedTabsSection
                            tabs={ungroupedTabs}
                            groupMemoryUrls={memoryUrls}
                            selectedTabIds={selectedTabIds}
                            focusHighlightTabId={focusedTabId}
                            isSelectionMode={isSelectionMode}
                            onTabClose={(id) => closeTab(id)}
                            onTabActivate={(id) => activateTab(id)}
                            onTabSelect={handleTabSelect}
                            onNewTab={handleNewUngroupedTab}
                            onSaveToBlueTab={(tabsToSave) => handleSaveToBlueTab(tabsToSave, t('sidepanel.tabsPanel.ungroupedTabs'))}
                            onSaveToArchive={(tabsToSave) => handleSaveToArchive(tabsToSave, t('sidepanel.tabsPanel.ungroupedTabs'))}
                            onCopyLinks={handleCopyLinks}
                            onDeleteAllTabs={handleDeleteTabsByIds}
                            onSaveTabToBlueTab={handleSaveTabToBlueTab}
                            onSaveSuspendedAsGroup={handleSaveSuspendedFromUngrouped}
                            showInactiveIndicator={browserSettings.showInactiveIndicator}
                            isDndActive={isDragging}
                            isDropTarget={activeDropTarget === 'ungrouped'}
                            dropIndicatorTabId={activeDropTarget === 'ungrouped' ? dropIndicatorTabId : null}
                            dropIndicatorPos={dropIndicatorPos}
                            onTabDragStart={handleTabDragStart}
                            onTabDragEnd={handleTabDragEnd}
                            onTabDragOver={handleTabDragOver}
                            onTabDrop={handleTabDrop}
                            onContainerDragOver={handleContainerDragOver}
                            onContainerDrop={handleContainerDrop}
                            searchQuery={searchQuery}
                        />
                    </motion.div>

                    {/* Empty State */}
                    {totalTabs === 0 && !searchQuery && (
                        <div className="flex flex-col items-center justify-center h-40 text-text-muted">
                            <p className="text-sm font-medium">{t('sidepanel.tabsPanel.noTabsOpen')}</p>
                        </div>
                    )}
                </motion.div>
            </div>

            {/* New Group Modal */}
            <NewGroupModal
                isOpen={isNewGroupModalOpen}
                onClose={() => setIsNewGroupModalOpen(false)}
                selectedTabs={selectedTabs}
                onCreateGroup={handleCreateGroup}
            />
        </div>
    );
}
