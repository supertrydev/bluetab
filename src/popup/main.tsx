import { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Storage } from '../utils/storage';
import { TagManager } from '../utils/tags';
import { sortGroupsWithPinning, getDefaultSettings } from '../utils/sorting';
import { ThemeManager } from '../utils/theme';
import { textSizeService } from '../utils/TextSizeService';
import { ConfirmModal } from '../components/ConfirmModal';
import { saveCurrentWindowTabs } from '../services/save-current-window-tabs';
import Logo from '../components/Logo';
import { migrateFromPersistentState, loadCollapsedStates, saveGroupState, removeGroupState, cleanupOrphanedStates } from '../utils/collapsed-state';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import { recordGroupActivity } from '../utils/group-activity';
import PinButton from '../components/PinButton';
import usePinManagement from '../hooks/usePinManagement';
import { PinnedSectionHeader } from '../components/PinnedGroupIndicator';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import type { TabGroup, Tag, Settings } from '../types/models';
import { ToastManager, Toaster } from '@/components/Toast';
import { LocaleDirectionProvider } from '@/components/LocaleDirectionProvider';
import { initI18n, setDocumentTitle } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { PomodoroStatus } from '@/components/PomodoroStatus';
import { useSimplifyMode } from '@/hooks/useSimplifyMode';
import { ChevronRight, ChevronDown, RotateCcw, Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDirection } from '@radix-ui/react-direction';
import '../styles/tailwind.css';
import '../styles/navbar/index.css';
import '../styles/popup-header.css';
import '../styles/pin-indicators.css';


