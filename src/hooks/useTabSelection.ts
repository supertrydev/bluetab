import { useCallback } from 'react';
import { useTabSelectionContext } from '../contexts/TabSelectionContext';
import type { TabItem } from '../types/models';

export function useTabSelection() {
  const context = useTabSelectionContext();

  // Handle tab click with modifier key support
  const handleTabClick = useCallback(
    (tab: TabItem, groupId: string, event: React.MouseEvent) => {
      const { isSelectionMode } = context.state;

      // Ctrl/Cmd+Click or already in selection mode -> toggle selection
      if (event.ctrlKey || event.metaKey || isSelectionMode) {
        context.toggleTab(tab, groupId);
        return true; // Indicate selection was handled
      }

      return false; // Indicate normal click should proceed
    },
    [context]
  );

  return {
    ...context,
    handleTabClick,
  };
}
