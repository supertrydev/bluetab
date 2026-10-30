export const HEAVY_GROUP_TAB_PREVIEW_LIMIT = 3;

interface HeavyListDisplayOptions {
  enabled: boolean;
  isHovered: boolean;
  limit?: number;
}

export function getHeavyListDisplayTabs<T>(
  tabs: T[],
  {
    enabled,
    isHovered,
    limit = HEAVY_GROUP_TAB_PREVIEW_LIMIT,
  }: HeavyListDisplayOptions,
): T[] {
  if (!enabled || isHovered || tabs.length <= limit) return tabs;
  return tabs.slice(0, limit);
}

export function getHiddenTabCount(totalTabs: number, visibleTabs: number): number {
  return Math.max(0, totalTabs - visibleTabs);
}
