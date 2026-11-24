import { matchesSearch, normalizeForSearch } from './search-text';
import type { TabGroup, TabItem, Tag } from '@/types/models';

const tabMatches = (tab: TabItem, query: string) =>
  matchesSearch(tab.title, query) || matchesSearch(tab.url, query);

/** Name, note, tabs and tags: what a search in saved groups looks at. */
export function groupMatchesSearch(group: TabGroup, tags: Tag[], search: string): boolean {
  const query = normalizeForSearch(search);
  if (!query) return true;
  return matchesSearch(group.name, query)
    || matchesSearch(group.notes ?? '', query)
    || group.tabs.some((tab) => tabMatches(tab, query))
    || (group.tags ?? []).some((id) => {
      const tag = tags.find((item) => item.id === id);
      return tag !== undefined && matchesSearch(tag.name, query);
    });
}

/** The tabs to list during a search; all of them when the group itself is what matched. */
export function getSearchVisibleTabs(group: TabGroup, search: string): TabItem[] {
  const query = normalizeForSearch(search);
  if (!query || matchesSearch(group.name, query)) return group.tabs;
  const matching = group.tabs.filter((tab) => tabMatches(tab, query));
  return matching.length > 0 ? matching : group.tabs;
}
