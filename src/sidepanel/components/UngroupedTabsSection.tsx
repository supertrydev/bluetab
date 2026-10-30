import { useState } from 'react';
import { Minus, ChevronDown, ChevronRight, Plus, MoreHorizontal, Archive, Copy, Trash2, LayersPlus, BedDouble } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import { cn } from '@/lib/utils';
import type { BrowserTab } from '../hooks/useBrowserTabs';

interface UngroupedTabsSectionProps {
    tabs: BrowserTab[];
    groupMemoryUrls?: Set<string>;
    selectedTabIds?: Set<number>;
    focusHighlightTabId?: number | null;
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
    /**
     * Phase 9 Safe Auto-Suspend — "Save & close suspended tabs" menu entry
     * for the ungrouped tabs bucket. Parity with BrowserGroupCard. Handler
     * filters the ungrouped subset to discarded tabs, saves them as a new
     * BlueTab group, and closes the saved Chrome tabs in one motion; empty
     * subset shows an explanatory toast rather than no-op'ing.
     */
    onSaveSuspendedAsGroup?: (tabs: BrowserTab[]) => void;
    showInactiveIndicator?: boolean;
    searchQuery?: string;
    isDndActive?: boolean;
    isDropTarget?: boolean;
    dropIndicatorTabId?: number | null;
    dropIndicatorPos?: 'above' | 'below' | null;
    onTabDragStart?: (e: React.DragEvent, tab: BrowserTab, containerId: string) => void;
    onTabDragEnd?: (e: React.DragEvent) => void;
    onTabDragOver?: (e: React.DragEvent, tab: BrowserTab, containerId: string) => void;
    onTabDrop?: (e: React.DragEvent, tab: BrowserTab, containerId: string) => void;
    onContainerDragOver?: (e: React.DragEvent, containerId: string) => void;
    onContainerDrop?: (e: React.DragEvent, containerId: string) => void;
}

export function UngroupedTabsSection({
    tabs,
    groupMemoryUrls,
    selectedTabIds,
    focusHighlightTabId = null,
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
    onSaveSuspendedAsGroup,
    showInactiveIndicator = true,
    searchQuery,
    isDndActive = false,
    isDropTarget = false,
    dropIndicatorTabId = null,
    dropIndicatorPos = null,
    onTabDragStart,
    onTabDragEnd,
    onTabDragOver,
    onTabDrop,
    onContainerDragOver,
    onContainerDrop,
}: UngroupedTabsSectionProps) {
    const { t } = useTranslation();

    const [isOpen, setIsOpen] = useState(true);
    const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);

    if (tabs.length === 0) return null;

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <div
                className={cn(
                    "rounded-xl border border-border bg-bg-1 overflow-hidden",
                    isDropTarget && "ring-2 ring-primary/40"
                )}
                onDragOver={(e) => { e.preventDefault(); onContainerDragOver?.(e, 'ungrouped'); }}
                onDrop={(e) => { e.preventDefault(); onContainerDrop?.(e, 'ungrouped'); }}
            >
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-2.5 min-w-0">
                    <CollapsibleTrigger asChild>
                        <button className="p-1 hover:bg-bg-2 rounded-md transition-colors duration-150 flex-shrink-0">
                            {isOpen ? (
                                <ChevronDown className="w-4 h-4 text-text-muted" />
                            ) : (
                                <ChevronRight className="w-4 h-4 text-text-muted rtl:rotate-180" />
                            )}
                        </button>
                    </CollapsibleTrigger>

                    <Minus className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />

                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                        <CollapsibleTrigger asChild>
                            <span className="text-label font-medium text-text-muted truncate cursor-pointer">
                                {t('sidepanel.tabsPanel.ungroupedLabel')}
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
                            title={t('sidepanel.ungroupedSection.newTab')}
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    )}

                    {/* Save to BlueTab button */}
                    {onSaveToBlueTab && (
                        <button
                            onClick={() => onSaveToBlueTab(tabs)}
                            className="p-1 hover:bg-bg-2 rounded-md transition-colors duration-150 flex-shrink-0 text-text-muted hover:text-text-strong"
                            title={t('sidepanel.browserGroup.saveToBlueTab')}
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
                                    <Archive className="w-4 h-4 me-2" />
                                    {t('sidepanel.browserGroup.saveToArchive')}
                                </DropdownMenuItem>
                            )}
                            {onCopyLinks && (
                                <DropdownMenuItem
                                    onClick={() => onCopyLinks(tabs)}
                                    className="focus:bg-gray-100 dark:focus:bg-gray-700"
                                >
                                    <Copy className="w-4 h-4 me-2" />
                                    {t('sidepanel.browserGroup.copyLinks')}
                                </DropdownMenuItem>
                            )}

                            {/* Phase 9 Safe Auto-Suspend — save the discarded
                                subset of the ungrouped bucket as a new BlueTab
                                group AND close the saved Chrome tabs in one
                                motion. Parity with BrowserGroupCard. Handler
                                toasts the outcome (success count, "no suspended
                                tabs", or save-succeeded-but-close-failed). */}
                            {onSaveSuspendedAsGroup && (
                                <DropdownMenuItem
                                    onClick={() => onSaveSuspendedAsGroup(tabs)}
                                    className="focus:bg-gray-100 dark:focus:bg-gray-700"
                                >
                                    <BedDouble className="w-4 h-4 me-2" />
                                    {t('sidepanel.browserGroup.saveAndCloseSuspendedTabs')}
                                </DropdownMenuItem>
                            )}

                            {onDeleteAllTabs && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => setShowDeleteAllModal(true)}
                                        className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-900/20"
                                    >
                                        <Trash2 className="w-4 h-4 me-2" />
                                        {t('sidepanel.browserGroup.deleteAll')}
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
                                containerId="ungrouped"
                                isInGroupMemory={groupMemoryUrls?.has(tab.url)}
                                isSelected={selectedTabIds?.has(tab.id)}
                                isFocusHighlighted={focusHighlightTabId === tab.id}
                                isSelectionMode={isSelectionMode}
                                isDndActive={isDndActive}
                                dropIndicator={dropIndicatorTabId === tab.id ? dropIndicatorPos : null}
                                onClose={onTabClose}
                                onActivate={onTabActivate}
                                onSelect={onTabSelect}
                                onSaveToBlueTab={onSaveTabToBlueTab}
                                searchQuery={searchQuery}
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
                title={t('sidepanel.ungroupedSection.deleteAllTitle')}
                message={t('sidepanel.ungroupedSection.deleteAllMessage', { count: tabs.length })}
                confirmText={t('common.delete')}
                cancelText={t('common.cancel')}
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
