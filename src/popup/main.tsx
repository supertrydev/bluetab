import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Storage } from '../utils/storage';
import { normalizeUrl } from '../utils/normalize';
import { deduplicateTabs, filterDuplicatesBySettings } from '../utils/dedupe';
import { TagManager } from '../utils/tags';
import { sortGroupsWithPinning, getDefaultSettings } from '../utils/sorting';
import { ThemeManager } from '../utils/theme';
import { textSizeService } from '../utils/TextSizeService';
import { ConfirmModal } from '../components/ConfirmModal';
import Logo from '../components/Logo';
import { migrateFromPersistentState, loadCollapsedStates, saveGroupState, removeGroupState, cleanupOrphanedStates } from '../utils/collapsed-state';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import PinButton from '../components/PinButton';
import usePinManagement from '../hooks/usePinManagement';
import { PinnedSectionHeader } from '../components/PinnedGroupIndicator';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import type { TabGroup, TabItem, Tag, Settings } from '../types/models';
import { Toaster } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { AICommandSidebar } from './components/AICommandSidebar';
import { Bot, ChevronRight, ChevronDown, RotateCcw } from 'lucide-react';
import '../styles/tailwind.css';
import '../styles/navbar/index.css';
import '../styles/popup-header.css';
import '../styles/pin-indicators.css';
import { color } from 'framer-motion';

