import type { GroupMenuConfig, GroupMenuSubmenuItem, TabGroup, Settings } from '../types/models';

export type SortOrder = 'newest' | 'oldest' | 'alphabetical' | 'mostTabs' | 'leastTabs';

export const SORT_OPTIONS = [
    { value: 'newest', label: 'Newest First' },
    { value: 'oldest', label: 'Oldest First' },
    { value: 'alphabetical', label: 'A-Z' },
    { value: 'mostTabs', label: 'Most Tabs' },
    { value: 'leastTabs', label: 'Least Tabs' }
] as const;

export function sortGroups(groups: TabGroup[], sortOrder: SortOrder): TabGroup[] {
    const sortedGroups = [...groups];

    switch (sortOrder) {
        case 'newest':
            return sortedGroups.sort((a, b) => b.created - a.created);

        case 'oldest':
            return sortedGroups.sort((a, b) => a.created - b.created);

        case 'alphabetical':
            return sortedGroups.sort((a, b) => a.name.localeCompare(b.name));

        case 'mostTabs':
            return sortedGroups.sort((a, b) => b.tabs.length - a.tabs.length);

        case 'leastTabs':
            return sortedGroups.sort((a, b) => a.tabs.length - b.tabs.length);

        default:
            return sortedGroups.sort((a, b) => b.created - a.created); // Default to newest
    }
}

export function sortGroupsWithPinning(groups: TabGroup[], sortOrder: SortOrder = 'newest'): TabGroup[] {
    const sortedGroups = [...groups];

    return sortedGroups.sort((a, b) => {
        // Pinned groups always come first
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;

        // Among pinned groups, sort by pin date (newest first)
        if (a.isPinned && b.isPinned) {
            const aPinnedAt = a.pinnedAt || 0;
            const bPinnedAt = b.pinnedAt || 0;
            return bPinnedAt - aPinnedAt;
        }

        // Among unpinned groups, use existing sort order
        switch (sortOrder) {
            case 'newest':
                return b.created - a.created;
            case 'oldest':
                return a.created - b.created;
            case 'alphabetical':
                return a.name.localeCompare(b.name);
            case 'mostTabs':
                return b.tabs.length - a.tabs.length;
            case 'leastTabs':
                return a.tabs.length - b.tabs.length;
            default:
                return b.created - a.created;
        }
    });
}

export function getDefaultGroupMenuConfig(): GroupMenuConfig {
    return {
        groupInfo: true,
        archiveGroup: true,
        assignToProject: true,
        manageTags: true,
        addNote: true,
        lockUnlock: true,
        rememberThisGroup: true,
        copyLinks: true,
        shareToBluet: true,
        deleteGroup: true,
        mainOrder: ['groupInfo', 'archiveGroup', 'assignToProject', 'edit', 'share', 'deleteGroup'],
        editOrder: ['manageTags', 'addNote', 'lockUnlock', 'rememberThisGroup'],
        shareOrder: ['copyLinks', 'shareToBluet'],
        mainOrderV2: ['groupInfo', 'archiveGroup', 'assignToProject', 'submenu:edit', 'submenu:share', 'deleteGroup'],
        submenus: [
            { id: 'edit', label: 'Edit', visible: true },
            { id: 'share', label: 'Share', visible: true },
        ],
        submenuAssignments: {
            manageTags: 'edit',
            addNote: 'edit',
            lockUnlock: 'edit',
            rememberThisGroup: 'edit',
            copyLinks: 'share',
            shareToBluet: 'share',
        },
        submenuItemOrder: {
            edit: ['manageTags', 'addNote', 'lockUnlock', 'rememberThisGroup'],
            share: ['copyLinks', 'shareToBluet'],
        },
    };
}

