import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Storage } from '../utils/storage';
import { normalizeUrl } from '../utils/normalize';
import { deduplicateTabs, filterDuplicatesBySettings } from '../utils/dedupe';
import { TagManager, TAG_COLORS } from '../utils/tags';
import { sortGroupsWithPinning, getDefaultSettings, getNormalizedGroupMenuConfig, SORT_OPTIONS, type SortOrder } from '../utils/sorting';
import { ThemeManager } from '../utils/theme';
import ThemeToggle from '../components/ThemeToggle';
import { textSizeService } from '../utils/TextSizeService';
import { ToastManager } from '../components/Toast';
import { ConfirmModal } from '../components/ConfirmModal';
import { GroupInfoModal } from '../components/GroupInfoModal';
import { Toaster } from 'sonner';
import { ArchiveModal as CreateArchiveModal, ArchiveOptions } from '../popup/components/modals/ArchiveModal';
import { ArchiveModal } from '../components/archive-modal';
import { useModal } from '../popup/components/modals/ModalWrapper';
import Logo from '../components/Logo';
import { migrateFromPersistentState, loadCollapsedStates, saveGroupState, saveMultipleStates, removeGroupState, cleanupOrphanedStates } from '../utils/collapsed-state';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import PinButton from '../components/PinButton';
import usePinManagement from '../hooks/usePinManagement';
import { PinnedSectionHeader } from '../components/PinnedGroupIndicator';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupButton } from '../components/ui/input-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { ChevronDown, Tags, Plus, Sparkles, X, PanelLeft, ArrowLeft, FolderPlus, Check, SquaresExclude } from 'lucide-react';
import { AppSidebar } from '../components/app-sidebar';
import {
    SidebarProvider,
    SidebarInset,
    SidebarTrigger,
} from '../components/ui/sidebar';
import { Separator } from '../components/ui/separator';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../components/ui/dialog';
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';
import { MasonryGroupCard } from '../components/MasonryGroupCard';
import { TabSelectionProvider, useTabSelectionContext } from '../contexts/TabSelectionContext';
import { TabSelectionToolbar } from '../components/TabSelectionToolbar';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useClickOutside } from '../hooks/useClickOutside';
import type { TabGroup, TabItem, Tag, Settings, Project } from '../types/models';
import { PROJECT_COLORS } from '../types/models';
import { ProjectModal, PROJECT_ICONS, getProjectBackgroundColor } from '../components/ProjectModal';
import { AddGroupToProjectModal } from '../components/AddGroupToProjectModal';
import { useAuth } from '../components/auth/useAuth';
import { BluetBridgeService } from '../services/bluet-bridge-service';
import type { BluetSharedRef } from '../types/bluet';
import '../styles/tailwind.css';
import '../styles/pin-indicators.css';
import '../styles/options-layout.css';

// Wrapper component that provides TabSelectionContext
function TabManager() {
    const [groups, setGroups] = useState<TabGroup[]>([]);

    return (
        <TabSelectionProvider groups={groups}>
            <TabManagerContent groups={groups} setGroups={setGroups} />
        </TabSelectionProvider>
    );
}

// Main content component that uses the context
interface TabManagerContentProps {
    groups: TabGroup[];
    setGroups: React.Dispatch<React.SetStateAction<TabGroup[]>>;
}

