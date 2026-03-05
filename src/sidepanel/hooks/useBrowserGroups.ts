import { useState, useEffect, useCallback, useRef } from 'react';

// Chrome tab group colors
export type TabGroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export interface BrowserGroup {
    id: number;
    title: string;
    color: TabGroupColor;
    collapsed: boolean;
    windowId: number;
}

interface UseBrowserGroupsReturn {
    groups: BrowserGroup[];
    loading: boolean;
    error: string | null;
    refreshGroups: () => Promise<void>;
    createGroup: (tabIds: number[], title?: string, color?: TabGroupColor) => Promise<number | null>;
    updateGroup: (groupId: number, options: { title?: string; color?: TabGroupColor; collapsed?: boolean }) => Promise<void>;
    deleteGroup: (groupId: number) => Promise<void>;
    collapseGroup: (groupId: number, collapsed: boolean) => Promise<void>;
}

export function useBrowserGroups(): UseBrowserGroupsReturn {
    const [groups, setGroups] = useState<BrowserGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchGroups = useCallback(async () => {
        try {
            const currentWindow = await chrome.windows.getCurrent();
            const chromeGroups = await chrome.tabGroups.query({ windowId: currentWindow.id });

            // Get first tab index for each group to determine visual order
            const groupsWithIndex = await Promise.all(
                chromeGroups.map(async (group) => {
                    const tabs = await chrome.tabs.query({ groupId: group.id });
                    const firstIndex = tabs.length > 0
                        ? Math.min(...tabs.map(t => t.index))
                        : Infinity;
                    return {
                        id: group.id,
                        title: group.title || '',
                        color: group.color as TabGroupColor,
                        collapsed: group.collapsed,
                        windowId: group.windowId,
                        _sortIndex: firstIndex,
                    };
                })
            );

            // Sort by tab index (matches tab bar order)
            groupsWithIndex.sort((a, b) => a._sortIndex - b._sortIndex);

            const mappedGroups: BrowserGroup[] = groupsWithIndex.map(({ _sortIndex, ...g }) => g);

            setGroups(mappedGroups);
            setError(null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshGroups = useCallback(async () => {
        setLoading(true);
        await fetchGroups();
    }, [fetchGroups]);

    const createGroup = useCallback(async (
        tabIds: number[],
        title?: string,
        color: TabGroupColor = 'blue'
    ): Promise<number | null> => {
        try {
            const groupId = await chrome.tabs.group({ tabIds });

            if (title || color) {
                await chrome.tabGroups.update(groupId, {
                    title: title || '',
                    color
                });
            }

            return groupId;
        } catch (err) {
            setError((err as Error).message);
            return null;
        }
    }, []);

    const updateGroup = useCallback(async (
        groupId: number,
        options: { title?: string; color?: TabGroupColor; collapsed?: boolean }
    ) => {
        try {
            await chrome.tabGroups.update(groupId, options);
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    const deleteGroup = useCallback(async (groupId: number) => {
        try {
            // Get all tabs in the group
            const tabs = await chrome.tabs.query({ groupId });
            const tabIds = tabs.map(tab => tab.id!).filter(id => id !== undefined);

            // Ungroup all tabs (this effectively "deletes" the group)
            if (tabIds.length > 0) {
                await chrome.tabs.ungroup(tabIds);
            }
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    const collapseGroup = useCallback(async (groupId: number, collapsed: boolean) => {
        try {
            await chrome.tabGroups.update(groupId, { collapsed });
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchGroups();
    }, [fetchGroups]);

    // Debounced fetch to handle rapid event bursts (e.g. moving multiple tabs)
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();
    const debouncedFetch = useCallback(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchGroups(), 150);
    }, [fetchGroups]);

    useEffect(() => {
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, []);

    // Listen for group changes
    useEffect(() => {
        chrome.tabGroups.onCreated.addListener(debouncedFetch);
        chrome.tabGroups.onRemoved.addListener(debouncedFetch);
        chrome.tabGroups.onUpdated.addListener(debouncedFetch);
        chrome.tabGroups.onMoved.addListener(debouncedFetch);

        // Also listen for tab moves (group reorder = tab moves)
        chrome.tabs.onMoved.addListener(debouncedFetch);

        return () => {
            chrome.tabGroups.onCreated.removeListener(debouncedFetch);
            chrome.tabGroups.onRemoved.removeListener(debouncedFetch);
            chrome.tabGroups.onUpdated.removeListener(debouncedFetch);
            chrome.tabGroups.onMoved.removeListener(debouncedFetch);
            chrome.tabs.onMoved.removeListener(debouncedFetch);
        };
    }, [debouncedFetch]);

    return {
        groups,
        loading,
        error,
        refreshGroups,
        createGroup,
        updateGroup,
        deleteGroup,
        collapseGroup
    };
}

// Helper to get CSS color for tab group
export function getGroupColor(color: TabGroupColor): string {
    const colors: Record<TabGroupColor, string> = {
        grey: '#5f6368',
        blue: '#1a73e8',
        red: '#d93025',
        yellow: '#f9ab00',
        green: '#188038',
        pink: '#e91e63',
        purple: '#a142f4',
        cyan: '#00acc1',
        orange: '#fa903e'
    };
    return colors[color] || colors.grey;
}
