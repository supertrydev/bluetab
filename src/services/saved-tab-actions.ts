import { FlowService } from './flow-service';
import { Storage } from '../utils/storage';
import { getDefaultSettings } from '../utils/sorting';
import { filterDuplicatesBySettings, deduplicateTabs } from '../utils/dedupe';
import { normalizeUrl } from '../utils/normalize';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import { recordGroupActivity } from '../utils/group-activity';
import { FlowStorageService } from '../utils/flow-storage';
import { autoRenameSavedGroupIfUntitled } from './smart-group-naming';
import type { RememberedGroup, Settings, TabGroup, TabItem } from '../types/models';

type SaveableBrowserTab = Pick<chrome.tabs.Tab, 'id' | 'title' | 'url' | 'favIconUrl' | 'pinned'>;

export interface RestoreSavedTabOptions {
    url: string;
    tabId: string;
    groupId: string;
    groups: TabGroup[];
    active?: boolean;
    settingsFallback?: Partial<Settings>;
}

export interface RestoreSavedTabResult {
    updatedGroups: TabGroup[];
    removedFromList: boolean;
    openedTabId?: number;
}

export interface SaveTabsToBlueTabOptions {
    closeSourceTabs?: boolean;
    now?: number;
    projectId?: string;
    isPro?: boolean;
    mode?: 'auto_organize' | 'preserve_set';
}

export interface SaveTabsToBlueTabResult {
    processedCount: number;
    memoryRestoredCount: number;
    flowMatchedCount: number;
    defaultGroupedCount: number;
    closedCount: number;
    savedGroups: TabGroup[];
}

export interface AddTabToExistingGroupResult {
    addedTab: TabItem;
    targetGroup: TabGroup;
    updatedGroups: TabGroup[];
}

function isSavableUrl(url: string | undefined): url is string {
    if (!url) return false;

    return !url.startsWith('chrome-extension://')
        && !url.startsWith('chrome://')
        && !url.startsWith('edge://')
        && !url.startsWith('about:')
        && !url.startsWith('moz-extension://')
        && url !== 'about:blank';
}

function mapTabsToItems(tabs: SaveableBrowserTab[], now: number): TabItem[] {
    return tabs.map((tab) => ({
        id: crypto.randomUUID(),
        url: normalizeUrl(tab.url || ''),
        title: tab.title || '',
        favicon: tab.favIconUrl,
        timestamp: now,
        groupId: crypto.randomUUID(),
        pinned: tab.pinned || false,
    }));
}

export async function addTabToExistingGroup(
    currentTab: SaveableBrowserTab,
    groupId: string,
    now = Date.now(),
): Promise<AddTabToExistingGroupResult | null> {
    if (!isSavableUrl(currentTab.url)) return null;

    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const targetGroup = groups.find((group) => group.id === groupId);
    if (!targetGroup) return null;

    const storedSettings = await Storage.get<Settings>('settings');
    const settings = { ...getDefaultSettings(), ...(storedSettings || {}) };
    const normalizedUrl = normalizeUrl(currentTab.url);
    const rememberedGroup = await GroupMemoryStorageService.findGroupByUrl(normalizedUrl);
    const rememberedTabId = rememberedGroup?.id === groupId
        ? rememberedGroup.tabs.find((tab) => normalizeUrl(tab.url) === normalizedUrl)?.originalId
        : undefined;
    const newTabItem: TabItem = {
        id: rememberedTabId || crypto.randomUUID(),
        url: normalizedUrl,
        title: currentTab.title || '',
        favicon: currentTab.favIconUrl,
        timestamp: now,
        groupId,
        pinned: currentTab.pinned || false,
    };

    if (
        settings.duplicateHandling === 'reject'
        && targetGroup.tabs.some((tab) => normalizeUrl(tab.url) === newTabItem.url)
    ) {
        return null;
    }

    const updatedGroups = groups.map((group) => (
        group.id === groupId
            ? { ...group, tabs: [...group.tabs, newTabItem], modified: now }
            : group
    ));
    await Storage.set('groups', updatedGroups);

    return { addedTab: newTabItem, targetGroup, updatedGroups };
}

async function appendNewGroup(
    name: string,
    tabs: TabItem[],
    now: number,
    projectId?: string,
): Promise<TabGroup | null> {
    if (tabs.length === 0) return null;

    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const groupId = crypto.randomUUID();
    const newGroup: TabGroup = {
        id: groupId,
        name,
        tabs: tabs.map((tab) => ({ ...tab, groupId })),
        created: now,
        modified: now,
        ...(projectId ? { projectId } : {}),
    };

    await Storage.set('groups', [...groups, newGroup]);
    return newGroup;
}

