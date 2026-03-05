import { useCallback } from 'react';
import { useTabSelectionContext } from '../contexts/TabSelectionContext';
import type { TabGroup, TabItem } from '../types/models';
import { Storage } from '../utils/storage';
import { ToastManager } from '../components/Toast';

interface UseTabSelectionActionsProps {
  groups: TabGroup[];
  setGroups: (groups: TabGroup[]) => void;
}

export function useTabSelectionActions({ groups, setGroups }: UseTabSelectionActionsProps) {
  const { getSelectedTabsArray, clearSelection, selectedCount } = useTabSelectionContext();

  const deleteSelectedTabs = useCallback(async () => {
    const selectedTabs = getSelectedTabsArray();
    if (selectedTabs.length === 0) return;

    try {
      // Group tabs by their groupId for efficient processing
      const tabsByGroup = new Map<string, string[]>();
      selectedTabs.forEach(({ tab, groupId }) => {
        if (!tabsByGroup.has(groupId)) {
          tabsByGroup.set(groupId, []);
        }
        tabsByGroup.get(groupId)!.push(tab.id);
      });

      // Check for locked groups
      const lockedGroupIds = Array.from(tabsByGroup.keys()).filter(
        (groupId) => groups.find((g) => g.id === groupId)?.locked
      );

      if (lockedGroupIds.length > 0) {
        ToastManager.getInstance().warning('Cannot delete tabs from locked groups');
        return;
      }

      // Remove tabs from groups
      const updatedGroups = groups
        .map((group) => {
          const tabIdsToRemove = tabsByGroup.get(group.id);
          if (!tabIdsToRemove) return group;

          return {
            ...group,
            tabs: group.tabs.filter((t) => !tabIdsToRemove.includes(t.id)),
            modified: Date.now(),
          };
        })
        .filter((group) => group.tabs.length > 0);

      await Storage.set('groups', updatedGroups);
      setGroups(updatedGroups);

      ToastManager.getInstance().success(
        `Deleted ${selectedTabs.length} tab${selectedTabs.length > 1 ? 's' : ''}`
      );
      clearSelection();
    } catch (error) {
      ToastManager.getInstance().error('Failed to delete tabs: ' + (error as Error).message);
    }
  }, [groups, setGroups, getSelectedTabsArray, clearSelection]);

  const moveSelectedTabsToGroup = useCallback(
    async (targetGroupId: string) => {
      const selectedTabs = getSelectedTabsArray();
      if (selectedTabs.length === 0) return;

      const targetGroup = groups.find((g) => g.id === targetGroupId);
      if (!targetGroup || targetGroup.locked) {
        ToastManager.getInstance().warning('Cannot move tabs to this group');
        return;
      }

      try {
        const tabsToMove: TabItem[] = [];
        const sourceGroupIds = new Set<string>();

        selectedTabs.forEach(({ tab, groupId }) => {
          const sourceGroup = groups.find((g) => g.id === groupId);
          if (sourceGroup?.locked || groupId === targetGroupId) return;

          tabsToMove.push({ ...tab, groupId: targetGroupId });
          sourceGroupIds.add(groupId);
        });

        if (tabsToMove.length === 0) {
          ToastManager.getInstance().info('No tabs to move');
          return;
        }

        const selectedTabIds = new Set(selectedTabs.map((s) => s.tab.id));

        const updatedGroups = groups
          .map((group) => {
            if (group.id === targetGroupId) {
              return {
                ...group,
                tabs: [...group.tabs, ...tabsToMove],
                modified: Date.now(),
              };
            } else if (sourceGroupIds.has(group.id)) {
              return {
                ...group,
                tabs: group.tabs.filter((t) => !selectedTabIds.has(t.id)),
                modified: Date.now(),
              };
            }
            return group;
          })
          .filter((group) => group.tabs.length > 0);

        await Storage.set('groups', updatedGroups);
        setGroups(updatedGroups);

        ToastManager.getInstance().success(
          `Moved ${tabsToMove.length} tab${tabsToMove.length > 1 ? 's' : ''} to "${targetGroup.name}"`
        );
        clearSelection();
      } catch (error) {
        ToastManager.getInstance().error('Failed to move tabs: ' + (error as Error).message);
      }
    },
    [groups, setGroups, getSelectedTabsArray, clearSelection]
  );

  const copySelectedTabLinks = useCallback(() => {
    const selectedTabs = getSelectedTabsArray();
    if (selectedTabs.length === 0) return;

    const links = selectedTabs.map(({ tab }) => tab.url).join('\n');
    navigator.clipboard.writeText(links);
    ToastManager.getInstance().success(
      `Copied ${selectedTabs.length} link${selectedTabs.length > 1 ? 's' : ''}`
    );
  }, [getSelectedTabsArray]);

  const createGroupFromSelectedTabs = useCallback(async () => {
    const selectedTabs = getSelectedTabsArray();
    if (selectedTabs.length === 0) return;

    try {
      const tabsToMove: TabItem[] = [];
      const sourceGroupIds = new Set<string>();
      const selectedTabIds = new Set(selectedTabs.map((s) => s.tab.id));

      selectedTabs.forEach(({ tab, groupId }) => {
        const sourceGroup = groups.find((g) => g.id === groupId);
        if (sourceGroup?.locked) return;

        tabsToMove.push(tab);
        sourceGroupIds.add(groupId);
      });

      if (tabsToMove.length === 0) {
        ToastManager.getInstance().warning('Cannot move tabs from locked groups');
        return;
      }

      const newGroupId = crypto.randomUUID();
      const newGroup: TabGroup = {
        id: newGroupId,
        name: `New Group (${tabsToMove.length} tabs)`,
        tabs: tabsToMove.map((t) => ({ ...t, groupId: newGroupId })),
        created: Date.now(),
        modified: Date.now(),
      };

      const updatedGroups = groups
        .map((group) => {
          if (sourceGroupIds.has(group.id)) {
            return {
              ...group,
              tabs: group.tabs.filter((t) => !selectedTabIds.has(t.id)),
              modified: Date.now(),
            };
          }
          return group;
        })
        .filter((group) => group.tabs.length > 0);

      await Storage.set('groups', [...updatedGroups, newGroup]);
      setGroups([...updatedGroups, newGroup]);

      ToastManager.getInstance().success(
        `Created new group with ${tabsToMove.length} tab${tabsToMove.length > 1 ? 's' : ''}`
      );
      clearSelection();
    } catch (error) {
      ToastManager.getInstance().error('Failed to create group: ' + (error as Error).message);
    }
  }, [groups, setGroups, getSelectedTabsArray, clearSelection]);

  return {
    deleteSelectedTabs,
    moveSelectedTabsToGroup,
    copySelectedTabLinks,
    createGroupFromSelectedTabs,
    selectedCount,
  };
}
