import { matchesSearch, normalizeForSearch, findSearchMatch } from '@/utils/search-text';
import { deleteGroupsWithUndo } from '@/services/group-deletion';
import { shouldShowGroupMemoryNotice, showGroupMemoryNotice } from '@/services/group-memory-notice';
import React, { useState, useEffect } from 'react';
import { toast, ToastManager } from '@/components/Toast';
import { motion } from 'framer-motion';
import { stagger } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { Storage } from '../../utils/storage';
import { TagManager } from '../../utils/tags';
import { sortGroupsWithPinning } from '../../utils/sorting';
import { loadCollapsedStates, saveGroupState, removeGroupState, cleanupOrphanedStates, migrateFromPersistentState } from '../../utils/collapsed-state';
import { GroupMemoryStorageService } from '../../utils/group-memory-storage';
import { recordGroupActivity } from '../../utils/group-activity';
import { ConfirmModal } from '../../components/ConfirmModal';
import PinButton from '../../components/PinButton';
import usePinManagement from '../../hooks/usePinManagement';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { SearchBar } from './SearchBar';
import type { TabGroup, Tag, Settings } from '../../types/models';
import { ChevronRight, ChevronDown, Undo2, Trash2, MoreHorizontal, Pin, Send, Repeat } from 'lucide-react';
// Plan 14-07 — INTEG-10 + INTEG-12: dynamic Save-to / Mirror entries on the
// group context menu. Pulls connected accounts via listConnectedAccounts and
// dispatches the registry verb send_group_to_<integrationId> on click.
import { listConnectedAccounts } from '../../services/integration-token-storage';
import { dispatchVerb, setupNotionMirror, stopGroupMirror } from '../../services/integration-service';
import { INTEGRATION_REGISTRY_MAP } from '../../services/integrations/registry';
import { LinearSyncStorage } from '../../services/linear-sync-storage';
import { TodoistSyncStorage } from '../../services/todoist-sync-storage';
import { restoreSavedTabWithBehavior } from '../../services/saved-tab-actions';
import { NotionPagePicker } from '../../components/integrations/NotionPagePicker';
import type { IntegrationAccount } from '../../types/integrations';
import type { IntegrationId } from '../../services/integrations/registry';
import {
    formatIntegrationActionLabel,
    getGroupIntegrationAction,
    isGroupMenuIntegration,
    type IntegrationMenuSettings,
} from '../../utils/integration-labels';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';
import { restoreSidepanelGroupTabs } from '../restore-saved-group-tabs';

interface IntegrationSettings extends IntegrationMenuSettings {
    auto_sync_groups?: Array<{
        groupId: string;
        integrationId: string;
        accountId: string;
        mirrorVerb: string;
        mirrorTarget?: string;
    }>;
}

const listVariants: Variants = {
    visible: {
        transition: {
            delayChildren: stagger(0.03),
        }
    },
    hidden: {}
};

const itemVariants: Variants = {
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.2, ease: 'easeOut' }
    },
    hidden: { opacity: 0, y: 8 }
};

function highlightMatch(text: string, query: string): React.ReactNode {
    if (!query) return text;
    const match = findSearchMatch(text, query);
    if (!match) return text;
    return (
        <>
            {text.slice(0, match.start)}
            <mark className="bg-yellow-200/60 dark:bg-yellow-500/30 rounded-sm px-0.5">{text.slice(match.start, match.end)}</mark>
            {text.slice(match.end)}
        </>
    );
}