async function restoreGroupFromMemory(
    rememberedGroup: RememberedGroup,
    newTabs: TabItem[],
    now: number,
): Promise<number> {
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const rememberedTabIds = new Map(
        rememberedGroup.tabs.map((tab) => [normalizeUrl(tab.url), tab.originalId]),
    );
    const restoreTab = (tab: TabItem): TabItem => ({
        ...tab,
        id: rememberedTabIds.get(normalizeUrl(tab.url)) || tab.id,
        groupId: rememberedGroup.id,
    });

    let validProjectId: string | undefined;
    if (rememberedGroup.projectId) {
        const projects = await Storage.getProjects();
        if (projects.some((project) => project.id === rememberedGroup.projectId)) {
            validProjectId = rememberedGroup.projectId;
        }
    }

    const existingGroup = groups.find((group) => group.id === rememberedGroup.id);
    if (existingGroup) {
        const existingUrls = new Set(existingGroup.tabs.map((tab) => normalizeUrl(tab.url)));
        const newUniqueTabs = newTabs
            .filter((tab) => !existingUrls.has(normalizeUrl(tab.url)))
            .map(restoreTab);

        if (newUniqueTabs.length === 0) return 0;

        const updatedGroups = groups.map((group) => (
            group.id === rememberedGroup.id
                ? { ...group, tabs: [...group.tabs, ...newUniqueTabs], modified: now }
                : group
        ));
        await Storage.set('groups', updatedGroups);
        return newUniqueTabs.length;
    }

    const restoredGroup: TabGroup = {
        id: rememberedGroup.id,
        name: rememberedGroup.name,
        color: rememberedGroup.color,
        tags: rememberedGroup.tags,
        isPinned: rememberedGroup.isPinned,
        pinnedAt: rememberedGroup.pinnedAt,
        projectId: validProjectId,
        notes: rememberedGroup.notes,
        tabs: newTabs.map(restoreTab),
        created: rememberedGroup.created,
        modified: now,
    };

    await Storage.set('groups', [...groups, restoredGroup]);
    await GroupMemoryStorageService.restoreIntegrationState(rememberedGroup.id, rememberedGroup.integrationState);
    return restoredGroup.tabs.length;
}

export async function restoreSavedTabWithBehavior({
    url,
    tabId,
    groupId,
    groups,
    active = true,
    settingsFallback = {},
}: RestoreSavedTabOptions): Promise<RestoreSavedTabResult> {
    const openedTab = await chrome.tabs.create({ url, active });
    const storedSettings = await Storage.get<Settings>('settings');
    const settings = { ...getDefaultSettings(), ...settingsFallback, ...(storedSettings || {}) };
    await recordGroupActivity(groupId);

    if (settings.restoreBehavior !== 'removeFromList') {
        return {
            updatedGroups: groups,
            removedFromList: false,
            openedTabId: openedTab.id,
        };
    }

    const group = groups.find((candidate) => candidate.id === groupId);
    if (group && settings.groupMemoryEnabled !== false && settings.groupMemoryAutoRemember !== false) {
        await GroupMemoryStorageService.rememberGroup(group);
    }

    const updatedGroups = groups
        .map((candidate) => (
            candidate.id === groupId
                ? {
                    ...candidate,
                    tabs: candidate.tabs.filter((tab) => tab.id !== tabId),
                    modified: Date.now(),
                }
                : candidate
        ))
        .filter((candidate) => candidate.tabs.length > 0);

    await Storage.set('groups', updatedGroups);

    return {
        updatedGroups,
        removedFromList: true,
        openedTabId: openedTab.id,
    };
}

