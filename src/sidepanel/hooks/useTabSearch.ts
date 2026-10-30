import { useState, useMemo, useCallback } from 'react';
import type { BrowserTab } from './useBrowserTabs';
import type { BrowserGroup } from './useBrowserGroups';

interface UseTabSearchProps {
    tabs: BrowserTab[];
    groups: BrowserGroup[];
    groupedTabs: Map<number, BrowserTab[]>;
}

interface UseTabSearchReturn {
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    filteredPinnedTabs: BrowserTab[];
    filteredGroupedTabs: Map<number, BrowserTab[]>;
    filteredUngroupedTabs: BrowserTab[];
    filteredGroups: BrowserGroup[];
    hasResults: boolean;
}

export function useTabSearch({
    tabs,
    groups,
    groupedTabs
}: UseTabSearchProps): UseTabSearchReturn {
    const [searchQuery, setSearchQuery] = useState('');

    const normalizedQuery = searchQuery.toLowerCase().trim();

    const matchesSearch = useCallback((tab: BrowserTab, groupTitle?: string): boolean => {
        if (!normalizedQuery) return true;

        const titleMatch = tab.title.toLowerCase().includes(normalizedQuery);
        const urlMatch = tab.url.toLowerCase().includes(normalizedQuery);
        const groupMatch = groupTitle ? groupTitle.toLowerCase().includes(normalizedQuery) : false;

        return titleMatch || urlMatch || groupMatch;
    }, [normalizedQuery]);

    const filteredResults = useMemo(() => {
        const pinnedTabs = tabs.filter(t => t.pinned);
        const ungroupedTabs = tabs.filter(t => !t.pinned && t.groupId === -1);

        // Filter pinned tabs
        const filteredPinnedTabs = pinnedTabs.filter(tab => matchesSearch(tab));

        // Filter grouped tabs
        const filteredGroupedTabs = new Map<number, BrowserTab[]>();
        const filteredGroups: BrowserGroup[] = [];

        groups.forEach(group => {
            const groupTabs = groupedTabs.get(group.id) || [];
            const matchingTabs = groupTabs.filter(tab => matchesSearch(tab, group.title));

            // Include group if it has matching tabs OR if group title matches query
            const groupTitleMatches = normalizedQuery && group.title?.toLowerCase().includes(normalizedQuery);

            if (matchingTabs.length > 0 || groupTitleMatches) {
                // If group title matches, include all tabs
                filteredGroupedTabs.set(group.id, groupTitleMatches ? groupTabs : matchingTabs);
                filteredGroups.push(group);
            }
        });

        // Filter ungrouped tabs
        const filteredUngroupedTabs = ungroupedTabs.filter(tab => matchesSearch(tab));

        return {
            filteredPinnedTabs,
            filteredGroupedTabs,
            filteredUngroupedTabs,
            filteredGroups
        };
    }, [tabs, groups, groupedTabs, matchesSearch, normalizedQuery]);

    const hasResults = !normalizedQuery || (
        filteredResults.filteredPinnedTabs.length > 0 ||
        filteredResults.filteredGroupedTabs.size > 0 ||
        filteredResults.filteredUngroupedTabs.length > 0
    );

    return {
        searchQuery,
        setSearchQuery,
        ...filteredResults,
        hasResults
    };
}
