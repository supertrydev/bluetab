/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useTabSearch } from './useTabSearch';
import type { BrowserTab } from './useBrowserTabs';

it('sidepanel searches pinned, ungrouped and grouped tabs with the same normalisation', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const tabs = [
    { id: 1, title: 'Café', url: 'https://one.test', pinned: true, groupId: -1 },
    { id: 2, title: 'العَرَبِيَّة', url: 'https://two.test', pinned: false, groupId: -1 },
    { id: 3, title: 'Other', url: 'https://three.test/\u0131\u015f\u0131k', pinned: false, groupId: 7 },
  ] as BrowserTab[];
  let result!: ReturnType<typeof useTabSearch>;
  function Harness() {
    result = useTabSearch({ tabs, groups: [{ id: 7, title: '\u0130stanbul', color: 'blue', collapsed: false, windowId: 1 }], groupedTabs: new Map([[7, [tabs[2]]]]) });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    act(() => root.render(<Harness />));
    act(() => result.setSearchQuery('cafe'));
    expect(result.filteredPinnedTabs.map(t => t.id)).toEqual([1]);
    act(() => result.setSearchQuery('العربية'));
    expect(result.filteredUngroupedTabs.map(t => t.id)).toEqual([2]);
    for (const query of ['istanbul', 'isik']) {
      act(() => result.setSearchQuery(query));
      expect(result.filteredGroupedTabs.get(7)?.map(t => t.id)).toEqual([3]);
    }
    act(() => result.setSearchQuery('missing'));
    expect(result.hasResults).toBe(false);
    act(() => result.setSearchQuery('  '));
    expect(result.filteredPinnedTabs).toHaveLength(1);
    expect(result.filteredUngroupedTabs).toHaveLength(1);
    expect(result.filteredGroups).toHaveLength(1);
  } finally { act(() => root.unmount()); }
});
