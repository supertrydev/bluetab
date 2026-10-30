import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Tags, StickyNote, Lock, Unlock, Brain,
    Copy, Send, Info, Archive, FolderPlus,
    Menu, Trash2, Check, Bell, Download,
    Share2, X, MessageCircle, Linkedin,
    Repeat, Mail, Globe2,
} from 'lucide-react';
import { toast } from '@/components/Toast';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreVertical } from 'lucide-react';
import { getNormalizedGroupMenuConfig } from '@/utils/sorting';
import { getGroupSubmenuLabel } from '@/utils/group-menu-labels';
import { GroupMemoryStorageService } from '@/utils/group-memory-storage';
import { ToastManager } from '@/components/Toast';
import { isolateBidi } from '@/i18n/bidi';
import { buildShareText, openShareUrl, getGroupBluetUrl } from '@/utils/social-share';
import { Storage } from '@/utils/storage';
import { listConnectedAccounts } from '@/services/integration-token-storage';
import { dispatchVerb, setupNotionMirror, stopGroupMirror } from '@/services/integration-service';
import {
    INTEGRATION_REGISTRY_MAP,
    type IntegrationId,
} from '@/services/integrations/registry';
import { NotionPagePicker } from '@/components/integrations/NotionPagePicker';
import { LinearSyncStorage } from '@/services/linear-sync-storage';
import { TodoistSyncStorage } from '@/services/todoist-sync-storage';
import type { IntegrationAccount } from '@/types/integrations';
import {
    formatIntegrationActionLabel,
    getGroupIntegrationAction,
    isGroupMenuIntegration,
    type IntegrationMenuSettings,
} from '@/utils/integration-labels';
import type { TabGroup, Settings, Project } from '@/types/models';
import type { BluetSharedRef } from '@/types/bluet';

interface AutoSyncMapping {
    groupId: string;
    integrationId: string;
    accountId: string;
    targetId: string;
}

interface IntegrationSettings extends IntegrationMenuSettings {
    auto_sync_groups?: AutoSyncMapping[];
}

export interface GroupMenuProps {
    group: TabGroup;
    settings: Settings;
    projects: Project[];
    isPro: boolean;
    bluet_sharedRefs: BluetSharedRef[];
    onOpenTagModal: (groupId: string) => void;
    onOpenNotesModal: (groupId: string) => void;
    onToggleLock: (groupId: string) => void;
    onCopyLinks: (groupId: string) => void;
    onShareToBluet: (group: TabGroup) => void;
    onShowInfo: (groupId: string) => void;
    onArchive: (groupId: string) => void;
    onAssignToProject: (groupId: string, projectId: string | undefined) => void;
    onSetReminder: (group: TabGroup) => void;
    onDelete: (groupId: string) => void;
    onSaveOffline?: (groupId: string) => void;
    offlineState?: 'none' | 'partial' | 'all';
}