function TabManagerContent({ groups, setGroups }: TabManagerContentProps) {
    const [tags, setTags] = useState<Tag[]>([]);
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [showTagManager, setShowTagManager] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [bulkMode, setBulkMode] = useState(false);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [infoGroupId, setInfoGroupId] = useState<string | null>(null);
    const [showTagModal, setShowTagModal] = useState(false);
    const [tagModalGroupId, setTagModalGroupId] = useState<string | null>(null);
    const [settings, setSettings] = useState<Settings>(getDefaultSettings());
    const [notesModalGroupId, setNotesModalGroupId] = useState<string | null>(null);
    const [notesText, setNotesText] = useState('');
    const [currentSortOrder, setCurrentSortOrder] = useState<SortOrder>('newest');
    const [stats, setStats] = useState({ totalGroups: 0, totalTabs: 0 });
    const [draggedTab, setDraggedTab] = useState<{ tab: TabItem; sourceGroupId: string } | null>(null);
    const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
    const [isDraggingTabs, setIsDraggingTabs] = useState(false);
    const [dragOverTarget, setDragOverTarget] = useState<'trash' | 'new-group' | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [layoutMode, setLayoutMode] = useState<'grid' | 'masonry' | 'dashboard'>('grid');
    const [deleteModalType, setDeleteModalType] = useState<'group' | 'selected' | 'tag'>('group');
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [collapsedGroups, setCollapsedGroups] = useState<Map<string, boolean>>(new Map());
    const [isStateLoaded, setIsStateLoaded] = useState(false);
    const [isLayoutModeInitialized, setIsLayoutModeInitialized] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('bluetab_sidebar_open');
        return saved !== null ? saved === 'true' : true;
    });

    // Auth & Bluet Bridge state
    const { isPro } = useAuth();
    const [bluet_sharedRefs, setBluetSharedRefs] = useState<BluetSharedRef[]>([]);

    useEffect(() => {
        BluetBridgeService.getSharedRefs().then(setBluetSharedRefs);
    }, []);

    const handleShareToBluet = async (group: TabGroup) => {
        if (!isPro) {
            ToastManager.getInstance().warning('Share to Bluet requires BlueTab Pro');
            return;
        }

        const connected = await BluetBridgeService.isConnected();
        if (!connected) {
            ToastManager.getInstance().info('Connect to Bluet first in Account settings');
            return;
        }

        const isAlreadyShared = bluet_sharedRefs.some(r => r.id === group.id);
        const result = await BluetBridgeService.shareTabGroup(group);

        if (result.success) {
            const url = result.fullUrl || result.pageUrl || '';
            ToastManager.getInstance().success(
                isAlreadyShared
                    ? `Updated on Bluet: ${url}`
                    : `Shared to Bluet: ${url}`
            );
            // Open the shared page
            if (result.fullUrl) {
                chrome.tabs.create({ url: result.fullUrl });
            }
            setBluetSharedRefs(await BluetBridgeService.getSharedRefs());
        } else {
            ToastManager.getInstance().error(`Share failed: ${result.error}`);
        }
    };

    // Project state - check URL hash for initial project
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
        const hash = window.location.hash;
        if (hash.startsWith('#project=')) {
            return hash.replace('#project=', '');
        }
        return null;
    });
    const [showProjectModal, setShowProjectModal] = useState(false);
    const [editingProject, setEditingProject] = useState<Project | undefined>(undefined);
    const [showAddGroupToProjectModal, setShowAddGroupToProjectModal] = useState(false);

    // Save sidebar state to localStorage
    const handleSidebarOpenChange = (open: boolean) => {
        setSidebarOpen(open);
        localStorage.setItem('bluetab_sidebar_open', String(open));
    };

    // Pin management
    const pinManagement = usePinManagement(groups);

    // Tab selection from context
    const tabSelection = useTabSelectionContext();
    const {
        state: { isSelectionMode: tabSelectionMode, isDragging, selectedTabs, draggedItems },
        clearSelection: clearTabSelection,
        exitSelectionMode,
        startDrag,
        endDrag,
    } = tabSelection;

    // ESC key to exit selection mode
    useEscapeKey({
        enabled: tabSelectionMode,
        onEscape: exitSelectionMode,
    });

    // Click outside to exit selection mode
    useClickOutside({
        enabled: tabSelectionMode,
        onClickOutside: exitSelectionMode,
    });

    // Archive modal management
    const archiveModal = useModal();
    const [selectedGroupForArchive, setSelectedGroupForArchive] = useState<string | null>(null);

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
            if (changes.settings) {
                const newSettings = changes.settings.newValue || getDefaultSettings();
                setSettings(newSettings);
                setCurrentSortOrder(newSettings.sortOrder);
            }
            // Listen for collapsed state changes
            if (changes.collapsedGroups) {
                const newCollapsedGroups = changes.collapsedGroups.newValue || {};
                setCollapsedGroups(new Map(Object.entries(newCollapsedGroups)));
            }
            // Listen for layoutMode changes
            if (changes.layoutMode) {
                const newLayoutMode = changes.layoutMode.newValue;
                if (newLayoutMode) {
                    setLayoutMode(newLayoutMode);
                }
            }
            // Listen for projects changes
            if (changes.projects) {
                const newProjects = changes.projects.newValue || [];
                setProjects(newProjects);
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);

        return () => {
            chrome.storage.onChanged.removeListener(handleStorageChange);
        };
    }, []);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (openMenuId) {
                const target = event.target as Element;
                if (!target.closest('.relative')) {
                    setOpenMenuId(null);
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openMenuId]);

    const initializeApp = async () => {
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

    useEffect(() => {
        setStats({
            totalGroups: groups.length,
            totalTabs: groups.reduce((acc, group) => acc + group.tabs.length, 0)
        });
    }, [groups]);

    // Save layoutMode preference when it changes (but not on initial load)
    useEffect(() => {
        if (isLayoutModeInitialized) {
            Storage.set('layoutMode', layoutMode);
        }
    }, [layoutMode, isLayoutModeInitialized]);

    // ESC key and click-outside handlers are now managed by hooks (useEscapeKey, useClickOutside)

    const loadGroups = async () => {
        const stored = await Storage.get<TabGroup[]>('groups') || [];
        const storedTags = await Storage.get<Tag[]>('tags') || [];
        const storedProjects = await Storage.getProjects();
        // Migrate groups with pin data
        const migratedGroups = await Storage.migrateExistingGroups(stored);
        const storedSettings = await Storage.get<Settings>('settings');
        const defaultSettings = getDefaultSettings();

        // Set projects
        setProjects(storedProjects);

        // Merge stored settings with defaults to ensure all fields are present
        const mergedSettings = {
            ...defaultSettings,
            ...storedSettings
        };

        ThemeManager.initializeTheme(mergedSettings);

        // Save merged settings to storage if there were missing fields
        if (JSON.stringify(storedSettings) !== JSON.stringify(mergedSettings)) {
            await Storage.set('settings', mergedSettings);
        }

        // Load layoutMode preference
        const storedLayoutMode = await Storage.get<'grid' | 'masonry'>('layoutMode');
        if (storedLayoutMode) {
            setLayoutMode(storedLayoutMode);
        }
        // Mark as initialized after loading from storage
        setIsLayoutModeInitialized(true);

        setGroups(migratedGroups);
        setTags(storedTags);
        setSettings(mergedSettings);
        setCurrentSortOrder(mergedSettings.sortOrder);
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
        const currentCollapsed = collapsedGroups.get(groupId) || false;
        const newCollapsed = !currentCollapsed;

        // Update UI immediately for responsiveness
        const newState = new Map(collapsedGroups);
        newState.set(groupId, newCollapsed);
        setCollapsedGroups(newState);

        // Save to storage
        try {
            await saveGroupState(groupId, newCollapsed);
        } catch (error) {
            console.error('Failed to save collapsed state:', error);
            ToastManager.getInstance().error('Failed to save collapse state');
            // Revert UI state on error
            const revertedState = new Map(collapsedGroups);
            revertedState.set(groupId, currentCollapsed);
            setCollapsedGroups(revertedState);
        }
    };

    const saveAllTabs = async (projectId?: string | null) => {
        try {
            console.log('Starting tab save process...');
            const tabs = await chrome.tabs.query({ currentWindow: true });
            console.log('All tabs:', tabs);

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

            console.log('Tabs to save:', tabsToSave);

            if (tabsToSave.length === 0) {
                ToastManager.getInstance().warning('No tabs to save');
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
                name: `Session ${new Date().toLocaleString()}`,
                tabs: dedupedTabs,
                created: Date.now(),
                modified: Date.now(),
                ...(projectId && { projectId }),
            };

            const updatedGroups = [...groups, newGroup];
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);

            console.log('Group saved, now closing tabs...');

            // Get tab IDs to close (all saved tabs)
            const tabIdsToClose = tabsToSave.map(tab => tab.id).filter(id => id !== undefined) as number[];

            console.log('Tab IDs to close:', tabIdsToClose);

            if (tabIdsToClose.length > 0) {
                await chrome.tabs.remove(tabIdsToClose);
                console.log('Tabs closed successfully');
            }

            // Show success toast
            const projectName = projectId ? projects.find(p => p.id === projectId)?.name : null;
            const message = projectName
                ? `Saved ${dedupedTabs.length} tabs to "${projectName}"`
                : `Saved ${dedupedTabs.length} tabs and closed them`;
            ToastManager.getInstance().success(message);

        } catch (error) {
            console.error('Error in saveAllTabs:', error);
            ToastManager.getInstance().error('Failed to save tabs: ' + (error as Error).message);
        }
    };

    // Project handlers
    const handleCreateProject = async (projectData: Omit<Project, 'id' | 'created' | 'modified'>) => {
        const newProject: Project = {
            id: crypto.randomUUID(),
            ...projectData,
            created: Date.now(),
            modified: Date.now(),
        };
        await Storage.addProject(newProject);
        ToastManager.getInstance().success(`Project "${newProject.name}" created`);
    };

    const handleEditProject = async (projectData: Omit<Project, 'id' | 'created' | 'modified'>) => {
        if (!editingProject) return;
        await Storage.updateProject(editingProject.id, projectData);
        ToastManager.getInstance().success(`Project "${projectData.name}" updated`);
        setEditingProject(undefined);
    };

    const handleDeleteProject = async (projectId: string) => {
        const project = projects.find(p => p.id === projectId);
        if (!project) return;

        if (window.confirm(`Are you sure you want to delete the project "${project.name}"? Groups in this project will not be deleted, just unassigned.`)) {
            await Storage.deleteProject(projectId);
            if (activeProjectId === projectId) {
                setActiveProjectId(null);
            }
            ToastManager.getInstance().success(`Project "${project.name}" deleted`);
        }
    };

    const handleAssignGroupToProject = async (groupId: string, projectId: string | undefined) => {
        await Storage.assignGroupToProject(groupId, projectId);
        // Update local state
        setGroups(prev => prev.map(g =>
            g.id === groupId ? { ...g, projectId, modified: Date.now() } : g
        ));
        const projectName = projectId ? projects.find(p => p.id === projectId)?.name : 'No Project';
        ToastManager.getInstance().success(`Group assigned to ${projectName}`);
    };

    const handleBulkAssignToProject = async (projectId: string | undefined) => {
        if (selectedGroups.size === 0) return;
        const groupIds = Array.from(selectedGroups);
        await Storage.assignGroupsToProject(groupIds, projectId);
        // Update local state
        setGroups(prev => prev.map(g =>
            selectedGroups.has(g.id) ? { ...g, projectId, modified: Date.now() } : g
        ));
        const projectName = projectId ? projects.find(p => p.id === projectId)?.name : 'No Project';
        ToastManager.getInstance().success(`${groupIds.length} groups assigned to ${projectName}`);
    };

    const restoreGroup = async (group: TabGroup) => {
        try {
            const settings = await Storage.get<Settings>('settings') || getDefaultSettings();
            const restoreMode = settings.restoreMode || 'smart';
            const tabGroupRestoreMode = settings.tabGroupRestoreMode || 'normal';

            // Get current window tabs to determine behavior
            const currentTabs = await chrome.tabs.query({ currentWindow: true });

            let shouldCreateNewWindow = false;

            // Debug logging
            console.log('🔍 Restore settings:', { restoreMode, tabGroupRestoreMode });

            switch (restoreMode) {
                case 'newWindow':
                    shouldCreateNewWindow = true;
                    break;
                case 'currentWindow':
                    shouldCreateNewWindow = false;
                    break;
                case 'smart':
                    // Smart mode: new window if current window has more than just BlueTab
                    const nonBlueTabTabs = currentTabs.filter(tab =>
                        tab.url && !tab.url.includes('src/options/index.html') && !tab.url.includes('src/settings/index.html')
                    );
                    shouldCreateNewWindow = nonBlueTabTabs.length > 0;
                    console.log('Smart mode analysis:', { totalTabs: currentTabs.length, nonBlueTabTabs: nonBlueTabTabs.length, shouldCreateNewWindow });
                    break;
            }

            console.log('✅ Window decision:', shouldCreateNewWindow ? 'NEW WINDOW' : 'CURRENT WINDOW');

            // Feature 018: Browser Tab Groups Support
            // When tabGroupRestoreMode is 'browserGroups', we:
            // 1. Open all tabs normally (existing behavior)
            // 2. Collect tab IDs in createdTabIds array
            // 3. Use chrome.tabs.group() to create native tab group
            // 4. Use chrome.tabGroups.update() to set group title
            // 5. Handle errors gracefully (tabs still open if grouping fails)
            let createdTabIds: number[] = [];

            let targetWindowId: number | undefined;

            if (shouldCreateNewWindow) {
                // Create new window with tabs (same for both modes)
                if (group.tabs.length > 0) {
                    const newWindow = await chrome.windows.create({
                        url: group.tabs[0].url,
                        focused: true
                    });

                    targetWindowId = newWindow.id;
                    console.log('📌 Created new window ID:', targetWindowId);

                    if (newWindow.tabs && newWindow.tabs[0].id) {
                        createdTabIds.push(newWindow.tabs[0].id);
                    }

                    // Add remaining tabs to the new window
                    for (let i = 1; i < group.tabs.length; i++) {
                        const newTab = await chrome.tabs.create({
                            url: group.tabs[i].url,
                            windowId: newWindow.id,
                            active: false
                        });
                        if (newTab.id) {
                            createdTabIds.push(newTab.id);
                        }
                    }
                }
            } else {
                // Add tabs to current window
                for (const tab of group.tabs) {
                    const newTab = await chrome.tabs.create({ url: tab.url, active: false });
                    if (newTab.id) {
                        createdTabIds.push(newTab.id);
                    }
                }
            }

            // Feature 018: Create browser tab group if mode is 'browserGroups'
            // Only attempt grouping if user opted-in and we have tabs to group
            if (tabGroupRestoreMode === 'browserGroups' && createdTabIds.length > 0) {
                try {
                    console.log(`Attempting to create tab group: "${group.name}" with ${createdTabIds.length} tabs`);
                    console.log('Tab IDs to group:', createdTabIds);

                    // Small delay to ensure tabs are fully created
                    await new Promise(resolve => setTimeout(resolve, 150));

                    // If tabs are in a new window, make sure that window is focused
                    // This prevents Chrome from moving tabs to the active window during grouping
                    if (targetWindowId) {
                        console.log('🎯 Ensuring target window is focused before grouping...');
                        await chrome.windows.update(targetWindowId, { focused: true });
                        // Small delay after focus
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    // Create the group
                    const groupId = await chrome.tabs.group({
                        tabIds: createdTabIds
                    });

                    // Set the group's title to match the BlueTab group name
                    await chrome.tabGroups.update(groupId, {
                        title: group.name
                    });

                    console.log(`✅ Successfully created browser tab group: ${group.name} (ID: ${groupId})`);
                } catch (groupError) {
                    // Graceful degradation: If grouping fails, tabs are still open
                    // This can happen if Chrome Tab Groups API is unavailable or if there's a browser issue
                    const errorMessage = (groupError as Error).message;
                    const errorStack = (groupError as Error).stack;
                    console.error('Failed to create tab group:', {
                        groupName: group.name,
                        tabCount: createdTabIds.length,
                        tabIds: createdTabIds,
                        error: errorMessage,
                        stack: errorStack
                    });

                    // Inform user that tabs are restored but not grouped
                    ToastManager.getInstance().warning(
                        `Tabs restored but grouping failed. ${createdTabIds.length} tabs opened as normal tabs.`
                    );
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
                ToastManager.getInstance().success(`Restored ${group.tabs.length} tabs from "${group.name}" and removed from list`);
            } else {
                ToastManager.getInstance().success(`Restored ${group.tabs.length} tabs from "${group.name}"`);
            }
        } catch (error) {
            ToastManager.getInstance().error('Failed to restore tabs: ' + (error as Error).message);
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
                    group.locked ? `"${group.name}" locked` : `"${group.name}" unlocked`
                );
            }
            setOpenMenuId(null);
        } catch (error) {
            ToastManager.getInstance().error('Failed to toggle lock: ' + (error as Error).message);
        }
    };

    const showDeleteGroupModal = (groupId: string) => {
        // Check if group is locked
        const group = groups.find(g => g.id === groupId);
        if (group?.locked) {
            ToastManager.getInstance().warning('Cannot delete locked group. Unlock it first.');
            return;
        }

        setDeleteModalType('group');
        setDeleteTarget(groupId);
        setShowDeleteModal(true);
        setOpenMenuId(null);
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

            ToastManager.getInstance().success('Group deleted successfully');
        } catch (error) {
            ToastManager.getInstance().error('Failed to delete group: ' + (error as Error).message);
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
            ToastManager.getInstance().error('Failed to save group name: ' + (error as Error).message);
        }
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditName('');
    };

    const saveGroupNotes = async () => {
        if (!notesModalGroupId) return;
        try {
            const updatedGroups = groups.map(g =>
                g.id === notesModalGroupId
                    ? { ...g, notes: notesText.trim() || undefined, modified: Date.now() }
                    : g
            );
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
            setNotesModalGroupId(null);
            setNotesText('');
            ToastManager.getInstance().success('Notes saved');
        } catch (error) {
            ToastManager.getInstance().error('Failed to save notes: ' + (error as Error).message);
        }
    };

    const exportData = async () => {
        try {
            // Get pin settings
            const pinSettings = await Storage.getPinSettings();

            // Get all archives
            let archives = {};
            try {
                const { ArchiveStorageService } = await import('../utils/archive-storage');
                const archiveData = await ArchiveStorageService.getArchives();
                archives = archiveData.archives || {};
            } catch (archiveError) {
                console.warn('Could not export archives:', archiveError);
            }

            const data = {
                groups,
                tags,
                settings,
                collapsedGroups: Object.fromEntries(collapsedGroups),
                pinSettings,
                archives,
                projects,
                exportedAt: Date.now(),
                version: '2.2.0'
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bluetab-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            const archiveCount = Object.keys(archives).length;
            let msg = 'Backup exported';
            if (archiveCount > 0) msg += ` (includes ${archiveCount} archives)`;
            if (projects.length > 0) msg += `, ${projects.length} projects`;
            ToastManager.getInstance().success(msg);
        } catch (error) {
            console.error('Failed to export data:', error);
            ToastManager.getInstance().error('Failed to export backup: ' + (error as Error).message);
        }
    };

    const exportAsHTML = async () => {
        try {
            const exportDate = new Date().toISOString();
            const totalTabs = groups.reduce((sum, group) => sum + group.tabs.length, 0);

            const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BlueTab Export - ${new Date().toLocaleDateString()}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 2rem;
            min-height: 100vh;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
            text-align: center;
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
            font-weight: 700;
        }

        .header .subtitle {
            font-size: 1rem;
            opacity: 0.9;
        }

        .stats {
            display: flex;
            justify-content: center;
            gap: 2rem;
            margin-top: 1.5rem;
            padding: 1rem;
            background: rgba(255,255,255,0.1);
            border-radius: 8px;
        }

        .stat {
            text-align: center;
        }

        .stat-value {
            font-size: 2rem;
            font-weight: bold;
        }

        .stat-label {
            font-size: 0.875rem;
            opacity: 0.9;
        }

        .content {
            padding: 2rem;
        }

        .group {
            margin-bottom: 2rem;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
            transition: box-shadow 0.3s ease;
        }

        .group:hover {
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .group-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1rem 1.5rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .group-title {
            font-size: 1.25rem;
            font-weight: 600;
        }

        .group-meta {
            font-size: 0.875rem;
            opacity: 0.9;
        }

        .tabs-list {
            list-style: none;
        }

        .tab-item {
            padding: 1rem 1.5rem;
            border-bottom: 1px solid #f3f4f6;
            display: flex;
            align-items: center;
            gap: 1rem;
            transition: background-color 0.2s ease;
        }

        .tab-item:last-child {
            border-bottom: none;
        }

        .tab-item:hover {
            background-color: #f9fafb;
        }

        .tab-favicon {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .tab-info {
            flex: 1;
            min-width: 0;
        }

        .tab-title {
            font-weight: 500;
            color: #1f2937;
            margin-bottom: 0.25rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .tab-url {
            font-size: 0.875rem;
            color: #6b7280;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .tab-url a {
            color: #667eea;
            text-decoration: none;
        }

        .tab-url a:hover {
            text-decoration: underline;
        }

        .footer {
            text-align: center;
            padding: 2rem;
            background: #f9fafb;
            color: #6b7280;
            font-size: 0.875rem;
        }

        .empty-group {
            padding: 2rem;
            text-align: center;
            color: #9ca3af;
            font-style: italic;
        }

        .tag {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 500;
            margin-right: 0.5rem;
        }

        @media (max-width: 768px) {
            body {
                padding: 1rem;
            }

            .header h1 {
                font-size: 1.75rem;
            }

            .stats {
                gap: 1rem;
            }

            .stat-value {
                font-size: 1.5rem;
            }
        }

        @media print {
            body {
                background: white;
                padding: 0;
            }

            .container {
                box-shadow: none;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔵 BlueTab Export</h1>
            <p class="subtitle">Tab Groups Backup - ${new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })}</p>
            <div class="stats">
                <div class="stat">
                    <div class="stat-value">${groups.length}</div>
                    <div class="stat-label">Groups</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${totalTabs}</div>
                    <div class="stat-label">Total Tabs</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${tags.length}</div>
                    <div class="stat-label">Tags</div>
                </div>
            </div>
        </div>

        <div class="content">
            ${groups.map((group) => {
                const groupTags = (group.tags || []).map(tagId => tags.find(t => t.id === tagId)).filter(Boolean);
                return `
                <div class="group">
                    <div class="group-header">
                        <div>
                            <div class="group-title">${escapeHtml(group.name)}</div>
                            ${groupTags.length > 0 ? `
                                <div style="margin-top: 0.5rem;">
                                    ${groupTags.map(tag => `
                                        <span class="tag" style="background-color: ${tag.color}20; color: ${tag.color};">
                                            ${escapeHtml(tag.name)}
                                        </span>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                        <div class="group-meta">
                            ${group.tabs.length} tab${group.tabs.length !== 1 ? 's' : ''} •
                            Created ${new Date(group.created).toLocaleDateString()}
                            ${group.pinned ? ' • 📌 Pinned' : ''}
                        </div>
                    </div>
                    ${group.tabs.length > 0 ? `
                        <ul class="tabs-list">
                            ${group.tabs.map(tab => `
                                <li class="tab-item">
                                    ${tab.favicon
                        ? `<img src="${escapeHtml(tab.favicon)}" alt="" class="tab-favicon" onerror="this.style.display='none'">`
                        : '<div class="tab-favicon">🔗</div>'
                    }
                                    <div class="tab-info">
                                        <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
                                        <div class="tab-url"><a href="${escapeHtml(tab.url)}" target="_blank">${escapeHtml(tab.url)}</a></div>
                                    </div>
                                </li>
                            `).join('')}
                        </ul>
                    ` : `
                        <div class="empty-group">No tabs in this group</div>
                    `}
                </div>
            `}).join('')}
        </div>

        <div class="footer">
            <p>Exported from BlueTab - Chrome Extension</p>
            <p>Export Date: ${new Date(exportDate).toLocaleString()}</p>
            <p>${groups.length} groups • ${totalTabs} tabs • ${tags.length} tags</p>
        </div>
    </div>
</body>
</html>`;

            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bluetab-export-${new Date().toISOString().split('T')[0]}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            ToastManager.getInstance().success('HTML export completed successfully');
        } catch (error) {
            console.error('Failed to export as HTML:', error);
            ToastManager.getInstance().error('Failed to export HTML: ' + (error as Error).message);
        }
    };

    // Helper function to escape HTML special characters
    const escapeHtml = (text: string): string => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);

                if (!data.groups || !Array.isArray(data.groups)) {
                    ToastManager.getInstance().error('Invalid backup file: missing groups data');
                    return;
                }

                // Create group ID mapping (old -> new)
                const originalToNewIdMap = new Map<string, string>();

                // ===== TAG IMPORT WITH SMART MAPPING =====
                const tagIdMapping = new Map<string, string>(); // oldTagId -> newTagId

                if (data.tags && Array.isArray(data.tags)) {
                    console.log('Importing tags from backup:', data.tags.length);

                    // Get current tags from storage (not state, which might be stale)
                    const currentTags = await Storage.get<Tag[]>('tags') || [];
                    const existingTagNames = new Map(currentTags.map(t => [t.name.toLowerCase(), t.id]));
                    const newTags: Tag[] = [];

                    for (const importedTag of data.tags) {
                        const existingByName = existingTagNames.get(importedTag.name.toLowerCase());

                        if (existingByName) {
                            // Tag exists with same name, map to existing
                            tagIdMapping.set(importedTag.id, existingByName);
                            console.log(`Tag "${importedTag.name}" exists, mapping to ${existingByName}`);
                        } else {
                            // Create new tag
                            const newId = crypto.randomUUID();
                            tagIdMapping.set(importedTag.id, newId);
                            newTags.push({
                                ...importedTag,
                                id: newId,
                                created: Date.now()
                            });
                            console.log(`Creating new tag: "${importedTag.name}" with id ${newId}`);
                        }
                    }

                    if (newTags.length > 0) {
                        const mergedTags = [...currentTags, ...newTags];
                        await Storage.set('tags', mergedTags);
                        setTags(mergedTags);
                        console.log(`Created ${newTags.length} new tags, total: ${mergedTags.length}`);
                    }
                }

                // ===== IMPORT PROJECTS FIRST (before groups) =====
                let importedProjectIds = new Set<string>();
                let projectsCount = 0;
                if (data.projects && Array.isArray(data.projects) && data.projects.length > 0) {
                    console.log('Importing projects from backup:', data.projects.length);
                    try {
                        const currentProjects = await Storage.getProjects();
                        const existingIds = new Set(currentProjects.map(p => p.id));

                        // Track all valid project IDs (existing + new)
                        importedProjectIds = new Set([...existingIds]);

                        // Filter out projects that already exist and add new ones
                        const newProjects = data.projects.filter((p: any) => !existingIds.has(p.id));

                        if (newProjects.length > 0) {
                            const mergedProjects = [...currentProjects, ...newProjects];
                            await Storage.set('projects', mergedProjects);
                            setProjects(mergedProjects);
                            projectsCount = newProjects.length;

                            // Add new project IDs to valid set
                            newProjects.forEach((p: any) => importedProjectIds.add(p.id));
                            console.log(`Successfully imported ${projectsCount} projects`);
                        }
                    } catch (projectError) {
                        console.error('Failed to import projects:', projectError);
                    }
                } else {
                    // No projects in backup, get current projects for validation
                    const currentProjects = await Storage.getProjects();
                    importedProjectIds = new Set(currentProjects.map(p => p.id));
                }

                // ===== IMPORT GROUPS WITH TAG AND PROJECT MAPPING =====
                const safeGroups = data.groups.map((group: TabGroup) => {
                    const newGroupId = crypto.randomUUID();
                    originalToNewIdMap.set(group.id, newGroupId);

                    // Map tags to new/existing tag IDs
                    const mappedTags = (group.tags || []).map((oldTagId: string) => {
                        return tagIdMapping.get(oldTagId) || oldTagId;
                    });

                    // Validate projectId - only keep if project exists
                    const validProjectId = group.projectId && importedProjectIds.has(group.projectId)
                        ? group.projectId
                        : undefined;

                    if (group.projectId && !validProjectId) {
                        console.log(`Group "${group.name}" had invalid projectId ${group.projectId}, removing`);
                    }

                    return {
                        ...group,
                        id: newGroupId,
                        tags: mappedTags,
                        projectId: validProjectId,
                        tabs: group.tabs.map(tab => ({
                            ...tab,
                            id: crypto.randomUUID()
                        })),
                        modified: Date.now()
                    };
                });

                const importedGroups = [...groups, ...safeGroups];
                await Storage.set('groups', importedGroups);
                setGroups(importedGroups);

                // ===== IMPORT SETTINGS =====
                if (data.settings && typeof data.settings === 'object') {
                    // Remove deprecated fields before applying
                    const { autoBackup, backupInterval, ...cleanSettings } = data.settings;

                    // Use imported settings as the new settings (not merge)
                    // Ensure we have valid settings structure
                    const newSettings = { ...cleanSettings };

                    console.log('Applying imported settings:', newSettings);

                    // Force update storage
                    await Storage.set('settings', newSettings);

                    // Update local state
                    setSettings(newSettings);

                    ToastManager.getInstance().info('Settings restored. You may need to refresh other tabs.');
                }

                // ===== IMPORT COLLAPSED STATES =====
                const collapsedData = data.persistentState?.collapsedGroups || data.collapsedGroups;
                if (collapsedData) {
                    try {
                        const newStates = new Map<string, boolean>();
                        for (const [originalGroupId, collapsed] of Object.entries(collapsedData)) {
                            const newGroupId = originalToNewIdMap.get(originalGroupId);
                            if (newGroupId) {
                                newStates.set(newGroupId, collapsed as boolean);
                            }
                        }

                        if (newStates.size > 0) {
                            await saveMultipleStates(newStates);
                            const currentStates = await loadCollapsedStates();
                            setCollapsedGroups(currentStates);
                        }
                    } catch (stateError) {
                        console.error('Failed to import collapsed states:', stateError);
                    }
                }

                // ===== IMPORT PIN SETTINGS =====
                if (data.pinSettings?.pinnedGroups) {
                    try {
                        const existingPinSettings = await Storage.getPinSettings();
                        const newPinSettings = { ...existingPinSettings };

                        for (const [oldGroupId, pinData] of Object.entries(data.pinSettings.pinnedGroups)) {
                            const newGroupId = originalToNewIdMap.get(oldGroupId);
                            if (newGroupId && pinData) {
                                newPinSettings.pinnedGroups[newGroupId] = pinData as { isPinned: boolean; pinnedAt: number };
                            }
                        }

                        await Storage.set('pinSettings', newPinSettings);
                        console.log(`Imported pin settings for ${Object.keys(data.pinSettings.pinnedGroups).length} groups`);
                    } catch (pinError) {
                        console.error('Failed to import pin settings:', pinError);
                    }
                }

                // ===== IMPORT ARCHIVES =====
                let archiveCount = 0;
                if (data.archives && typeof data.archives === 'object') {
                    console.log('Importing archives from backup:', Object.keys(data.archives).length);
                    try {
                        const { ArchiveStorageService } = await import('../utils/archive-storage');

                        for (const [originalId, archive] of Object.entries(data.archives)) {
                            try {
                                const archiveData = archive as any;
                                const newId = crypto.randomUUID();

                                // Create new archive object
                                const newArchive = {
                                    ...archiveData,
                                    id: newId
                                };

                                // CRITICAL: For unencrypted archives, we MUST update the inner group ID 
                                // to match the new archive ID, otherwise validation fails.
                                if (!newArchive.protection?.passwordProtected &&
                                    newArchive.originalGroup &&
                                    typeof newArchive.originalGroup === 'object') {
                                    newArchive.originalGroup = {
                                        ...newArchive.originalGroup,
                                        id: newId
                                    };
                                }

                                console.log(`Importing archive: ${originalId} -> ${newArchive.id}`);
                                await ArchiveStorageService.storeArchive(newArchive);
                                archiveCount++;
                            } catch (singleArchiveError) {
                                console.error(`Failed to import archive ${originalId}:`, singleArchiveError);
                            }
                        }

                        if (archiveCount > 0) {
                            console.log(`Successfully imported ${archiveCount} archives`);
                        }
                    } catch (archiveError) {
                        console.error('Failed to import archives:', archiveError);
                        ToastManager.getInstance().warning('Some archives could not be imported');
                    }
                } else {
                    console.log('No archives found in backup');
                }

                // Success message
                let successMsg = `Imported ${data.groups.length} groups`;
                if (archiveCount > 0) successMsg += `, ${archiveCount} archives`;
                if (projectsCount > 0) successMsg += `, ${projectsCount} projects`;
                ToastManager.getInstance().success(successMsg + ' successfully!');

            } catch (error) {
                console.error('Import failed:', error);
                ToastManager.getInstance().error('Invalid backup file format!');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    const clearAllData = async () => {
        if (confirm('Delete ALL groups, tags, and archives permanently? This cannot be undone!')) {
            try {
                // Clear groups
                await Storage.set('groups', []);
                setGroups([]);

                // Clear tags
                await Storage.set('tags', []);
                setTags([]);

                // Clear archives
                try {
                    const { ArchiveStorageService } = await import('../utils/archive-storage');
                    await ArchiveStorageService.clearAllArchives();
                } catch (archiveError) {
                    console.warn('Could not clear archives:', archiveError);
                }

                // Clear pin settings
                await Storage.set('pinSettings', { pinnedGroups: {} });

                ToastManager.getInstance().success('All data cleared');
            } catch (error) {
                ToastManager.getInstance().error('Failed to clear data: ' + (error as Error).message);
            }
        }
    };

    const filteredAndSortedGroups = (() => {
        // Get active project's search scope
        const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;
        const searchScope = activeProject?.searchScope || 'project';

        // Filter by project based on context:
        // - No search: always show only active project's groups
        // - Searching: use searchScope setting (project or all)
        let filtered = groups;
        if (activeProjectId) {
            const shouldFilterByProject = search === '' || searchScope === 'project';
            if (shouldFilterByProject) {
                filtered = groups.filter(group => group.projectId === activeProjectId);
            }
        }

        // Then filter by search
        filtered = filtered.filter(group => {
            if (search === '') return true;

            const searchLower = search.toLowerCase();

            // Text search in group name and tabs
            const matchesText = group.name.toLowerCase().includes(searchLower) ||
                group.tabs.some(tab =>
                    tab.title.toLowerCase().includes(searchLower) ||
                    tab.url.toLowerCase().includes(searchLower)
                );

            // Tag search
            const matchesTag = group.tags && group.tags.some(tagId => {
                const tag = tags.find(t => t.id === tagId);
                return tag && tag.name.toLowerCase().includes(searchLower);
            });

            return matchesText || matchesTag;
        });

        // Then sort
        return sortGroupsWithPinning(filtered, currentSortOrder);
    })();

    // Get project for a group (helper)
    const getGroupProject = (group: TabGroup): Project | undefined => {
        return group.projectId ? projects.find(p => p.id === group.projectId) : undefined;
    };

    const openTab = async (url: string, tabId: string, groupId: string) => {
        try {
            chrome.tabs.create({ url });

            // Handle restore behavior for individual tabs
            const storedSettings = await Storage.get<Settings>('settings');
            const defaultSettings = getDefaultSettings();
            const mergedSettings = { ...defaultSettings, ...storedSettings };

            const restoreBehavior = mergedSettings.restoreBehavior || 'removeFromList';
            if (restoreBehavior === 'removeFromList') {
                // Remove the tab from its group
                const updatedGroups = groups.map(group => {
                    if (group.id === groupId) {
                        const updatedTabs = group.tabs.filter(tab => tab.id !== tabId);
                        return { ...group, tabs: updatedTabs, modified: Date.now() };
                    }
                    return group;
                }).filter(group => group.tabs.length > 0); // Remove empty groups

                await Storage.set('groups', updatedGroups);
                setGroups(updatedGroups);
            }
        } catch (error) {
            ToastManager.getInstance().error('Failed to open tab: ' + (error as Error).message);
        }
    };

    const createTag = async () => {
        const error = TagManager.validateTagName(newTagName, tags);
        if (error) {
            ToastManager.getInstance().error(error);
            return;
        }

        try {
            const newTag = TagManager.createTag(newTagName, newTagColor);
            const updatedTags = [...tags, newTag];
            await Storage.set('tags', updatedTags);
            setTags(updatedTags);
            setNewTagName('');
            setNewTagColor(TAG_COLORS[0]);
        } catch (error) {
            ToastManager.getInstance().error('Failed to create tag: ' + (error as Error).message);
        }
    };

    const showDeleteTagModal = (tagId: string) => {
        setDeleteModalType('tag');
        setDeleteTarget(tagId);
        setShowDeleteModal(true);
    };

    const deleteTag = async (tagId: string) => {
        try {
            const updatedTags = tags.filter(tag => tag.id !== tagId);
            const updatedGroups = groups.map(group => ({
                ...group,
                tags: (group.tags || []).filter(id => id !== tagId),
                tabs: group.tabs.map(tab => ({
                    ...tab,
                    tags: (tab.tags || []).filter(id => id !== tagId)
                }))
            }));

            await Storage.set('tags', updatedTags);
            await Storage.set('groups', updatedGroups);
            setTags(updatedTags);
            setGroups(updatedGroups);
            ToastManager.getInstance().success('Tag deleted successfully');
        } catch (error) {
            ToastManager.getInstance().error('Failed to delete tag: ' + (error as Error).message);
        }
    };

    const addTagToGroup = async (groupId: string, tagId: string) => {
        try {
            const updatedGroups = groups.map(group =>
                group.id === groupId ? TagManager.addTagToGroup(group, tagId) : group
            );

            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
        } catch (error) {
            ToastManager.getInstance().error('Failed to add tag: ' + (error as Error).message);
        }
    };

    const removeTagFromGroup = async (groupId: string, tagId: string) => {
        try {
            const updatedGroups = groups.map(group =>
                group.id === groupId ? TagManager.removeTagFromGroup(group, tagId) : group
            );

            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
        } catch (error) {
            ToastManager.getInstance().error('Failed to remove tag: ' + (error as Error).message);
        }
    };

    const toggleGroupSelection = (groupId: string) => {
        const newSelection = new Set(selectedGroups);
        if (newSelection.has(groupId)) {
            newSelection.delete(groupId);
        } else {
            newSelection.add(groupId);
        }
        setSelectedGroups(newSelection);
    };

    const selectAllGroups = () => {
        setSelectedGroups(new Set(filteredAndSortedGroups.map(g => g.id)));
    };

    const clearSelection = () => {
        setSelectedGroups(new Set());
    };

    // Tab selection functions are now in useTabSelectionActions hook (tabActions)

    const bulkAddTag = async (tagId: string) => {
        try {
            const updatedGroups = groups.map(group =>
                selectedGroups.has(group.id) ? TagManager.addTagToGroup(group, tagId) : group
            );

            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
        } catch (error) {
            ToastManager.getInstance().error('Failed to add tags: ' + (error as Error).message);
        }
    };

    const bulkRemoveTag = async (tagId: string) => {
        try {
            const updatedGroups = groups.map(group =>
                selectedGroups.has(group.id) ? TagManager.removeTagFromGroup(group, tagId) : group
            );

            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
        } catch (error) {
            ToastManager.getInstance().error('Failed to remove tags: ' + (error as Error).message);
        }
    };

    const showDeleteSelectedModal = () => {
        // Check if any selected groups are locked
        const lockedGroups = groups.filter(g => selectedGroups.has(g.id) && g.locked);
        if (lockedGroups.length > 0) {
            ToastManager.getInstance().warning(
                `Cannot delete ${lockedGroups.length} locked group${lockedGroups.length > 1 ? 's' : ''}. Unlock them first.`
            );
            return;
        }

        setDeleteModalType('selected');
        setDeleteTarget(`${selectedGroups.size}`);
        setShowDeleteModal(true);
    };

    const bulkDeleteGroups = async () => {
        try {
            // Filter out locked groups from deletion
            const groupsToDelete = groups.filter(g => selectedGroups.has(g.id) && !g.locked);
            const lockedCount = Array.from(selectedGroups).filter(id =>
                groups.find(g => g.id === id)?.locked
            ).length;

            const updatedGroups = groups.filter(group => !selectedGroups.has(group.id) || group.locked);
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
            clearSelection();

            if (lockedCount > 0) {
                ToastManager.getInstance().warning(
                    `Deleted ${groupsToDelete.length} groups. ${lockedCount} locked group${lockedCount > 1 ? 's' : ''} skipped.`
                );
            } else {
                ToastManager.getInstance().success(`${groupsToDelete.length} groups deleted successfully`);
            }
        } catch (error) {
            ToastManager.getInstance().error('Failed to delete groups: ' + (error as Error).message);
        }
    };

    const changeSortOrder = async (newSortOrder: SortOrder) => {
        try {
            const updatedSettings = { ...settings, sortOrder: newSortOrder };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
            setCurrentSortOrder(newSortOrder);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save sort preference: ' + (error as Error).message);
        }
    };

    const handleThemeChange = async (newTheme: 'light' | 'dark' | 'system') => {
        try {
            const updatedSettings = { ...settings, theme: newTheme };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save theme preference: ' + (error as Error).message);
        }
    };

    const openTagModal = (groupId: string) => {
        setTagModalGroupId(groupId);
        setShowTagModal(true);
        setOpenMenuId(null);
    };

    const showArchiveModal = (groupId: string) => {
        setSelectedGroupForArchive(groupId);
        archiveModal.openModal();
        setOpenMenuId(null);
    };

    /**
     * Copies all tab URLs and titles from a group to the clipboard
     * Format: URL | Title (one per line)
     * @param groupId - The ID of the group to copy links from
     */
    const handleCopyGroupLinks = async (groupId: string) => {
        try {
            // Check clipboard API availability
            if (!navigator.clipboard || !navigator.clipboard.writeText) {
                ToastManager.getInstance().error('Clipboard API not available in this browser');
                console.error('Clipboard API not supported');
                return;
            }

            const group = groups.find(g => g.id === groupId);
            if (!group || group.tabs.length === 0) {
                ToastManager.getInstance().warning('No tabs to copy');
                return;
            }

            // Format: URL | Title (handle edge cases)
            const linksText = group.tabs
                .map(tab => {
                    const url = tab.url || '';
                    const title = tab.title || 'Untitled';
                    return `${url} | ${title}`;
                })
                .join('\n');

            await navigator.clipboard.writeText(linksText);
            ToastManager.getInstance().success(`Copied ${group.tabs.length} links to clipboard`);
        } catch (error) {
            console.error('Failed to copy links:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            // Handle specific errors
            if (error instanceof DOMException && error.name === 'NotAllowedError') {
                ToastManager.getInstance().error('Permission denied. Please allow clipboard access.');
            } else {
                ToastManager.getInstance().error('Failed to copy links to clipboard');
            }
        }
    };

    const handleArchiveGroup = async (options: ArchiveOptions) => {
        try {
            console.log('Archiving groups:', options);

            // Import ArchiveService
            const { ArchiveService } = await import('../services/archive-service');

            // Get the groups to archive
            const groupsToArchive = groups.filter(g => options.groupIds.includes(g.id));

            // Archive each group using ArchiveService
            const archiveResults = [];
            for (const group of groupsToArchive) {
                const archiveOptions = {
                    groupId: group.id,
                    reason: options.reason,
                    password: options.passwordProtected ? options.password : undefined,
                    passwordHint: options.passwordProtected ? options.passwordHint : undefined,
                    createBackup: options.createBackup
                };

                const result = await ArchiveService.createArchive(group, archiveOptions);
                archiveResults.push(result);

                if (!result.success) {
                    throw new Error(result.error || `Failed to archive group "${group.name}"`);
                }
            }

            // Remove archived groups from the active list only after successful archiving
            const updatedGroups = groups.filter(g => !options.groupIds.includes(g.id));
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);

            // Show success message and close modal - toast z-index will handle visibility
            const warnings = archiveResults.flatMap(r => r.warnings || []);
            ToastManager.getInstance().success(
                `Successfully archived ${options.groupIds.length} group(s)${warnings.length > 0 ? ` (${warnings.length} warnings)` : ''}`
            );

            // Close immediately
            archiveModal.closeModal();
            setSelectedGroupForArchive(null);

            // Log warnings if any
            if (warnings.length > 0) {
                console.warn('Archive warnings:', warnings);
            }

        } catch (error) {
            console.error('Failed to archive group:', error);
            ToastManager.getInstance().error('Failed to archive group: ' + (error as Error).message);
            throw error; // Re-throw to let the modal handle the error display
        }
    };

    const handleTabDragStart = (e: React.DragEvent, tab: TabItem, sourceGroupId: string) => {
        e.stopPropagation();

        // Check if the dragged tab is selected and there are multiple selected tabs
        const isMultiDrag = selectedTabs.has(tab.id) && selectedTabs.size > 1;

        if (isMultiDrag) {
            // Start multi-drag through context
            startDrag();
            setDraggedTab(null);

            // Create custom drag image showing multiple tabs
            const dragPreview = document.createElement('div');
            dragPreview.className = 'fixed pointer-events-none z-[9999] flex flex-col gap-1 p-2 bg-bg-1 border border-border rounded-lg shadow-xl';
            dragPreview.style.cssText = 'position: absolute; top: -9999px; left: -9999px; max-width: 280px; opacity: 0.95;';

            // Get selected tab details
            const selectedTabsList = groups.flatMap(g => g.tabs).filter(t => selectedTabs.has(t.id));
            const maxPreviewTabs = 3;

            selectedTabsList.slice(0, maxPreviewTabs).forEach(t => {
                const tabEl = document.createElement('div');
                tabEl.className = 'flex items-center gap-2 px-2 py-1 bg-blue-50 dark:bg-blue-900/30 rounded text-sm';
                tabEl.innerHTML = `
                    <img src="${t.favicon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="gray"><circle cx="12" cy="12" r="10"/></svg>'}"
                         class="w-4 h-4" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22gray%22><circle cx=%2212%22 cy=%2212%22 r=%2210%22/></svg>'" />
                    <span class="truncate text-gray-700 dark:text-gray-200">${t.title.substring(0, 30)}${t.title.length > 30 ? '...' : ''}</span>
                `;
                dragPreview.appendChild(tabEl);
            });

            if (selectedTabs.size > maxPreviewTabs) {
                const moreEl = document.createElement('div');
                moreEl.className = 'text-xs text-gray-500 dark:text-gray-400 text-center py-1';
                moreEl.textContent = `+${selectedTabs.size - maxPreviewTabs} more tabs`;
                dragPreview.appendChild(moreEl);
            }

            // Badge showing count
            const badge = document.createElement('div');
            badge.className = 'absolute -top-2 -right-2 w-6 h-6 bg-blue-500 text-white text-xs font-bold rounded-full flex items-center justify-center';
            badge.textContent = String(selectedTabs.size);
            dragPreview.appendChild(badge);

            document.body.appendChild(dragPreview);
            e.dataTransfer.setDragImage(dragPreview, 20, 20);

            // Clean up after drag starts
            requestAnimationFrame(() => {
                setTimeout(() => dragPreview.remove(), 0);
            });
        } else {
            // Drag single tab
            setDraggedTab({ tab, sourceGroupId });
        }

        setIsDraggingTabs(true);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    };

    const handleTabDragEnd = (e: React.DragEvent) => {
        e.stopPropagation();
        setDraggedTab(null);
        endDrag();
        setDragOverGroupId(null);
        setIsDraggingTabs(false);
        setDragOverTarget(null);
    };

    const handleGroupDragEnter = (e: React.DragEvent, targetGroupId: string) => {
        e.preventDefault();
        e.stopPropagation();
        if ((draggedTab && draggedTab.sourceGroupId !== targetGroupId) || isDragging) {
            setDragOverGroupId(targetGroupId);
            setDragOverTarget(null);
        }
    };

    const handleGroupDragOver = (e: React.DragEvent, targetGroupId: string) => {
        e.preventDefault();
        e.stopPropagation();

        // Check if target group is locked
        const targetGroup = groups.find(g => g.id === targetGroupId);
        if (targetGroup?.locked) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }

        if ((draggedTab && draggedTab.sourceGroupId !== targetGroupId) || isDragging) {
            e.dataTransfer.dropEffect = 'move';
            setDragOverGroupId(targetGroupId);
            setDragOverTarget(null);
        }
    };

    const handleGroupDragLeave = (e: React.DragEvent) => {
        e.stopPropagation();
        const currentTarget = e.currentTarget as HTMLElement;
        const related = e.relatedTarget as Node | null;
        if (related && currentTarget.contains(related)) {
            return;
        }
        setDragOverGroupId(null);
    };

    const handleGroupDrop = async (e: React.DragEvent, targetGroupId: string) => {
        e.preventDefault();
        e.stopPropagation();

        // Check if target group is locked
        const targetGroup = groups.find(g => g.id === targetGroupId);
        if (targetGroup?.locked) {
            ToastManager.getInstance().warning('Cannot move tabs to locked group');
            setDragOverGroupId(null);
            return;
        }

        // Handle multiple tabs drop
        if (draggedItems && draggedItems.size > 0) {
            try {
                const tabsToMove: TabItem[] = [];
                const sourceGroupIds = new Set<string>();
                const draggedTabIds = new Set(Array.from(draggedItems.keys()));
                const tabIdsToRemoveFromSources = new Set<string>();

                draggedItems.forEach(({ tab, groupId }) => {
                    const sourceGroup = groups.find(g => g.id === groupId);
                    if (sourceGroup?.locked) return;

                    // Skip tabs that are already in the target group
                    if (groupId === targetGroupId) return;

                    tabsToMove.push({ ...tab, groupId: targetGroupId });
                    sourceGroupIds.add(groupId);
                    tabIdsToRemoveFromSources.add(tab.id);
                });

                if (tabsToMove.length === 0) {
                    ToastManager.getInstance().info('Tabs are already in this group');
                    clearTabSelection();
                    return;
                }

                // Filter out tabs that already exist in target group (by URL)
                const existingUrls = new Set(targetGroup?.tabs.map(t => t.url) || []);
                const uniqueTabsToMove = tabsToMove.filter(t => !existingUrls.has(t.url));

                const updatedGroups = groups.map(group => {
                    if (group.id === targetGroupId) {
                        return {
                            ...group,
                            tabs: [...group.tabs, ...uniqueTabsToMove],
                            modified: Date.now()
                        };
                    } else if (sourceGroupIds.has(group.id)) {
                        return {
                            ...group,
                            tabs: group.tabs.filter(t => !tabIdsToRemoveFromSources.has(t.id)),
                            modified: Date.now()
                        };
                    }
                    return group;
                }).filter(group => group.tabs.length > 0);

                await Storage.set('groups', updatedGroups);
                setGroups(updatedGroups);
                const skipped = tabsToMove.length - uniqueTabsToMove.length;
                const message = skipped > 0
                    ? `Moved ${uniqueTabsToMove.length} tab${uniqueTabsToMove.length !== 1 ? 's' : ''} (${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped)`
                    : `Moved ${uniqueTabsToMove.length} tab${uniqueTabsToMove.length !== 1 ? 's' : ''} to "${targetGroup?.name}"`;
                ToastManager.getInstance().success(message);
                clearTabSelection();
            } catch (error) {
                ToastManager.getInstance().error('Failed to move tabs: ' + (error as Error).message);
            }
        }
        // Handle single tab drop
        else if (draggedTab && draggedTab.sourceGroupId !== targetGroupId) {
            try {
                const updatedGroups = groups.map(group => {
                    if (group.id === draggedTab.sourceGroupId) {
                        return {
                            ...group,
                            tabs: group.tabs.filter(tab => tab.id !== draggedTab.tab.id),
                            modified: Date.now()
                        };
                    } else if (group.id === targetGroupId) {
                        return {
                            ...group,
                            tabs: [...group.tabs, { ...draggedTab.tab, groupId: targetGroupId }],
                            modified: Date.now()
                        };
                    }
                    return group;
                }).filter(group => group.tabs.length > 0);

                await Storage.set('groups', updatedGroups);
                setGroups(updatedGroups);
                ToastManager.getInstance().success(`Moved tab to "${targetGroup?.name}"`);
            } catch (error) {
                ToastManager.getInstance().error('Failed to move tab: ' + (error as Error).message);
            }
        }

        setDraggedTab(null);
        endDrag();
        setDragOverGroupId(null);
        setIsDraggingTabs(false);
        exitSelectionMode();
    };

    // Drop handlers for special targets (trash, new group)
    const handleTrashDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (draggedItems && draggedItems.size > 0) {
            // Delete multiple tabs
            try {
                const tabsByGroup = new Map<string, string[]>();
                draggedItems.forEach(({ groupId }, tabId) => {
                    if (!tabsByGroup.has(groupId)) {
                        tabsByGroup.set(groupId, []);
                    }
                    tabsByGroup.get(groupId)!.push(tabId);
                });

                const lockedGroupIds = Array.from(tabsByGroup.keys()).filter(
                    groupId => groups.find(g => g.id === groupId)?.locked
                );

                if (lockedGroupIds.length > 0) {
                    ToastManager.getInstance().warning('Cannot delete tabs from locked groups');
                    return;
                }

                const updatedGroups = groups.map(group => {
                    const tabIdsToRemove = tabsByGroup.get(group.id);
                    if (!tabIdsToRemove) return group;
                    return {
                        ...group,
                        tabs: group.tabs.filter(t => !tabIdsToRemove.includes(t.id)),
                        modified: Date.now()
                    };
                }).filter(group => group.tabs.length > 0);

                await Storage.set('groups', updatedGroups);
                setGroups(updatedGroups);
                ToastManager.getInstance().success(`Deleted ${draggedItems.size} tab${draggedItems.size > 1 ? 's' : ''}`);
                clearTabSelection();
            } catch (error) {
                ToastManager.getInstance().error('Failed to delete tabs: ' + (error as Error).message);
            }
        } else if (draggedTab) {
            // Delete single tab
            try {
                const sourceGroup = groups.find(g => g.id === draggedTab.sourceGroupId);
                if (sourceGroup?.locked) {
                    ToastManager.getInstance().warning('Cannot delete tabs from locked groups');
                    return;
                }

                const updatedGroups = groups.map(group => {
                    if (group.id === draggedTab.sourceGroupId) {
                        return {
                            ...group,
                            tabs: group.tabs.filter(t => t.id !== draggedTab.tab.id),
                            modified: Date.now()
                        };
                    }
                    return group;
                }).filter(group => group.tabs.length > 0);

                await Storage.set('groups', updatedGroups);
                setGroups(updatedGroups);
                ToastManager.getInstance().success('Tab deleted');
            } catch (error) {
                ToastManager.getInstance().error('Failed to delete tab: ' + (error as Error).message);
            }
        }

        setDraggedTab(null);
        endDrag();
        setDragOverGroupId(null);
        setIsDraggingTabs(false);
        setDragOverTarget(null);
        exitSelectionMode();
    };

    const handleNewGroupDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (draggedItems && draggedItems.size > 0) {
            // Create new group with multiple tabs
            try {
                const tabsToMove: TabItem[] = [];
                const sourceGroupIds = new Set<string>();
                const draggedTabIds = new Set(Array.from(draggedItems.keys()));

                draggedItems.forEach(({ tab, groupId }) => {
                    const sourceGroup = groups.find(g => g.id === groupId);
                    if (sourceGroup?.locked) return;
                    tabsToMove.push(tab);
                    sourceGroupIds.add(groupId);
                });

                if (tabsToMove.length === 0) {
                    ToastManager.getInstance().warning('Cannot move tabs from locked groups');
                    return;
                }

                const newGroupId = crypto.randomUUID();
                const newGroup: TabGroup = {
                    id: newGroupId,
                    name: `New Group (${tabsToMove.length} tabs)`,
                    tabs: tabsToMove.map(t => ({ ...t, groupId: newGroupId })),
                    created: Date.now(),
                    modified: Date.now()
                };

                const updatedGroups = groups.map(group => {
                    if (sourceGroupIds.has(group.id)) {
                        return {
                            ...group,
                            tabs: group.tabs.filter(t => !draggedTabIds.has(t.id)),
                            modified: Date.now()
                        };
                    }
                    return group;
                }).filter(group => group.tabs.length > 0);

                await Storage.set('groups', [...updatedGroups, newGroup]);
                setGroups([...updatedGroups, newGroup]);
                ToastManager.getInstance().success(`Created new group with ${tabsToMove.length} tab${tabsToMove.length > 1 ? 's' : ''}`);
                clearTabSelection();
            } catch (error) {
                ToastManager.getInstance().error('Failed to create group: ' + (error as Error).message);
            }
        } else if (draggedTab) {
            // Create new group with single tab
            try {
                const sourceGroup = groups.find(g => g.id === draggedTab.sourceGroupId);
                if (sourceGroup?.locked) {
                    ToastManager.getInstance().warning('Cannot move tabs from locked groups');
                    return;
                }

                const newGroupId = crypto.randomUUID();
                const newGroup: TabGroup = {
                    id: newGroupId,
                    name: `New Group`,
                    tabs: [{ ...draggedTab.tab, groupId: newGroupId }],
                    created: Date.now(),
                    modified: Date.now()
                };

                const updatedGroups = groups.map(group => {
                    if (group.id === draggedTab.sourceGroupId) {
                        return {
                            ...group,
                            tabs: group.tabs.filter(t => t.id !== draggedTab.tab.id),
                            modified: Date.now()
                        };
                    }
                    return group;
                }).filter(group => group.tabs.length > 0);

                await Storage.set('groups', [...updatedGroups, newGroup]);
                setGroups([...updatedGroups, newGroup]);
                ToastManager.getInstance().success('Created new group');
            } catch (error) {
                ToastManager.getInstance().error('Failed to create group: ' + (error as Error).message);
            }
        }

        setDraggedTab(null);
        endDrag();
        setDragOverGroupId(null);
        setIsDraggingTabs(false);
        setDragOverTarget(null);
        exitSelectionMode();
    };

    const handleTargetDragOver = (e: React.DragEvent, target: 'trash' | 'new-group') => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDragOverTarget(target);
        setDragOverGroupId(null);
    };

    const handleTargetDragLeave = (e: React.DragEvent) => {
        e.stopPropagation();
        setDragOverTarget(null);
    };

    // Render group menu content - reusable for all layouts
    const renderGroupMenu = (group: TabGroup) => {
        const groupMenuConfig = getNormalizedGroupMenuConfig(settings.groupMenuConfig);

        const showRememberThisGroup =
            groupMenuConfig.rememberThisGroup &&
            settings.groupMemoryEnabled !== false &&
            settings.groupMemoryAutoRemember === false;

        const showShareToBluet = isPro && groupMenuConfig.shareToBluet;
        const optionCanRender = (item: string) => {
            if (item === 'manageTags') return groupMenuConfig.manageTags;
            if (item === 'addNote') return groupMenuConfig.addNote;
            if (item === 'lockUnlock') return groupMenuConfig.lockUnlock;
            if (item === 'rememberThisGroup') return showRememberThisGroup;
            if (item === 'copyLinks') return groupMenuConfig.copyLinks;
            if (item === 'shareToBluet') return showShareToBluet;
            return false;
        };

        const renderSubmenuOption = (item: string) => {
            if (item === 'manageTags') {
                return (
                    <button
                        key={item}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!group.locked) {
                                openTagModal(group.id);
                                setOpenMenuId(null);
                            }
                        }}
                        disabled={group.locked}
                        className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${group.locked
                            ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                        title={group.locked ? 'Unlock group to manage tags' : ''}
                    >
                        <i className="fas fa-tags w-4"></i>
                        Manage Tags
                    </button>
                );
            }

            if (item === 'addNote') {
                return (
                    <button
                        key={item}
                        onClick={(e) => {
                            e.stopPropagation();
                            setNotesModalGroupId(group.id);
                            setNotesText(group.notes || '');
                            setOpenMenuId(null);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                        <i className="fas fa-sticky-note w-4"></i>
                        {group.notes ? 'Edit Note' : 'Add Note'}
                    </button>
                );
            }

            if (item === 'lockUnlock') {
                return (
                    <button
                        key={item}
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleGroupLock(group.id);
                            setOpenMenuId(null);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                        <i className={`fas fa-${group.locked ? 'unlock' : 'lock'} w-4`}></i>
                        {group.locked ? 'Unlock Group' : 'Lock Group'}
                    </button>
                );
            }

            if (item === 'rememberThisGroup') {
                return (
                    <button
                        key={item}
                        onClick={async (e) => {
                            e.stopPropagation();
                            await GroupMemoryStorageService.rememberGroup(group);
                            ToastManager.getInstance().success(`"${group.name}" will be remembered`);
                            setOpenMenuId(null);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                        <i className="fas fa-brain w-4"></i>
                        Remember This Group
                    </button>
                );
            }

            if (item === 'copyLinks') {
                return (
                    <button
                        key={item}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleCopyGroupLinks(group.id);
                            setOpenMenuId(null);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                        aria-label="Copy all links from group"
                        title="Copy all tab URLs and titles to clipboard"
                    >
                        <i className="fas fa-copy w-4"></i>
                        Copy Links
                    </button>
                );
            }

            if (item === 'shareToBluet') {
                return (
                    <button
                        key={item}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleShareToBluet(group);
                            setOpenMenuId(null);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                        <i className="fas fa-paper-plane w-4"></i>
                        {bluet_sharedRefs.some(r => r.id === group.id) ? 'Update on Bluet' : 'Share to Bluet'}
                    </button>
                );
            }

            return null;
        };

        const submenuVisibleItems: Record<string, string[]> = {};
        for (const submenu of groupMenuConfig.submenus || []) {
            const ordered = (groupMenuConfig.submenuItemOrder?.[submenu.id] || []).filter(
                (item) => groupMenuConfig.submenuAssignments?.[item as keyof typeof groupMenuConfig.submenuAssignments] === submenu.id && optionCanRender(item)
            );
            submenuVisibleItems[submenu.id] = ordered;
        }

        const mainItemCanRender = (token: string) => {
            if (token === 'groupInfo') return groupMenuConfig.groupInfo;
            if (token === 'archiveGroup') return groupMenuConfig.archiveGroup;
            if (token === 'assignToProject') return groupMenuConfig.assignToProject && projects.length > 0;
            if (token === 'deleteGroup') return groupMenuConfig.deleteGroup;
            if (token.startsWith('submenu:')) {
                const submenuId = token.replace('submenu:', '');
                const submenu = (groupMenuConfig.submenus || []).find(s => s.id === submenuId);
                return Boolean(submenu && submenu.visible && (submenuVisibleItems[submenuId]?.length || 0) > 0);
            }
            // Promoted submenu items at main level
            if (optionCanRender(token)) return true;
            return false;
        };

        const renderedMainItems = (groupMenuConfig.mainOrderV2 || []).filter(mainItemCanRender);

        return (
            <div className="absolute right-0 mt-2 w-48 bg-bg-1 border border-border rounded-lg shadow-xl z-40">
                {renderedMainItems.map((item, index) => {
                    if (item === 'groupInfo') {
                        return (
                            <button
                                key={item}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setInfoGroupId(group.id);
                                    setOpenMenuId(null);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                            >
                                <i className="fas fa-info-circle w-4"></i>
                                Group Info
                            </button>
                        );
                    }

                    if (item === 'archiveGroup') {
                        return (
                            <button
                                key={item}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!group.locked) {
                                        showArchiveModal(group.id);
                                        setOpenMenuId(null);
                                    }
                                }}
                                disabled={group.locked}
                                className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${group.locked
                                    ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                                title={group.locked ? 'Unlock group to archive' : ''}
                            >
                                <i className="fas fa-archive"></i>
                                Archive Group
                            </button>
                        );
                    }

                    if (item === 'assignToProject') {
                        return (
                            <div key={item} className="relative group/project">
                                <button
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between gap-2"
                                >
                                    <span className="flex items-center gap-2">
                                        <i className="fas fa-folder-plus w-4"></i>
                                        Assign to Project
                                    </span>
                                    <i className="fas fa-chevron-right text-xs"></i>
                                </button>
                                <div className="absolute left-full top-0 w-48 bg-bg-1 border border-border rounded-lg shadow-xl z-50 hidden group-hover/project:block">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleAssignGroupToProject(group.id, undefined);
                                            setOpenMenuId(null);
                                        }}
                                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 ${!group.projectId ? 'text-primary font-medium' : 'text-gray-700 dark:text-gray-300'}`}
                                    >
                                        {!group.projectId && <i className="fas fa-check text-xs"></i>}
                                        <span className={!group.projectId ? '' : 'ml-4'}>No Project</span>
                                    </button>
                                    {projects.map(proj => (
                                        <button
                                            key={proj.id}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleAssignGroupToProject(group.id, proj.id);
                                                setOpenMenuId(null);
                                            }}
                                            className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 ${group.projectId === proj.id ? 'text-primary font-medium' : 'text-gray-700 dark:text-gray-300'}`}
                                        >
                                            {group.projectId === proj.id && <i className="fas fa-check text-xs"></i>}
                                            <span className={group.projectId === proj.id ? '' : 'ml-4'}>{proj.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    }

                    if (item.startsWith('submenu:')) {
                        const submenuId = item.replace('submenu:', '');
                        const submenu = (groupMenuConfig.submenus || []).find(s => s.id === submenuId);
                        const items = submenuVisibleItems[submenuId] || [];
                        if (!submenu || items.length === 0 || !submenu.visible) return null;

                        return (
                            <div key={item} className="relative group/submenu">
                                <button
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between gap-2"
                                >
                                    <span className="flex items-center gap-2">
                                        <i className="fas fa-bars w-4"></i>
                                        {submenu.label}
                                    </span>
                                    <i className="fas fa-chevron-right text-xs"></i>
                                </button>
                                <div className="absolute left-full top-0 w-52 bg-bg-1 border border-border rounded-lg shadow-xl z-50 hidden group-hover/submenu:block">
                                    {items.map((submenuItem) => renderSubmenuOption(submenuItem))}
                                </div>
                            </div>
                        );
                    }

                    // Promoted submenu items rendered directly at main level
                    if (optionCanRender(item)) {
                        return renderSubmenuOption(item);
                    }

                    if (item === 'deleteGroup') {
                        const hasPreviousItems = index > 0;
                        return (
                            <div key={item}>
                                {hasPreviousItems && <div className="border-t border-gray-100 dark:border-gray-700 my-1"></div>}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (!group.locked) {
                                            showDeleteGroupModal(group.id);
                                            setOpenMenuId(null);
                                        }
                                    }}
                                    disabled={group.locked}
                                    className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${group.locked
                                        ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
                                        : 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
                                        }`}
                                    title={group.locked ? 'Unlock group to delete' : ''}
                                >
                                    <i className="fas fa-trash-alt w-4"></i>
                                    Delete Group
                                </button>
                            </div>
                        );
                    }

                    return null;
                })}
            </div>
        );
    };

    const handleDeleteConfirm = async () => {
        setShowDeleteModal(false);

        if (deleteModalType === 'group' && deleteTarget) {
            const group = groups.find(g => g.id === deleteTarget);
            // If the group is pinned, unpin it first
            if (group && pinManagement.isPinned(group.id)) {
                await pinManagement.togglePin(group.id);
            }
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

    return (
        <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
            <AppSidebar
                onSaveAllTabs={saveAllTabs}
                onNavigateToGroups={() => setActiveProjectId(null)}
                projects={projects}
                activeProjectId={activeProjectId}
                onSelectProject={setActiveProjectId}
                onCreateProject={() => {
                    setEditingProject(undefined);
                    setShowProjectModal(true);
                }}
                onEditProject={(project) => {
                    setEditingProject(project);
                    setShowProjectModal(true);
                }}
                onDeleteProject={handleDeleteProject}
            />
            <SidebarInset>
                <div className="min-h-screen bg-background text-foreground">
                    {/* Header */}
                    <header className="sticky top-0 z-50 flex flex-wrap xl:flex-nowrap items-center gap-2 border-b border-border bg-bg-1 px-4 py-2 xl:py-0 xl:h-16">
                        {/* Row 1 on mobile: Trigger, Stats, Layout */}
                        <div className="flex items-center gap-2 w-full xl:w-auto">
                            <SidebarTrigger className="-ml-1" />
                            <Separator orientation="vertical" className="mr-2 h-4" />
                            {/* Stats */}
                            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                {stats.totalGroups} groups • {stats.totalTabs} tabs
                            </span>

                            {/* Layout Toggle */}
                            <div className="flex items-center gap-1 ml-auto xl:ml-4">
                                <button
                                    onClick={() => setLayoutMode('grid')}
                                    className={`p-2 rounded transition-colors ${layoutMode === 'grid'
                                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300'
                                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                                        }`}
                                    title="Grid Layout"
                                >
                                    <i className="fas fa-th"></i>
                                </button>
                                <button
                                    onClick={() => setLayoutMode('masonry')}
                                    className={`p-2 rounded transition-colors ${layoutMode === 'masonry'
                                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300'
                                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                                        }`}
                                    title="Masonry Layout"
                                >
                                    <i className="fas fa-grip-vertical"></i>
                                </button>
                                <button
                                    onClick={() => setLayoutMode('dashboard')}
                                    className={`p-2 rounded transition-colors ${layoutMode === 'dashboard'
                                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300'
                                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                                        }`}
                                    title="Dashboard Layout"
                                >
                                    <i className="fas fa-border-all"></i>
                                </button>
                            </div>
                        </div>

                        {/* Row 2 on mobile: Search + Edit */}
                        <div className="flex items-center gap-2 w-full xl:w-auto xl:flex-1 xl:ml-8 xl:mr-8">
                            <div className="flex-1">
                                <InputGroup>
                                    <InputGroupInput
                                        type="text"
                                        placeholder="Search groups, tabs, or tags..."
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="text-sm"
                                    />
                                    <InputGroupAddon align="inline-end">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <button className="flex items-center gap-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors px-2">
                                                    {SORT_OPTIONS.find(opt => opt.value === currentSortOrder)?.label || 'Sort'}
                                                    <ChevronDown className="size-3" />
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {SORT_OPTIONS.map(option => (
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

                            {/* Edit button (always visible in row 2) */}
                            <Button
                                onClick={() => {
                                    if (bulkMode) clearSelection();
                                    setBulkMode(!bulkMode);
                                }}
                                variant="secondary"
                                size="sm"
                                className="px-3 flex-shrink-0"
                                title="Edit"
                            >
                                <i className={`fas ${bulkMode ? 'fa-times' : 'fa-edit'}`}></i>
                                <span className="hidden xl:inline ml-1.5">Edit</span>
                            </Button>
                        </div>

                    </header>

                    {/* Bulk Actions - Modern Design */}
                    {bulkMode && (
                        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
                            <div className="bg-bg-1 border border-border rounded-xl shadow-lg p-4">
                                {/* Header Row */}
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                                            <i className="fas fa-edit text-white text-sm"></i>
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-bold text-text-strong">Bulk Edit Mode</h3>
                                            <p className="text-xs text-text-muted">{selectedGroups.size} selected</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setBulkMode(false);
                                            clearSelection();
                                        }}
                                        className="p-1.5 rounded-lg text-text-muted hover:text-text-strong hover:bg-bg-2 transition-colors"
                                        title="Exit Edit Mode"
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>
                                </div>

                                {/* Actions Row */}
                                <div className="flex flex-wrap items-center gap-2">
                                    {/* Selection */}
                                    <button
                                        onClick={selectAllGroups}
                                        className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                                    >
                                        <i className="fas fa-check-double"></i>
                                        Select All
                                    </button>
                                    <button
                                        onClick={clearSelection}
                                        className="px-3 py-1.5 bg-bg-2 hover:bg-highlight text-text-strong border border-border rounded-lg text-xs font-medium flex items-center gap-1.5"
                                    >
                                        <i className="fas fa-times"></i>
                                        Clear
                                    </button>

                                    <div className="w-px h-6 bg-border mx-1"></div>

                                    {/* Tag Operations - Compact Dropdowns */}
                                    <div className="relative">
                                        <select
                                            onChange={(e) => {
                                                if (e.target.value) {
                                                    bulkAddTag(e.target.value);
                                                    e.target.value = '';
                                                }
                                            }}
                                            className="px-3 py-1.5 pr-7 bg-bg-2 border-0 rounded-lg text-xs text-text-strong cursor-pointer appearance-none"
                                            defaultValue=""
                                            disabled={selectedGroups.size === 0}
                                        >
                                            <option value="" disabled>+ Add Tag</option>
                                            {tags.map(tag => (
                                                <option key={tag.id} value={tag.id}>{tag.name}</option>
                                            ))}
                                        </select>
                                        <i className="fas fa-chevron-down absolute right-2 top-1/2 -translate-y-1/2 text-success text-[10px] pointer-events-none"></i>
                                    </div>
                                    <div className="relative">
                                        <select
                                            onChange={(e) => {
                                                if (e.target.value) {
                                                    bulkRemoveTag(e.target.value);
                                                    e.target.value = '';
                                                }
                                            }}
                                            className="px-3 py-1.5 pr-7 bg-bg-2 border-0 rounded-lg text-xs text-text-strong cursor-pointer appearance-none"
                                            defaultValue=""
                                            disabled={selectedGroups.size === 0}
                                        >
                                            <option value="" disabled>− Remove Tag</option>
                                            {tags.map(tag => (
                                                <option key={tag.id} value={tag.id}>{tag.name}</option>
                                            ))}
                                        </select>
                                        <i className="fas fa-chevron-down absolute right-2 top-1/2 -translate-y-1/2 text-danger text-[10px] pointer-events-none"></i>
                                    </div>

                                    {/* Assign to Project */}
                                    <div className="relative">
                                        <select
                                            onChange={(e) => {
                                                if (e.target.value !== '') {
                                                    handleBulkAssignToProject(e.target.value === 'none' ? undefined : e.target.value);
                                                    e.target.value = '';
                                                }
                                            }}
                                            className="px-3 py-1.5 pr-7 bg-bg-2 border-0 rounded-lg text-xs text-text-strong cursor-pointer appearance-none"
                                            defaultValue=""
                                            disabled={selectedGroups.size === 0}
                                        >
                                            <option value="" disabled>Assign to Project</option>
                                            <option value="none">No Project</option>
                                            {projects.map(project => (
                                                <option key={project.id} value={project.id}>{project.name}</option>
                                            ))}
                                        </select>
                                        <i className="fas fa-folder absolute right-2 top-1/2 -translate-y-1/2 text-primary text-[10px] pointer-events-none"></i>
                                    </div>

                                    <div className="w-px h-6 bg-border mx-1"></div>

                                    {/* Bulk Actions */}
                                    <button
                                        onClick={() => {
                                            if (selectedGroups.size === 0) return;
                                            // Copy all links from selected groups
                                            const selectedGroupsArray = groups.filter(g => selectedGroups.has(g.id));
                                            const allLinks = selectedGroupsArray.flatMap(g => g.tabs.map(t => t.url)).join('\n');
                                            navigator.clipboard.writeText(allLinks);
                                            ToastManager.getInstance().success(`Copied ${selectedGroupsArray.reduce((acc, g) => acc + g.tabs.length, 0)} links`);
                                        }}
                                        disabled={selectedGroups.size === 0}
                                        className="px-3 py-1.5 bg-bg-2 hover:bg-highlight text-text-strong border border-border rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Copy all links from selected groups"
                                    >
                                        <i className="fas fa-copy"></i>
                                        Copy Links
                                    </button>
                                    <button
                                        onClick={async () => {
                                            if (selectedGroups.size === 0) return;
                                            // Lock/Unlock all selected groups
                                            const selectedGroupsArray = groups.filter(g => selectedGroups.has(g.id));
                                            const allLocked = selectedGroupsArray.every(g => g.locked);
                                            const updatedGroups = groups.map(g =>
                                                selectedGroups.has(g.id) ? { ...g, locked: !allLocked } : g
                                            );
                                            await Storage.set('groups', updatedGroups);
                                            setGroups(updatedGroups);
                                            ToastManager.getInstance().success(`${allLocked ? 'Unlocked' : 'Locked'} ${selectedGroups.size} groups`);
                                        }}
                                        disabled={selectedGroups.size === 0}
                                        className="px-3 py-1.5 bg-bg-2 hover:bg-highlight text-text-strong border border-border rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Lock/Unlock selected groups"
                                    >
                                        <i className="fas fa-lock"></i>
                                        Lock/Unlock
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (selectedGroups.size === 0) return;
                                            // Open archive modal for selected groups
                                            setSelectedGroupForArchive(Array.from(selectedGroups)[0]);
                                            archiveModal.openModal();
                                        }}
                                        disabled={selectedGroups.size === 0}
                                        className="px-3 py-1.5 bg-bg-2 hover:bg-highlight text-text-strong border border-border rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Archive selected groups"
                                    >
                                        <i className="fas fa-archive"></i>
                                        Archive
                                    </button>

                                    <div className="flex-1"></div>

                                    {/* Delete */}
                                    {selectedGroups.size > 0 && (
                                        <button
                                            onClick={showDeleteSelectedModal}
                                            className="px-3 py-1.5 bg-danger hover:brightness-110 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                                        >
                                            <i className="fas fa-trash-alt"></i>
                                            Delete
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}


                    {/* Groups List */}
                    <div style={{ padding: '2rem' }} className={`mx-auto py-4 sm:py-6 ${layoutMode === 'grid' ? 'max-w-7xl px-4 sm:px-6 lg:px-8' : 'px-4 sm:px-6'}`}>
                        {layoutMode === 'dashboard' ? (
                            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                {filteredAndSortedGroups.length === 0 ? (
                                    <div className="col-span-full bg-bg-1 rounded-lg shadow-sm p-8 text-center border border-border">
                                        <p className="text-gray-500 dark:text-gray-400">No groups found. Save some tabs to get started!</p>
                                    </div>
                                ) : (
                                    filteredAndSortedGroups.map(group => (
                                        <MasonryGroupCard
                                            key={group.id}
                                            group={group}
                                            tags={tags}
                                            project={getGroupProject(group)}
                                            isPinned={pinManagement.isPinned(group.id)}
                                            isSelected={selectedGroups.has(group.id)}
                                            isDragOver={dragOverGroupId === group.id}
                                            bulkMode={bulkMode}
                                            isCollapsed={collapsedGroups.get(group.id) || false}
                                            editingId={editingId}
                                            editName={editName}
                                            tabLayout="dashboard"
                                            tabUrlDisplay={settings.tabUrlDisplay}
                                            groupNotesDisplay={settings.groupNotesDisplay}
                                            onEditNotes={() => { setNotesModalGroupId(group.id); setNotesText(group.notes || ''); setOpenMenuId(null); }}
                                            onTogglePin={() => pinManagement.togglePin(group.id)}
                                            onToggleSelect={() => toggleGroupSelection(group.id)}
                                            onToggleCollapse={() => toggleCollapse(group.id)}
                                            onOpenTab={(url, tabId) => openTab(url, tabId, group.id)}
                                            onCopyLink={(url) => {
                                                navigator.clipboard.writeText(url);
                                                ToastManager.getInstance().success('Link copied to clipboard');
                                            }}
                                            onDragEnter={(e) => handleGroupDragEnter(e, group.id)}
                                            onDragOver={(e) => handleGroupDragOver(e, group.id)}
                                            onDragLeave={handleGroupDragLeave}
                                            onDrop={(e) => handleGroupDrop(e, group.id)}
                                            onTabDragStart={(e, tab) => handleTabDragStart(e, tab, group.id)}
                                            onTabDragEnd={handleTabDragEnd}
                                            onOpenMenu={() => setOpenMenuId(openMenuId === group.id ? null : group.id)}
                                            isMenuOpen={openMenuId === group.id}
                                            onRestoreGroup={() => restoreGroup(group)}
                                            onStartEdit={() => startEdit(group)}
                                            onSaveEdit={saveEdit}
                                            onCancelEdit={cancelEdit}
                                            onEditNameChange={(value) => setEditName(value)}
                                            menuContent={renderGroupMenu(group)}
                                        />
                                    ))
                                )}
                            </div>
                        ) : layoutMode === 'masonry' ? (
                            <ResponsiveMasonry columnsCountBreakPoints={{ 0: 1, 900: 2, 1350: 3, 1800: 4 }}>
                                <Masonry gutter="1rem">
                                    {filteredAndSortedGroups.length === 0 ? (
                                        <div className="bg-bg-1 rounded-lg shadow-sm p-8 text-center border border-border">
                                            <p className="text-gray-500 dark:text-gray-400">No groups found. Save some tabs to get started!</p>
                                        </div>
                                    ) : (
                                        filteredAndSortedGroups.map(group => (
                                            <MasonryGroupCard
                                                key={group.id}
                                                group={group}
                                                tags={tags}
                                                project={getGroupProject(group)}
                                                isPinned={pinManagement.isPinned(group.id)}
                                                isSelected={selectedGroups.has(group.id)}
                                                isDragOver={dragOverGroupId === group.id}
                                                bulkMode={bulkMode}
                                                isCollapsed={collapsedGroups.get(group.id) || false}
                                                editingId={editingId}
                                                editName={editName}
                                                tabLayout="masonry"
                                                tabUrlDisplay={settings.tabUrlDisplay}
                                                groupNotesDisplay={settings.groupNotesDisplay}
                                                onEditNotes={() => { setNotesModalGroupId(group.id); setNotesText(group.notes || ''); setOpenMenuId(null); }}
                                                onTogglePin={() => pinManagement.togglePin(group.id)}
                                                onToggleSelect={() => toggleGroupSelection(group.id)}
                                                onToggleCollapse={() => toggleCollapse(group.id)}
                                                onOpenTab={(url, tabId) => openTab(url, tabId, group.id)}
                                                onCopyLink={(url) => {
                                                    navigator.clipboard.writeText(url);
                                                    ToastManager.getInstance().success('Link copied to clipboard');
                                                }}
                                                onDragEnter={(e) => handleGroupDragEnter(e, group.id)}
                                                onDragOver={(e) => handleGroupDragOver(e, group.id)}
                                                onDragLeave={handleGroupDragLeave}
                                                onDrop={(e) => handleGroupDrop(e, group.id)}
                                                onTabDragStart={(e, tab) => handleTabDragStart(e, tab, group.id)}
                                                onTabDragEnd={handleTabDragEnd}
                                                onOpenMenu={() => setOpenMenuId(openMenuId === group.id ? null : group.id)}
                                                isMenuOpen={openMenuId === group.id}
                                                onRestoreGroup={() => restoreGroup(group)}
                                                onStartEdit={() => startEdit(group)}
                                                onSaveEdit={saveEdit}
                                                onCancelEdit={cancelEdit}
                                                onEditNameChange={(value) => setEditName(value)}
                                                menuContent={renderGroupMenu(group)}
                                            />
                                        ))
                                    )}
                                </Masonry>
                            </ResponsiveMasonry>
                        ) : (
                            <div className="space-y-3 sm:space-y-4">
                                {filteredAndSortedGroups.length === 0 ? (
                                    <div className="bg-bg-1 rounded-lg shadow-sm p-8 text-center border border-border">
                                        <p className="text-gray-500 dark:text-gray-400">No groups found. Save some tabs to get started!</p>
                                    </div>
                                ) : (
                                    filteredAndSortedGroups.map(group => (
                                        <MasonryGroupCard
                                            key={group.id}
                                            group={group}
                                            tags={tags}
                                            project={getGroupProject(group)}
                                            isPinned={pinManagement.isPinned(group.id)}
                                            isSelected={selectedGroups.has(group.id)}
                                            isDragOver={dragOverGroupId === group.id}
                                            bulkMode={bulkMode}
                                            isCollapsed={collapsedGroups.get(group.id) || false}
                                            editingId={editingId}
                                            editName={editName}
                                            tabLayout="grid"
                                            tabUrlDisplay={settings.tabUrlDisplay}
                                            groupNotesDisplay={settings.groupNotesDisplay}
                                            onEditNotes={() => { setNotesModalGroupId(group.id); setNotesText(group.notes || ''); setOpenMenuId(null); }}
                                            onTogglePin={() => pinManagement.togglePin(group.id)}
                                            onToggleSelect={() => toggleGroupSelection(group.id)}
                                            onToggleCollapse={() => toggleCollapse(group.id)}
                                            onOpenTab={(url, tabId) => openTab(url, tabId, group.id)}
                                            onCopyLink={(url) => {
                                                navigator.clipboard.writeText(url);
                                                ToastManager.getInstance().success('Link copied to clipboard');
                                            }}
                                            onDragEnter={(e) => handleGroupDragEnter(e, group.id)}
                                            onDragOver={(e) => handleGroupDragOver(e, group.id)}
                                            onDragLeave={handleGroupDragLeave}
                                            onDrop={(e) => handleGroupDrop(e, group.id)}
                                            onTabDragStart={(e, tab) => handleTabDragStart(e, tab, group.id)}
                                            onTabDragEnd={handleTabDragEnd}
                                            onOpenMenu={() => setOpenMenuId(openMenuId === group.id ? null : group.id)}
                                            isMenuOpen={openMenuId === group.id}
                                            onRestoreGroup={() => restoreGroup(group)}
                                            onStartEdit={() => startEdit(group)}
                                            onSaveEdit={saveEdit}
                                            onCancelEdit={cancelEdit}
                                            onEditNameChange={(value) => setEditName(value)}
                                            menuContent={renderGroupMenu(group)}
                                        />
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    {/* Tag Management Modal - Modern */}
                    <Dialog open={showTagModal && !!tagModalGroupId} onOpenChange={(open) => !open && setShowTagModal(false)}>
                        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
                            <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
                                <DialogTitle className="text-text-strong flex items-center gap-2">
                                    <Tags className="h-4 w-4 text-primary" />
                                    Manage Tags
                                </DialogTitle>
                                <DialogDescription className="text-xs">
                                    Type and press Enter or Space to create a tag
                                </DialogDescription>
                            </DialogHeader>

                            <div className="p-4 space-y-4">
                                {/* Compact Tag Input with Color Picker */}
                                <div className="flex items-center gap-2">
                                    {/* Color Picker - Simple Toggle */}
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const picker = document.getElementById('color-picker-dropdown');
                                                if (picker) picker.classList.toggle('hidden');
                                            }}
                                            className="w-8 h-8 rounded-lg flex-shrink-0 border-2 border-border hover:border-primary transition-colors"
                                            style={{ backgroundColor: newTagColor }}
                                            title="Select color"
                                        />
                                        <div
                                            id="color-picker-dropdown"
                                            className="hidden absolute top-full left-0 mt-1 p-3 bg-bg-1 border border-border rounded-lg shadow-lg z-50"
                                            style={{ minWidth: '180px' }}
                                        >
                                            <div className="grid grid-cols-5 gap-3">
                                                {TAG_COLORS.map((color) => (
                                                    <button
                                                        key={color}
                                                        type="button"
                                                        onClick={() => {
                                                            setNewTagColor(color);
                                                            document.getElementById('color-picker-dropdown')?.classList.add('hidden');
                                                        }}
                                                        className={`w-6 h-6 rounded-full transition-all hover:scale-110 ${newTagColor === color ? 'ring-2 ring-primary' : ''}`}
                                                        style={{ backgroundColor: color }}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Tag Name Input */}
                                    <Input
                                        type="text"
                                        placeholder="Type tag name, press Enter..."
                                        value={newTagName}
                                        onChange={(e) => setNewTagName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if ((e.key === 'Enter' || e.key === ' ') && newTagName.trim()) {
                                                e.preventDefault();
                                                createTag();
                                            }
                                        }}
                                        className="flex-1 h-8 text-sm bg-bg-1"
                                    />
                                </div>

                                {/* Existing Tags - Click to assign/unassign */}
                                <div>
                                    <p className="text-xs text-text-muted mb-2">
                                        Click to assign • Hover to delete
                                    </p>
                                    <div className="flex flex-wrap gap-2.5 p-3 rounded-lg bg-bg-0 border border-border min-h-[60px]">
                                        {tags.length === 0 ? (
                                            <p className="text-xs text-text-muted w-full text-center py-2">
                                                No tags yet
                                            </p>
                                        ) : (
                                            tags.map(tag => {
                                                const group = groups.find(g => g.id === tagModalGroupId);
                                                const isAssigned = group?.tags?.includes(tag.id) || false;

                                                return (
                                                    <button
                                                        key={tag.id}
                                                        onClick={() => {
                                                            if (isAssigned) {
                                                                removeTagFromGroup(tagModalGroupId!, tag.id);
                                                            } else {
                                                                addTagToGroup(tagModalGroupId!, tag.id);
                                                            }
                                                        }}
                                                        className="group/tag relative px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 hover:scale-105"
                                                        style={{
                                                            backgroundColor: `${tag.color}33`,
                                                            color: tag.color,
                                                            border: isAssigned ? `2px solid ${tag.color}` : '2px solid transparent'
                                                        }}
                                                    >
                                                        {isAssigned && (
                                                            <span
                                                                className="absolute -top-1 -left-1 w-3 h-3 rounded-full flex items-center justify-center text-white"
                                                                style={{ backgroundColor: tag.color }}
                                                            >
                                                                <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                                                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                </svg>
                                                            </span>
                                                        )}
                                                        {tag.name}
                                                        {/* Delete on hover */}
                                                        <span
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                deleteTag(tag.id);
                                                            }}
                                                            className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center opacity-0 group-hover/tag:opacity-100 transition-opacity bg-danger text-white cursor-pointer"
                                                            title="Delete"
                                                        >
                                                            <X className="h-2 w-2" />
                                                        </span>
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="px-4 py-3 border-t border-border bg-bg-0">
                                <Button
                                    onClick={() => setShowTagModal(false)}
                                    variant="secondary"
                                    size="sm"
                                    className="w-full"
                                >
                                    Done
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Notes Modal */}
                    <Dialog open={!!notesModalGroupId} onOpenChange={(open) => { if (!open) { setNotesModalGroupId(null); setNotesText(''); } }}>
                        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
                            <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
                                <DialogTitle className="text-text-strong flex items-center gap-2">
                                    <i className="fas fa-sticky-note text-primary"></i>
                                    {groups.find(g => g.id === notesModalGroupId)?.notes ? 'Edit Note' : 'Add Note'}
                                </DialogTitle>
                                <DialogDescription className="text-xs">
                                    {groups.find(g => g.id === notesModalGroupId)?.name}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="p-4">
                                <textarea
                                    value={notesText}
                                    onChange={(e) => setNotesText(e.target.value)}
                                    placeholder="Add notes, details, or reminders..."
                                    className="w-full min-h-[120px] p-3 rounded-lg border border-border bg-bg-0 text-sm text-text-strong placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                                    autoFocus
                                />
                            </div>
                            <DialogFooter className="px-4 py-3 border-t border-border bg-bg-0">
                                <Button variant="outline" size="sm" onClick={() => { setNotesModalGroupId(null); setNotesText(''); }}>
                                    Cancel
                                </Button>
                                <Button size="sm" onClick={saveGroupNotes}>
                                    Save
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Drop Targets - Show when dragging tabs */}
                    {isDraggingTabs && (
                        <div data-drop-zone className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-bg-1 border border-border rounded-xl shadow-lg transition-all duration-200 ${dragOverTarget ? 'scale-105 shadow-xl' : ''}`}>
                            <span className={`text-sm font-medium mr-2 transition-opacity ${dragOverTarget ? 'opacity-50' : 'text-gray-500 dark:text-gray-400'}`}>
                                {isDragging && selectedTabs.size > 1 ? `${selectedTabs.size} tabs` : '1 tab'}
                            </span>

                            <div className="h-8 w-px bg-border"></div>

                            {/* New Group Drop Target */}
                            <div
                                onDragOver={(e) => handleTargetDragOver(e, 'new-group')}
                                onDragLeave={handleTargetDragLeave}
                                onDrop={handleNewGroupDrop}
                                className={`flex items-center gap-2 px-5 py-3 rounded-lg border-2 border-dashed transition-all cursor-pointer
                                    ${dragOverTarget === 'new-group'
                                        ? 'border-blue-500 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 scale-110 shadow-lg ring-2 ring-blue-300 dark:ring-blue-600'
                                        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/20'
                                    }`}
                            >
                                <i className={`fas fa-folder-plus text-xl ${dragOverTarget === 'new-group' ? 'animate-pulse' : ''}`}></i>
                                <span className="text-sm font-semibold">New Group</span>
                            </div>

                            {/* Trash Drop Target */}
                            <div
                                onDragOver={(e) => handleTargetDragOver(e, 'trash')}
                                onDragLeave={handleTargetDragLeave}
                                onDrop={handleTrashDrop}
                                className={`flex items-center gap-2 px-5 py-3 rounded-lg border-2 border-dashed transition-all cursor-pointer
                                    ${dragOverTarget === 'trash'
                                        ? 'border-red-500 bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 scale-110 shadow-lg ring-2 ring-red-300 dark:ring-red-600'
                                        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-red-400 hover:bg-red-50/50 dark:hover:bg-red-900/20'
                                    }`}
                            >
                                <i className={`fas fa-trash-alt text-xl ${dragOverTarget === 'trash' ? 'animate-pulse' : ''}`}></i>
                                <span className="text-sm font-semibold">Delete</span>
                            </div>
                        </div>
                    )}

                    {/* Tab Selection Toolbar */}
                    <TabSelectionToolbar groups={groups} setGroups={setGroups} isDraggingTabs={isDraggingTabs} />

                    {/* Floating Action Buttons */}
                    <div className={`fixed bottom-6 right-6 flex items-center gap-3 z-50 ${isDraggingTabs ? 'opacity-30 pointer-events-none' : ''}`}>
                        {/* Project Action Buttons - only shown when a project is selected */}
                        {activeProjectId && (() => {
                            const activeProject = projects.find(p => p.id === activeProjectId);
                            if (!activeProject) return null;
                            return (
                                <>
                                    {/* Add Existing Group to Project Button */}
                                    <button
                                        onClick={() => setShowAddGroupToProjectModal(true)}
                                        className="w-14 h-14 rounded-full shadow-lg transition-all duration-200 hover:shadow-2xl hover:scale-105 flex items-center justify-center"
                                        style={{
                                            backgroundColor: getProjectBackgroundColor(activeProject.color, 0.1),
                                            color: PROJECT_COLORS[activeProject.color],
                                        }}
                                        title={`Add Group to ${activeProject.name}`}
                                    >
                                        <FolderPlus className="w-6 h-6" />
                                    </button>
                                    {/* Save Tabs to Project Button */}
                                    <button
                                        onClick={() => saveAllTabs(activeProjectId)}
                                        className="w-14 h-14 rounded-full shadow-lg transition-all duration-200 hover:shadow-2xl hover:scale-105 flex items-center justify-center"
                                        style={{
                                            backgroundColor: getProjectBackgroundColor(activeProject.color, 0.1),
                                            color: PROJECT_COLORS[activeProject.color],
                                        }}
                                        title={`Save Tabs to ${activeProject.name}`}
                                    >
                                        <SquaresExclude className="w-6 h-6" />
                                    </button>
                                </>
                            );
                        })()}
                        {/* Archive Access Button */}
                        <button
                            onClick={() => setIsArchiveModalOpen(true)}
                            className="w-14 h-14 text-white rounded-full shadow-lg transition-all duration-200 hover:shadow-xl flex items-center justify-center"
                            style={{ backgroundColor: '#2950D5' }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1e3fa8'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#2950D5'}
                            title="Open Archives"
                        >
                            <i className="fas fa-archive text-xl"></i>
                        </button>
                    </div>

                    {/* Archive Browser Modal */}
                    <ArchiveModal
                        isOpen={isArchiveModalOpen}
                        onClose={() => setIsArchiveModalOpen(false)}
                    />

                    {/* Create Archive Modal */}
                    <CreateArchiveModal
                        isOpen={archiveModal.isOpen}
                        onClose={archiveModal.closeModal}
                        onArchive={handleArchiveGroup}
                        groups={groups}
                        selectedGroupIds={selectedGroupForArchive ? [selectedGroupForArchive] : []}
                    />

                    {/* Group Info Modal */}
                    <GroupInfoModal
                        group={groups.find(g => g.id === infoGroupId) ?? null}
                        tags={tags}
                        projects={projects}
                        onClose={() => setInfoGroupId(null)}
                    />

                    {/* Delete Confirmation Modal */}
                    <ConfirmModal
                        isOpen={showDeleteModal}
                        title={
                            deleteModalType === 'group'
                                ? 'Delete Group'
                                : deleteModalType === 'selected'
                                    ? 'Delete Selected Groups'
                                    : 'Delete Tag'
                        }
                        message={
                            deleteModalType === 'group'
                                ? 'Are you sure you want to delete this group? All tabs in this group will be permanently removed.'
                                : deleteModalType === 'selected'
                                    ? `Are you sure you want to delete ${selectedGroups.size} selected group(s)? All tabs in these groups will be permanently removed.`
                                    : 'Are you sure you want to delete this tag? It will be removed from all groups and tabs.'
                        }
                        confirmText="Delete"
                        cancelText="Cancel"
                        onConfirm={handleDeleteConfirm}
                        onCancel={handleDeleteCancel}
                        type="danger"
                    />

                    {/* Project Modal */}
                    <ProjectModal
                        isOpen={showProjectModal}
                        onClose={() => {
                            setShowProjectModal(false);
                            setEditingProject(undefined);
                        }}
                        onSave={editingProject ? handleEditProject : handleCreateProject}
                        editProject={editingProject}
                        existingProjects={projects}
                    />

                    {/* Add Group to Project Modal */}
                    {activeProjectId && (() => {
                        const activeProject = projects.find(p => p.id === activeProjectId);
                        if (!activeProject) return null;
                        return (
                            <AddGroupToProjectModal
                                isOpen={showAddGroupToProjectModal}
                                onClose={() => setShowAddGroupToProjectModal(false)}
                                project={activeProject}
                                groups={groups}
                                onAddGroups={async (groupIds) => {
                                    const updatedGroups = groups.map(g =>
                                        groupIds.includes(g.id)
                                            ? { ...g, projectId: activeProjectId, modified: Date.now() }
                                            : g
                                    );
                                    await Storage.set('groups', updatedGroups);
                                    setGroups(updatedGroups);
                                    ToastManager.getInstance().success(`Added ${groupIds.length} group${groupIds.length > 1 ? 's' : ''} to "${activeProject.name}"`);
                                }}
                            />
                        );
                    })()}

                    {/* Toast Notifications */}
                    <Toaster richColors position="bottom-right" />
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = createRoot(rootElement);
    root.render(<TabManager />);
}
