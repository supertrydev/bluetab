import { useState, useCallback } from 'react';
import {
    Pencil, X, CheckCheck, ChevronDown,
    Copy, Lock, Archive, Trash2,
    Folder, Share2, Download,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Storage } from '@/utils/storage';
import { TagManager } from '@/utils/tags';
import { ToastManager } from '@/components/Toast';
import { buildBulkShareText, getGroupBluetUrl } from '@/utils/social-share';
import type { TabGroup, Tag, Project } from '@/types/models';
import type { BluetSharedRef } from '@/types/bluet';
import { isolateBidi } from '@/i18n/bidi';

export interface BulkEditToolbarProps {
    groups: TabGroup[];
    setGroups: React.Dispatch<React.SetStateAction<TabGroup[]>>;
    tags: Tag[];
    projects: Project[];
    filteredGroupIds: string[];
    bluet_sharedRefs: BluetSharedRef[];
    onArchiveSelected: (groupIds: string[]) => void;
    onDeleteSelected: (selectedGroups: Set<string>) => void;
    onSaveOfflineSelected?: (groupIds: string[]) => void;
}

/**
 * Custom hook that owns bulk edit mode state (bulkMode, selectedGroups)
 * and returns the toolbar JSX + action helpers for the parent.
 */
export function useBulkEditToolbar({
    groups,
    setGroups,
    tags,
    projects,
    filteredGroupIds,
    bluet_sharedRefs,
    onArchiveSelected,
    onDeleteSelected,
    onSaveOfflineSelected,
}: BulkEditToolbarProps) {
    const { t } = useTranslation();
    const [bulkMode, setBulkMode] = useState(false);
    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

    const toggleGroupSelection = useCallback((groupId: string) => {
        setSelectedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    }, []);

    const selectAllGroups = useCallback(() => {
        setSelectedGroups(new Set(filteredGroupIds));
    }, [filteredGroupIds]);

    const clearSelection = useCallback(() => {
        setSelectedGroups(new Set());
    }, []);

    const toggleBulkMode = useCallback(() => {
        if (bulkMode) clearSelection();
        setBulkMode(prev => !prev);
    }, [bulkMode, clearSelection]);

    const exitBulkMode = useCallback(() => {
        setBulkMode(false);
        clearSelection();
    }, [clearSelection]);

    // Tag operations
    const bulkAddTag = async (tagId: string) => {
        try {
            const updatedGroups = groups.map(group =>
                selectedGroups.has(group.id) ? TagManager.addTagToGroup(group, tagId) : group
            );
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
        } catch (error) {
            ToastManager.getInstance().error(t('options.bulkEdit.addTagsFailed', { message: isolateBidi((error as Error).message) }));
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
            ToastManager.getInstance().error(t('options.bulkEdit.removeTagsFailed', { message: isolateBidi((error as Error).message) }));
        }
    };

    const handleBulkAssignToProject = async (projectId: string | undefined) => {
        if (selectedGroups.size === 0) return;
        const groupIds = Array.from(selectedGroups);
        await Storage.assignGroupsToProject(groupIds, projectId);
        setGroups(prev => prev.map(g =>
            selectedGroups.has(g.id) ? { ...g, projectId, modified: Date.now() } : g
        ));
        const projectName = projectId
            ? (projects.find(p => p.id === projectId)?.name ?? t('options.bulkEdit.noProject'))
            : t('options.bulkEdit.noProject');
        ToastManager.getInstance().success(t('options.bulkEdit.assignedToProject', { count: groupIds.length, project: isolateBidi(projectName) }));
    };

    const handleBulkCopyLinks = () => {
        if (selectedGroups.size === 0) return;
        const selectedGroupsArray = groups.filter(g => selectedGroups.has(g.id));
        const allLinks = selectedGroupsArray.flatMap(g => g.tabs.map(t => t.url)).join('\n');
        navigator.clipboard.writeText(allLinks);
        ToastManager.getInstance().success(t('options.bulkEdit.copiedLinks', {
            count: selectedGroupsArray.reduce((acc, g) => acc + g.tabs.length, 0),
        }));
    };

    const handleBulkShare = async () => {
        if (selectedGroups.size === 0) return;
        const selectedGroupsArray = groups.filter(g => selectedGroups.has(g.id));
        const groupsData = selectedGroupsArray.map(g => ({
            name: g.name,
            tabCount: g.tabs.length,
            notes: g.notes,
            tabs: g.tabs.map(t => ({ title: t.title, url: t.url })),
        }));
        const bluetUrls = selectedGroupsArray
            .map(g => getGroupBluetUrl(g.id, bluet_sharedRefs))
            .filter((url): url is string => Boolean(url));
        const shareText = buildBulkShareText(groupsData, bluetUrls.length > 0 ? bluetUrls : undefined);
        try {
            await navigator.clipboard.writeText(shareText);
            ToastManager.getInstance().success(t('options.bulkEdit.shareCopied', { count: selectedGroupsArray.length }));
        } catch {
            ToastManager.getInstance().error(t('options.bulkEdit.shareCopyFailed'));
        }
    };

    const handleBulkLockToggle = async () => {
        if (selectedGroups.size === 0) return;
        const selectedGroupsArray = groups.filter(g => selectedGroups.has(g.id));
        const allLocked = selectedGroupsArray.every(g => g.locked);
        const updatedGroups = groups.map(g =>
            selectedGroups.has(g.id) ? { ...g, locked: !allLocked } : g
        );
        await Storage.set('groups', updatedGroups);
        setGroups(updatedGroups);
        ToastManager.getInstance().success(
            allLocked
                ? t('options.bulkEdit.unlockedGroups', { count: selectedGroups.size })
                : t('options.bulkEdit.lockedGroups', { count: selectedGroups.size })
        );
    };

    const handleShowDeleteSelectedModal = () => {
        const lockedGroups = groups.filter(g => selectedGroups.has(g.id) && g.locked);
        if (lockedGroups.length > 0) {
            ToastManager.getInstance().warning(
                t('options.bulkEdit.cannotDeleteLocked', { count: lockedGroups.length })
            );
            return;
        }
        onDeleteSelected(selectedGroups);
    };

    const ToolbarElement = bulkMode ? (
        <div className="sticky top-[56px] xl:top-16 z-30 bg-bg-1/95 backdrop-blur-sm border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="bg-bg-1 border border-border rounded-xl shadow-lg p-4">
                {/* Header Row */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                            <Pencil className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-text-strong">{t('options.bulkEdit.title')}</h3>
                            <p className="text-xs text-text-muted">{t('options.bulkEdit.selectedCount', { count: selectedGroups.size })}</p>
                        </div>
                    </div>
                    <button
                        onClick={exitBulkMode}
                        className="p-1.5 rounded-lg text-text-muted hover:text-text-strong hover:bg-bg-2 transition-colors"
                        title={t('options.bulkEdit.exitEditMode')}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Actions Row */}
                <div className="flex flex-wrap items-center gap-2">
                    {/* Selection */}
                    <button
                        onClick={selectAllGroups}
                        className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                    >
                        <CheckCheck className="w-3.5 h-3.5" />
                        {t('options.bulkEdit.selectAll')}
                    </button>
                    <button
                        onClick={clearSelection}
                        className="px-3 py-1.5 bg-bg-2 hover:bg-highlight text-text-strong border border-border rounded-lg text-xs font-medium flex items-center gap-1.5"
                    >
                        <X className="w-3.5 h-3.5" />
                        {t('options.bulkEdit.clear')}
                    </button>

                    <div className="w-px h-6 bg-border mx-1"></div>

                    {/* Tag Operations - Compact Dropdowns */}
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            className="px-3 py-1.5 bg-bg-2 hover:bg-highlight rounded-lg text-xs text-text-strong cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                            disabled={selectedGroups.size === 0}
                        >
                            {t('options.bulkEdit.addTag')}
                            <ChevronDown className="w-2.5 h-2.5 text-success" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            {tags.map(tag => (
                                <DropdownMenuItem key={tag.id} onClick={() => bulkAddTag(tag.id)}>
                                    <bdi dir="auto">{tag.name}</bdi>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            className="px-3 py-1.5 bg-bg-2 hover:bg-highlight rounded-lg text-xs text-text-strong cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                            disabled={selectedGroups.size === 0}
                        >
                            {t('options.bulkEdit.removeTag')}
                            <ChevronDown className="w-2.5 h-2.5 text-danger" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            {tags.map(tag => (
                                <DropdownMenuItem key={tag.id} onClick={() => bulkRemoveTag(tag.id)}>
                                    <bdi dir="auto">{tag.name}</bdi>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Assign to Project */}
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            className="px-3 py-1.5 bg-bg-2 hover:bg-highlight rounded-lg text-xs text-text-strong cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                            disabled={selectedGroups.size === 0}
                        >
                            {t('options.bulkEdit.assignToProject')}
                            <Folder className="w-2.5 h-2.5 text-primary" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => handleBulkAssignToProject(undefined)}>
                                {t('options.bulkEdit.noProject')}
                            </DropdownMenuItem>
                            {projects.map(project => (
                                <DropdownMenuItem key={project.id} onClick={() => handleBulkAssignToProject(project.id)}>
                                    <bdi dir="auto">{project.name}</bdi>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="w-px h-6 bg-border mx-1"></div>

                    {/* Bulk Actions */}
                    <button
                        onClick={handleBulkCopyLinks}
                        disabled={selectedGroups.size === 0}
                        className="px-3 py-1.5 bg-bg-2 hover:bg-highlight text-text-strong border border-border rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={t('options.bulkEdit.copyLinksTitle')}
                    >
                        <Copy className="w-3.5 h-3.5" />
                        {t('options.bulkEdit.copyLinks')}
                    </button>
                    <button
                        onClick={handleBulkShare}
                        disabled={selectedGroups.size === 0}
                        className="px-3 py-1.5 bg-bg-2 hover:bg-highlight text-text-strong border border-border rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={t('options.bulkEdit.shareTitle')}
                    >
                        <Share2 className="w-3.5 h-3.5" />
                        {t('options.bulkEdit.share')}
                    </button>
                    <button
                        onClick={handleBulkLockToggle}
                        disabled={selectedGroups.size === 0}
                        className="px-3 py-1.5 bg-bg-2 hover:bg-highlight text-text-strong border border-border rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={t('options.bulkEdit.lockUnlockTitle')}
                    >
                        <Lock className="w-3.5 h-3.5" />
                        {t('options.bulkEdit.lockUnlock')}
                    </button>
                    <button
                        onClick={() => {
                            if (selectedGroups.size === 0) return;
                            onArchiveSelected(Array.from(selectedGroups));
                        }}
                        disabled={selectedGroups.size === 0}
                        className="px-3 py-1.5 bg-bg-2 hover:bg-highlight text-text-strong border border-border rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={t('options.bulkEdit.archiveTitle')}
                    >
                        <Archive className="w-3.5 h-3.5" />
                        {t('options.bulkEdit.archive')}
                    </button>
                    {onSaveOfflineSelected && (
                        <button
                            onClick={() => {
                                if (selectedGroups.size === 0) return;
                                onSaveOfflineSelected(Array.from(selectedGroups));
                            }}
                            disabled={selectedGroups.size === 0}
                            className="px-3 py-1.5 bg-bg-2 hover:bg-highlight text-text-strong border border-border rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={t('options.bulkEdit.saveOfflineTitle')}
                        >
                            <Download className="w-3.5 h-3.5" />
                            {t('options.bulkEdit.saveOffline')}
                        </button>
                    )}

                    <div className="flex-1"></div>

                    {/* Delete */}
                    {selectedGroups.size > 0 && (
                        <button
                            onClick={handleShowDeleteSelectedModal}
                            className="px-3 py-1.5 bg-danger hover:brightness-110 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            {t('common.delete')}
                        </button>
                    )}
                </div>
            </div>
        </div>
        </div>
    ) : null;

    return {
        bulkMode,
        selectedGroups,
        toggleBulkMode,
        toggleGroupSelection,
        clearSelection,
        exitBulkMode,
        ToolbarElement,
    };
}
