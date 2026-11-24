import { findSearchMatch } from '@/utils/search-text';
import { useState, memo } from 'react';
import type { ReactNode } from 'react';
import { X, Brain, Check, Globe, Copy, LayersPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ZzIcon } from '@/components/ZzIcon';
import type { BrowserTab } from '../hooks/useBrowserTabs';
import { useTranslation } from 'react-i18next';

function highlightMatch(text: string, query: string): ReactNode {
    if (!query) return text;
    const match = findSearchMatch(text, query);
    if (!match) return text;
    return (
        <>
            {text.slice(0, match.start)}
            <mark className="bg-warning-muted rounded-xs px-0.5">{text.slice(match.start, match.end)}</mark>
            {text.slice(match.end)}
        </>
    );
}

function isValidFaviconUrl(url?: string): boolean {
    if (!url) return false;
    if (url.startsWith('chrome://')) return false;
    if (url.startsWith('chrome-extension://')) return false;
    return true;
}

interface TabItemProps {
    tab: BrowserTab;
    containerId: string;
    isInGroupMemory?: boolean;
    isSelected?: boolean;
    isFocusHighlighted?: boolean;
    isSelectionMode?: boolean;
    isDndActive?: boolean;
    dropIndicator?: 'above' | 'below' | null;
    onClose: (tabId: number) => void;
    onActivate: (tabId: number) => void;
    onSelect?: (tabId: number) => void;
    onSaveToBlueTab?: (tab: BrowserTab) => void;
    searchQuery?: string;
    onDragStart?: (e: React.DragEvent, tab: BrowserTab, containerId: string) => void;
    onDragEnd?: (e: React.DragEvent) => void;
    onDragOver?: (e: React.DragEvent, tab: BrowserTab, containerId: string) => void;
    onDrop?: (e: React.DragEvent, tab: BrowserTab, containerId: string) => void;
    showInactiveIndicator?: boolean;
}

export const TabItem = memo(function TabItem({
    tab,
    containerId,
    isInGroupMemory,
    isSelected = false,
    isFocusHighlighted = false,
    isSelectionMode = false,
    isDndActive = false,
    dropIndicator = null,
    onClose,
    onActivate,
    onSelect,
    onSaveToBlueTab,
    searchQuery,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
    showInactiveIndicator = true,
}: TabItemProps) {
    const { t } = useTranslation();
    const [isHovered, setIsHovered] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleClick = () => {
        if (isSelectionMode && onSelect) {
            onSelect(tab.id);
        } else {
            onActivate(tab.id);
        }
    };

    const handleClose = (e: React.MouseEvent) => {
        e.stopPropagation();
        onClose(tab.id);
    };

    return (
        <div className="relative" data-tab-id={tab.id}>
            {/* Drop indicator - above */}
            {dropIndicator === 'above' && (
                <div className="absolute top-0 left-2 right-2 h-0.5 bg-primary rounded-full -translate-y-0.5 z-10" />
            )}
            <div
                className={cn(
                    "group/tab flex min-h-10 items-center gap-3 px-2.5 py-2 rounded-sm cursor-pointer transition-all duration-200 min-w-0",
                    tab.active && !isSelectionMode
                        ? "bg-primary-muted hover:bg-primary-muted"
                        : "hover:bg-accent",
                    tab.discarded && "opacity-60",
                    isSelected && "bg-primary-muted hover:bg-primary-muted",
                    isFocusHighlighted && "ring-2 ring-primary/30 shadow-[0_0_0_1px_rgba(59,130,246,0.18)] scale-[1.01]"
                )}
                draggable={!isSelectionMode}
                onDragStart={(e) => onDragStart?.(e, tab, containerId)}
                onDragEnd={(e) => onDragEnd?.(e)}
                onDragOver={(e) => { e.preventDefault(); onDragOver?.(e, tab, containerId); }}
                onDrop={(e) => { e.preventDefault(); onDrop?.(e, tab, containerId); }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onClick={handleClick}
                title={tab.title}
            >
                {/* Selection Checkbox */}
                {isSelectionMode && (
                    <div className={cn(
                        "w-[18px] h-[18px] rounded-xs border flex items-center justify-center flex-shrink-0 transition-all duration-150",
                        isSelected
                            ? "bg-primary border-primary text-primary-foreground scale-105"
                            : "border-field bg-bg-1 hover:border-text-muted"
                    )}>
                        {isSelected && <Check className="w-3 h-3" />}
                    </div>
                )}

                {/* Favicon */}
                <div className="relative flex-shrink-0 w-5 h-5">
                    {isValidFaviconUrl(tab.favIconUrl) ? (
                        <img
                            src={tab.favIconUrl}
                            alt=""
                            className="w-5 h-5 rounded-xs"
                            onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                            }}
                        />
                    ) : null}
                    <Globe className={cn(
                        "w-5 h-5 text-text-muted",
                        isValidFaviconUrl(tab.favIconUrl) && "hidden"
                    )} />
                    {/* Discarded overlay - bottom right. Zz glyph mirrors the
                        favicon overlay and the toolbar action badge so every
                        surface carries the same suspended-state symbol. */}
                    {tab.discarded && showInactiveIndicator && (
                        <div className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-[1px]">
                            <ZzIcon className="w-3 h-3 text-warning" />
                        </div>
                    )}
                    {/* Group Memory overlay - top right (no conflict with discarded).
                        Decorative: a "this tab belonged to a saved group" hint —
                        the tab is still fully usable without it. Hidden under
                        Default Simplify via bt-decor. */}
                    {isInGroupMemory && (
                        <div className="absolute -top-0.5 -right-0.5 bg-background rounded-full p-[1px] bt-decor">
                            <Brain className="w-3 h-3 text-primary" />
                        </div>
                    )}
                </div>

                {/* Title - always truncated */}
                <span className={cn(
                    "text-sm truncate flex-1 min-w-0 leading-tight",
                    tab.active && !isSelectionMode
                        ? "font-medium text-text-strong"
                        : "text-text"
                )}>
                    <bdi dir="auto">
                        {searchQuery ? highlightMatch(tab.title, searchQuery) : tab.title}
                    </bdi>
                </span>

                {/* Hover actions */}
                {isHovered && !isSelectionMode && !isDndActive && (
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                        {onSaveToBlueTab && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSaveToBlueTab(tab);
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-accent text-text-muted hover:text-text-strong transition-colors duration-150"
                                title={t('sidepanel.tabItem.saveToBlueTab')}
                            >
                                <LayersPlus className="w-3.5 h-3.5" />
                            </button>
                        )}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(tab.url);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1500);
                            }}
                            className={cn(
                                "flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200",
                                copied
                                    ? "text-success scale-110"
                                    : "text-text-muted hover:text-text-strong hover:bg-accent"
                            )}
                            title={copied ? t('sidepanel.tabItem.copied') : t('sidepanel.tabItem.copyLink')}
                        >
                            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <button
                            onClick={handleClose}
                            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-danger-muted text-text-muted hover:text-danger transition-colors duration-150"
                            title={t('sidepanel.tabItem.closeTab')}
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </div>
            {/* Drop indicator - below */}
            {dropIndicator === 'below' && (
                <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full translate-y-0.5 z-10" />
            )}
        </div>
    );
});
