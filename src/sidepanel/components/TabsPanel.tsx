import { useState, useCallback, useEffect, useRef } from 'react';
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
import { Loader2, SearchX } from 'lucide-react';
import { Storage } from '../../utils/storage';
import type { TabGroup, TabItem, Settings } from '../../types/models';
import type { BrowserGroup, TabGroupColor as BrowserGroupColor } from '../hooks/useBrowserGroups';
import { FlowService } from '../../services/flow-service';
import { FlowStorageService } from '../../utils/flow-storage';
import { ArchiveService } from '../../services/archive-service';

export function TabsPanel() {
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
        filteredPinnedTabs,
        filteredGroupedTabs,
        filteredUngroupedTabs,
        filteredGroups,
        hasResults
    } = useTabSearch({ tabs, groups, groupedTabs });

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
        const blueTabGroupId = crypto.randomUUID();
        const tabItems: TabItem[] = sectionTabs.map(t => ({
            id: crypto.randomUUID(),
            url: t.url,
            title: t.title,
            favicon: t.favIconUrl,
            timestamp: Date.now(),
            groupId: blueTabGroupId,
            pinned: t.pinned
        }));

        const newGroup: TabGroup = {
            id: blueTabGroupId,
            name: groupName || `Saved ${new Date().toLocaleDateString()}`,
            tabs: tabItems,
            created: Date.now(),
            modified: Date.now()
        };

        const existing = await Storage.get<TabGroup[]>('groups') || [];
        await Storage.set('groups', [...existing, newGroup]);

        if (browserSettings.closeOnSave) {
            const tabIdsToClose = sectionTabs.map(t => t.id).filter(id => id !== undefined);
            if (tabIdsToClose.length > 0) {
                await chrome.tabs.remove(tabIdsToClose);
            }
        }
    };

    const handleSaveGroupToBlueTab = async (group: BrowserGroup, groupTabs: BrowserTab[]) => {
        await handleSaveToBlueTab(groupTabs, group.title || 'Unnamed Group');
    };

    const handleSaveTabToBlueTab = async (tab: BrowserTab) => {
        await handleSaveToBlueTab([tab], tab.title || 'Saved Tab');
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
            name: groupName || `Archived ${new Date().toLocaleDateString()}`,
            tabs: tabItems,
            created: Date.now(),
            modified: Date.now()
        };

        const result = await ArchiveService.createArchive(group, {
            groupId: group.id,
            reason: 'Saved from sidepanel'
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
                <p className="text-sm text-danger">Error: {error}</p>
            </div>
        );
    }

    const totalTabs = pinnedTabs.length + ungroupedTabs.length +
        Array.from(groupedTabs.values()).reduce((sum, t) => sum + t.length, 0);

    const filteredTotalTabs = filteredPinnedTabs.length + filteredUngroupedTabs.length +
        Array.from(filteredGroupedTabs.values()).reduce((sum, t) => sum + t.length, 0);

    return (
        <div className="flex flex-col h-full min-w-0">
            {/* Action Bar */}
            <ActionBar
                selectedTabs={selectedTabs}
                isSelectionMode={isSelectionMode}
                groups={groups}
                onToggleSelectionMode={handleToggleSelectionMode}
                onClearSelection={() => setSelectedTabIds(new Set())}
                onNewGroup={handleNewGroup}
                onOrganize={handleOrganize}
                onSaveToBlueTab={(tabs) => handleSaveToBlueTab(tabs, `Selected ${new Date().toLocaleDateString()}`)}
                onMoveToGroup={async (tabIds, groupId) => {
                    await chrome.tabs.group({ tabIds, groupId });
                    setSelectedTabIds(new Set());
                    setIsSelectionMode(false);
                }}
            />

            {/* Search Bar */}
            <div className="px-2 py-2">
                <SearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                />
            </div>

            {/* Tabs List */}
            <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden scrollbar-transparent">
                <div className="space-y-3 px-2 pb-4 min-w-0">
                    {/* No Results */}
                    {searchQuery && !hasResults && (
                        <div className="flex flex-col items-center justify-center h-40 text-text-muted">
                            <SearchX className="w-10 h-10 mb-3 opacity-50" />
                            <p className="text-sm font-medium">No tabs found</p>
                            <p className="text-xs mt-1">Try a different search term</p>
                        </div>
                    )}

                    {/* Pinned Tabs */}
                    {hasResults && (
                        <PinnedTabsSection
                            tabs={filteredPinnedTabs}
                            groupMemoryUrls={memoryUrls}
                            selectedTabIds={selectedTabIds}
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
                            onSaveToBlueTab={(t) => handleSaveToBlueTab(t, 'Pinned Tabs')}
                            onSaveToArchive={(t) => handleSaveToArchive(t, 'Pinned Tabs')}
                            onCopyLinks={handleCopyLinks}
                            onDeleteAllTabs={handleDeleteTabsByIds}
                            onSaveTabToBlueTab={handleSaveTabToBlueTab}
                            showInactiveIndicator={browserSettings.showInactiveIndicator}
                        />
                    )}

                    {/* Grouped Tabs */}
                    {hasResults && filteredGroups.map(group => {
                        const groupTabs = filteredGroupedTabs.get(group.id) || [];
                        if (groupTabs.length === 0) return null;

                        return (
                            <BrowserGroupCard
                                key={group.id}
                                group={group}
                                tabs={groupTabs}
                                groupMemoryUrls={memoryUrls}
                                selectedTabIds={selectedTabIds}
                                isSelectionMode={isSelectionMode}
                                onTabClose={(id) => closeTab(id)}
                                onTabActivate={(id) => activateTab(id)}
                                onTabSelect={handleTabSelect}
                                onCollapseGroup={(id, c) => collapseGroup(id, c)}
                                onRenameGroup={handleRenameGroup}
                                onChangeGroupColor={handleChangeGroupColor}
                                onSaveToBlueTab={handleSaveGroupToBlueTab}
                                onSaveToArchive={(t) => handleSaveToArchive(t, group.title || 'Unnamed Group')}
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
                            />
                        );
                    })}

                    {/* Ungrouped Tabs */}
                    {hasResults && (
                        <UngroupedTabsSection
                            tabs={filteredUngroupedTabs}
                            groupMemoryUrls={memoryUrls}
                            selectedTabIds={selectedTabIds}
                            isSelectionMode={isSelectionMode}
                            onTabClose={(id) => closeTab(id)}
                            onTabActivate={(id) => activateTab(id)}
                            onTabSelect={handleTabSelect}
                            onNewTab={handleNewUngroupedTab}
                            onSaveToBlueTab={(t) => handleSaveToBlueTab(t, 'Ungrouped Tabs')}
                            onSaveToArchive={(t) => handleSaveToArchive(t, 'Ungrouped Tabs')}
                            onCopyLinks={handleCopyLinks}
                            onDeleteAllTabs={handleDeleteTabsByIds}
                            onSaveTabToBlueTab={handleSaveTabToBlueTab}
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
                        />
                    )}

                    {/* Empty State */}
                    {totalTabs === 0 && !searchQuery && (
                        <div className="flex flex-col items-center justify-center h-40 text-text-muted">
                            <p className="text-sm font-medium">No tabs open</p>
                        </div>
                    )}

                    {/* Search results count */}
                    {searchQuery && hasResults && (
                        <div className="text-center py-1">
                            <span className="text-xs text-text-muted">
                                {filteredTotalTabs} of {totalTabs} tabs
                            </span>
                        </div>
                    )}
                </div>
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
