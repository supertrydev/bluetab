import { groupMatchesSearch } from '@/utils/group-search';
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Grid3X3, LayoutGrid, LayoutDashboard, Pencil, X, Layers } from 'lucide-react';
// DownloadCheck (HardDriveDownload alias) is used in MasonryGroupCard tab-row indicators — imported there.
// @ts-expect-error -- react-responsive-masonry has no type declarations
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';
import { MasonryGroupCard } from '@/components/MasonryGroupCard';
import { GroupInfoModal } from '@/components/GroupInfoModal';
import { InputGroup, InputGroupInput, InputGroupAddon } from '@/components/ui/input-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/i18n/format';
import { isolateBidi } from '@/i18n/bidi';
import { sortGroupsWithPinning, SORT_OPTIONS, type SortOrder } from '@/utils/sorting';
import { Storage } from '@/utils/storage';
import { ToastManager } from '@/components/Toast';
import { GroupMenu } from './GroupMenu';
import { ReminderQuickPicker } from './ReminderQuickPicker';
import { ReminderService } from '@/services/reminder-service';
import { restoreSavedTabWithBehavior } from '@/services/saved-tab-actions';
import {
    countVisibleTabRowsForGroupList,
    shouldUseHeavyGroupCards,
    shouldUseSequentialMasonry,
} from './group-list-performance';
import type { TabGroup, TabItem, Tag, Settings, Project } from '@/types/models';
import type { Reminder, ReminderSettings } from '@/types/productivity';
import { DEFAULT_REMINDER_SETTINGS } from '@/types/productivity';
import type { BluetSharedRef } from '@/types/bluet';
import type { OfflineArticle, OfflineFailureRecord } from '@/types/offline-reading';

export interface GroupListViewProps {
    groups: TabGroup[];
    setGroups: React.Dispatch<React.SetStateAction<TabGroup[]>>;
    tags: Tag[];
    settings: Settings;
    projects: Project[];
    activeProjectId: string | null;
    isPro: boolean;
    bluet_sharedRefs: BluetSharedRef[];
    // Collapsed state
    collapsedGroups: Map<string, boolean>;
    toggleCollapse: (groupId: string) => void;
    // Pin management
    isPinned: (groupId: string) => boolean;
    togglePin: (groupId: string) => void;
    // Bulk mode
    bulkMode: boolean;
    selectedGroups: Set<string>;
    toggleBulkMode: () => void;
    toggleGroupSelection: (groupId: string) => void;
    // Drag and drop
    isDraggingTabs: boolean;
    dragOverGroupId: string | null;
    handleTabDragStart: (e: React.DragEvent, tab: TabItem, sourceGroupId: string) => void;
    handleTabDragEnd: (e: React.DragEvent) => void;
    handleGroupDragEnter: (e: React.DragEvent, targetGroupId: string) => void;
    handleGroupDragOver: (e: React.DragEvent, targetGroupId: string) => void;
    handleGroupDragLeave: (e: React.DragEvent) => void;
    handleGroupDrop: (e: React.DragEvent, targetGroupId: string) => void;
    // Actions
    onOpenNotesModal: (groupId: string) => void;
    onOpenTagModal: (groupId: string) => void;
    onArchiveGroup: (groupId: string) => void;
    onDeleteGroup: (groupId: string) => void;
    onRestoreGroup: (group: TabGroup) => void;
    onToggleLock: (groupId: string) => void;
    onCopyGroupLinks: (groupId: string) => void;
    onShareToBluet: (group: TabGroup) => void;
    onAssignToProject: (groupId: string, projectId: string | undefined) => void;
    sidebarTrigger?: React.ReactNode;
    bulkEditToolbar?: React.ReactNode;
    // Offline reading indicator props — passed to MasonryGroupCard for per-tab-row indicators.
    // MasonryGroupCard renders: DownloadCheck = "Saved for offline", Loader2 spinner = pending, AlertCircle = failed.
    offlineArticles?: Map<string, OfflineArticle>;
    offlineInFlight?: Set<string>;
    offlineFailures?: Map<string, OfflineFailureRecord>;
    onRetryOffline?: (articleId: string) => void;
    onSaveOfflineGroup?: (groupId: string) => void;
    offlineStateForGroup?: (groupId: string, totalTabs: number) => 'none' | 'partial' | 'all';
}

