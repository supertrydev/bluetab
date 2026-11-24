import { getSearchVisibleTabs } from '@/utils/group-search';
import type { TabGroup } from '@/types/models';

export type OptionsGroupLayoutMode = 'grid' | 'masonry' | 'dashboard';

export const HEAVY_GROUP_VISIBLE_TAB_THRESHOLD = 200;

interface HeavyGroupCardOptions {
  layoutMode: OptionsGroupLayoutMode;
  visibleTabRows: number;
}

interface CountVisibleRowsOptions {
  collapsedGroups: Map<string, boolean>;
  search: string;
}

export function shouldUseHeavyGroupCards({
  layoutMode,
  visibleTabRows,
}: HeavyGroupCardOptions): boolean {
  return layoutMode === 'grid'
    && visibleTabRows >= HEAVY_GROUP_VISIBLE_TAB_THRESHOLD;
}

export function shouldUseSequentialMasonry({
  layoutMode,
  visibleTabRows,
}: HeavyGroupCardOptions): boolean {
  return layoutMode === 'masonry'
    && visibleTabRows >= HEAVY_GROUP_VISIBLE_TAB_THRESHOLD;
}

export function countVisibleTabRowsForGroupList(
  groups: TabGroup[],
  { collapsedGroups, search }: CountVisibleRowsOptions,
): number {
  return groups.reduce((total, group) => {
    if (collapsedGroups.get(group.id)) return total;
    return total + getSearchVisibleTabs(group, search).length;
  }, 0);
}
