import { useState, useRef, useEffect } from 'react';
import {
    ChevronDown, ChevronRight, MoreHorizontal,
    Trash2, Ungroup, Plus, Archive, Copy, LayersPlus, BedDouble
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
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';

const GROUP_COLORS: TabGroupColor[] = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];
const COLOR_PICKER_WIDTH_PX = 122;
const COLOR_PICKER_VIEWPORT_GUTTER_PX = 8;
const COLOR_PICKER_OFFSET_PX = 6;

export interface ColorPickerPositionInput {
    anchorLeft: number;
    anchorRight: number;
    anchorBottom: number;
    direction: 'ltr' | 'rtl';
    viewportWidth: number;
}

export function computeColorPickerPosition({
    anchorLeft,
    anchorRight,
    anchorBottom,
    direction,
    viewportWidth,
}: ColorPickerPositionInput): { left: number; top: number } {
    const desiredLeft = direction === 'rtl'
        ? anchorRight - COLOR_PICKER_WIDTH_PX
        : anchorLeft;
    const maximumLeft = Math.max(
        COLOR_PICKER_VIEWPORT_GUTTER_PX,
        viewportWidth - COLOR_PICKER_WIDTH_PX - COLOR_PICKER_VIEWPORT_GUTTER_PX,
    );

    return {
        left: Math.min(Math.max(desiredLeft, COLOR_PICKER_VIEWPORT_GUTTER_PX), maximumLeft),
        top: anchorBottom + COLOR_PICKER_OFFSET_PX,
    };
}

