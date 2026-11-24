import { useState, useCallback } from 'react';
import { FolderPlus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Storage } from '@/utils/storage';
import { GroupMemoryStorageService } from '@/utils/group-memory-storage';
import { ToastManager } from '@/components/Toast';
import { isolateBidi } from '@/i18n/bidi';
import { useTabSelectionContext } from '@/contexts/TabSelectionContext';
import type { TabGroup, TabItem } from '@/types/models';
import type { BluetSharedRef } from '@/types/bluet';

const FALLBACK_FAVICON =
    'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22gray%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22/%3E%3C/svg%3E';

function safeFaviconSrc(value: string | undefined): string {
    if (!value) return FALLBACK_FAVICON;
    try {
        const parsed = new URL(value);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'chrome-extension:') {
            return value;
        }
        if (parsed.protocol === 'data:' && /^data:image\/(?:png|gif|jpeg|jpg|webp);/i.test(value)) {
            return value;
        }
    } catch {
        // fall through
    }
    return FALLBACK_FAVICON;
}

export interface UseDragDropOptions {
    groups: TabGroup[];
    setGroups: React.Dispatch<React.SetStateAction<TabGroup[]>>;
    bluet_sharedRefs?: BluetSharedRef[];
}

/**
 * Custom hook that owns all drag-and-drop state for tab reordering.
 * Returns drag event handlers, state accessors, and the floating overlay JSX.
 */
