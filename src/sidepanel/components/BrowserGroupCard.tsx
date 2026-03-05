import { useState, useRef, useEffect } from 'react';
import {
    ChevronDown, ChevronRight, MoreHorizontal,
    Trash2, Ungroup, Plus, Archive, Copy, LayersPlus
} from 'lucide-react';
import type { BrowserTab } from '../hooks/useBrowserTabs';
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
import { getGroupColor, type BrowserGroup, type TabGroupColor } from '../hooks/useBrowserGroups';
import { cn } from '@/lib/utils';

const GROUP_COLORS: TabGroupColor[] = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];

interface BrowserGroupCardProps {
    group: BrowserGroup;
    tabs: BrowserTab[];
    groupMemoryUrls?: Set<string>;
    selectedTabIds?: Set<number>;
    isSelectionMode?: boolean;
    onTabClose: (tabId: number) => void;
    onTabActivate: (tabId: number) => void;
    onTabSelect?: (tabId: number) => void;
    onCollapseGroup: (groupId: number, collapsed: boolean) => void;
    onRenameGroup: (groupId: number, title: string) => void;
    onChangeGroupColor: (groupId: number, color: TabGroupColor) => void;
    onSaveToBlueTab?: (group: BrowserGroup, tabs: BrowserTab[]) => void;
    onSaveToArchive?: (tabs: BrowserTab[]) => void;
    onCopyLinks?: (tabs: BrowserTab[]) => void;
    onNewTab?: () => void;
    onDeleteGroup?: (groupId: number) => void;
    onDeleteAllTabs?: (groupId: number, tabIds: number[]) => void;
    onSaveTabToBlueTab?: (tab: import('../hooks/useBrowserTabs').BrowserTab) => void;
    showGroupBorder?: boolean;
    showInactiveIndicator?: boolean;
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

export function BrowserGroupCard({
    group,
    tabs,
    groupMemoryUrls,
    selectedTabIds,
    isSelectionMode = false,
    onTabClose,
    onTabActivate,
    onTabSelect,
    onCollapseGroup,
    onRenameGroup,
    onChangeGroupColor,
    onSaveToBlueTab,
    onSaveToArchive,
    onCopyLinks,
    onNewTab,
    onDeleteGroup,
    onDeleteAllTabs,
    onSaveTabToBlueTab,
    showGroupBorder = true,
    showInactiveIndicator = true,
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
}: BrowserGroupCardProps) {

    const [isOpen, setIsOpen] = useState(!group.collapsed);
    const [isEditing, setIsEditing] = useState(false);
    const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
    const [editTitle, setEditTitle] = useState(group.title);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const colorPickerRef = useRef<HTMLDivElement>(null);
    const colorDotRef = useRef<HTMLButtonElement>(null);
    const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    // Sync collapse state from browser
    useEffect(() => {
        setIsOpen(!group.collapsed);
    }, [group.collapsed]);

    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        onCollapseGroup(group.id, !open);
    };