export async function saveTabsToBlueTab(
    tabs: SaveableBrowserTab[],
    defaultGroupName: string,
    {
        closeSourceTabs = false,
        now = Date.now(),
        projectId,
        isPro = false,
        mode = 'auto_organize',
    }: SaveTabsToBlueTabOptions = {},
): Promise<SaveTabsToBlueTabResult> {
    const existingGroups = await Storage.get<TabGroup[]>('groups') || [];
    const storedSettings = await Storage.get<Settings>('settings');
    const settings = { ...getDefaultSettings(), ...(storedSettings || {}) };

    let filteredTabs = tabs.filter((tab) => isSavableUrl(tab.url));
    if (settings.pinnedTabsMode === 'exclude') {
        filteredTabs = filteredTabs.filter((tab) => !tab.pinned);
    }

    const candidateTabs = mapTabsToItems(filteredTabs, now);
    const dedupedTabs = deduplicateTabs(filterDuplicatesBySettings(candidateTabs, existingGroups, settings));
    if (dedupedTabs.length === 0) {
        return {
            processedCount: 0,
            memoryRestoredCount: 0,
            flowMatchedCount: 0,
            defaultGroupedCount: 0,
            closedCount: 0,
            savedGroups: existingGroups,
        };
    }

    if (mode === 'preserve_set') {
        const createdGroup = await appendNewGroup(defaultGroupName, dedupedTabs, now, projectId);

        if (closeSourceTabs) {
            const tabIdsToClose = filteredTabs
                .map((tab) => tab.id)
                .filter((tabId): tabId is number => typeof tabId === 'number');

            if (tabIdsToClose.length > 0) {
                const managerUrl = chrome.runtime.getURL('src/options/index.html');
                const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
                const hasManager = currentWindowTabs.some((tab) => tab.url?.startsWith(managerUrl));
                const nonManagerIds = currentWindowTabs
                    .filter((tab) => !tab.url?.startsWith(managerUrl))
                    .map((tab) => tab.id)
                    .filter((tabId): tabId is number => typeof tabId === 'number');

                if (!hasManager && tabIdsToClose.length >= nonManagerIds.length) {
                    await chrome.tabs.create({ url: managerUrl });
                }

                await chrome.tabs.remove(tabIdsToClose);
            }
        }

        const savedGroups = await Storage.get<TabGroup[]>('groups') || [];
        if (createdGroup) {
            await autoRenameSavedGroupIfUntitled({
                groupId: createdGroup.id,
                initialName: createdGroup.name,
                tabs: createdGroup.tabs,
                isPro,
            });
        }

        const closedCount = closeSourceTabs
            ? filteredTabs.filter((tab) => typeof tab.id === 'number').length
            : 0;

        return {
            processedCount: dedupedTabs.length,
            memoryRestoredCount: 0,
            flowMatchedCount: 0,
            defaultGroupedCount: createdGroup?.tabs.length ?? 0,
            closedCount,
            savedGroups,
        };
    }

    let remainingTabs = dedupedTabs;
    let memoryRestoredCount = 0;
    if (settings.groupMemoryEnabled !== false) {
        const { buckets, remainingTabs: afterMemory } = await GroupMemoryStorageService.partitionTabsByMemory(dedupedTabs);
        for (const { group, tabs: bucketTabs } of buckets.values()) {
            memoryRestoredCount += await restoreGroupFromMemory(group, bucketTabs, now);
        }
        remainingTabs = afterMemory;
    }

    let flowMatchedCount = 0;
    let defaultGroupedCount = 0;
    let createdDefaultGroup: TabGroup | null = null;
    if (remainingTabs.length > 0) {
        const flowSettings = await FlowStorageService.getFlowSettings();
        const useFlow = flowSettings.enabled && flowSettings.rules.length > 0;

        if (useFlow) {
            const groupsForFlow = await Storage.get<TabGroup[]>('groups') || [];
            const flowResult = await FlowService.processTabs(remainingTabs, groupsForFlow);

            if (flowResult.success && flowResult.matched > 0) {
                flowMatchedCount = flowResult.matched;
                const unmatchedTabs = remainingTabs.filter((tab) =>
                    flowResult.results.some((result) => result.tabId === tab.id && result.actionTaken === 'no_match')
                );

                if (unmatchedTabs.length > 0) {
                    createdDefaultGroup = await appendNewGroup(defaultGroupName, unmatchedTabs, now, projectId);
                    defaultGroupedCount += createdDefaultGroup?.tabs.length ?? 0;
                }
            } else {
                createdDefaultGroup = await appendNewGroup(defaultGroupName, remainingTabs, now, projectId);
                defaultGroupedCount += createdDefaultGroup?.tabs.length ?? 0;
            }
        } else {
            createdDefaultGroup = await appendNewGroup(defaultGroupName, remainingTabs, now, projectId);
            defaultGroupedCount += createdDefaultGroup?.tabs.length ?? 0;
        }
    }

    let closedCount = 0;
    if (closeSourceTabs) {
        const tabIdsToClose = filteredTabs
            .map((tab) => tab.id)
            .filter((tabId): tabId is number => typeof tabId === 'number');

        if (tabIdsToClose.length > 0) {
            await chrome.tabs.remove(tabIdsToClose);
            closedCount = tabIdsToClose.length;
        }
    }

    if (createdDefaultGroup) {
        await autoRenameSavedGroupIfUntitled({
            groupId: createdDefaultGroup.id,
            initialName: createdDefaultGroup.name,
            tabs: createdDefaultGroup.tabs,
            isPro,
        });
    }

    const savedGroups = (await Storage.get<TabGroup[]>('groups')) || [];

    return {
        processedCount: dedupedTabs.length,
        memoryRestoredCount,
        flowMatchedCount,
        defaultGroupedCount,
        closedCount,
        savedGroups,
    };
}