interface BrowserGroupCardProps {
    group: BrowserGroup;
    tabs: BrowserTab[];
    groupMemoryUrls?: Set<string>;
    selectedTabIds?: Set<number>;
    focusHighlightTabId?: number | null;
    forceOpen?: boolean;
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
    /**
     * Phase 9 Safe Auto-Suspend — "Save & close suspended tabs" menu entry.
     * Handler filters the group's tabs to the discarded subset, saves them
     * as a new BlueTab group, and closes the saved Chrome tabs in one motion;
     * empty subset shows an explanatory toast rather than no-op'ing (so the
     * menu item is always discoverable).
     */
    onSaveSuspendedAsGroup?: (group: BrowserGroup, tabs: BrowserTab[]) => void;
    showGroupBorder?: boolean;
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

export function BrowserGroupCard({
    group,
    tabs,
    groupMemoryUrls,
    selectedTabIds,
    focusHighlightTabId = null,
    forceOpen = false,
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
    onSaveSuspendedAsGroup,
    showGroupBorder = true,
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
}: BrowserGroupCardProps) {
    const { t } = useTranslation();

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
            const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
            setPickerPos(computeColorPickerPosition({
                anchorLeft: rect.left,
                anchorRight: rect.right,
                anchorBottom: rect.bottom,
                direction: document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr',
                viewportWidth,
            }));
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
    const effectiveOpen = forceOpen || isOpen;

    return (
        <Collapsible open={effectiveOpen} onOpenChange={handleOpenChange}>
            <div
                className={cn(
                    "rounded-lg bg-bg-1 overflow-hidden transition-shadow duration-200 hover:shadow-md",
                    !showGroupBorder && "border border-border",
                    isDropTarget && "ring-2 ring-primary/40"
                )}
                style={showGroupBorder ? { border: `2px solid ${groupColor}` } : undefined}
                onDragOver={(e) => { e.preventDefault(); onContainerDragOver?.(e, `group-${group.id}`); }}
                onDrop={(e) => { e.preventDefault(); onContainerDrop?.(e, `group-${group.id}`); }}
            >
                {/* Header */}
                <div className="flex min-h-12 items-center gap-1.5 px-2 py-1 min-w-0">
                    <CollapsibleTrigger asChild>
                        <button className="flex h-7 w-7 items-center justify-center hover:bg-accent rounded-full transition-colors duration-150 flex-shrink-0">
                            {effectiveOpen ? (
                                <ChevronDown className="w-4 h-4 text-text-muted" />
                            ) : (
                                <ChevronRight className="w-4 h-4 text-text-muted rtl:rotate-180" />
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
                            title={t('sidepanel.browserGroup.changeColor')}
                        />
                        {/* Color Picker Popover - fixed position to escape overflow */}
                        {showColorPicker && (
                            <div
                                ref={colorPickerRef}
                                className="fixed z-50 w-[122px] box-border bg-bg-2 border border-border rounded-lg shadow-lg p-2.5"
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
                                dir="auto"
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
                                    title={group.title || t('sidepanel.actionBar.unnamedGroup')}
                                >
                                    <bdi dir="auto">{group.title || t('sidepanel.actionBar.unnamedGroup')}</bdi>
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
                            className="flex h-7 w-7 items-center justify-center hover:bg-accent rounded-full transition-colors duration-150 flex-shrink-0 text-text-muted hover:text-text-strong"
                            title={t('sidepanel.browserGroup.newTabInGroup')}
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    )}

                    {/* Save to BlueTab button */}
                    {!isEditing && onSaveToBlueTab && (
                        <button
                            onClick={() => onSaveToBlueTab(group, tabs)}
                            className="flex h-7 w-7 items-center justify-center hover:bg-accent rounded-full transition-colors duration-150 flex-shrink-0 text-text-muted hover:text-text-strong"
                            title={t('sidepanel.browserGroup.saveToBlueTab')}
                        >
                            <LayersPlus className="w-4 h-4" />
                        </button>
                    )}

                    {/* Actions menu - always visible */}
                    {!isEditing && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="flex h-7 w-7 items-center justify-center hover:bg-accent rounded-full transition-all duration-150 flex-shrink-0 text-text-muted hover:text-text-strong">
                                    <MoreHorizontal className="w-4 h-4" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                {onSaveToArchive && (
                                    <DropdownMenuItem
                                        onClick={() => onSaveToArchive(tabs)}
                                        className="focus:bg-accent"
                                    >
                                        <Archive className="w-4 h-4" />
                                        {t('sidepanel.browserGroup.saveToArchive')}
                                    </DropdownMenuItem>
                                )}
                                {onCopyLinks && (
                                    <DropdownMenuItem
                                        onClick={() => onCopyLinks(tabs)}
                                        className="focus:bg-accent"
                                    >
                                        <Copy className="w-4 h-4" />
                                        {t('sidepanel.browserGroup.copyLinks')}
                                    </DropdownMenuItem>
                                )}

                                {/* Phase 9 Safe Auto-Suspend — save the
                                    discarded subset of this group as a new
                                    BlueTab group AND close the saved Chrome
                                    tabs in one motion. Handler toasts the
                                    outcome (success count, "no suspended
                                    tabs", or save-succeeded-but-close-failed). */}
                                {onSaveSuspendedAsGroup && (
                                    <DropdownMenuItem
                                        onClick={() => onSaveSuspendedAsGroup(group, tabs)}
                                        className="focus:bg-accent"
                                    >
                                        <BedDouble className="w-4 h-4" />
                                        {t('sidepanel.browserGroup.saveAndCloseSuspendedTabs')}
                                    </DropdownMenuItem>
                                )}

                                {onDeleteGroup && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => onDeleteGroup(group.id)}
                                            className="focus:bg-accent"
                                        >
                                            <Ungroup className="w-4 h-4" />
                                            {t('sidepanel.browserGroup.ungroupAll')}
                                        </DropdownMenuItem>
                                    </>
                                )}

                                {onDeleteAllTabs && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => setShowDeleteAllModal(true)}
                                            className="text-danger focus:text-danger focus:bg-danger-muted"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            {t('sidepanel.browserGroup.deleteAll')}
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>

                {/* Tabs */}
                <CollapsibleContent>
                    <div className="px-2 pb-2 space-y-0.5">
                        {tabs.map(tab => (
                            <TabItem
                                key={tab.id}
                                tab={tab}
                                containerId={`group-${group.id}`}
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
                title={t('sidepanel.browserGroup.deleteAllTabsTitle')}
                message={t('sidepanel.browserGroup.deleteAllTabsMessage', {
                    count: tabs.length,
                    name: isolateBidi(group.title || t('sidepanel.actionBar.unnamedGroup')),
                })}
                confirmText={t('common.delete')}
                cancelText={t('common.cancel')}
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