export function GroupsPanel() {
    const { t } = useTranslation();
    const [groups, setGroups] = useState<TabGroup[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [search, setSearch] = useState('');
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Map<string, boolean>>(new Map());
    const [isTogglingState, setIsTogglingState] = useState<Set<string>>(new Set());

    // Plan 14-07 — connected integrations, mirror mappings.
    const [integrationAccounts, setIntegrationAccounts] = useState<IntegrationAccount[]>([]);
    const [integrationSettings, setIntegrationSettings] = useState<IntegrationSettings | null>(null);
    const [autoSyncGroups, setAutoSyncGroups] = useState<NonNullable<IntegrationSettings['auto_sync_groups']>>([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [linearSyncGroups, setLinearSyncGroups] = useState<any[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [todoistSyncGroups, setTodoistSyncGroups] = useState<any[]>([]);
    // Slack mirroring check — groups currently being mirrored to Slack
    const [slackMirroringGroupIds, setSlackMirroringGroupIds] = useState<string[]>([]);
    // Discord mirroring check
    const [discordMirroringGroupIds, setDiscordMirroringGroupIds] = useState<string[]>([]);

    // Notion Save-to auto-mirror picker state (Batch 3). One picker per
    // panel; we remember which group + account triggered it so the
    // confirm handler can run setupNotionMirror with the right context.
    const [notionPickerState, setNotionPickerState] = useState<{
        open: boolean;
        groupId: string;
        groupName: string;
        accountId: string;
    }>({ open: false, groupId: '', groupName: '', accountId: '' });

    const pinManagement = usePinManagement(groups);

    // Load + subscribe to integration changes.
    useEffect(() => {
        let cancelled = false;
        async function reloadIntegrations() {
            const [accts, settings, linearGroups, todoistGroups, allStorage] = await Promise.all([
                listConnectedAccounts(),
                Storage.get<IntegrationSettings>('integration_settings'),
                LinearSyncStorage.getAllSyncGroups(),
                TodoistSyncStorage.getAllSyncGroups(),
                chrome.storage.local.get(null),
            ]);
            if (cancelled) return;
            setIntegrationAccounts(accts);
            setIntegrationSettings(settings ?? null);
            setAutoSyncGroups(settings?.auto_sync_groups ?? []);
            setLinearSyncGroups(linearGroups);
            setTodoistSyncGroups(todoistGroups);
            // Extract Slack mirroring group IDs from storage keys
            const slackKeys = Object.keys(allStorage).filter(k => k.startsWith('slack_mirror:'));
            const slackGroupIds = slackKeys.map(k => k.replace('slack_mirror:', ''));
            setSlackMirroringGroupIds(slackGroupIds);
            // Extract Discord mirroring group IDs from storage keys
            const discordKeys = Object.keys(allStorage).filter(k => k.startsWith('discord_mirror:'));
            setDiscordMirroringGroupIds(discordKeys.map(k => k.replace('discord_mirror:', '')));
        }
        reloadIntegrations();

        const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
            if (changes.integration_tokens || changes.integration_settings || changes.linear_sync_data || changes.todoist_sync_data || Object.keys(changes).some(k => k.startsWith('slack_mirror:') || k.startsWith('discord_mirror:'))) {
                reloadIntegrations();
            }
        };
        chrome.storage.onChanged.addListener(listener);
        return () => {
            cancelled = true;
            chrome.storage.onChanged.removeListener(listener);
        };
    }, []);

    const handleSendGroupToIntegration = async (group: TabGroup, account: IntegrationAccount) => {
        const entry = INTEGRATION_REGISTRY_MAP.get(account.integrationId as IntegrationId);
        if (!entry) return;

        if (account.integrationId === 'notion') {
            setNotionPickerState({
                open: true,
                groupId: group.id,
                groupName: group.name,
                accountId: account.accountId,
            });
            return;
        }

        if (account.integrationId === 'linear' || account.integrationId === 'todoist' || account.integrationId === 'slack' || account.integrationId === 'discord') {
            const label = entry.display_name;
            try {
                const result = await dispatchVerb(
                    account.integrationId as IntegrationId,
                    'start_group_mirroring',
                    { groupId: group.id },
                    account.accountId,
                );
                if (result.success) {
                    toast.success(t('options.groupMenu.startMirroringSuccess', {
                        name: isolateBidi(group.name),
                        integration: isolateBidi(label),
                    }));
                } else {
                    toast.error(t('options.groupMenu.startMirroringFailed', {
                        message: isolateBidi(result.error ?? t('common.unknownError')),
                    }));
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : t('common.unknownError');
                toast.error(t('options.groupMenu.startMirroringFailedWithIntegration', {
                    integration: isolateBidi(label),
                    message: isolateBidi(msg),
                }));
            }
            return;
        }

        const verb = `send_group_to_${account.integrationId.replace('-', '_')}`;
        try {
            const result = await dispatchVerb(
                account.integrationId as IntegrationId,
                verb,
                { groupId: group.id },
                account.accountId,
            );
            if (result.success) {
                toast.success(t('options.groupMenu.sentToIntegrationSuccess', {
                    name: isolateBidi(group.name),
                    integration: isolateBidi(entry.display_name),
                }));
            } else {
                toast.error(t('options.groupMenu.sendToIntegrationFailed', {
                    integration: isolateBidi(entry.display_name),
                    message: isolateBidi(result.error ?? t('common.unknownError')),
                }));
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : t('common.unknownError');
            toast.error(t('options.groupMenu.sendToIntegrationFailed', {
                integration: isolateBidi(entry.display_name),
                message: isolateBidi(msg),
            }));
        }
    };

    const handleStopMirroring = async (groupId: string, integrationId: string) => {
        if (integrationId === 'linear' || integrationId === 'todoist' || integrationId === 'slack' || integrationId === 'discord') {
            const entry = INTEGRATION_REGISTRY_MAP.get(integrationId as IntegrationId);
            const label = entry?.display_name ?? integrationId;
            const confirmDelete = window.confirm(t('components.groupsPanel.stopProviderConfirm', {
                integration: isolateBidi(label),
            }));
            if (!confirmDelete) return;
            const accountId = integrationAccounts.find((a) => a.integrationId === integrationId)?.accountId ?? '';
            try {
                const result = await dispatchVerb(integrationId as IntegrationId, 'stop_group_mirroring', { groupId }, accountId);
                if (result.success) {
                    toast.success(t('components.groupsPanel.stopProviderSuccess', { integration: isolateBidi(label) }));
                } else {
                    toast.error(t('options.groupMenu.stopMirroringFailed', {
                        integration: isolateBidi(label),
                        message: isolateBidi(result.error ?? t('common.unknownError')),
                    }));
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : t('common.unknownError');
                toast.error(t('options.groupMenu.stopMirroringFailed', {
                    integration: isolateBidi(label),
                    message: isolateBidi(msg),
                }));
            }
            return;
        }

        const archive = window.confirm(t('options.groupMenu.stopNotionConfirm'));
        try {
            await stopGroupMirror(groupId, { archiveNotionDatabase: archive });
            toast.success(archive
                ? t('options.groupMenu.stopNotionArchiveSuccess')
                : t('options.groupMenu.stopNotionKeepSuccess'));
        } catch (err) {
            const msg = err instanceof Error ? err.message : t('common.unknownError');
            toast.error(t('options.groupMenu.stopMirroringGenericFailed', { message: isolateBidi(msg) }));
        }
    };

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
            const settings = (await Storage.get<Partial<Settings>>('settings')) ?? {};
            const currentTabs = await chrome.tabs.query({ currentWindow: true });
            const { createdTabIds, groupingError } = await restoreSidepanelGroupTabs({
                group,
                settings,
                currentTabs,
                keepFocus: await shouldShowGroupMemoryNotice(settings),
            });

            if (groupingError) {
                console.error('Failed to create tab group:', groupingError);
                toast.warning(t('options.manager.restoreGroupingFailed', {
                    count: createdTabIds.length,
                }));
            }

            const restoreBehavior = settings.restoreBehavior || 'removeFromList';
            void recordGroupActivity(group.id);
            if (restoreBehavior === 'removeFromList') {
                if (settings.groupMemoryEnabled !== false && settings.groupMemoryAutoRemember !== false) {
                    await GroupMemoryStorageService.rememberGroup(group);
                }
                const updated = groups.filter(g => g.id !== group.id);
                await Storage.set('groups', updated);
                setGroups(updated);
                await showGroupMemoryNotice(settings);
            }
        } catch (error) {
            console.error('Failed to restore:', error);
        }
    };

    const restoreGroupTab = async (url: string, tabId: string, groupId: string) => {
        try {
            const { updatedGroups } = await restoreSavedTabWithBehavior({
                url,
                tabId,
                groupId,
                groups,
                active: false,
            });
            setGroups(updatedGroups);
        } catch (error) {
            console.error('Failed to restore tab:', error);
        }
    };

    const deleteGroup = async (groupId: string) => {
        try {
            const receipt = await deleteGroupsWithUndo([groupId]);
            setGroups(receipt.updatedGroups);
            if (receipt.count > 0) ToastManager.getInstance().undo({ key: 'options.manager.deletedGroups', values: { count: receipt.count } }, receipt);
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
            const q = normalizeForSearch(search);
            if (!q) return true;
            const matchesName = matchesSearch(group.name, q);
            const matchesTabs = group.tabs.some(t => matchesSearch(t.title, q) || matchesSearch(t.url, q));
            const matchesTags = group.tags?.length ? TagManager.getTagsByIds(group.tags, tags).some(t => matchesSearch(t.name, q)) : false;
            return matchesName || matchesTabs || matchesTags;
        });
        const sorted = sortGroupsWithPinning(filtered, 'newest');
        return {
            pinnedGroups: sorted.filter(g => pinManagement.isPinned(g.id)),
            unpinnedGroups: sorted.filter(g => !pinManagement.isPinned(g.id)),
        };
    })();

    const renderGroupCard = (group: TabGroup, isPinned: boolean) => {
        const q = normalizeForSearch(search);
        const groupNameMatches = q && matchesSearch(group.name, q);
        const displayTabs = q && !groupNameMatches
            ? group.tabs.filter(t => matchesSearch(t.title, q) || matchesSearch(t.url, q))
            : group.tabs;
        return (
        <div className={`border border-border rounded-lg p-3 bg-card hover-lift ${isPinned ? 'group-pinned' : ''}`}>
            <div className="flex justify-between items-center mb-1.5">
                {editingId === group.id ? (
                    <div className="flex-1 flex items-center gap-1.5">
                        <Input
                            dir="auto"
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                            placeholder={t('sidepanel.groupsPanel.groupNamePlaceholder')}
                            autoFocus
                            className="flex-1 h-7 text-xs"
                        />
                        <Button onClick={(e) => { e.stopPropagation(); saveEdit(); }} size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700">{t('common.save')}</Button>
                        <Button onClick={(e) => { e.stopPropagation(); cancelEdit(); }} size="sm" variant="secondary" className="h-7 text-xs">{t('common.cancel')}</Button>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <button
                                onClick={(e) => { e.stopPropagation(); toggleCollapse(group.id); }}
                                className="p-0.5 hover:bg-muted rounded transition-colors"
                                title={collapsedGroups.get(group.id) ? t('sidepanel.groupsPanel.expand') : t('sidepanel.groupsPanel.collapse')}
                            >
                                {collapsedGroups.get(group.id)
                                    ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground rtl:rotate-180" />
                                    : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                }
                            </button>
                            <h3
                                className="font-medium text-xs cursor-pointer hover:text-primary text-foreground flex-1 truncate flex items-center gap-1"
                                onClick={() => startEdit(group)}
                                title={t('sidepanel.groupsPanel.clickToRename')}
                            >
                                {isPinned && <Pin className="w-3 h-3 text-muted-foreground shrink-0 rotate-45" />}
                                <bdi dir="auto">{highlightMatch(group.name, search)}</bdi>
                                {collapsedGroups.get(group.id) && (
                                    <span className="text-muted-foreground ms-1 font-normal bt-decor">({group.tabs.length})</span>
                                )}
                            </h3>
                        </div>
                        <div className="flex gap-0.5 items-center">
                            <PinButton groupId={group.id} isPinned={pinManagement.isPinned(group.id)} onToggle={pinManagement.togglePin} size="small" />
                            <Button onClick={() => restoreGroup(group)} size="sm" variant="ghost" className="h-6 w-6 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-950" title={t('sidepanel.groupsPanel.restore')}>
                                <Undo2 className="w-3 h-3" />
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" title={t('common.more')}>
                                        <MoreHorizontal className="w-3.5 h-3.5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                {/* The side panel is too narrow for a submenu (it flips off-screen),
                                    so integrations are an inline section capped to the panel width. */}
                                <DropdownMenuContent align="end" collisionPadding={8} className="w-64 max-w-[calc(100vw-1rem)]">
                                    {(() => {
                                        const mirroredIds = new Set(
                                            autoSyncGroups
                                                .filter((m) => m.groupId === group.id)
                                                .map((m) => m.integrationId),
                                        );
                                        const linearMirrored = linearSyncGroups.some((g) => g.groupId === group.id && g.isAutoSync);
                                        const todoistMirrored = todoistSyncGroups.some((g) => g.groupId === group.id && g.isAutoSync);
                                        const slackMirrored = slackMirroringGroupIds.includes(group.id);
                                        const discordMirrored = discordMirroringGroupIds.includes(group.id);
                                        if (linearMirrored) mirroredIds.add('linear');
                                        if (todoistMirrored) mirroredIds.add('todoist');
                                        if (slackMirrored) mirroredIds.add('slack');
                                        if (discordMirrored) mirroredIds.add('discord');

                                        const availableAccounts = integrationAccounts
                                            .filter((account) => !mirroredIds.has(account.integrationId))
                                            .filter((account) => isGroupMenuIntegration(account.integrationId));
                                        const activeMirrorBindings = autoSyncGroups
                                            .filter((m) => m.groupId === group.id)
                                            .filter((m) => !['linear', 'todoist', 'slack', 'discord'].includes(m.integrationId));
                                        const hasIntegrationItems =
                                            availableAccounts.length > 0 ||
                                            activeMirrorBindings.length > 0 ||
                                            linearMirrored ||
                                            todoistMirrored ||
                                            slackMirrored ||
                                            discordMirrored;
                                        if (!hasIntegrationItems) return null;

                                        return (
                                            <>
                                                <DropdownMenuLabel className="flex items-center text-xs font-medium text-muted-foreground">
                                                    <Send className="w-3.5 h-3.5 me-2" />
                                                    {t('settingsTabs.integrations')}
                                                </DropdownMenuLabel>
                                                    {availableAccounts.map((account) => {
                                                        const entry = INTEGRATION_REGISTRY_MAP.get(
                                                            account.integrationId as IntegrationId,
                                                        );
                                                        if (!entry) return null;
                                                        const actionText = getGroupIntegrationAction(account.integrationId);
                                                        return (
                                                            <DropdownMenuItem
                                                                key={`save:${account.integrationId}:${account.accountId}`}
                                                                onClick={() => handleSendGroupToIntegration(group, account)}
                                                            >
                                                                <Send className="w-3.5 h-3.5 me-2 flex-shrink-0" />
                                                                <span className="min-w-0 truncate">
                                                                    {formatIntegrationActionLabel(
                                                                        actionText,
                                                                        entry.display_name,
                                                                        account,
                                                                        integrationSettings,
                                                                        (key, values) => {
                                                                            switch (key) {
                                                                                case 'contextMenu.mirrorToProvider':
                                                                                    return t('contextMenu.mirrorToProvider', {
                                                                                        integration: values.integration,
                                                                                    });
                                                                                case 'contextMenu.mirrorToIntegration':
                                                                                    return t('contextMenu.mirrorToIntegration', {
                                                                                        integration: values.integration,
                                                                                        account: values.account,
                                                                                    });
                                                                                case 'contextMenu.saveToProvider':
                                                                                    return t('contextMenu.saveToProvider', {
                                                                                        integration: values.integration,
                                                                                    });
                                                                                case 'contextMenu.saveToIntegration':
                                                                                    return t('contextMenu.saveToIntegration', {
                                                                                        integration: values.integration,
                                                                                        account: values.account,
                                                                                    });
                                                                            }
                                                                        },
                                                                    )}
                                                                </span>
                                                            </DropdownMenuItem>
                                                        );
                                                    })}
                                                    {activeMirrorBindings.map((mirror) => {
                                                        const entry = INTEGRATION_REGISTRY_MAP.get(
                                                            mirror.integrationId as IntegrationId,
                                                        );
                                                        const provider = entry?.display_name ?? 'integration';
                                                        return (
                                                            <DropdownMenuItem
                                                                key={`stop:${mirror.integrationId}:${mirror.accountId}`}
                                                                onClick={() => handleStopMirroring(group.id, mirror.integrationId)}
                                                            >
                                                                <Repeat className="w-3.5 h-3.5 me-2" />
                                                                {t('options.groupMenu.stopMirroringProvider', { provider: isolateBidi(provider) })}
                                                            </DropdownMenuItem>
                                                        );
                                                    })}
                                                    {linearMirrored && (
                                                        <DropdownMenuItem onClick={() => handleStopMirroring(group.id, 'linear')}>
                                                            <Repeat className="w-3.5 h-3.5 me-2" />
                                                            {t('options.groupMenu.stopMirroringProvider', { provider: isolateBidi('Linear') })}
                                                        </DropdownMenuItem>
                                                    )}
                                                    {todoistMirrored && (
                                                        <DropdownMenuItem onClick={() => handleStopMirroring(group.id, 'todoist')}>
                                                            <Repeat className="w-3.5 h-3.5 me-2" />
                                                            {t('options.groupMenu.stopMirroringProvider', { provider: isolateBidi('Todoist') })}
                                                        </DropdownMenuItem>
                                                    )}
                                                    {slackMirrored && (
                                                        <DropdownMenuItem onClick={() => handleStopMirroring(group.id, 'slack')}>
                                                            <Repeat className="w-3.5 h-3.5 me-2" />
                                                            {t('options.groupMenu.stopMirroringSlack')}
                                                        </DropdownMenuItem>
                                                    )}
                                                    {discordMirrored && (
                                                        <DropdownMenuItem onClick={() => handleStopMirroring(group.id, 'discord')}>
                                                            <Repeat className="w-3.5 h-3.5 me-2" />
                                                            {t('options.groupMenu.stopMirroringDiscord')}
                                                        </DropdownMenuItem>
                                                    )}
                                                <DropdownMenuSeparator />
                                            </>
                                        );
                                    })()}
                                    <DropdownMenuItem
                                        onClick={() => { setDeleteTarget(group.id); setShowDeleteModal(true); }}
                                        className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
                                    >
                                        <Trash2 className="w-3.5 h-3.5 me-2" />
                                        {t('common.delete')}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </>
                )}
            </div>
            <div className={`transition-all duration-300 ease-out overflow-hidden ${collapsedGroups.get(group.id) ? 'max-h-0' : 'max-h-96'}`}>
                <div className="space-y-1.5 pt-1">
                    <p className="text-xs text-muted-foreground bt-decor">{t('common.tabsCount', { count: group.tabs.length })}</p>
                    {group.tags && group.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 bt-decor">
                            {TagManager.getTagsByIds(group.tags, tags).slice(0, 3).map(tag => (
                                <span key={tag.id} className="px-1.5 py-0.5 text-caption rounded font-medium" style={{ backgroundColor: `${tag.color}33`, color: tag.color }}>
                                    <bdi dir="auto">{tag.name}</bdi>
                                </span>
                            ))}
                            {group.tags.length > 3 && <span className="text-caption text-muted-foreground">+{group.tags.length - 3}</span>}
                        </div>
                    )}
                    <div className="max-h-40 overflow-y-auto space-y-1">
                        {displayTabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => { void restoreGroupTab(tab.url, tab.id, group.id); }}
                                className="flex items-center gap-1.5 text-xs w-full text-start hover:bg-accent hover:text-accent-foreground rounded px-1 py-0.5 transition-colors cursor-pointer"
                                title={isolateBidi(tab.url, 'ltr')}
                            >
                                <img src={tab.favicon || '/icons/default-favicon.png'} alt="" className="w-3.5 h-3.5 flex-shrink-0" onError={(e) => { e.currentTarget.src = '/icons/default-favicon.png'; }} />
                                <span className="truncate text-muted-foreground"><bdi dir="auto">{highlightMatch(tab.title, search)}</bdi></span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
    };

    return (
            <div className="flex flex-col h-full">
            <div className="px-2 py-2">
                <SearchBar value={search} onChange={setSearch} placeholder={t('sidepanel.groupsPanel.searchPlaceholder')} ariaLabel={t('sidepanel.groupsPanel.searchAria')} autoFocus />
            </div>

            <motion.div
                className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-transparent px-2 pb-2 space-y-3"
                variants={listVariants}
                initial="hidden"
                animate="visible"
            >
                {pinnedGroups.map(g => (
                    <motion.div key={g.id} variants={itemVariants}>
                        {renderGroupCard(g, true)}
                    </motion.div>
                ))}
                {unpinnedGroups.map(g => (
                    <motion.div key={g.id} variants={itemVariants}>
                        {renderGroupCard(g, false)}
                    </motion.div>
                ))}

                {groups.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                        <p className="text-xs">{t('sidepanel.groupsPanel.noGroups')}</p>
                    </div>
                )}
                {groups.length > 0 && pinnedGroups.length === 0 && unpinnedGroups.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                        <p className="text-xs">{t('sidepanel.groupsPanel.noMatches')}</p>
                    </div>
                )}
            </motion.div>

            {/* Save-to Notion picker — runs setupNotionMirror on confirm. */}
            <NotionPagePicker
                open={notionPickerState.open}
                accountId={notionPickerState.accountId || null}
                defaultDatabaseTitle={notionPickerState.groupName}
                title={t('sidepanel.groupsPanel.mirrorToNotionTitle', { name: isolateBidi(notionPickerState.groupName) })}
                description={t('sidepanel.groupsPanel.mirrorToNotionDescription')}
                onConfirm={async ({ pageId, databaseTitle }) => {
                    try {
                        await setupNotionMirror({
                            group: { id: notionPickerState.groupId, name: notionPickerState.groupName },
                            accountId: notionPickerState.accountId,
                            parentPageId: pageId,
                            databaseTitle,
                        });
                        toast.success(t('options.groupMenu.notionMirrorSuccess', { name: isolateBidi(notionPickerState.groupName) }));
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : t('common.unknownError');
                        toast.error(t('options.groupMenu.notionMirrorFailed', { message: isolateBidi(msg) }));
                    }
                }}
                onClose={() => setNotionPickerState((s) => ({ ...s, open: false }))}
            />

            <ConfirmModal
                isOpen={showDeleteModal}
                title={(() => {
                    if (!deleteTarget) return t('popup.deleteGroupTitle');
                    const group = groups.find(g => g.id === deleteTarget);
                    return group && pinManagement.isPinned(group.id) ? t('popup.deletePinnedGroupTitle') : t('popup.deleteGroupTitle');
                })()}
                message={(() => {
                    if (!deleteTarget) return t('popup.deleteGroupMessage');
                    const group = groups.find(g => g.id === deleteTarget);
                    if (group && pinManagement.isPinned(group.id)) {
                        return t('popup.deletePinnedGroupMessage', { name: isolateBidi(group.name), count: group.tabs.length });
                    }
                    return t('popup.deleteGroupMessage');
                })()}
                confirmText={(() => {
                    if (!deleteTarget) return t('common.delete');
                    const group = groups.find(g => g.id === deleteTarget);
                    return group && pinManagement.isPinned(group.id) ? t('popup.deletePinnedConfirm') : t('common.delete');
                })()}
                cancelText={t('common.cancel')}
                onConfirm={handleDeleteConfirm}
                onCancel={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
                type="danger"
            />
        </div>
    );
}
