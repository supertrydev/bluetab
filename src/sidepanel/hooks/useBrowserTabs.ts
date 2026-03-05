import { useState, useEffect, useCallback } from 'react';

export interface BrowserTab {
    id: number;
    title: string;
    url: string;
    favIconUrl?: string;
    groupId: number; // -1 = ungrouped
    pinned: boolean;
    discarded: boolean;
    active: boolean;
    windowId: number;
    index: number;
}

interface UseBrowserTabsReturn {
    tabs: BrowserTab[];
    pinnedTabs: BrowserTab[];
    groupedTabs: Map<number, BrowserTab[]>;
    ungroupedTabs: BrowserTab[];
    loading: boolean;
    error: string | null;
    refreshTabs: () => Promise<void>;
    closeTab: (tabId: number) => Promise<void>;
    activateTab: (tabId: number) => Promise<void>;
    moveTabToGroup: (tabId: number, groupId: number) => Promise<void>;
    ungroupTab: (tabId: number) => Promise<void>;
}

export function useBrowserTabs(): UseBrowserTabsReturn {
    const [tabs, setTabs] = useState<BrowserTab[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchTabs = useCallback(async () => {
        try {
            const chromeTabs = await chrome.tabs.query({ currentWindow: true });

            const mappedTabs: BrowserTab[] = chromeTabs.map(tab => ({
                id: tab.id!,
                title: tab.title || 'Untitled',
                url: tab.url || '',
                favIconUrl: tab.favIconUrl,
                groupId: tab.groupId ?? -1,
                pinned: tab.pinned || false,
                discarded: tab.discarded || tab.status === 'unloaded' || false,
                active: tab.active || false,
                windowId: tab.windowId!,
                index: tab.index
            }));

            // Sort by index to maintain tab order
            mappedTabs.sort((a, b) => a.index - b.index);

            setTabs(mappedTabs);
            setError(null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshTabs = useCallback(async () => {
        setLoading(true);
        await fetchTabs();
    }, [fetchTabs]);

    const closeTab = useCallback(async (tabId: number) => {
        try {
            await chrome.tabs.remove(tabId);
            // Tab will be removed via event listener
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    const activateTab = useCallback(async (tabId: number) => {
        try {
            await chrome.tabs.update(tabId, { active: true });
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    const moveTabToGroup = useCallback(async (tabId: number, groupId: number) => {
        try {
            await chrome.tabs.group({ tabIds: [tabId], groupId });
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    const ungroupTab = useCallback(async (tabId: number) => {
        try {
            await chrome.tabs.ungroup([tabId]);
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchTabs();
    }, [fetchTabs]);

    // Listen for tab changes
    useEffect(() => {
        const handleChange = () => fetchTabs();

        chrome.tabs.onCreated.addListener(handleChange);
        chrome.tabs.onRemoved.addListener(handleChange);
        chrome.tabs.onUpdated.addListener(handleChange);
        chrome.tabs.onMoved.addListener(handleChange);
        chrome.tabs.onAttached.addListener(handleChange);
        chrome.tabs.onDetached.addListener(handleChange);
        chrome.tabs.onActivated.addListener(handleChange);

        return () => {
            chrome.tabs.onCreated.removeListener(handleChange);
            chrome.tabs.onRemoved.removeListener(handleChange);
            chrome.tabs.onUpdated.removeListener(handleChange);
            chrome.tabs.onMoved.removeListener(handleChange);
            chrome.tabs.onAttached.removeListener(handleChange);
            chrome.tabs.onDetached.removeListener(handleChange);
            chrome.tabs.onActivated.removeListener(handleChange);
        };
    }, [fetchTabs]);

    // Computed values
    const pinnedTabs = tabs.filter(tab => tab.pinned);
    const unpinnedTabs = tabs.filter(tab => !tab.pinned);

    const groupedTabs = new Map<number, BrowserTab[]>();
    const ungroupedTabs: BrowserTab[] = [];

    unpinnedTabs.forEach(tab => {
        if (tab.groupId === -1) {
            ungroupedTabs.push(tab);
        } else {
            const existing = groupedTabs.get(tab.groupId) || [];
            existing.push(tab);
            groupedTabs.set(tab.groupId, existing);
        }
    });

    return {
        tabs,
        pinnedTabs,
        groupedTabs,
        ungroupedTabs,
        loading,
        error,
        refreshTabs,
        closeTab,
        activateTab,
        moveTabToGroup,
        ungroupTab
    };
}
