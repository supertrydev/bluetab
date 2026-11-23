import { matchesSearch, normalizeForSearch } from '@/utils/search-text';
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

    const normalizedQuery = normalizeForSearch(searchQuery);

    const matchesTab = useCallback((tab: BrowserTab, groupTitle?: string): boolean => {
        if (!normalizedQuery) return true;

        const titleMatch = matchesSearch(tab.title, normalizedQuery);
        const urlMatch = matchesSearch(tab.url, normalizedQuery);
        const groupMatch = groupTitle ? matchesSearch(groupTitle, normalizedQuery) : false;

        return titleMatch || urlMatch || groupMatch;
    }, [normalizedQuery]);

    const filteredResults = useMemo(() => {
        const pinnedTabs = tabs.filter(t => t.pinned);
        const ungroupedTabs = tabs.filter(t => !t.pinned && t.groupId === -1);

        // Filter pinned tabs
        const filteredPinnedTabs = pinnedTabs.filter(tab => matchesTab(tab));

        // Filter grouped tabs
        const filteredGroupedTabs = new Map<number, BrowserTab[]>();
        const filteredGroups: BrowserGroup[] = [];

        groups.forEach(group => {
            const groupTabs = groupedTabs.get(group.id) || [];
            const matchingTabs = groupTabs.filter(tab => matchesTab(tab, group.title));

            // Include group if it has matching tabs OR if group title matches query
            const groupTitleMatches = normalizedQuery && matchesSearch(group.title ?? '', normalizedQuery);

            if (matchingTabs.length > 0 || groupTitleMatches) {
                // If group title matches, include all tabs
                filteredGroupedTabs.set(group.id, groupTitleMatches ? groupTabs : matchingTabs);
                filteredGroups.push(group);
            }
        });

        // Filter ungrouped tabs
        const filteredUngroupedTabs = ungroupedTabs.filter(tab => matchesTab(tab));

        return {
            filteredPinnedTabs,
            filteredGroupedTabs,
            filteredUngroupedTabs,
            filteredGroups
        };
    }, [tabs, groups, groupedTabs, matchesTab, normalizedQuery]);

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