export function getNormalizedGroupMenuConfig(config?: GroupMenuConfig): GroupMenuConfig {
    const defaults = getDefaultGroupMenuConfig();
    const merged: GroupMenuConfig = {
        ...defaults,
        ...(config || {}),
        submenus: (config?.submenus && config.submenus.length > 0) ? config.submenus : defaults.submenus,
        submenuAssignments: {
            ...(defaults.submenuAssignments || {}),
            ...(config?.submenuAssignments || {}),
        },
        submenuItemOrder: {
            ...(defaults.submenuItemOrder || {}),
            ...(config?.submenuItemOrder || {}),
        },
    };

    const allowedItems: GroupMenuSubmenuItem[] = ['manageTags', 'addNote', 'lockUnlock', 'rememberThisGroup', 'copyLinks', 'shareToBluet'];
    const submenuIds = new Set((merged.submenus || []).map(s => s.id));
    const fallbackSubmenuId = (merged.submenus && merged.submenus[0]?.id) || 'edit';

    // Detect items promoted to main menu level (appear directly in mainOrderV2)
    const rawMainOrder = merged.mainOrderV2 || [];
    const promotedToMain = new Set<GroupMenuSubmenuItem>(
        rawMainOrder.filter(token =>
            !token.startsWith('submenu:') && (allowedItems as string[]).includes(token)
        ) as GroupMenuSubmenuItem[]
    );

    for (const item of allowedItems) {
        if (promotedToMain.has(item)) continue; // Skip items promoted to main
        const assigned = merged.submenuAssignments?.[item];
        if (!assigned || !submenuIds.has(assigned)) {
            (merged.submenuAssignments as Record<GroupMenuSubmenuItem, string>)[item] = fallbackSubmenuId;
        }
    }

    for (const submenu of merged.submenus || []) {
        const itemOrder = merged.submenuItemOrder?.[submenu.id] || [];
        const assignedItems = allowedItems.filter(i => merged.submenuAssignments?.[i] === submenu.id && !promotedToMain.has(i));
        const normalizedOrder = [
            ...itemOrder.filter(i => assignedItems.includes(i)),
            ...assignedItems.filter(i => !itemOrder.includes(i)),
        ];
        (merged.submenuItemOrder as Record<string, GroupMenuSubmenuItem[]>)[submenu.id] = normalizedOrder;
    }

    const defaultMain = defaults.mainOrderV2 || [];
    const configuredMain = merged.mainOrderV2 || defaultMain;
    const validSubmenuTokens = new Set((merged.submenus || []).map(s => `submenu:${s.id}`));
    const allowedMainTokens = new Set(['groupInfo', 'archiveGroup', 'assignToProject', 'deleteGroup', ...validSubmenuTokens, ...allowedItems]);
    const filteredMain = configuredMain.filter(token => allowedMainTokens.has(token));
    const completedMain = [
        ...filteredMain,
        ...defaultMain.filter(token => {
            if (token.startsWith('submenu:')) {
                return validSubmenuTokens.has(token) && !filteredMain.includes(token);
            }
            return !filteredMain.includes(token) && !allowedItems.includes(token as GroupMenuSubmenuItem);
        }),
    ];
    merged.mainOrderV2 = completedMain;

    return merged;
}

export function getDefaultSettings(): Settings {
    return {
        maxGroups: 100,
        theme: 'system',
        sortOrder: 'newest',
        restoreMode: 'smart',
        pinnedTabsMode: 'exclude',
        startupBehavior: 'manual',
        restoreBehavior: 'removeFromList',
        duplicateHandling: 'reject',
        customNewTabEnabled: false,
        tabGroupRestoreMode: 'normal',
        contextMenuGroupLimit: 25,
        groupMemoryEnabled: true,
        groupMemoryAutoRemember: true,
        openManagerAfterSave: true,
        floatingButtonEnabled: true,
        floatingButtonPosition: 'top-right',
        floatingButtonConfirmSaveAll: true,
        tabUrlDisplay: 'full',
        groupNotesDisplay: 'preview',
        groupMenuConfig: getDefaultGroupMenuConfig(),
    };
}

export function getSortOrderLabel(sortOrder: SortOrder): string {
    const option = SORT_OPTIONS.find(opt => opt.value === sortOrder);
    return option ? option.label : 'Newest First';
}

export default { sortGroups, sortGroupsWithPinning, getDefaultSettings, getDefaultGroupMenuConfig, getNormalizedGroupMenuConfig, getSortOrderLabel, SORT_OPTIONS };