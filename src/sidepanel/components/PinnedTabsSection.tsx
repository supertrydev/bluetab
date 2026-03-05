import { useState } from 'react';
import { Pin, ChevronDown, ChevronRight, Plus, MoreHorizontal, Archive, Copy, Trash2, LayersPlus } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '../../components/ui/dropdown-menu';
import { ConfirmModal } from '../../components/ConfirmModal';
import { TabItem } from './TabItem';
import type { BrowserTab } from '../hooks/useBrowserTabs';

interface PinnedTabsSectionProps {
    tabs: BrowserTab[];
    groupMemoryUrls?: Set<string>;
    selectedTabIds?: Set<number>;
    isSelectionMode?: boolean;
    onTabClose: (tabId: number) => void;
    onTabActivate: (tabId: number) => void;
    onTabSelect?: (tabId: number) => void;
    onNewTab?: () => void;
    onSaveToBlueTab?: (tabs: BrowserTab[]) => void;
    onSaveToArchive?: (tabs: BrowserTab[]) => void;
    onCopyLinks?: (tabs: BrowserTab[]) => void;
    onDeleteAllTabs?: (tabIds: number[]) => void;
    onSaveTabToBlueTab?: (tab: BrowserTab) => void;
    showInactiveIndicator?: boolean;
    isDndActive?: boolean;
    dropIndicatorTabId?: number | null;
    dropIndicatorPos?: 'above' | 'below' | null;
    onTabDragStart?: (e: React.DragEvent, tab: BrowserTab, containerId: string) => void;
    onTabDragEnd?: (e: React.DragEvent) => void;
    onTabDragOver?: (e: React.DragEvent, tab: BrowserTab, containerId: string) => void;
    onTabDrop?: (e: React.DragEvent, tab: BrowserTab, containerId: string) => void;
}

export function PinnedTabsSection({
    tabs,
    groupMemoryUrls,
    selectedTabIds,
    isSelectionMode = false,
    onTabClose,
    onTabActivate,
    onTabSelect,
    onNewTab,
    onSaveToBlueTab,
    onSaveToArchive,
    onCopyLinks,
    onDeleteAllTabs,
    onSaveTabToBlueTab,
    showInactiveIndicator = true,
    isDndActive = false,
    dropIndicatorTabId = null,
    dropIndicatorPos = null,
    onTabDragStart,
    onTabDragEnd,
    onTabDragOver,
    onTabDrop,
}: PinnedTabsSectionProps) {
    const [isOpen, setIsOpen] = useState(true);
    const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);

    if (tabs.length === 0) return null;

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <div className="rounded-xl border border-border bg-bg-1 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-2.5 min-w-0">
                    <CollapsibleTrigger asChild>
                        <button className="p-1 hover:bg-bg-2 rounded-md transition-colors duration-150 flex-shrink-0">
                            {isOpen ? (
                                <ChevronDown className="w-4 h-4 text-text-muted" />
                            ) : (
                                <ChevronRight className="w-4 h-4 text-text-muted" />
                            )}
                        </button>
                    </CollapsibleTrigger>

                    <Pin className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0" />

                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                        <CollapsibleTrigger asChild>
                            <span className="text-xs font-semibold text-text-muted tracking-wide uppercase truncate cursor-pointer">
                                Pinned
                            </span>
                        </CollapsibleTrigger>
                        <span className="text-xs text-text-muted tabular-nums flex-shrink-0">
                            {tabs.length}
                        </span>
                    </div>

                    {/* New tab button */}
                    {onNewTab && (
                        <button
                            onClick={onNewTab}
                            className="p-1 hover:bg-bg-2 rounded-md transition-colors duration-150 flex-shrink-0 text-text-muted hover:text-text-strong"
                            title="New pinned tab"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    )}

                    {/* Save to BlueTab button */}
                    {onSaveToBlueTab && (
                        <button
                            onClick={() => onSaveToBlueTab(tabs)}
                            className="p-1 hover:bg-bg-2 rounded-md transition-colors duration-150 flex-shrink-0 text-text-muted hover:text-text-strong"
                            title="Save to BlueTab"
                        >
                            <LayersPlus className="w-4 h-4" />
                        </button>
                    )}

                    {/* 3-dot menu */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="p-1 hover:bg-bg-2 rounded-md transition-all duration-150 flex-shrink-0 text-text-muted hover:text-text-strong">
                                <MoreHorizontal className="w-4 h-4" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                            {onSaveToArchive && (
                                <DropdownMenuItem
                                    onClick={() => onSaveToArchive(tabs)}
                                    className="focus:bg-gray-100 dark:focus:bg-gray-700"
                                >
                                    <Archive className="w-4 h-4 mr-2" />
                                    Save to Archive
                                </DropdownMenuItem>
                            )}
                            {onCopyLinks && (
                                <DropdownMenuItem
                                    onClick={() => onCopyLinks(tabs)}
                                    className="focus:bg-gray-100 dark:focus:bg-gray-700"
                                >
                                    <Copy className="w-4 h-4 mr-2" />
                                    Copy Links
                                </DropdownMenuItem>
                            )}
                            {onDeleteAllTabs && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => setShowDeleteAllModal(true)}
                                        className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-900/20"
                                    >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Delete All
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {/* Tabs */}
                <CollapsibleContent>
                    <div className="px-1.5 pb-2 space-y-0.5">
                        {tabs.map(tab => (
                            <TabItem
                                key={tab.id}
                                tab={tab}
                                containerId="pinned"
                                isInGroupMemory={groupMemoryUrls?.has(tab.url)}
                                isSelected={selectedTabIds?.has(tab.id)}
                                isSelectionMode={isSelectionMode}
                                isDndActive={isDndActive}
                                dropIndicator={dropIndicatorTabId === tab.id ? dropIndicatorPos : null}
                                onClose={onTabClose}
                                onActivate={onTabActivate}
                                onSelect={onTabSelect}
                                onSaveToBlueTab={onSaveTabToBlueTab}
                                onDragStart={onTabDragStart}
                                onDragEnd={onTabDragEnd}
                                onDragOver={onTabDragOver}
                                onDrop={onTabDrop}
                                showInactiveIndicator={showInactiveIndicator}
                            />
                        ))}
                    </div>
                </CollapsibleContent>
            </div>

            {/* Delete All Confirmation Modal */}
            <ConfirmModal
                isOpen={showDeleteAllModal}
                title="Delete All Pinned Tabs"
                message={`Are you sure you want to close all ${tabs.length} pinned tab(s)?`}
                confirmText="Delete"
                cancelText="Cancel"
                onConfirm={() => {
                    onDeleteAllTabs?.(tabs.map(t => t.id));
                    setShowDeleteAllModal(false);
                }}
                onCancel={() => setShowDeleteAllModal(false)}
                type="danger"
            />
        </Collapsible>
    );
}