    const handleTitleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditTitle(group.title);
        setIsEditing(true);
    };

    const handleSaveRename = () => {
        const newTitle = editTitle.trim();
        if (newTitle && newTitle !== group.title) {
            onRenameGroup(group.id, newTitle);
        }
        setIsEditing(false);
    };

    const handleColorDotClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!showColorPicker && colorDotRef.current) {
            const rect = colorDotRef.current.getBoundingClientRect();
            setPickerPos({ top: rect.bottom + 6, left: rect.left });
        }
        setShowColorPicker(prev => !prev);
    };

    const handleColorSelect = (color: TabGroupColor) => {
        onChangeGroupColor(group.id, color);
        setShowColorPicker(false);
    };

    // Focus input when editing starts
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    // Close color picker on outside click
    useEffect(() => {
        if (!showColorPicker) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
                setShowColorPicker(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showColorPicker]);

    const groupColor = getGroupColor(group.color);

    return (
        <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
            <div
                className={cn(
                    "rounded-xl bg-bg-1 overflow-hidden transition-shadow duration-200 hover:shadow-md",
                    !showGroupBorder && "border border-border",
                    isDropTarget && "ring-2 ring-primary/40"
                )}
                style={showGroupBorder ? { border: `2px solid ${groupColor}` } : undefined}
                onDragOver={(e) => { e.preventDefault(); onContainerDragOver?.(e, `group-${group.id}`); }}
                onDrop={(e) => { e.preventDefault(); onContainerDrop?.(e, `group-${group.id}`); }}
            >
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

                    {/* Color dot - clickable for color picker */}
                    <div className="flex-shrink-0">
                        <button
                            ref={colorDotRef}
                            onClick={handleColorDotClick}
                            className="w-3.5 h-3.5 rounded-full ring-1 ring-white/10 hover:ring-2 hover:ring-white/30 transition-all duration-150 hover:scale-110"
                            style={{ backgroundColor: groupColor }}
                            title="Change color"
                        />
                        {/* Color Picker Popover - fixed position to escape overflow */}
                        {showColorPicker && (
                            <div
                                ref={colorPickerRef}
                                className="fixed z-50 bg-bg-2 border border-border rounded-lg shadow-lg p-2.5"
                                style={{ top: pickerPos.top, left: pickerPos.left }}
                            >
                                <div className="grid grid-cols-3 gap-2.5 p-1">
                                    {GROUP_COLORS.map((c) => (
                                        <button
                                            key={c}
                                            onClick={() => handleColorSelect(c)}
                                            className={cn(
                                                "w-6 h-6 rounded-full border-2 transition-all duration-150 hover:scale-110",
                                                group.color === c
                                                    ? "border-text-strong scale-105"
                                                    : "border-transparent"
                                            )}
                                            style={{ backgroundColor: getGroupColor(c) }}
                                            title={c}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Title + count - takes remaining space, truncates */}
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                        {isEditing ? (
                            <input
                                ref={inputRef}
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveRename();
                                    if (e.key === 'Escape') {
                                        setEditTitle(group.title);
                                        setIsEditing(false);
                                    }
                                }}
                                onBlur={handleSaveRename}
                                className="flex-1 min-w-0 text-sm font-medium bg-transparent border-b border-primary outline-none text-text-strong py-0"
                            />
                        ) : (
                            <>
                                <span
                                    onClick={handleTitleClick}
                                    className="text-sm font-medium truncate cursor-text text-text-strong min-w-0 hover:underline hover:decoration-dotted hover:underline-offset-4"
                                    title={group.title || 'Unnamed Group'}
                                >
                                    {group.title || 'Unnamed Group'}
                                </span>
                                <span className="text-xs text-text-muted tabular-nums flex-shrink-0">
                                    {tabs.length}
                                </span>
                            </>
                        )}
                    </div>

                    {/* New tab button */}
                    {!isEditing && onNewTab && (
                        <button
                            onClick={onNewTab}
                            className="p-1 hover:bg-bg-2 rounded-md transition-colors duration-150 flex-shrink-0 text-text-muted hover:text-text-strong"
                            title="New tab in group"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    )}

                    {/* Save to BlueTab button */}
                    {!isEditing && onSaveToBlueTab && (
                        <button
                            onClick={() => onSaveToBlueTab(group, tabs)}
                            className="p-1 hover:bg-bg-2 rounded-md transition-colors duration-150 flex-shrink-0 text-text-muted hover:text-text-strong"
                            title="Save to BlueTab"
                        >
                            <LayersPlus className="w-4 h-4" />
                        </button>
                    )}

                    {/* Actions menu - always visible */}
                    {!isEditing && (
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

                                {onDeleteGroup && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => onDeleteGroup(group.id)}
                                            className="focus:bg-gray-100 dark:focus:bg-gray-700"
                                        >
                                            <Ungroup className="w-4 h-4 mr-2" />
                                            Ungroup All
                                        </DropdownMenuItem>
                                    </>
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
                    )}
                </div>

                {/* Tabs */}
                <CollapsibleContent>
                    <div className="px-1.5 pb-2 space-y-0.5">
                        {tabs.map(tab => (
                            <TabItem
                                key={tab.id}
                                tab={tab}
                                containerId={`group-${group.id}`}
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
                title="Delete All Tabs"
                message={`Are you sure you want to close all ${tabs.length} tab(s) in "${group.title || 'Unnamed Group'}"? This will close the tabs and remove the group.`}
                confirmText="Delete"
                cancelText="Cancel"
                onConfirm={() => {
                    onDeleteAllTabs?.(group.id, tabs.map(t => t.id));
                    setShowDeleteAllModal(false);
                }}
                onCancel={() => setShowDeleteAllModal(false)}
                type="danger"
            />
        </Collapsible>
    );
}
