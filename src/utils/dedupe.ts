import { normalizeUrl } from './normalize';
import type { TabItem, TabGroup, Settings } from '../types/models';

export function deduplicateTabs(tabs: TabItem[]): TabItem[] {
    const seen = new Set<string>();
    const result: TabItem[] = [];

    for (const tab of tabs) {
        const key = `${normalizeUrl(tab.url)}::${tab.title.trim().toLowerCase()}`;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(tab);
        }
    }

    return result;
}

export function filterDuplicatesBySettings(newTabs: TabItem[], existingGroups: TabGroup[], settings: Settings): TabItem[] {
    if (settings.duplicateHandling !== 'reject') {
        return newTabs; // Allow all duplicates
    }

    // Get all existing URLs from all groups
    const existingUrls = new Set<string>();
    for (const group of existingGroups) {
        for (const tab of group.tabs) {
            existingUrls.add(normalizeUrl(tab.url));
        }
    }

    // Filter out tabs that already exist
    return newTabs.filter(newTab => {
        const normalizedUrl = normalizeUrl(newTab.url);
        return !existingUrls.has(normalizedUrl);
    });
}