export function GroupMenu({
    group,
    settings,
    projects,
    isPro,
    bluet_sharedRefs,
    onOpenTagModal,
    onOpenNotesModal,
    onToggleLock,
    onCopyLinks,
    onShareToBluet,
    onShowInfo,
    onArchive,
    onSetReminder,
    onAssignToProject,
    onDelete,
    onSaveOffline,
    offlineState = 'none',
}: GroupMenuProps) {
    const { t } = useTranslation();
    const groupMenuConfig = getNormalizedGroupMenuConfig(settings.groupMenuConfig);

    // Integration state — connected accounts and auto-sync mirror mappings.
    // Loaded once on mount and refreshed when integration storage keys change.
    const [integrationAccounts, setIntegrationAccounts] = useState<IntegrationAccount[]>([]);
    const [integrationSettings, setIntegrationSettings] = useState<IntegrationSettings | null>(null);
    const [autoSyncGroups, setAutoSyncGroups] = useState<AutoSyncMapping[]>([]);
    const [linearSyncGroups, setLinearSyncGroups] = useState<any[]>([]);
    const [todoistSyncGroups, setTodoistSyncGroups] = useState<any[]>([]);
    // Slack mirroring check
    const [slackMirroringGroupIds, setSlackMirroringGroupIds] = useState<string[]>([]);
    // Discord mirroring check
    const [discordMirroringGroupIds, setDiscordMirroringGroupIds] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;
        async function reload() {
            const [accounts, settingsObj, linearGroups, todoistGroups, allStorage] = await Promise.all([
                listConnectedAccounts(),
                Storage.get<IntegrationSettings>('integration_settings'),
                LinearSyncStorage.getAllSyncGroups(),
                TodoistSyncStorage.getAllSyncGroups(),
                chrome.storage.local.get(null),
            ]);
            if (cancelled) return;
            setIntegrationAccounts(accounts);
            setIntegrationSettings(settingsObj ?? null);
            setAutoSyncGroups(settingsObj?.auto_sync_groups ?? []);
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
        reload();

        const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
            if (changes.integration_tokens || changes.integration_settings || changes.linear_sync_data || changes.todoist_sync_data || Object.keys(changes).some(k => k.startsWith('slack_mirror:') || k.startsWith('discord_mirror:'))) reload();
        };
        chrome.storage.onChanged.addListener(listener);
        return () => {
            cancelled = true;
            chrome.storage.onChanged.removeListener(listener);
        };
    }, []);

    const isMirrored = autoSyncGroups.some((m) => m.groupId === group.id);
    const mirrorBinding = autoSyncGroups.find((m) => m.groupId === group.id);

    // Check Linear-specific mirroring
    const isLinearMirrored = linearSyncGroups.some((g) => g.groupId === group.id && g.isAutoSync);
    const linearMirrorGroup = linearSyncGroups.find((g) => g.groupId === group.id);

    // Check Todoist-specific mirroring
    const isTodoistMirrored = todoistSyncGroups.some((g) => g.groupId === group.id && g.isAutoSync);
    const todoistMirrorGroup = todoistSyncGroups.find((g) => g.groupId === group.id);

    // Check Slack mirroring
    const isSlackMirrored = slackMirroringGroupIds.includes(group.id);
    // Check Discord mirroring
    const isDiscordMirrored = discordMirroringGroupIds.includes(group.id);

    // Notion picker state — same shape as GroupsPanel; reusable picker
    // component handles the actual page list + database title.
    const [notionPickerState, setNotionPickerState] = useState<{
        open: boolean;
        accountId: string;
    }>({ open: false, accountId: '' });

    async function handleSendGroupToIntegration(account: IntegrationAccount) {
        const entry = INTEGRATION_REGISTRY_MAP.get(account.integrationId as IntegrationId);
        if (!entry) return;

        if (account.integrationId === 'notion') {
            setNotionPickerState({ open: true, accountId: account.accountId });
            return;
        }

        if (account.integrationId === 'linear' || account.integrationId === 'todoist' || account.integrationId === 'slack' || account.integrationId === 'discord') {
            const label = entry.display_name;
            try {
                const result = await dispatchVerb(
                    account.integrationId as IntegrationId,
                    'start_group_mirroring',
                    { groupId: group.id },
                    account.accountId
                );
                if (result.success) {
                    toast.success(t('options.groupMenu.startMirroringSuccess', {
                        name: isolateBidi(group.name),
                        integration: isolateBidi(label, 'ltr'),
                    }));
                } else {
                    toast.error(t('options.groupMenu.startMirroringFailed', { message: isolateBidi(result.error ?? t('common.unknownError')) }));
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : t('common.unknownError');
                toast.error(t('options.groupMenu.startMirroringFailedWithIntegration', {
                    integration: isolateBidi(label, 'ltr'),
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
                    integration: isolateBidi(entry.display_name, 'ltr'),
                }));
            } else {
                toast.error(t('options.groupMenu.sendToIntegrationFailed', {
                    integration: isolateBidi(entry.display_name, 'ltr'),
                    message: isolateBidi(result.error ?? t('common.unknownError')),
                }));
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : t('common.unknownError');
            toast.error(t('options.groupMenu.sendToIntegrationFailed', {
                integration: isolateBidi(entry.display_name, 'ltr'),
                message: isolateBidi(msg),
            }));
        }
    }

    function resolveLinearAccountId(): string {
        if (linearMirrorGroup?.accountId) return linearMirrorGroup.accountId;
        const fallback = integrationAccounts.find(a => a.integrationId === 'linear');
        return fallback?.accountId ?? '';
    }

    async function handleStopMirroring(integrationId?: string) {
        if (integrationId === 'discord' || (!integrationId && isDiscordMirrored)) {
            const confirmDelete = window.confirm(t('options.groupMenu.stopDiscordConfirm'));
            if (!confirmDelete) return;

            const accountId = integrationAccounts.find(a => a.integrationId === 'discord')?.accountId ?? '';
            try {
                const result = await dispatchVerb(
                    'discord' as IntegrationId,
                    'stop_group_mirroring',
                    { groupId: group.id },
                    accountId
                );
                if (result.success) {
                    toast.success(t('options.groupMenu.stopDiscordSuccess'));
                } else {
                    toast.error(t('options.groupMenu.stopMirroringFailed', {
                        integration: isolateBidi('Discord', 'ltr'),
                        message: isolateBidi(result.error ?? t('common.unknownError')),
                    }));
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : t('common.unknownError');
                toast.error(t('options.groupMenu.stopMirroringFailed', { integration: isolateBidi('Discord', 'ltr'), message: isolateBidi(msg) }));
            }
            return;
        }

        if (integrationId === 'slack' || (!integrationId && isSlackMirrored)) {
            const confirmDelete = window.confirm(t('options.groupMenu.stopSlackConfirm'));
            if (!confirmDelete) return;

            const accountId = integrationAccounts.find(a => a.integrationId === 'slack')?.accountId ?? '';
            try {
                const result = await dispatchVerb(
                    'slack' as IntegrationId,
                    'stop_group_mirroring',
                    { groupId: group.id },
                    accountId
                );
                if (result.success) {
                    toast.success(t('options.groupMenu.stopSlackSuccess'));
                } else {
                    toast.error(t('options.groupMenu.stopMirroringFailed', {
                        integration: isolateBidi('Slack', 'ltr'),
                        message: isolateBidi(result.error ?? t('common.unknownError')),
                    }));
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : t('common.unknownError');
                toast.error(t('options.groupMenu.stopMirroringFailed', { integration: isolateBidi('Slack', 'ltr'), message: isolateBidi(msg) }));
            }
            return;
        }

        if (integrationId === 'linear' || (!integrationId && linearMirrorGroup)) {
            const confirmDelete = window.confirm(t('options.groupMenu.stopLinearConfirm'));
            if (!confirmDelete) return;

            const accountId = resolveLinearAccountId();
            try {
                const result = await dispatchVerb(
                    'linear',
                    'stop_group_mirroring',
                    { groupId: group.id },
                    accountId
                );
                if (result.success) {
                    toast.success(t('options.groupMenu.stopLinearSuccess'));
                } else {
                    toast.error(t('options.groupMenu.stopMirroringFailed', {
                        integration: isolateBidi('Linear', 'ltr'),
                        message: isolateBidi(result.error ?? t('common.unknownError')),
                    }));
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : t('common.unknownError');
                toast.error(t('options.groupMenu.stopMirroringFailed', { integration: isolateBidi('Linear', 'ltr'), message: isolateBidi(msg) }));
            }
            return;
        }

        if (integrationId === 'todoist' || (!integrationId && todoistMirrorGroup)) {
            const confirmDelete = window.confirm(t('options.groupMenu.stopTodoistConfirm'));
            if (!confirmDelete) return;

            const accountId = integrationAccounts.find(a => a.integrationId === 'todoist')?.accountId ?? '';
            try {
                const result = await dispatchVerb(
                    'todoist',
                    'stop_group_mirroring',
                    { groupId: group.id },
                    accountId
                );
                if (result.success) {
                    toast.success(t('options.groupMenu.stopTodoistSuccess'));
                } else {
                    toast.error(t('options.groupMenu.stopMirroringFailed', {
                        integration: isolateBidi('Todoist', 'ltr'),
                        message: isolateBidi(result.error ?? t('common.unknownError')),
                    }));
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : t('common.unknownError');
                toast.error(t('options.groupMenu.stopMirroringFailed', { integration: isolateBidi('Todoist', 'ltr'), message: isolateBidi(msg) }));
            }
            return;
        }

        // Original Notion mirroring logic
        const archive = window.confirm(t('options.groupMenu.stopNotionConfirm'));
        try {
            await stopGroupMirror(group.id, { archiveNotionDatabase: archive });
            toast.success(
                archive
                    ? t('options.groupMenu.stopNotionArchiveSuccess')
                    : t('options.groupMenu.stopNotionKeepSuccess'),
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : t('common.unknownError');
            toast.error(t('options.groupMenu.stopMirroringGenericFailed', { message: isolateBidi(msg) }));
        }
    }

    const showRememberThisGroup =
        groupMenuConfig.rememberThisGroup &&
        settings.groupMemoryEnabled !== false &&
        settings.groupMemoryAutoRemember === false;

    const showShareToBluet = isPro && groupMenuConfig.shareToBluet;

    const bluetUrl = getGroupBluetUrl(group.id, bluet_sharedRefs);
    const tabData = group.tabs.map(t => ({ title: t.title, url: t.url }));
    const shareText = buildShareText(group.name, group.tabs.length, undefined, tabData, group.notes);

    const optionCanRender = (item: string) => {
        if (item === 'manageTags') return groupMenuConfig.manageTags;
        if (item === 'addNote') return groupMenuConfig.addNote;
        if (item === 'lockUnlock') return groupMenuConfig.lockUnlock;
        if (item === 'rememberThisGroup') return showRememberThisGroup;
        if (item === 'copyLinks') return groupMenuConfig.copyLinks;
        if (item === 'shareToBluet') return showShareToBluet;
        return false;
    };

    const renderSubmenuOption = (item: string) => {
        if (item === 'manageTags') {
            return (
                <DropdownMenuItem
                    key={item}
                    disabled={group.locked}
                    onClick={() => { if (!group.locked) onOpenTagModal(group.id); }}
                >
                    <Tags className="w-4 h-4" />
                    {t('settings.groupMenu.labels.manageTags')}
                </DropdownMenuItem>
            );
        }
        if (item === 'addNote') {
            return (
                <DropdownMenuItem key={item} onClick={() => onOpenNotesModal(group.id)}>
                    <StickyNote className="w-4 h-4" />
                    {group.notes ? t('options.groupMenu.editNote') : t('options.groupMenu.addNote')}
                </DropdownMenuItem>
            );
        }
        if (item === 'lockUnlock') {
            return (
                <DropdownMenuItem key={item} onClick={() => onToggleLock(group.id)}>
                    {group.locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                    {group.locked ? t('options.groupMenu.unlockGroup') : t('options.groupMenu.lockGroup')}
                </DropdownMenuItem>
            );
        }
        if (item === 'rememberThisGroup') {
            return (
                <DropdownMenuItem
                    key={item}
                    onClick={async () => {
                        await GroupMemoryStorageService.rememberGroup(group);
                        ToastManager.getInstance().success(t('options.groupMenu.remembered', { name: isolateBidi(group.name) }));
                    }}
                >
                    <Brain className="w-4 h-4" />
                    {t('settings.groupMenu.labels.rememberThisGroup')}
                </DropdownMenuItem>
            );
        }
        if (item === 'copyLinks') {
            return (
                <DropdownMenuItem key={item} onClick={() => onCopyLinks(group.id)}>
                    <Copy className="w-4 h-4" />
                    {t('settings.groupMenu.labels.copyLinks')}
                </DropdownMenuItem>
            );
        }
        if (item === 'shareToBluet') {
            return (
                <DropdownMenuItem key={item} onClick={() => onShareToBluet(group)}>
                    <Send className="w-4 h-4" />
                    {bluet_sharedRefs.some(r => r.id === group.id) ? t('options.groupMenu.updateOnBluet') : t('settings.groupMenu.labels.shareToBluet')}
                </DropdownMenuItem>
            );
        }
        return null;
    };

    const renderExternalShareItems = () => (
        <>
            <DropdownMenuItem onClick={() => openShareUrl('x', shareText, bluetUrl)}>
                <X className="w-4 h-4" />
                X
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openShareUrl('whatsapp', shareText, bluetUrl)}>
                <MessageCircle className="w-4 h-4" />
                WhatsApp
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openShareUrl('telegram', shareText, bluetUrl)}>
                <Send className="w-4 h-4" />
                Telegram
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openShareUrl('email', shareText, bluetUrl)}>
                <Mail className="w-4 h-4" />
                {t('auth.login.email')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openShareUrl('linkedin', shareText, bluetUrl)}>
                <Linkedin className="w-4 h-4" />
                LinkedIn
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openShareUrl('reddit', shareText, bluetUrl)}>
                <MessageCircle className="w-4 h-4" />
                Reddit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openShareUrl('facebook', shareText, bluetUrl)}>
                <Globe2 className="w-4 h-4" />
                Facebook
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openShareUrl('clipboard', shareText, bluetUrl)}>
                <Copy className="w-4 h-4" />
                {t('options.groupMenu.copyShareText')}
            </DropdownMenuItem>
        </>
    );

    const submenuVisibleItems: Record<string, string[]> = {};
    for (const submenu of groupMenuConfig.submenus || []) {
        const ordered = (groupMenuConfig.submenuItemOrder?.[submenu.id] || []).filter(
            (item) => groupMenuConfig.submenuAssignments?.[item as keyof typeof groupMenuConfig.submenuAssignments] === submenu.id && optionCanRender(item)
        );
        submenuVisibleItems[submenu.id] = ordered;
    }

    const getAvailableIntegrationAccounts = () => integrationAccounts.filter((account) => {
        if (!isGroupMenuIntegration(account.integrationId)) return false;
        if (account.integrationId === 'linear' && isLinearMirrored) return false;
        if (account.integrationId === 'todoist' && isTodoistMirrored) return false;
        if (account.integrationId === 'slack' && isSlackMirrored) return false;
        if (account.integrationId === 'discord' && isDiscordMirrored) return false;
        if (
            account.integrationId !== 'linear' &&
            account.integrationId !== 'todoist' &&
            account.integrationId !== 'slack' &&
            isMirrored &&
            mirrorBinding?.integrationId === account.integrationId
        ) {
            return false;
        }
        return true;
    });

    const hasIntegrationMenu =
        getAvailableIntegrationAccounts().length > 0 ||
        isLinearMirrored ||
        isTodoistMirrored ||
        isSlackMirrored ||
        isDiscordMirrored ||
        Boolean(isMirrored && mirrorBinding);

    const mainItemCanRender = (token: string) => {
        if (token === 'integrations') return groupMenuConfig.integrations && hasIntegrationMenu;
        if (token === 'groupInfo') return groupMenuConfig.groupInfo;
        if (token === 'archiveGroup') return groupMenuConfig.archiveGroup;
        if (token === 'assignToProject') return groupMenuConfig.assignToProject && projects.length > 0;
        if (token === 'setReminder') return groupMenuConfig.setReminder;
        if (token === 'saveOffline') return groupMenuConfig.saveOffline && Boolean(onSaveOffline);
        if (token === 'deleteGroup') return groupMenuConfig.deleteGroup;
        if (token.startsWith('submenu:')) {
            const submenuId = token.replace('submenu:', '');
            const submenu = (groupMenuConfig.submenus || []).find(s => s.id === submenuId);
            return Boolean(submenu && submenu.visible && (submenuId === 'share' || (submenuVisibleItems[submenuId]?.length || 0) > 0));
        }
        if (optionCanRender(token)) return true;
        return false;
    };

    const renderedMainItems = (groupMenuConfig.mainOrderV2 || []).filter(mainItemCanRender);

    const renderIntegrationMenu = () => {
        if (!hasIntegrationMenu) return null;

        return (
            <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                    <Send className="w-4 h-4" />
                    {t('settings.groupMenu.labels.integrations')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-64">
                    {getAvailableIntegrationAccounts().map((account) => {
                        const entry = INTEGRATION_REGISTRY_MAP.get(
                            account.integrationId as IntegrationId,
                        );
                        if (!entry) return null;
                        const actionText = getGroupIntegrationAction(account.integrationId);
                        return (
                            <DropdownMenuItem
                                key={`save:${account.integrationId}:${account.accountId}`}
                                onClick={() => handleSendGroupToIntegration(account)}
                            >
                                <Send className="w-4 h-4" />
                                <span className="truncate">
                                    {formatIntegrationActionLabel(
                                        actionText,
                                        entry.display_name,
                                        account,
                                        integrationSettings,
                                        (key, values) => t(key as never, values as never) as unknown as string,
                                    )}
                                </span>
                            </DropdownMenuItem>
                        );
                    })}
                    {isLinearMirrored && linearMirrorGroup && (
                        <DropdownMenuItem
                            key={`stop-linear:${group.id}`}
                            onClick={() => handleStopMirroring('linear')}
                        >
                            <Repeat className="w-4 h-4" />
                            <span className="truncate">
                                {t('options.groupMenu.stopMirroringLinear', { count: linearMirrorGroup.issueCount })}
                            </span>
                        </DropdownMenuItem>
                    )}
                    {isTodoistMirrored && todoistMirrorGroup && (
                        <DropdownMenuItem
                            key={`stop-todoist:${group.id}`}
                            onClick={() => handleStopMirroring('todoist')}
                        >
                            <Repeat className="w-4 h-4" />
                            <span className="truncate">
                                {t('options.groupMenu.stopMirroringTodoist', { count: todoistMirrorGroup.taskCount })}
                            </span>
                        </DropdownMenuItem>
                    )}
                    {isSlackMirrored && (
                        <DropdownMenuItem
                            key={`stop-slack:${group.id}`}
                            onClick={() => handleStopMirroring('slack')}
                        >
                            <Repeat className="w-4 h-4" />
                            {t('options.groupMenu.stopMirroringSlack')}
                        </DropdownMenuItem>
                    )}
                    {isDiscordMirrored && (
                        <DropdownMenuItem
                            key={`stop-discord:${group.id}`}
                            onClick={() => handleStopMirroring('discord')}
                        >
                            <Repeat className="w-4 h-4" />
                            {t('options.groupMenu.stopMirroringDiscord')}
                        </DropdownMenuItem>
                    )}
                    {isMirrored && mirrorBinding && !['linear', 'todoist', 'slack', 'discord'].includes(mirrorBinding.integrationId) && (() => {
                        const entry = INTEGRATION_REGISTRY_MAP.get(
                            mirrorBinding.integrationId as IntegrationId,
                        );
                        const provider = entry?.display_name ?? 'integration';
                        return (
                            <DropdownMenuItem
                                key={`stop:${group.id}`}
                                onClick={() => handleStopMirroring(mirrorBinding.integrationId)}
                            >
                                <Repeat className="w-4 h-4" />
                                {t('options.groupMenu.stopMirroringProvider', { provider })}
                            </DropdownMenuItem>
                        );
                    })()}
                </DropdownMenuSubContent>
            </DropdownMenuSub>
        );
    };

    return (
      <>
        <NotionPagePicker
            open={notionPickerState.open}
            accountId={notionPickerState.accountId || null}
            defaultDatabaseTitle={group.name}
            title={t('sidepanel.groupsPanel.mirrorToNotionTitle', { name: isolateBidi(group.name) })}
            description={t('sidepanel.groupsPanel.mirrorToNotionDescription')}
            onConfirm={async ({ pageId, databaseTitle }) => {
                try {
                    await setupNotionMirror({
                        group: { id: group.id, name: group.name },
                        accountId: notionPickerState.accountId,
                        parentPageId: pageId,
                        databaseTitle,
                    });
                    toast.success(t('options.groupMenu.notionMirrorSuccess', { name: isolateBidi(group.name) }));
                } catch (err) {
                    const msg = err instanceof Error ? err.message : t('common.unknownError');
                    toast.error(t('options.groupMenu.notionMirrorFailed', { message: isolateBidi(msg) }));
                }
            }}
            onClose={() => setNotionPickerState((s) => ({ ...s, open: false }))}
        />
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="p-1.5 h-auto w-auto"
                    onClick={(e) => e.stopPropagation()}
                >
                    <MoreVertical className="w-4 h-4 text-muted-foreground" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
                {renderedMainItems.map((item, index) => {
                    const hasPreviousItems = index > 0;
                    const hasFollowingItems = index < renderedMainItems.length - 1;

                    if (item === 'integrations') {
                        const integrationsMenu = renderIntegrationMenu();
                        if (!integrationsMenu) return null;

                        return (
                            <div key={item}>
                                {integrationsMenu}
                                {hasFollowingItems && <DropdownMenuSeparator />}
                            </div>
                        );
                    }

                    if (item === 'groupInfo') {
                        return (
                            <DropdownMenuItem key={item} onClick={() => onShowInfo(group.id)}>
                                <Info className="w-4 h-4" />
                                {t('settings.groupMenu.labels.groupInfo')}
                            </DropdownMenuItem>
                        );
                    }

                    if (item === 'archiveGroup') {
                        return (
                            <DropdownMenuItem
                                key={item}
                                disabled={group.locked}
                                onClick={() => { if (!group.locked) onArchive(group.id); }}
                            >
                                <Archive className="w-4 h-4" />
                                {t('settings.groupMenu.labels.archiveGroup')}
                            </DropdownMenuItem>
                        );
                    }

                    if (item === 'assignToProject') {
                        return (
                            <DropdownMenuSub key={item}>
                                <DropdownMenuSubTrigger>
                                    <FolderPlus className="w-4 h-4" />
                                    {t('settings.groupMenu.labels.assignToProject')}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-48">
                                    <DropdownMenuItem onClick={() => onAssignToProject(group.id, undefined)}>
                                        {!group.projectId && <Check className="w-3 h-3" />}
                                        <span className={!group.projectId ? 'font-medium' : ''}>{t('options.bulkEdit.noProject')}</span>
                                    </DropdownMenuItem>
                                    {projects.map(proj => (
                                        <DropdownMenuItem
                                            key={proj.id}
                                            onClick={() => onAssignToProject(group.id, proj.id)}
                                        >
                                            {group.projectId === proj.id && <Check className="w-3 h-3" />}
                                            <span className={group.projectId === proj.id ? 'font-medium' : ''}><bdi dir="auto">{proj.name}</bdi></span>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>
                        );
                    }

                    if (item.startsWith('submenu:')) {
                        const submenuId = item.replace('submenu:', '');
                        const submenu = (groupMenuConfig.submenus || []).find(s => s.id === submenuId);
                        const items = submenuVisibleItems[submenuId] || [];
                        if (!submenu || !submenu.visible || (submenuId !== 'share' && items.length === 0)) return null;
                        const isShareMenu = submenuId === 'share';

                        return (
                            <DropdownMenuSub key={item}>
                                <DropdownMenuSubTrigger>
                                    {isShareMenu ? <Share2 className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                                    {getGroupSubmenuLabel(submenu, t)}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className={isShareMenu ? 'w-64' : 'w-52'}>
                                    {items.map((submenuItem) => renderSubmenuOption(submenuItem))}
                                    {isShareMenu && items.length > 0 && <DropdownMenuSeparator />}
                                    {isShareMenu && renderExternalShareItems()}
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>
                        );
                    }

                    // Promoted submenu items rendered directly at main level
                    if (optionCanRender(item)) {
                        return renderSubmenuOption(item);
                    }

                    if (item === 'setReminder') {
                        return (
                            <DropdownMenuItem key={item} onClick={() => onSetReminder(group)}>
                                <Bell className="w-4 h-4" />
                                {t('settings.groupMenu.labels.setReminder')}
                            </DropdownMenuItem>
                        );
                    }

                    if (item === 'saveOffline') {
                        if (!onSaveOffline) return null;

                        return (
                            <DropdownMenuItem key={item} onClick={() => onSaveOffline(group.id)}>
                                <Download className="w-4 h-4" />
                                {offlineState === 'all' ? t('options.groupMenu.removeOfflineCopy') : t('settings.groupMenu.labels.saveOffline')}
                            </DropdownMenuItem>
                        );
                    }

                    if (item === 'deleteGroup') {
                        return (
                            <div key={item}>
                                {hasPreviousItems && <DropdownMenuSeparator />}

                                <DropdownMenuItem
                                    disabled={group.locked}
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => { if (!group.locked) onDelete(group.id); }}
                                >
                                    <Trash2 className="w-4 h-4" />
                                    {t('settings.groupMenu.labels.deleteGroup')}
                                </DropdownMenuItem>
                            </div>
                        );
                    }

                    return null;
                })}
            </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
}
