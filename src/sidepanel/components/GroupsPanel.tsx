import { useState, useEffect } from 'react';
import { Storage } from '../../utils/storage';
import { TagManager } from '../../utils/tags';
import { sortGroupsWithPinning } from '../../utils/sorting';
import { loadCollapsedStates, saveGroupState, removeGroupState, cleanupOrphanedStates, migrateFromPersistentState } from '../../utils/collapsed-state';
import { GroupMemoryStorageService } from '../../utils/group-memory-storage';
import { ConfirmModal } from '../../components/ConfirmModal';
import PinButton from '../../components/PinButton';
import usePinManagement from '../../hooks/usePinManagement';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { SearchBar } from './SearchBar';
import type { TabGroup, Tag, Settings } from '../../types/models';
import { ChevronRight, ChevronDown, Undo2, Trash2, MoreHorizontal } from 'lucide-react';

export function GroupsPanel() {
    const [groups, setGroups] = useState<TabGroup[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [search, setSearch] = useState('');
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Map<string, boolean>>(new Map());
    const [isTogglingState, setIsTogglingState] = useState<Set<string>>(new Set());

    const pinManagement = usePinManagement(groups);

    useEffect(() => {
        const init = async () => {
            try { await migrateFromPersistentState(); } catch {}
            await loadGroups();
        };
        init();

        const handleStorageChange = async (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.groups) {
                const newGroups = changes.groups.newValue || [];
                const migrated = await Storage.migrateExistingGroups(newGroups);
                setGroups(migrated);
                const validIds = new Set(migrated.map((g: TabGroup) => g.id));
                await cleanupOrphanedStates(validIds);
            }
            if (changes.tags) setTags(changes.tags.newValue || []);
            if (changes.pinSettings) await loadGroups();
            if (changes.collapsedGroups) {
                setCollapsedGroups(new Map(Object.entries(changes.collapsedGroups.newValue || {})));
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);
        return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }, []);

    const loadGroups = async () => {
        const stored = await Storage.get<TabGroup[]>('groups') || [];
        const storedTags = await Storage.get<Tag[]>('tags') || [];
        const migrated = await Storage.migrateExistingGroups(stored);
        setGroups(migrated);
        setTags(storedTags);

        try {
            const states = await loadCollapsedStates();
            setCollapsedGroups(states);
            const validIds = new Set(migrated.map((g: TabGroup) => g.id));
            await cleanupOrphanedStates(validIds);
        } catch {}
    };

    const toggleCollapse = async (groupId: string) => {
        if (isTogglingState.has(groupId)) return;
        const current = collapsedGroups.get(groupId) || false;
        const next = !current;

        setIsTogglingState(prev => new Set(prev).add(groupId));
        const newState = new Map(collapsedGroups);
        newState.set(groupId, next);
        setCollapsedGroups(newState);

        try {
            await saveGroupState(groupId, next);
        } catch {
            const reverted = new Map(collapsedGroups);
            reverted.set(groupId, current);
            setCollapsedGroups(reverted);
        } finally {
            setIsTogglingState(prev => { const s = new Set(prev); s.delete(groupId); return s; });
        }
    };

    const restoreGroup = async (group: TabGroup) => {
        try {
            const settings = await Storage.get<Settings>('settings') || { restoreMode: 'smart' };
            const restoreMode = settings.restoreMode || 'smart';
            const currentTabs = await chrome.tabs.query({ currentWindow: true });

            let shouldCreateNewWindow = false;
            switch (restoreMode) {
                case 'newWindow': shouldCreateNewWindow = true; break;
                case 'currentWindow': shouldCreateNewWindow = false; break;
                case 'smart':
                    const nonBlueTabs = currentTabs.filter(t =>
                        t.url && !t.url.includes('src/popup/') && !t.url.includes('src/options/') && !t.url.includes('src/settings/')
                    );
                    shouldCreateNewWindow = nonBlueTabs.length > 0;
                    break;
            }

            if (shouldCreateNewWindow && group.tabs.length > 0) {
                const win = await chrome.windows.create({ url: group.tabs[0].url, focused: true });
                for (let i = 1; i < group.tabs.length; i++) {
                    await chrome.tabs.create({ url: group.tabs[i].url, windowId: win.id });
                }
            } else {
                for (const tab of group.tabs) {
                    await chrome.tabs.create({ url: tab.url });
                }
            }

            const restoreBehavior = settings.restoreBehavior || 'removeFromList';
            if (restoreBehavior === 'removeFromList') {
                if (settings.groupMemoryEnabled !== false && settings.groupMemoryAutoRemember !== false) {
                    await GroupMemoryStorageService.rememberGroup(group);
                }
                const updated = groups.filter(g => g.id !== group.id);
                await Storage.set('groups', updated);
                setGroups(updated);
            }
        } catch (error) {
            console.error('Failed to restore:', error);
        }
    };

    const deleteGroup = async (groupId: string) => {
        try {
            await GroupMemoryStorageService.forgetGroup(groupId);
            const updated = groups.filter(g => g.id !== groupId);
            await Storage.set('groups', updated);
            setGroups(updated);
            try {
                await removeGroupState(groupId);
                const newState = new Map(collapsedGroups);
                newState.delete(groupId);
                setCollapsedGroups(newState);
            } catch {}
        } catch (error) {
            console.error('Failed to delete:', error);
        }
    };

    const startEdit = (group: TabGroup) => { setEditingId(group.id); setEditName(group.name); };
    const cancelEdit = () => { setEditingId(null); setEditName(''); };
    const saveEdit = async () => {
        if (!editingId || !editName.trim()) return;
        try {
            const updated = groups.map(g => g.id === editingId ? { ...g, name: editName.trim(), modified: Date.now() } : g);
            await Storage.set('groups', updated);
            setGroups(updated);
            setEditingId(null); setEditName('');
        } catch (error) {
            console.error('Failed to save edit:', error);
        }
    };

    const handleDeleteConfirm = async () => {
        setShowDeleteModal(false);
        if (deleteTarget) {
            const group = groups.find(g => g.id === deleteTarget);
            if (group && pinManagement.isPinned(group.id)) await pinManagement.togglePin(group.id);
            await deleteGroup(deleteTarget);
        }
        setDeleteTarget(null);
    };

    // Filter & sort
    const { pinnedGroups, unpinnedGroups } = (() => {
        const filtered = groups.filter(group => {
            const q = search.toLowerCase();
            if (!q) return true;
            const matchesName = group.name.toLowerCase().includes(q);
            const matchesTabs = group.tabs.some(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));
            const matchesTags = group.tags?.length ? TagManager.getTagsByIds(group.tags, tags).some(t => t.name.toLowerCase().includes(q)) : false;
            return matchesName || matchesTabs || matchesTags;
        });
        const sorted = sortGroupsWithPinning(filtered, 'newest');
        return {
            pinnedGroups: sorted.filter(g => pinManagement.isPinned(g.id)),
            unpinnedGroups: sorted.filter(g => !pinManagement.isPinned(g.id)),
        };
    })();

    const renderGroupCard = (group: TabGroup, isPinned: boolean) => (
        <div key={group.id} className={`border border-border rounded-lg p-3 bg-card ${isPinned ? 'group-pinned' : ''}`}>
            <div className="flex justify-between items-center mb-1.5">
                {editingId === group.id ? (
                    <div className="flex-1 flex items-center gap-1.5">
                        <Input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                            placeholder="Group name..."
                            autoFocus
                            className="flex-1 h-7 text-xs"
                        />
                        <Button onClick={(e) => { e.stopPropagation(); saveEdit(); }} size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700">Save</Button>
                        <Button onClick={(e) => { e.stopPropagation(); cancelEdit(); }} size="sm" variant="secondary" className="h-7 text-xs">Cancel</Button>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <button
                                onClick={(e) => { e.stopPropagation(); toggleCollapse(group.id); }}
                                className="p-0.5 hover:bg-muted rounded transition-colors"
                                title={collapsedGroups.get(group.id) ? "Expand" : "Collapse"}
                            >
                                {collapsedGroups.get(group.id)
                                    ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                                    : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                }
                            </button>
                            <h3
                                className="font-medium text-xs cursor-pointer hover:text-primary text-foreground flex-1 truncate"
                                onClick={() => startEdit(group)}
                                title="Click to rename"
                            >
                                {group.name}
                                {collapsedGroups.get(group.id) && (
                                    <span className="text-muted-foreground ml-1 font-normal">({group.tabs.length})</span>
                                )}
                            </h3>
                        </div>
                        <div className="flex gap-0.5 items-center">
                            <PinButton groupId={group.id} isPinned={pinManagement.isPinned(group.id)} onToggle={pinManagement.togglePin} size="small" />
                            <Button onClick={() => restoreGroup(group)} size="sm" variant="ghost" className="h-6 w-6 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-950" title="Restore">
                                <Undo2 className="w-3 h-3" />
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" title="More">
                                        <MoreHorizontal className="w-3.5 h-3.5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-[140px]">
                                    <DropdownMenuItem
                                        onClick={() => { setDeleteTarget(group.id); setShowDeleteModal(true); }}
                                        className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
                                    >
                                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                                        Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </>
                )}
            </div>
            <div className={`transition-all duration-300 ease-out overflow-hidden ${collapsedGroups.get(group.id) ? 'max-h-0' : 'max-h-96'}`}>
                <div className="space-y-1.5 pt-1">
                    <p className="text-xs text-muted-foreground">{group.tabs.length} tabs</p>
                    {group.tags && group.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {TagManager.getTagsByIds(group.tags, tags).slice(0, 3).map(tag => (
                                <span key={tag.id} className="px-1.5 py-0.5 text-[11px] rounded font-medium" style={{ backgroundColor: `${tag.color}33`, color: tag.color }}>
                                    {tag.name}
                                </span>
                            ))}
                            {group.tags.length > 3 && <span className="text-[11px] text-muted-foreground">+{group.tags.length - 3}</span>}
                        </div>
                    )}
                    {group.tabs.slice(0, 3).map(tab => (
                        <div key={tab.id} className="flex items-center gap-1.5 text-xs">
                            <img src={tab.favicon || '/icons/default-favicon.png'} alt="" className="w-3.5 h-3.5 flex-shrink-0" onError={(e) => { e.currentTarget.src = '/icons/default-favicon.png'; }} />
                            <span className="truncate text-muted-foreground" title={tab.title}>{tab.title}</span>
                        </div>
                    ))}
                    {group.tabs.length > 3 && <p className="text-[11px] text-muted-foreground">+{group.tabs.length - 3} more</p>}
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex flex-col h-full">
            <div className="px-2 py-2">
                <SearchBar value={search} onChange={setSearch} placeholder="Search groups..." />
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-transparent px-2 pb-2 space-y-3">
                {pinnedGroups.map(g => renderGroupCard(g, true))}
                {unpinnedGroups.map(g => renderGroupCard(g, false))}

                {groups.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                        <p className="text-xs">No saved groups yet</p>
                    </div>
                )}
                {groups.length > 0 && pinnedGroups.length === 0 && unpinnedGroups.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                        <p className="text-xs">No groups match your search</p>
                    </div>
                )}
            </div>

            <ConfirmModal
                isOpen={showDeleteModal}
                title={(() => {
                    if (!deleteTarget) return "Delete Group";
                    const group = groups.find(g => g.id === deleteTarget);
                    return group && pinManagement.isPinned(group.id) ? "Delete Pinned Group" : "Delete Group";
                })()}
                message={(() => {
                    if (!deleteTarget) return "Are you sure? This cannot be undone.";
                    const group = groups.find(g => g.id === deleteTarget);
                    if (group && pinManagement.isPinned(group.id)) {
                        return `"${group.name}" is pinned. Deleting will remove all ${group.tabs.length} tabs and the pin. This cannot be undone.`;
                    }
                    return "Are you sure you want to delete this group? This cannot be undone.";
                })()}
                confirmText={(() => {
                    if (!deleteTarget) return "Delete";
                    const group = groups.find(g => g.id === deleteTarget);
                    return group && pinManagement.isPinned(group.id) ? "Delete Pinned Group" : "Delete";
                })()}
                cancelText="Cancel"
                onConfirm={handleDeleteConfirm}
                onCancel={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
                type="danger"
            />
        </div>
    );
}