export function GroupListView({
    groups,
    setGroups,
    tags,
    settings,
    projects,
    activeProjectId,
    isPro,
    bluet_sharedRefs,
    collapsedGroups,
    toggleCollapse,
    isPinned,
    togglePin,
    bulkMode,
    selectedGroups,
    toggleBulkMode,
    toggleGroupSelection,
    isDraggingTabs: _isDraggingTabs,
    dragOverGroupId,
    handleTabDragStart,
    handleTabDragEnd,
    handleGroupDragEnter,
    handleGroupDragOver,
    handleGroupDragLeave,
    handleGroupDrop,
    onOpenNotesModal,
    onOpenTagModal,
    onArchiveGroup,
    onDeleteGroup,
    onRestoreGroup,
    onToggleLock,
    onCopyGroupLinks,
    onShareToBluet,
    onAssignToProject,
    sidebarTrigger,
    bulkEditToolbar,
    offlineArticles,
    offlineInFlight,
    offlineFailures,
    onRetryOffline,
    onSaveOfflineGroup,
    offlineStateForGroup,
}: GroupListViewProps) {
    const { t } = useTranslation();
    // Search state
    const [search, setSearch] = useState('');
    // Sort state
    const [currentSortOrder, setCurrentSortOrder] = useState<SortOrder>(settings.sortOrder || 'newest');
    // Layout mode
    const [layoutMode, setLayoutMode] = useState<'grid' | 'masonry' | 'dashboard'>('masonry');
    const [isLayoutModeInitialized, setIsLayoutModeInitialized] = useState(false);
    // Stats
    const [stats, setStats] = useState({ totalGroups: 0, totalTabs: 0 });
    // Group editing
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    // Menu state
    // Info modal
    const [infoGroupId, setInfoGroupId] = useState<string | null>(null);
    // Reminder quick picker
    const [reminderTarget, setReminderTarget] = useState<TabGroup | null>(null);
    // Reminder badges
    const [reminderTargetIds, setReminderTargetIds] = useState<Set<string>>(new Set());
    const [showReminderBadge, setShowReminderBadge] = useState(false);

    // Load reminder badge setting and active reminders
    useEffect(() => {
        Storage.get<ReminderSettings>('reminderSettings').then((s) => {
            setShowReminderBadge(s?.showBadge ?? DEFAULT_REMINDER_SETTINGS.showBadge);
        });
        ReminderService.listActive().then((reminders) => {
            setReminderTargetIds(new Set(reminders.map((r) => r.targetId)));
        });

        const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.reminders) {
                const all: Reminder[] = changes.reminders.newValue || [];
                const now = Date.now();
                setReminderTargetIds(new Set(all.filter((r) => r.fireAt > now).map((r) => r.targetId)));
            }
            if (changes.reminderSettings) {
                const s = changes.reminderSettings.newValue;
                setShowReminderBadge(s?.showBadge ?? false);
            }
        };
        chrome.storage.local.onChanged.addListener(listener);
        return () => chrome.storage.local.onChanged.removeListener(listener);
    }, []);

    // Initialize layout mode from storage
    useEffect(() => {
        Storage.get<'grid' | 'masonry' | 'dashboard'>('layoutMode').then(stored => {
            if (stored) setLayoutMode(stored);
            setIsLayoutModeInitialized(true);
        });
    }, []);

    // Save layoutMode preference when it changes
    useEffect(() => {
        if (isLayoutModeInitialized) {
            Storage.set('layoutMode', layoutMode);
        }
    }, [layoutMode, isLayoutModeInitialized]);

    // Update stats when groups change
    useEffect(() => {
        setStats({
            totalGroups: groups.length,
            totalTabs: groups.reduce((acc, group) => acc + group.tabs.length, 0)
        });
    }, [groups]);

    // Sync sort order with settings changes
    useEffect(() => {
        if (settings.sortOrder) {
            setCurrentSortOrder(settings.sortOrder);
        }
    }, [settings.sortOrder]);

    // Sort order change handler
    const changeSortOrder = async (newSortOrder: SortOrder) => {
        try {
            const updatedSettings = { ...settings, sortOrder: newSortOrder };
            await Storage.set('settings', updatedSettings);
            setCurrentSortOrder(newSortOrder);
        } catch (error) {
            ToastManager.getInstance().error(t('options.groupList.saveSortError', { message: isolateBidi((error as Error).message) }));
        }
    };

    // Tab open handler
    const openTab = async (url: string, tabId: string, groupId: string) => {
        try {
            const { updatedGroups } = await restoreSavedTabWithBehavior({
                url,
                tabId,
                groupId,
                groups,
                settingsFallback: settings,
            });
            setGroups(updatedGroups);
        } catch (error) {
            ToastManager.getInstance().error(t('options.groupList.openTabError', { message: isolateBidi((error as Error).message) }));
        }
    };

    // Group editing
    const startEdit = (group: TabGroup) => {
        setEditingId(group.id);
        setEditName(group.name);
    };

    const saveEdit = async () => {
        if (!editingId || !editName.trim()) return;
        try {
            const updatedGroups = groups.map(g =>
                g.id === editingId ? { ...g, name: editName.trim(), modified: Date.now() } : g
            );
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
            setEditingId(null);
            setEditName('');
        } catch (error) {
            ToastManager.getInstance().error(t('options.groupList.saveGroupNameError', { message: isolateBidi((error as Error).message) }));
        }
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditName('');
    };

    // Filter and sort groups
    const filteredAndSortedGroups = useMemo(() => {
        const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;
        const searchScope = activeProject?.searchScope || 'project';

        let filtered = groups;
        if (activeProjectId) {
            const shouldFilterByProject = search === '' || searchScope === 'project';
            if (shouldFilterByProject) {
                filtered = groups.filter(group => group.projectId === activeProjectId);
            }
        }

        filtered = filtered.filter(group => groupMatchesSearch(group, tags, search));

        return sortGroupsWithPinning(filtered, currentSortOrder);
    }, [groups, tags, search, currentSortOrder, activeProjectId, projects]);

    const visibleTabRowsForPerformance = useMemo(() => (
        countVisibleTabRowsForGroupList(filteredAndSortedGroups, {
            collapsedGroups,
            search,
        })
    ), [collapsedGroups, filteredAndSortedGroups, search]);

    const useHeavyGroupCards = shouldUseHeavyGroupCards({
        layoutMode,
        visibleTabRows: visibleTabRowsForPerformance,
    });
    const useSequentialMasonry = shouldUseSequentialMasonry({
        layoutMode,
        visibleTabRows: visibleTabRowsForPerformance,
    });

    // Get project for a group
    const getGroupProject = (group: TabGroup): Project | undefined => {
        return group.projectId ? projects.find(p => p.id === group.projectId) : undefined;
    };

    // Render the menu content for a group
    const renderGroupMenu = (group: TabGroup) => (
        <GroupMenu
            group={group}
            settings={settings}
            projects={projects}
            isPro={isPro}
            bluet_sharedRefs={bluet_sharedRefs}
            onOpenTagModal={onOpenTagModal}
            onOpenNotesModal={onOpenNotesModal}
            onToggleLock={onToggleLock}
            onCopyLinks={onCopyGroupLinks}
            onShareToBluet={onShareToBluet}
            onShowInfo={(id) => { setInfoGroupId(id); }}
            onSaveOffline={onSaveOfflineGroup}
            offlineState={offlineStateForGroup ? offlineStateForGroup(group.id, group.tabs.length) : 'none'}
            onArchive={onArchiveGroup}
            onSetReminder={(g) => { setReminderTarget(g); }}
            onAssignToProject={onAssignToProject}
            onDelete={onDeleteGroup}
        />
    );

    // Common card props factory
    const getCardProps = (group: TabGroup, tabLayout: 'grid' | 'masonry' | 'dashboard') => ({
        key: group.id,
        group,
        tags,
        project: getGroupProject(group),
        isPinned: isPinned(group.id),
        isSelected: selectedGroups.has(group.id),
        isDragOver: dragOverGroupId === group.id,
        bulkMode,
        isCollapsed: collapsedGroups.get(group.id) || false,
        editingId,
        editName,
        tabLayout,
        heavyTabPreview: tabLayout === 'grid' && useHeavyGroupCards,
        tabUrlDisplay: settings.tabUrlDisplay,
        groupNotesDisplay: settings.groupNotesDisplay,
        onEditNotes: () => onOpenNotesModal(group.id),
        onTogglePin: () => togglePin(group.id),
        onToggleSelect: () => toggleGroupSelection(group.id),
        onToggleCollapse: () => toggleCollapse(group.id),
        onOpenTab: (url: string, tabId: string) => openTab(url, tabId, group.id),
        onCopyLink: (url: string) => {
            navigator.clipboard.writeText(url);
            ToastManager.getInstance().success(t('options.groupList.linkCopied'));
        },
        onDragEnter: (e: React.DragEvent) => handleGroupDragEnter(e, group.id),
        onDragOver: (e: React.DragEvent) => handleGroupDragOver(e, group.id),
        onDragLeave: handleGroupDragLeave,
        onDrop: (e: React.DragEvent) => handleGroupDrop(e, group.id),
        onTabDragStart: (e: React.DragEvent, tab: TabItem) => handleTabDragStart(e, tab, group.id),
        onTabDragEnd: handleTabDragEnd,
        onRestoreGroup: () => onRestoreGroup(group),
        onStartEdit: () => startEdit(group),
        onSaveEdit: saveEdit,
        onCancelEdit: cancelEdit,
        onEditNameChange: (value: string) => setEditName(value),
        menuContent: renderGroupMenu(group),
        searchQuery: search,
        hasReminder: showReminderBadge && reminderTargetIds.has(group.id),
        offlineArticles,
        offlineInFlight,
        offlineFailures,
        onRetryOffline,
    });

    const localizedSortOptions = useMemo(() => (
        SORT_OPTIONS.map((option) => ({
            ...option,
            label: t(`options.groupList.sort.${option.value}`),
        }))
    ), [t]);

    const emptyState = (
        <div className="flex flex-col items-center px-6 py-16 text-center">
            <Layers className="mb-3 h-6 w-6 text-text-muted" />
            <p className="text-sm text-text-muted">{t('options.groupList.empty')}</p>
        </div>
    );

    return (
        <>
            {/* Header */}
            <header className="sticky top-0 z-50 flex flex-wrap lg:flex-nowrap items-center gap-2 border-b border-border-glass bg-glass-bg backdrop-blur-md px-4 py-2 lg:py-0 lg:h-16">
                {sidebarTrigger}
                <div className="flex items-center gap-2">
                    <Layers className="h-5 w-5 text-primary" />
                    <div>
                        <h1 className="text-lg font-semibold text-text-strong">{t('options.groupList.title')}</h1>
                        {/* Header stats are decorative metadata — hidden under
                            Default Simplify. Action buttons in the header row
                            stay visible. */}
                        <p className="text-xs text-text-muted leading-tight bt-decor">
                            {t('options.groupList.stats', {
                                groups: isolateBidi(formatNumber(stats.totalGroups), 'ltr'),
                                tabs: isolateBidi(formatNumber(stats.totalTabs), 'ltr'),
                            })}
                        </p>
                    </div>
                </div>
                {/* Row 1 on mobile: Layout */}
                <div className="flex items-center gap-2 w-full lg:w-auto lg:ms-auto">

                    {/* Layout Toggle */}
                    <div className="flex h-9 items-center gap-0.5 rounded-full border border-border-glass bg-accent p-1 lg:ms-4">
                        <button
                            onClick={() => setLayoutMode('grid')}
                            className={`flex h-7 w-9 items-center justify-center rounded-full transition-all duration-slow ${layoutMode === 'grid'
                                ? 'bg-segment text-text-strong shadow-md'
                                : 'text-text-muted hover:text-text-strong'
                                }`}
                            aria-pressed={layoutMode === 'grid'}
                            title={t('options.groupList.layoutGrid')}
                        >
                            <Grid3X3 className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setLayoutMode('masonry')}
                            className={`flex h-7 w-9 items-center justify-center rounded-full transition-all duration-slow ${layoutMode === 'masonry'
                                ? 'bg-segment text-text-strong shadow-md'
                                : 'text-text-muted hover:text-text-strong'
                                }`}
                            aria-pressed={layoutMode === 'masonry'}
                            title={t('options.groupList.layoutMasonry')}
                        >
                            <LayoutDashboard className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setLayoutMode('dashboard')}
                            className={`flex h-7 w-9 items-center justify-center rounded-full transition-all duration-slow ${layoutMode === 'dashboard'
                                ? 'bg-segment text-text-strong shadow-md'
                                : 'text-text-muted hover:text-text-strong'
                                }`}
                            aria-pressed={layoutMode === 'dashboard'}
                            title={t('options.groupList.layoutDashboard')}
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Row 2 on mobile: Search + Edit */}
                <div className="flex items-center gap-2 w-full lg:w-auto lg:flex-1 lg:ms-8 lg:me-8">
                    <div className="flex-1">
                        <InputGroup>
                            <InputGroupInput
                                type="text"
                                placeholder={t('options.groupList.searchPlaceholder')}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="text-sm"
                            />
                            <InputGroupAddon align="inline-end">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button className="flex items-center gap-1 text-xs font-medium text-text-strong hover:text-text-strong transition-colors px-2">
                                            {localizedSortOptions.find(opt => opt.value === currentSortOrder)?.label || t('options.groupList.sortFallback')}
                                            <ChevronDown className="size-3" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        {localizedSortOptions.map(option => (
                                            <DropdownMenuItem
                                                key={option.value}
                                                onClick={() => changeSortOrder(option.value as SortOrder)}
                                            >
                                                {option.label}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </InputGroupAddon>
                        </InputGroup>
                    </div>

                    {/* Edit button */}
                    <Button
                        onClick={toggleBulkMode}
                        variant="secondary"
                        size="sm"
                        className="px-3 flex-shrink-0"
                        title={t('common.edit')}
                    >
                        {bulkMode ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                        <span className="hidden lg:inline ms-1.5">{t('common.edit')}</span>
                    </Button>
                </div>
            </header>

            {bulkEditToolbar}

            {/* Groups List */}
            <div
                data-layout-mode={layoutMode}
                className={`options-groups-list mx-auto py-6 sm:py-8 ${layoutMode === 'grid' ? 'max-w-7xl px-4 sm:px-6 lg:px-8' : 'px-4 sm:px-6 lg:px-8'}`}
            >
                {layoutMode === 'dashboard' ? (
                    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {filteredAndSortedGroups.length === 0 ? (
                            <div className="col-span-full">{emptyState}</div>
                        ) : (
                            filteredAndSortedGroups.map(group => (
                                <MasonryGroupCard {...getCardProps(group, 'dashboard')} />
                            ))
                        )}
                    </div>
                ) : layoutMode === 'masonry' ? (
                    <ResponsiveMasonry columnsCountBreakPoints={{ 0: 1, 900: 2, 1350: 3, 1800: 4 }}>
                        <Masonry gutter="1rem" sequential={useSequentialMasonry}>
                            {filteredAndSortedGroups.length === 0 ? (
                                emptyState
                            ) : (
                                filteredAndSortedGroups.map(group => (
                                    <MasonryGroupCard {...getCardProps(group, 'masonry')} />
                                ))
                            )}
                        </Masonry>
                    </ResponsiveMasonry>
                ) : (
                    <div className="space-y-3 sm:space-y-4">
                        {filteredAndSortedGroups.length === 0 ? (
                            emptyState
                        ) : (
                            filteredAndSortedGroups.map(group => (
                                <MasonryGroupCard {...getCardProps(group, 'grid')} />
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Group Info Modal */}
            <GroupInfoModal
                group={groups.find(g => g.id === infoGroupId) ?? null}
                tags={tags}
                projects={projects}
                onClose={() => setInfoGroupId(null)}
            />

            {/* Reminder Quick Picker */}
            {reminderTarget && (
                <ReminderQuickPicker
                    open={!!reminderTarget}
                    onOpenChange={(open) => { if (!open) setReminderTarget(null); }}
                    group={reminderTarget}
                />
            )}
        </>
    );
}
