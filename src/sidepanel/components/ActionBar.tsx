import { useState, useRef } from 'react';
import { Plus, Zap, Check, Crown, SquareMousePointer, LayersPlus, FileSliders } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '../../components/ui/dropdown-menu';
import type { BrowserTab } from '../hooks/useBrowserTabs';
import type { BrowserGroup } from '../hooks/useBrowserGroups';
import { getGroupColor } from '../hooks/useBrowserGroups';
import { FlowStorageService } from '../../utils/flow-storage';
import { getAuthState } from '../../utils/auth-state';
import { cn } from '@/lib/utils';

interface ActionBarProps {
    selectedTabs: BrowserTab[];
    isSelectionMode: boolean;
    groups: BrowserGroup[];
    onToggleSelectionMode: () => void;
    onClearSelection: () => void;
    onNewGroup: () => void;
    onOrganize: () => void;
    onSaveToBlueTab: (tabs: BrowserTab[]) => void;
    onMoveToGroup: (tabIds: number[], groupId: number) => void;
}

export function ActionBar({
    selectedTabs,
    isSelectionMode,
    groups,
    onToggleSelectionMode,
    onClearSelection,
    onNewGroup,
    onOrganize,
    onSaveToBlueTab,
    onMoveToGroup
}: ActionBarProps) {
    const [showProModal, setShowProModal] = useState(false);
    const [noRulesMessage, setNoRulesMessage] = useState(false);
    const noRulesTimeout = useRef<ReturnType<typeof setTimeout>>();

    const handleOrganizeClick = async () => {
        const authState = await getAuthState();
        const settings = await FlowStorageService.getFlowSettings();
        const hasRules = settings.enabled && settings.rules.some(r => r.enabled);

        if (!authState.isPro) {
            setShowProModal(true);
            return;
        }

        if (!hasRules) {
            setNoRulesMessage(true);
            if (noRulesTimeout.current) clearTimeout(noRulesTimeout.current);
            noRulesTimeout.current = setTimeout(() => setNoRulesMessage(false), 3000);
            return;
        }

        onOrganize();
    };

    const hasSelection = selectedTabs.length > 0;

    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex gap-1.5 px-1 py-2 border-b border-border">
                {isSelectionMode ? (
                    <>
                        {/* Selection info */}
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {selectedTabs.length} selected
                            </span>
                            {hasSelection && (
                                <Button
                                    onClick={onClearSelection}
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs"
                                >
                                    Clear
                                </Button>
                            )}
                        </div>

                        {/* New Group */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={onNewGroup}
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    disabled={!hasSelection}
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {hasSelection
                                    ? `Create group with ${selectedTabs.length} tabs`
                                    : 'Select tabs first'}
                            </TooltipContent>
                        </Tooltip>

                        {/* Save to BlueTab */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={() => onSaveToBlueTab(selectedTabs)}
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    disabled={!hasSelection}
                                >
                                    <LayersPlus className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {hasSelection
                                    ? `Save ${selectedTabs.length} tabs to BlueTab`
                                    : 'Select tabs first'}
                            </TooltipContent>
                        </Tooltip>

                        {/* Move to existing group */}
                        <DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            className="h-7 w-7 p-0"
                                            disabled={!hasSelection || groups.length === 0}
                                        >
                                            <FileSliders className="w-3.5 h-3.5" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {groups.length === 0
                                        ? 'No groups to move to'
                                        : hasSelection
                                            ? 'Move to existing group'
                                            : 'Select tabs first'}
                                </TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent align="end" className="w-48 max-h-60 overflow-y-auto">
                                {groups.map(group => (
                                    <DropdownMenuItem
                                        key={group.id}
                                        onClick={() => {
                                            const tabIds = selectedTabs.map(t => t.id);
                                            onMoveToGroup(tabIds, group.id);
                                        }}
                                        className="flex items-center gap-2 focus:bg-gray-100 dark:focus:bg-gray-700"
                                    >
                                        <span
                                            className="w-3 h-3 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: getGroupColor(group.color) }}
                                        />
                                        <span className="truncate">{group.title || 'Unnamed Group'}</span>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Done */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={onToggleSelectionMode}
                                    size="sm"
                                    variant="secondary"
                                    className="h-7 w-7 p-0"
                                >
                                    <Check className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Done</TooltipContent>
                        </Tooltip>
                    </>
                ) : (
                    <>
                        {/* Normal Mode */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={onToggleSelectionMode}
                                    size="sm"
                                    className="flex-1 h-7 text-xs gap-1"
                                >
                                    <SquareMousePointer className="w-3 h-3" />
                                    Select
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Select tabs to create a group
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={handleOrganizeClick}
                                    size="sm"
                                    variant="secondary"
                                    className={cn(
                                        "flex-1 h-7 text-xs gap-1 transition-all duration-300",
                                        noRulesMessage && "text-warning border-warning/30"
                                    )}
                                >
                                    <Zap className="w-3 h-3" />
                                    <span className={cn(
                                        "transition-all duration-300",
                                        noRulesMessage && "animate-pulse"
                                    )}>
                                        {noRulesMessage ? 'No Flow rules!' : 'Organize'}
                                    </span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Auto-organize tabs using Flow rules
                            </TooltipContent>
                        </Tooltip>
                    </>
                )}
            </div>

            {/* Pro Upgrade Modal */}
            {showProModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowProModal(false)}>
                    <div
                        className="bg-bg-1 border border-border rounded-xl shadow-xl max-w-sm mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-6 text-center">
                            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                                <Crown className="w-6 h-6 text-primary" />
                            </div>
                            <h3 className="text-lg font-semibold text-text-strong mb-2">
                                Coming Soon in Cloud
                            </h3>
                            <p className="text-sm text-text-muted mb-1">
                                Flow Organize uses your custom rules to automatically group tabs by domain, title, or URL patterns.
                            </p>
                            <p className="text-sm text-text-muted">
                                This feature will be available in the upcoming BlueTab Cloud version.
                            </p>
                        </div>
                        <div className="flex border-t border-border">
                            <button
                                onClick={() => setShowProModal(false)}
                                className="flex-1 py-3 text-sm text-text-muted hover:bg-bg-2 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    setShowProModal(false);
                                    chrome.tabs.create({ url: 'https://github.com/supertrydev/bluetab' });
                                }}
                                className="flex-1 py-3 text-sm font-medium text-primary hover:bg-primary/5 transition-colors border-l border-border"
                            >
                                Learn More
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </TooltipProvider>
    );
}