function App() {
    const { t } = useTranslation();
    const direction = useDirection();
    // Phase 9 Plan 09-04 — flip Simplify Mode data attributes on <html>.
    useSimplifyMode();

    const [groups, setGroups] = useState<TabGroup[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [search, setSearch] = useState('');
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Map<string, boolean>>(new Map());
    const [, setIsStateLoaded] = useState(false);
    const [isTogglingState, setIsTogglingState] = useState<Set<string>>(new Set());

    // Pin management
    const pinManagement = usePinManagement(groups);


    const loadCollapsedState = useCallback(async (currentGroups?: TabGroup[]) => {
        try {
            const allStates = await loadCollapsedStates();
            setCollapsedGroups(allStates);

            // Cleanup orphaned states if groups are provided
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
        // Migrate groups with pin data
        const migratedGroups = await Storage.migrateExistingGroups(stored);
        setGroups(migratedGroups);
        setTags(storedTags);
        await loadCollapsedState(migratedGroups);
    }, [loadCollapsedState]);

    const initializeApp = useCallback(async () => {
        const settings = await Storage.get<Settings>('settings') ?? getDefaultSettings();
        ThemeManager.initializeTheme(settings);

        // Initialize text size service
        try {
            await textSizeService.initialize();
        } catch (error) {
            console.error('Failed to initialize text size service:', error);
        }

        // Migrate from old persistent state if needed
        try {
            await migrateFromPersistentState();
        } catch (error) {
            console.error('Migration failed (non-critical):', error);
        }

        await loadGroups();
    }, [loadGroups]);

    useEffect(() => {
        void initializeApp();

        // Listen for storage changes to auto-update interface
        const handleStorageChange = async (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.groups) {
                const newGroups = changes.groups.newValue || [];
                // Migrate groups with pin data
                const migratedGroups = await Storage.migrateExistingGroups(newGroups);
                setGroups(migratedGroups);
                // Cleanup orphaned states when groups change
                const validIds = new Set(migratedGroups.map(g => g.id));
                await cleanupOrphanedStates(validIds);
            }
            if (changes.tags) {
                const newTags = changes.tags.newValue || [];
                setTags(newTags);
            }
            if (changes.pinSettings) {
                // Pin settings changed - reload groups with updated pin data
                await loadGroups();
            }
            // Listen for collapsed state changes
            if (changes.collapsedGroups) {
                const newCollapsedGroups = changes.collapsedGroups.newValue || {};
                setCollapsedGroups(new Map(Object.entries(newCollapsedGroups)));
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);

        return () => {
            chrome.storage.onChanged.removeListener(handleStorageChange);
        };
    }, [initializeApp, loadGroups]);

    const toggleCollapse = async (groupId: string) => {
        // Prevent multiple simultaneous toggles on same group
        if (isTogglingState.has(groupId)) return;

        const currentCollapsed = collapsedGroups.get(groupId) || false;
        const newCollapsed = !currentCollapsed;

        // Add to toggling state for loading indication
        setIsTogglingState(prev => new Set(prev).add(groupId));

        // Update UI immediately for responsiveness
        const newState = new Map(collapsedGroups);
        newState.set(groupId, newCollapsed);
        setCollapsedGroups(newState);

        // Save to storage
        try {
            await saveGroupState(groupId, newCollapsed);
        } catch (error) {
            console.error('Failed to save collapsed state:', error);
            // Revert UI state on error
            const revertedState = new Map(collapsedGroups);
            revertedState.set(groupId, currentCollapsed);
            setCollapsedGroups(revertedState);
        } finally {
            // Remove from toggling state
            setIsTogglingState(prev => {
                const newSet = new Set(prev);
                newSet.delete(groupId);
                return newSet;
            });
        }
    };


    const saveAllTabs = async () => {
        try {
            const result = await saveCurrentWindowTabs({ now: Date.now() });
            if (!result || result.processedCount === 0) {
                ToastManager.getInstance().warning({ key: 'feedback.noTabsToSave' });
                return;
            }
            setGroups(result.savedGroups);

            // Open BlueTab manager if enabled (single tab enforcement)
            const currentSettings = await Storage.getSettings();
            if (currentSettings.openManagerAfterSave !== false) {
                await chrome.runtime.sendMessage({ type: 'OPEN_BLUETAB_PAGE', pagePath: 'src/options/index.html' });
            }

            // Close the popup
            window.close();
        } catch (error) {
            ToastManager.getInstance().error({
                key: 'feedback.failedToSaveTabs',
                values: { message: (error as Error).message },
            });
        }
    };

    const restoreGroup = async (group: TabGroup) => {
        try {
            const settings = await Storage.get<Settings>('settings') ?? getDefaultSettings();
            const restoreMode = settings.restoreMode || 'smart';

            // Get current window tabs to determine behavior
            const currentTabs = await chrome.tabs.query({ currentWindow: true });

            let shouldCreateNewWindow = false;

            switch (restoreMode) {
                case 'newWindow':
                    shouldCreateNewWindow = true;
                    break;
                case 'currentWindow':
                    shouldCreateNewWindow = false;
                    break;
                case 'smart':
                    // Smart mode: new window if current window has more than just BlueTab popup
                    const nonBlueTabTabs = currentTabs.filter(tab =>
                        tab.url && !tab.url.includes('src/popup/index.html') && !tab.url.includes('src/options/index.html') && !tab.url.includes('src/settings/index.html')
                    );
                    shouldCreateNewWindow = nonBlueTabTabs.length > 0;
                    break;
            }

            if (shouldCreateNewWindow) {
                // Create new window with first tab
                if (group.tabs.length > 0) {
                    const newWindow = await chrome.windows.create({
                        url: group.tabs[0].url,
                        focused: true
                    });

                    // Add remaining tabs to the new window
                    for (let i = 1; i < group.tabs.length; i++) {
                        await chrome.tabs.create({
                            url: group.tabs[i].url,
                            windowId: newWindow.id
                        });
                    }
                }
            } else {
                // Add tabs to current window
                for (const tab of group.tabs) {
                    await chrome.tabs.create({ url: tab.url });
                }
            }

            // Handle restore behavior (remove from list or keep in list)
            const restoreBehavior = settings.restoreBehavior || 'removeFromList';
            await recordGroupActivity(group.id);
            if (restoreBehavior === 'removeFromList') {
                // Group Memory: Remember the group before removing (if enabled)
                if (settings.groupMemoryEnabled !== false && settings.groupMemoryAutoRemember !== false) {
                    await GroupMemoryStorageService.rememberGroup(group);
                }

                // Remove the group from the list
                const updatedGroups = groups.filter(g => g.id !== group.id);
                await Storage.set('groups', updatedGroups);
                setGroups(updatedGroups);
            }

            // Close popup after restoring
            window.close();
        } catch (error) {
            ToastManager.getInstance().error({
                key: 'feedback.failedToRestoreTabs',
                values: { message: (error as Error).message },
            });
        }
    };

    const deleteGroup = async (groupId: string) => {
        try {
            // Group Memory: Forget the group when manually deleted (user explicitly wants it gone)
            await GroupMemoryStorageService.forgetGroup(groupId);

            const updatedGroups = groups.filter(g => g.id !== groupId);
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);

            // Remove the group's collapsed state
            try {
                await removeGroupState(groupId);

                // Update local state immediately
                const newCollapsedState = new Map(collapsedGroups);
                newCollapsedState.delete(groupId);
                setCollapsedGroups(newCollapsedState);
            } catch (stateError) {
                console.error('Failed to remove group state:', stateError);
                // Non-critical error, don't interrupt the main operation
            }
        } catch (error) {
            ToastManager.getInstance().error({
                key: 'feedback.failedToDeleteGroup',
                values: { message: (error as Error).message },
            });
        }
    };

    const startEdit = (group: TabGroup) => {
        setEditingId(group.id);
        setEditName(group.name);
    };

    const saveEdit = async () => {
        if (!editingId || !editName.trim()) return;

        try {
            const updatedGroups = groups.map(g =>
                g.id === editingId
                    ? { ...g, name: editName.trim(), modified: Date.now() }
                    : g
            );

            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);

            setEditingId(null);
            setEditName('');
        } catch (error) {
            ToastManager.getInstance().error({
                key: 'feedback.failedToSaveGroupName',
                values: { message: (error as Error).message },
            });
        }
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditName('');
    };

    const handleDeleteConfirm = async () => {
        setShowDeleteModal(false);
        if (deleteTarget) {
            const group = groups.find(g => g.id === deleteTarget);
            // If the group is pinned, unpin it first
            if (group && pinManagement.isPinned(group.id)) {
                await pinManagement.togglePin(group.id);
            }
            await deleteGroup(deleteTarget);
        }
        setDeleteTarget(null);
    };

    const handleDeleteCancel = () => {
        setShowDeleteModal(false);
        setDeleteTarget(null);
    };
    const { pinnedGroups, unpinnedGroups } = (() => {
        const filtered = groups.filter(group => {
            const searchLower = search.toLowerCase();
            const matchesName = group.name.toLowerCase().includes(searchLower);
            const matchesTabs = group.tabs.some(tab =>
                tab.title.toLowerCase().includes(searchLower) ||
                tab.url.toLowerCase().includes(searchLower)
            );
            const matchesTags = group.tags && group.tags.length > 0 &&
                TagManager.getTagsByIds(group.tags, tags).some(tag =>
                    tag.name.toLowerCase().includes(searchLower)
                );

            return matchesName || matchesTabs || matchesTags;
        });

        // Use enhanced sorting with pinning
        const sorted = sortGroupsWithPinning(filtered, 'newest');

        // Separate pinned and unpinned for visual grouping
        const pinned = sorted.filter(g => pinManagement.isPinned(g.id));
        const unpinned = sorted.filter(g => !pinManagement.isPinned(g.id));

        return { pinnedGroups: pinned, unpinnedGroups: unpinned };
    })();

    return (
        <div className="popup-container bg-bg-0 px-3 pb-3 pt-1 h-[600px] flex flex-col overflow-hidden">
            {/* Centered Logo */}
            <div className="flex justify-center mb-2" style={{ marginTop: '-20px', marginBottom: '-10px' }}>
                <Logo
                    size="popup"
                    variant="auto"
                    animated={true}
                    withClearSpace={false}
                />
            </div>

            <PomodoroStatus />

            {/* Action Buttons */}
            <div className="flex gap-2 mb-3">
                <Button
                    onClick={saveAllTabs}
                    size="sm"
                    variant="primary"
                    className="flex-1 whitespace-nowrap h-8 text-xs"
                >
                    {t('popup.saveAllTabs')}
                </Button>
                <Button
                    onClick={() => chrome.runtime.sendMessage({ type: 'OPEN_BLUETAB_PAGE', pagePath: 'src/options/index.html' })}
                    variant="secondary"
                    size="sm"
                    className="flex-1 whitespace-nowrap h-8 text-xs"
                >
                    {t('popup.openManager')}
                </Button>
            </div>

            {/* Divider */}
            {/* <div className="h-px bg-gray-200 dark:bg-gray-700 mb-3 mx-1" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}></div> */}

            {/* Search */}
            <div className="flex gap-2 mb-3">
                <Input
                    type="text"
                    placeholder={t('popup.searchPlaceholder')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="text-xs flex-1 h-8"
                />
            </div>

            {/* Content Section - Scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pe-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300/60 dark:[&::-webkit-scrollbar-thumb]:bg-gray-600/60 hover:[&::-webkit-scrollbar-thumb]:bg-gray-400/80 dark:hover:[&::-webkit-scrollbar-thumb]:bg-gray-500/80">
                {/* Pinned Groups Section */}
                {pinnedGroups.length > 0 && (
                    <>
                        <PinnedSectionHeader count={pinnedGroups.length} />
                        {pinnedGroups.map(group => (
                            <div key={group.id} className="border border-border rounded-md p-3 bg-bg-1 group-pinned">
                                {/* Group content here - same as below */}
                                <div className="flex justify-between items-center mb-1">
                                    {editingId === group.id ? (
                                        <div className="flex-1 flex items-center gap-2">
                                            <Input
                                                type="text"
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') saveEdit();
                                                    if (e.key === 'Escape') cancelEdit();
                                                }}
                                                placeholder={t('popup.groupNamePlaceholder')}
                                                autoFocus
                                                className="flex-1 h-8"
                                            />
                                            <Button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    saveEdit();
                                                }}
                                                size="sm"
                                                className="h-8 bg-green-600 hover:bg-green-700"
                                            >
                                                {t('common.save')}
                                            </Button>
                                            <Button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    cancelEdit();
                                                }}
                                                size="sm"
                                                variant="secondary"
                                                className="h-8"
                                            >
                                                {t('common.cancel')}
                                            </Button>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleCollapse(group.id);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            toggleCollapse(group.id);
                                                        }
                                                    }}
                                                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                                    title={collapsedGroups.get(group.id)
                                                        ? t('popup.expandGroup')
                                                        : t('popup.collapseGroup')}
                                                    aria-expanded={!collapsedGroups.get(group.id)}
                                                    aria-controls={`group-content-${group.id}`}
                                                    aria-label={collapsedGroups.get(group.id)
                                                        ? t('popup.expandGroupAria', { name: isolateBidi(group.name), count: group.tabs.length })
                                                        : t('popup.collapseGroupAria', { name: isolateBidi(group.name), count: group.tabs.length })}
                                                >
                                                    {collapsedGroups.get(group.id) ? <ChevronRight className="w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform duration-200 rtl:rotate-180" /> : <ChevronDown className="w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform duration-200" />}
                                                </button>
                                                <h3
                                                    className="font-medium text-sm cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 text-gray-900 dark:text-gray-100 flex-1 truncate flex items-center gap-1"
                                                    onClick={() => startEdit(group)}
                                                    title={t('popup.clickToRename')}
                                                >
                                                    {pinManagement.isPinned(group.id) && <Pin className="w-3 h-3 text-muted-foreground shrink-0 rotate-45" />}
                                                    <bdi dir="auto">{group.name}</bdi>
                                                    {collapsedGroups.get(group.id) && (
                                                        <span dir="ltr" className="text-xs text-gray-500 dark:text-gray-400 ms-1 font-normal">
                                                            ({group.tabs.length})
                                                        </span>
                                                    )}
                                                </h3>
                                            </div>
                                            <div className="flex gap-1 items-center">
                                                <PinButton
                                                    groupId={group.id}
                                                    isPinned={pinManagement.isPinned(group.id)}
                                                    onToggle={pinManagement.togglePin}
                                                    size="small"
                                                />
                                                <Button
                                                    onClick={() => restoreGroup(group)}
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-950"
                                                    title={t('popup.restoreGroup')}
                                                >
                                                    <RotateCcw className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        </>
                                    )}
                                </div>
                                <div
                                    id={`group-content-${group.id}`}
                                    className={`tab-list-container transition-all duration-300 ease-out overflow-hidden ${collapsedGroups.get(group.id) ? 'max-h-0' : 'max-h-96'
                                        }`}
                                    aria-hidden={collapsedGroups.get(group.id)}
                                >
                                    <div className="space-y-1 pt-1">
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {t('popup.tabsCount', { count: group.tabs.length })}
                                        </p>
                                        {group.tags && group.tags.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {TagManager.getTagsByIds(group.tags, tags).slice(0, 3).map(tag => (
                                                    <span
                                                        key={tag.id}
                                                        className="px-2 py-0.5 text-xs rounded-md font-medium"
                                                        style={{
                                                            backgroundColor: `${tag.color}33`,
                                                            color: tag.color
                                                        }}
                                                    >
                                                        <bdi dir="auto">{tag.name}</bdi>
                                                    </span>
                                                ))}
                                                {group.tags.length > 3 && (
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                                        {t('popup.moreTags', { count: group.tags.length - 3 })}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {group.tabs.slice(0, 3).map(tab => (
                                            <div key={tab.id} className="flex items-center gap-2 text-xs">
                                                <img
                                                    src={tab.favicon || '/icons/default-favicon.png'}
                                                    alt=""
                                                    className="w-4 h-4 flex-shrink-0"
                                                    onError={(e) => {
                                                        e.currentTarget.src = '/icons/default-favicon.png';
                                                    }}
                                                />
                                                <span className="truncate text-gray-700 dark:text-gray-300" title={isolateBidi(tab.title)}>
                                                    <bdi dir="auto">{tab.title}</bdi>
                                                </span>
                                            </div>
                                        ))}
                                        {group.tabs.length > 3 && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {t('popup.moreTabs', { count: group.tabs.length - 3 })}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                        {unpinnedGroups.length > 0 && (
                            <div className="pinned-section-separator"></div>
                        )}
                    </>
                )}

                {/* Unpinned Groups Section */}
                {unpinnedGroups.map(group => (
                    <div key={group.id} className={`border border-border rounded-md p-3 bg-bg-1 ${pinManagement.isPinned(group.id) ? 'group-pinned' : ''
                        }`}>
                        <div className="flex justify-between items-center mb-1">
                            {editingId === group.id ? (
                                <div className="flex-1 flex items-center gap-2">
                                    <Input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveEdit();
                                            if (e.key === 'Escape') cancelEdit();
                                        }}
                                        placeholder={t('popup.groupNamePlaceholder')}
                                        autoFocus
                                        className="flex-1 h-8"
                                    />
                                    <Button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            saveEdit();
                                        }}
                                        size="sm"
                                        className="h-8 bg-green-600 hover:bg-green-700"
                                    >
                                        {t('common.save')}
                                    </Button>
                                    <Button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            cancelEdit();
                                        }}
                                        size="sm"
                                        variant="secondary"
                                        className="h-8"
                                    >
                                        {t('common.cancel')}
                                    </Button>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleCollapse(group.id);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    toggleCollapse(group.id);
                                                }
                                            }}
                                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                            title={collapsedGroups.get(group.id)
                                                ? t('popup.expandGroup')
                                                : t('popup.collapseGroup')}
                                            aria-expanded={!collapsedGroups.get(group.id)}
                                            aria-controls={`group-content-${group.id}`}
                                            aria-label={collapsedGroups.get(group.id)
                                                ? t('popup.expandGroupAria', { name: isolateBidi(group.name), count: group.tabs.length })
                                                : t('popup.collapseGroupAria', { name: isolateBidi(group.name), count: group.tabs.length })}
                                        >
                                            {collapsedGroups.get(group.id) ? <ChevronRight className="w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform duration-200 rtl:rotate-180" /> : <ChevronDown className="w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform duration-200" />}
                                        </button>
                                        <h3
                                            className="font-medium text-sm cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 text-gray-900 dark:text-gray-100 flex-1 truncate"
                                            onClick={() => startEdit(group)}
                                            title={t('popup.clickToRename')}
                                        >
                                            <bdi dir="auto">{group.name}</bdi>
                                            {collapsedGroups.get(group.id) && (
                                                <span dir="ltr" className="text-xs text-gray-500 dark:text-gray-400 ms-1 font-normal">
                                                    ({group.tabs.length})
                                                </span>
                                            )}
                                        </h3>
                                    </div>
                                    <div className="flex gap-1 items-center">
                                        <PinButton
                                            groupId={group.id}
                                            isPinned={pinManagement.isPinned(group.id)}
                                            onToggle={pinManagement.togglePin}
                                            size="small"
                                        />
                                        <Button
                                            onClick={() => restoreGroup(group)}
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-950"
                                            title={t('popup.restoreGroup')}
                                        >
                                            <RotateCcw className="w-3 h-3" />
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                        <div
                            id={`group-content-${group.id}`}
                            className={`tab-list-container transition-all duration-300 ease-out overflow-hidden ${collapsedGroups.get(group.id) ? 'max-h-0' : 'max-h-96'
                                }`}
                            aria-hidden={collapsedGroups.get(group.id)}
                        >
                            <div className="space-y-1 pt-1">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {t('popup.tabsCount', { count: group.tabs.length })}
                                </p>
                                {group.tags && group.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {TagManager.getTagsByIds(group.tags, tags).slice(0, 3).map(tag => (
                                            <span
                                                key={tag.id}
                                                className="px-2 py-0.5 text-xs rounded-md font-medium"
                                                style={{
                                                    backgroundColor: `${tag.color}33`,
                                                    color: tag.color
                                                }}
                                            >
                                                <bdi dir="auto">{tag.name}</bdi>
                                            </span>
                                        ))}
                                        {group.tags.length > 3 && (
                                            <span className="text-xs text-gray-400">
                                                {t('popup.moreTags', { count: group.tags.length - 3 })}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>


            <ConfirmModal
                isOpen={showDeleteModal}
                title={(() => {
                    if (!deleteTarget) return t('popup.deleteGroupTitle');
                    const group = groups.find(g => g.id === deleteTarget);
                    if (group && pinManagement.isPinned(group.id)) {
                        return t('popup.deletePinnedGroupTitle');
                    }
                    return t('popup.deleteGroupTitle');
                })()}
                message={(() => {
                    if (!deleteTarget) return t('popup.deleteGroupMessage');
                    const group = groups.find(g => g.id === deleteTarget);
                    if (group && pinManagement.isPinned(group.id)) {
                        return t('popup.deletePinnedGroupMessage', {
                                name: isolateBidi(group.name),
                            count: group.tabs.length,
                        });
                    }
                    return t('popup.deleteGroupMessage');
                })()}
                confirmText={(() => {
                    if (!deleteTarget) return t('common.delete');
                    const group = groups.find(g => g.id === deleteTarget);
                    if (group && pinManagement.isPinned(group.id)) {
                        return t('popup.deletePinnedConfirm');
                    }
                    return t('common.delete');
                })()}
                cancelText={t('common.cancel')}
                onConfirm={handleDeleteConfirm}
                onCancel={handleDeleteCancel}
                type="danger"
            />

            <Toaster richColors position={direction === 'rtl' ? 'bottom-left' : 'bottom-right'} />
        </div>
    );
}

async function mountPopupPage(): Promise<void> {
    await initI18n();
    setDocumentTitle('document.popupTitle');

    const container = document.getElementById('root');
    if (!container) {
        return;
    }

    const root = createRoot(container);
    root.render(
        <LocaleDirectionProvider>
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        </LocaleDirectionProvider>
    );
}

void mountPopupPage();