export function useDragDrop({ groups, setGroups, bluet_sharedRefs = [] }: UseDragDropOptions) {
    const { t } = useTranslation();
    const [draggedTab, setDraggedTab] = useState<{ tab: TabItem; sourceGroupId: string } | null>(null);
    const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
    const [isDraggingTabs, setIsDraggingTabs] = useState(false);
    const [dragOverTarget, setDragOverTarget] = useState<'trash' | 'new-group' | null>(null);

    const {
        state: { isDragging, selectedTabs, draggedItems },
        clearSelection: clearTabSelection,
        exitSelectionMode,
        startDrag,
        endDrag,
    } = useTabSelectionContext();

    /**
     * Check if removing tabs from groups would empty any group that has a Bluet share.
     * If so, show a confirmation dialog. Returns true if operation should proceed.
     */
    const confirmBluetDeletion = useCallback((groupsAfterOp: TabGroup[]): boolean => {
        if (bluet_sharedRefs.length === 0) return true;
        const currentIds = new Set(groups.map(g => g.id));
        const afterIds = new Set(groupsAfterOp.map(g => g.id));
        const removedIds = [...currentIds].filter(id => !afterIds.has(id));
        const affectedBluet = removedIds.filter(id => bluet_sharedRefs.some(r => r.id === id));
        if (affectedBluet.length === 0) return true;
        const names = affectedBluet.map(id => groups.find(g => g.id === id)?.name).filter(Boolean);
        const msg = affectedBluet.length === 1
            ? t('options.dragDrop.bluetShareDeleteSingle', { name: isolateBidi(names[0] ?? '') })
            : t('options.dragDrop.bluetShareDeleteMultiple', { count: affectedBluet.length, names: names.join(', ') });
        return window.confirm(msg);
    }, [bluet_sharedRefs, groups, t]);

    const handleTabDragStart = useCallback((e: React.DragEvent, tab: TabItem, sourceGroupId: string) => {
        e.stopPropagation();

        const isMultiDrag = selectedTabs.has(tab.id) && selectedTabs.size > 1;

        if (isMultiDrag) {
            startDrag();
            setDraggedTab(null);

            const dragPreview = document.createElement('div');
            dragPreview.className = 'fixed pointer-events-none z-[9999] flex flex-col gap-1 p-2 bg-bg-1 border border-border rounded-xl shadow-xl';
            dragPreview.style.cssText = 'position: absolute; top: -9999px; left: -9999px; max-width: 280px; opacity: 0.95;';

            const selectedTabsList = groups.flatMap(g => g.tabs).filter(t => selectedTabs.has(t.id));
            const maxPreviewTabs = 3;

            selectedTabsList.slice(0, maxPreviewTabs).forEach(t => {
                const tabEl = document.createElement('div');
                tabEl.className = 'flex items-center gap-2 px-2 py-1 bg-primary-muted rounded text-sm';
                const img = document.createElement('img');
                img.src = safeFaviconSrc(t.favicon);
                img.className = 'w-4 h-4';
                img.alt = '';
                img.addEventListener('error', () => {
                    img.src = FALLBACK_FAVICON;
                }, { once: true });

                const title = document.createElement('span');
                title.className = 'truncate text-text-strong';
                title.dir = 'auto';
                title.textContent = `${t.title.substring(0, 30)}${t.title.length > 30 ? '...' : ''}`;

                tabEl.append(img, title);
                dragPreview.appendChild(tabEl);
            });

            if (selectedTabs.size > maxPreviewTabs) {
                const moreEl = document.createElement('div');
                moreEl.className = 'text-xs text-text-muted text-center py-1';
                moreEl.dir = 'auto';
                moreEl.textContent = t('components.masonry.moreTabs', { count: selectedTabs.size - maxPreviewTabs });
                dragPreview.appendChild(moreEl);
            }

            const badge = document.createElement('div');
            badge.className = 'absolute -top-2 -right-2 w-6 h-6 bg-primary text-white text-xs font-semibold rounded-full flex items-center justify-center';
            badge.dir = 'ltr';
            badge.textContent = String(selectedTabs.size);
            dragPreview.appendChild(badge);

            document.body.appendChild(dragPreview);
            e.dataTransfer.setDragImage(dragPreview, 20, 20);

            requestAnimationFrame(() => {
                setTimeout(() => dragPreview.remove(), 0);
            });
        } else {
            setDraggedTab({ tab, sourceGroupId });
        }

        setIsDraggingTabs(true);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    }, [groups, selectedTabs, startDrag, t]);

    const handleTabDragEnd = useCallback((e: React.DragEvent) => {
        e.stopPropagation();
        setDraggedTab(null);
        endDrag();
        setDragOverGroupId(null);
        setIsDraggingTabs(false);
        setDragOverTarget(null);
    }, [endDrag]);

    const handleGroupDragEnter = useCallback((e: React.DragEvent, targetGroupId: string) => {
        e.preventDefault();
        e.stopPropagation();
        if ((draggedTab && draggedTab.sourceGroupId !== targetGroupId) || isDragging) {
            setDragOverGroupId(targetGroupId);
            setDragOverTarget(null);
        }
    }, [draggedTab, isDragging]);

    const handleGroupDragOver = useCallback((e: React.DragEvent, targetGroupId: string) => {
        e.preventDefault();
        e.stopPropagation();

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
    }, [draggedTab, isDragging, groups]);

    const handleGroupDragLeave = useCallback((e: React.DragEvent) => {
        e.stopPropagation();
        const currentTarget = e.currentTarget as HTMLElement;
        const related = e.relatedTarget as Node | null;
        if (related && currentTarget.contains(related)) {
            return;
        }
        setDragOverGroupId(null);
    }, []);

    const resetDragState = useCallback(() => {
        setDraggedTab(null);
        endDrag();
        setDragOverGroupId(null);
        setIsDraggingTabs(false);
        setDragOverTarget(null);
        exitSelectionMode();
    }, [endDrag, exitSelectionMode]);

    const handleGroupDrop = useCallback(async (e: React.DragEvent, targetGroupId: string) => {
        e.preventDefault();
        e.stopPropagation();

        const targetGroup = groups.find(g => g.id === targetGroupId);
        if (targetGroup?.locked) {
            ToastManager.getInstance().warning(t('options.dragDrop.cannotMoveToLockedGroup'));
            setDragOverGroupId(null);
            return;
        }

        // Handle multiple tabs drop
        if (draggedItems && draggedItems.size > 0) {
            try {
                const tabsToMove: TabItem[] = [];
                const sourceGroupIds = new Set<string>();
                const tabIdsToRemoveFromSources = new Set<string>();

                draggedItems.forEach(({ tab, groupId }) => {
                    const sourceGroup = groups.find(g => g.id === groupId);
                    if (sourceGroup?.locked) return;
                    if (groupId === targetGroupId) return;
                    tabsToMove.push({ ...tab, groupId: targetGroupId });
                    sourceGroupIds.add(groupId);
                    tabIdsToRemoveFromSources.add(tab.id);
                });

                if (tabsToMove.length === 0) {
                    ToastManager.getInstance().info(t('options.dragDrop.alreadyInGroup'));
                    clearTabSelection();
                    return;
                }

                const existingUrls = new Set(targetGroup?.tabs.map(t => t.url) || []);
                const uniqueTabsToMove = tabsToMove.filter(t => !existingUrls.has(t.url));

                const updatedGroups = groups.map(group => {
                    if (group.id === targetGroupId) {
                        return { ...group, tabs: [...group.tabs, ...uniqueTabsToMove], modified: Date.now() };
                    } else if (sourceGroupIds.has(group.id)) {
                        return { ...group, tabs: group.tabs.filter(t => !tabIdsToRemoveFromSources.has(t.id)), modified: Date.now() };
                    }
                    return group;
                }).filter(group => group.tabs.length > 0);

                if (!confirmBluetDeletion(updatedGroups)) { resetDragState(); return; }

                await GroupMemoryStorageService.reconcilePermanentGroupChanges(
                    updatedGroups,
                    new Set([...sourceGroupIds, targetGroupId]),
                );
                await Storage.set('groups', updatedGroups);
                setGroups(updatedGroups);
                const skipped = tabsToMove.length - uniqueTabsToMove.length;
                const message = skipped > 0
                    ? t('options.dragDrop.movedTabsWithDuplicates', {
                        moved: uniqueTabsToMove.length,
                        skipped,
                    })
                    : t('options.dragDrop.movedTabsToGroup', {
                        count: uniqueTabsToMove.length,
                        name: targetGroup?.name ?? '',
                    });
                ToastManager.getInstance().success(message);
                clearTabSelection();
            } catch (error) {
                ToastManager.getInstance().error(t('options.dragDrop.failedToMoveTabs', { message: isolateBidi((error as Error).message) }));
            }
        }
        // Handle single tab drop
        else if (draggedTab && draggedTab.sourceGroupId !== targetGroupId) {
            try {
                const updatedGroups = groups.map(group => {
                    if (group.id === draggedTab.sourceGroupId) {
                        return { ...group, tabs: group.tabs.filter(tab => tab.id !== draggedTab.tab.id), modified: Date.now() };
                    } else if (group.id === targetGroupId) {
                        return { ...group, tabs: [...group.tabs, { ...draggedTab.tab, groupId: targetGroupId }], modified: Date.now() };
                    }
                    return group;
                }).filter(group => group.tabs.length > 0);

                if (!confirmBluetDeletion(updatedGroups)) { resetDragState(); return; }

                await GroupMemoryStorageService.reconcilePermanentGroupChanges(
                    updatedGroups,
                    [draggedTab.sourceGroupId, targetGroupId],
                );
                await Storage.set('groups', updatedGroups);
                setGroups(updatedGroups);
                ToastManager.getInstance().success(t('options.dragDrop.movedTabToGroup', { name: isolateBidi(targetGroup?.name ?? '') }));
            } catch (error) {
                ToastManager.getInstance().error(t('options.dragDrop.failedToMoveTab', { message: isolateBidi((error as Error).message) }));
            }
        }

        resetDragState();
    }, [groups, setGroups, draggedTab, draggedItems, clearTabSelection, resetDragState, confirmBluetDeletion, t]);

    const handleTrashDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (draggedItems && draggedItems.size > 0) {
            try {
                const tabsByGroup = new Map<string, string[]>();
                draggedItems.forEach(({ groupId }, tabId) => {
                    if (!tabsByGroup.has(groupId)) tabsByGroup.set(groupId, []);
                    tabsByGroup.get(groupId)!.push(tabId);
                });

                const lockedGroupIds = Array.from(tabsByGroup.keys()).filter(
                    groupId => groups.find(g => g.id === groupId)?.locked
                );
                if (lockedGroupIds.length > 0) {
                    ToastManager.getInstance().warning(t('options.dragDrop.cannotDeleteFromLockedGroups'));
                    return;
                }

                const updatedGroups = groups.map(group => {
                    const tabIdsToRemove = tabsByGroup.get(group.id);
                    if (!tabIdsToRemove) return group;
                    return { ...group, tabs: group.tabs.filter(t => !tabIdsToRemove.includes(t.id)), modified: Date.now() };
                }).filter(group => group.tabs.length > 0);

                if (!confirmBluetDeletion(updatedGroups)) { resetDragState(); return; }

                await GroupMemoryStorageService.reconcilePermanentGroupChanges(updatedGroups, tabsByGroup.keys());
                await Storage.set('groups', updatedGroups);
                setGroups(updatedGroups);
                ToastManager.getInstance().success(t('options.dragDrop.deletedTabs', { count: draggedItems.size }));
                clearTabSelection();
            } catch (error) {
                ToastManager.getInstance().error(t('options.dragDrop.failedToDeleteTabs', { message: isolateBidi((error as Error).message) }));
            }
        } else if (draggedTab) {
            try {
                const sourceGroup = groups.find(g => g.id === draggedTab.sourceGroupId);
                if (sourceGroup?.locked) {
                    ToastManager.getInstance().warning(t('options.dragDrop.cannotDeleteFromLockedGroups'));
                    return;
                }

                const updatedGroups = groups.map(group => {
                    if (group.id === draggedTab.sourceGroupId) {
                        return { ...group, tabs: group.tabs.filter(t => t.id !== draggedTab.tab.id), modified: Date.now() };
                    }
                    return group;
                }).filter(group => group.tabs.length > 0);

                if (!confirmBluetDeletion(updatedGroups)) { resetDragState(); return; }

                await GroupMemoryStorageService.reconcilePermanentGroupChanges(
                    updatedGroups,
                    [draggedTab.sourceGroupId],
                );
                await Storage.set('groups', updatedGroups);
                setGroups(updatedGroups);
                ToastManager.getInstance().success(t('options.dragDrop.tabDeleted'));
            } catch (error) {
                ToastManager.getInstance().error(t('options.dragDrop.failedToDeleteTab', { message: isolateBidi((error as Error).message) }));
            }
        }

        resetDragState();
    }, [groups, setGroups, draggedTab, draggedItems, clearTabSelection, resetDragState, confirmBluetDeletion, t]);

    const handleNewGroupDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (draggedItems && draggedItems.size > 0) {
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
                    ToastManager.getInstance().warning(t('options.dragDrop.cannotMoveFromLockedGroups'));
                    return;
                }

                const newGroupId = crypto.randomUUID();
                const newGroup: TabGroup = {
                    id: newGroupId,
                    name: t('options.dragDrop.newGroupNameWithCount', { count: tabsToMove.length }),
                    tabs: tabsToMove.map(t => ({ ...t, groupId: newGroupId })),
                    created: Date.now(),
                    modified: Date.now()
                };

                const updatedGroups = groups.map(group => {
                    if (sourceGroupIds.has(group.id)) {
                        return { ...group, tabs: group.tabs.filter(t => !draggedTabIds.has(t.id)), modified: Date.now() };
                    }
                    return group;
                }).filter(group => group.tabs.length > 0);

                if (!confirmBluetDeletion(updatedGroups)) { resetDragState(); return; }

                const nextGroups = [...updatedGroups, newGroup];
                await GroupMemoryStorageService.reconcilePermanentGroupChanges(
                    nextGroups,
                    new Set([...sourceGroupIds, newGroupId]),
                );
                await Storage.set('groups', nextGroups);
                setGroups(nextGroups);
                ToastManager.getInstance().success(t('options.dragDrop.createdNewGroupWithTabs', { count: tabsToMove.length }));
                clearTabSelection();
            } catch (error) {
                ToastManager.getInstance().error(t('options.dragDrop.failedToCreateGroup', { message: isolateBidi((error as Error).message) }));
            }
        } else if (draggedTab) {
            try {
                const sourceGroup = groups.find(g => g.id === draggedTab.sourceGroupId);
                if (sourceGroup?.locked) {
                    ToastManager.getInstance().warning(t('options.dragDrop.cannotMoveFromLockedGroups'));
                    return;
                }

                const newGroupId = crypto.randomUUID();
                const newGroup: TabGroup = {
                    id: newGroupId,
                    name: t('options.dragDrop.newGroupName'),
                    tabs: [{ ...draggedTab.tab, groupId: newGroupId }],
                    created: Date.now(),
                    modified: Date.now()
                };

                const updatedGroups = groups.map(group => {
                    if (group.id === draggedTab.sourceGroupId) {
                        return { ...group, tabs: group.tabs.filter(t => t.id !== draggedTab.tab.id), modified: Date.now() };
                    }
                    return group;
                }).filter(group => group.tabs.length > 0);

                if (!confirmBluetDeletion(updatedGroups)) { resetDragState(); return; }

                const nextGroups = [...updatedGroups, newGroup];
                await GroupMemoryStorageService.reconcilePermanentGroupChanges(
                    nextGroups,
                    [draggedTab.sourceGroupId, newGroupId],
                );
                await Storage.set('groups', nextGroups);
                setGroups(nextGroups);
                ToastManager.getInstance().success(t('options.dragDrop.createdNewGroup'));
            } catch (error) {
                ToastManager.getInstance().error(t('options.dragDrop.failedToCreateGroup', { message: isolateBidi((error as Error).message) }));
            }
        }

        resetDragState();
    }, [groups, setGroups, draggedTab, draggedItems, clearTabSelection, resetDragState, confirmBluetDeletion, t]);

    const handleTargetDragOver = useCallback((e: React.DragEvent, target: 'trash' | 'new-group') => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDragOverTarget(target);
        setDragOverGroupId(null);
    }, []);

    const handleTargetDragLeave = useCallback((e: React.DragEvent) => {
        e.stopPropagation();
        setDragOverTarget(null);
    }, []);

    const OverlayElement = isDraggingTabs ? (
        <div data-drop-zone className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-bg-1 border border-border rounded-xl shadow-lg transition-all duration-200 ${dragOverTarget ? 'scale-105 shadow-xl' : ''}`}>
            <span className={`text-sm font-medium me-2 transition-opacity ${dragOverTarget ? 'opacity-50' : 'text-text-muted'}`}>
                {t('options.dragDrop.tabCount', { count: isDragging && selectedTabs.size > 1 ? selectedTabs.size : 1 })}
            </span>

            <div className="h-8 w-px bg-border"></div>

            {/* New Group Drop Target */}
            <div
                onDragOver={(e) => handleTargetDragOver(e, 'new-group')}
                onDragLeave={handleTargetDragLeave}
                onDrop={handleNewGroupDrop}
                className={`flex items-center gap-2 px-5 py-3 rounded-lg border-2 border-dashed transition-all cursor-pointer
                    ${dragOverTarget === 'new-group'
                        ? 'border-primary bg-primary-muted text-primary scale-110 shadow-lg ring-2 ring-primary'
                        : 'border-border text-text-muted hover:border-primary hover:bg-primary-muted'
                    }`}
            >
                <FolderPlus className={`w-5 h-5 ${dragOverTarget === 'new-group' ? 'animate-pulse' : ''}`} />
                <span className="text-sm font-semibold">{t('options.dragDrop.overlayNewGroup')}</span>
            </div>

            {/* Trash Drop Target */}
            <div
                onDragOver={(e) => handleTargetDragOver(e, 'trash')}
                onDragLeave={handleTargetDragLeave}
                onDrop={handleTrashDrop}
                className={`flex items-center gap-2 px-5 py-3 rounded-lg border-2 border-dashed transition-all cursor-pointer
                    ${dragOverTarget === 'trash'
                        ? 'border-danger bg-danger-muted text-danger scale-110 shadow-lg ring-2 ring-danger'
                        : 'border-border text-text-muted hover:border-danger hover:bg-danger-muted'
                    }`}
            >
                <Trash2 className={`w-5 h-5 ${dragOverTarget === 'trash' ? 'animate-pulse' : ''}`} />
                <span className="text-sm font-semibold">{t('common.delete')}</span>
            </div>
        </div>
    ) : null;

    return {
        isDraggingTabs,
        dragOverGroupId,
        handleTabDragStart,
        handleTabDragEnd,
        handleGroupDragEnter,
        handleGroupDragOver,
        handleGroupDragLeave,
        handleGroupDrop,
        OverlayElement,
    };
}