function App() {
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
    const [isAISidebarOpen, setIsAISidebarOpen] = useState(false);

    // Pin management
    const pinManagement = usePinManagement(groups);


    useEffect(() => {
        initializeApp();

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
    }, []);

    const initializeApp = async () => {
        const settings = await Storage.get<Settings>('settings');
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
    };

    const loadGroups = async () => {
        const stored = await Storage.get<TabGroup[]>('groups') || [];
        const storedTags = await Storage.get<Tag[]>('tags') || [];
        // Migrate groups with pin data
        const migratedGroups = await Storage.migrateExistingGroups(stored);
        setGroups(migratedGroups);
        setTags(storedTags);
        await loadCollapsedState(migratedGroups);
    };

    const loadCollapsedState = async (currentGroups?: TabGroup[]) => {
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
    };

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
            const tabs = await chrome.tabs.query({ currentWindow: true });

            // Get settings for filtering
            const storedSettings = await Storage.get<Settings>('settings');
            const mergedSettings = { ...getDefaultSettings(), ...storedSettings };

            // Filter out extension pages but keep regular web pages
            let tabsToSave = tabs.filter(tab =>
                tab.url &&
                !tab.url.startsWith('chrome-extension://') &&
                !tab.url.startsWith('chrome://') &&
                !tab.url.startsWith('edge://') &&
                !tab.url.startsWith('about:') &&
                !tab.url.startsWith('moz-extension://') &&
                tab.url !== 'about:blank'
            );

            // Apply pinned tabs filter
            if (mergedSettings.pinnedTabsMode === 'exclude') {
                tabsToSave = tabsToSave.filter(tab => !tab.pinned);
            }

            if (tabsToSave.length === 0) {
                alert('No tabs to save');
                return;
            }

            const tabItems: TabItem[] = tabsToSave.map(tab => ({
                id: crypto.randomUUID(),
                url: normalizeUrl(tab.url || ''),
                title: tab.title || '',
                favicon: tab.favIconUrl,
                timestamp: Date.now(),
                groupId: 'current',
                pinned: tab.pinned
            }));

            // Apply duplicate filtering based on settings
            const filteredTabs = filterDuplicatesBySettings(tabItems, groups, mergedSettings);
            const dedupedTabs = deduplicateTabs(filteredTabs);

            const newGroup: TabGroup = {
                id: crypto.randomUUID(),
                name: `Session ${new Date().toLocaleTimeString()}`,
                tabs: dedupedTabs,
                created: Date.now(),
                modified: Date.now()
            };

            const updatedGroups = [...groups, newGroup];
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);

            // Close saved tabs
            const tabIdsToClose = tabsToSave.map(tab => tab.id).filter(id => id !== undefined) as number[];
            if (tabIdsToClose.length > 0) {
                await chrome.tabs.remove(tabIdsToClose);
            }

            // Open BlueTab manager if enabled (single tab enforcement)
            const currentSettings = await Storage.getSettings();
            if (currentSettings.openManagerAfterSave !== false) {
                await chrome.runtime.sendMessage({ type: 'OPEN_BLUETAB_PAGE', pagePath: 'src/options/index.html' });
            }

            // Close the popup
            window.close();
        } catch (error) {
            alert('Failed to save tabs: ' + (error as Error).message);
        }
    };

    const restoreGroup = async (group: TabGroup) => {
        try {
            const settings = await Storage.get<Settings>('settings') || { restoreMode: 'smart' };
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
            alert('Failed to restore tabs: ' + (error as Error).message);
        }
    };

    const showDeleteGroupModal = (groupId: string) => {
        setDeleteTarget(groupId);
        setShowDeleteModal(true);
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
            alert('Failed to delete group: ' + (error as Error).message);
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
            alert('Failed to save group name: ' + (error as Error).message);
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



    const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                if (data.groups && Array.isArray(data.groups)) {
                    // Regenerate IDs to avoid conflicts
                    const safeGroups = data.groups.map((group: TabGroup) => ({
                        ...group,
                        id: crypto.randomUUID(),
                        tabs: group.tabs.map(tab => ({
                            ...tab,
                            id: crypto.randomUUID()
                        })),
                        modified: Date.now()
                    }));

                    const importedGroups = [...groups, ...safeGroups];
                    await Storage.set('groups', importedGroups);
                    setGroups(importedGroups);
                    alert(`Imported ${data.groups.length} groups successfully!`);
                }
            } catch (error) {
                alert('Invalid backup file format!');
            }
        };
        reader.readAsText(file);

        // Reset file input
        event.target.value = '';
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

    const filteredGroups = [...pinnedGroups, ...unpinnedGroups];

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

            {/* Action Buttons & AI */}
            <div className="flex gap-2 mb-3">
                <Button
                    onClick={saveAllTabs}
                    size="sm"
                    variant="primary"
                    className="flex-1 whitespace-nowrap h-8 text-xs"
                >
                    Save All Tabs
                </Button>
                <Button
                    onClick={() => chrome.runtime.sendMessage({ type: 'OPEN_BLUETAB_PAGE', pagePath: 'src/options/index.html' })}
                    variant="secondary"
                    size="sm"
                    className="flex-1 whitespace-nowrap h-8 text-xs"
                >
                    Open Manager
                </Button>
                <Button
                    onClick={() => setIsAISidebarOpen(true)}
                    size="sm"
                    variant="secondary"
                    className="px-3 h-8"
                    title="AI Command"
                >
                    <Bot className="w-4 h-4" />
                </Button>
            </div>

            {/* Divider */}
            {/* <div className="h-px bg-gray-200 dark:bg-gray-700 mb-3 mx-1" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}></div> */}

            {/* Search */}
            <div className="flex gap-2 mb-3">
                <Input
                    type="text"
                    placeholder="Search tabs..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="text-xs flex-1 h-8"
                />
            </div>

            {/* Content Section - Scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300/60 dark:[&::-webkit-scrollbar-thumb]:bg-gray-600/60 hover:[&::-webkit-scrollbar-thumb]:bg-gray-400/80 dark:hover:[&::-webkit-scrollbar-thumb]:bg-gray-500/80">
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
                                                placeholder="Group name..."
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
                                                Save
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
                                                Cancel
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
                                                    title={collapsedGroups.get(group.id) ? "Expand group" : "Collapse group"}
                                                    aria-expanded={!collapsedGroups.get(group.id)}
                                                    aria-controls={`group-content-${group.id}`}
                                                    aria-label={`${collapsedGroups.get(group.id) ? 'Expand' : 'Collapse'} group ${group.name} with ${group.tabs.length} tabs`}
                                                >
                                                    {collapsedGroups.get(group.id) ? <ChevronRight className="w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform duration-200" /> : <ChevronDown className="w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform duration-200" />}
                                                </button>
                                                <h3
                                                    className="font-medium text-sm cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 text-gray-900 dark:text-gray-100 flex-1 truncate"
                                                    onClick={() => startEdit(group)}
                                                    title="Click to rename"
                                                >
                                                    {group.name}
                                                    {collapsedGroups.get(group.id) && (
                                                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-1 font-normal">
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
                                                    title="Restore group"
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
                                        <p className="text-xs text-gray-500 dark:text-gray-400">{group.tabs.length} tabs</p>
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
                                                        {tag.name}
                                                    </span>
                                                ))}
                                                {group.tags.length > 3 && (
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                                        +{group.tags.length - 3} more
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
                                                <span className="truncate text-gray-700 dark:text-gray-300" title={tab.title}>
                                                    {tab.title}
                                                </span>
                                            </div>
                                        ))}
                                        {group.tabs.length > 3 && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                +{group.tabs.length - 3} more tabs
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
                                        placeholder="Group name..."
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
                                        Save
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
                                        Cancel
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
                                            title={collapsedGroups.get(group.id) ? "Expand group" : "Collapse group"}
                                            aria-expanded={!collapsedGroups.get(group.id)}
                                            aria-controls={`group-content-${group.id}`}
                                            aria-label={`${collapsedGroups.get(group.id) ? 'Expand' : 'Collapse'} group ${group.name} with ${group.tabs.length} tabs`}
                                        >
                                            {collapsedGroups.get(group.id) ? <ChevronRight className="w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform duration-200" /> : <ChevronDown className="w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform duration-200" />}
                                        </button>
                                        <h3
                                            className="font-medium text-sm cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 text-gray-900 dark:text-gray-100 flex-1 truncate"
                                            onClick={() => startEdit(group)}
                                            title="Click to rename"
                                        >
                                            {group.name}
                                            {collapsedGroups.get(group.id) && (
                                                <span className="text-xs text-gray-500 dark:text-gray-400 ml-1 font-normal">
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
                                            title="Restore group"
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
                                <p className="text-xs text-gray-500 dark:text-gray-400">{group.tabs.length} tabs</p>
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
                                                {tag.name}
                                            </span>
                                        ))}
                                        {group.tags.length > 3 && (
                                            <span className="text-xs text-gray-400">+{group.tags.length - 3}</span>
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
                    if (!deleteTarget) return "Delete Group";
                    const group = groups.find(g => g.id === deleteTarget);
                    if (group && pinManagement.isPinned(group.id)) {
                        return "⚠️ Delete Pinned Group";
                    }
                    return "Delete Group";
                })()}
                message={(() => {
                    if (!deleteTarget) return "Are you sure you want to delete this group permanently? This action cannot be undone.";
                    const group = groups.find(g => g.id === deleteTarget);
                    if (group && pinManagement.isPinned(group.id)) {
                        return `⚠️ WARNING: "${group.name}" is currently PINNED to the top of your list.\n\nDeleting this group will:\n• Remove all ${group.tabs.length} tabs permanently\n• Remove the pin status\n• This action cannot be undone\n\nAre you absolutely sure you want to delete this pinned group?`;
                    }
                    return "Are you sure you want to delete this group permanently? This action cannot be undone.";
                })()}
                confirmText={(() => {
                    if (!deleteTarget) return "Delete";
                    const group = groups.find(g => g.id === deleteTarget);
                    if (group && pinManagement.isPinned(group.id)) {
                        return "Yes, Delete Pinned Group";
                    }
                    return "Delete";
                })()}
                cancelText="Cancel"
                onConfirm={handleDeleteConfirm}
                onCancel={handleDeleteCancel}
                type="danger"
            />

            <AICommandSidebar
                isOpen={isAISidebarOpen}
                onClose={() => setIsAISidebarOpen(false)}
            />

            <Toaster richColors position="bottom-right" />
        </div>
    );
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
    <ErrorBoundary>
        <App />
    </ErrorBoundary>
);
