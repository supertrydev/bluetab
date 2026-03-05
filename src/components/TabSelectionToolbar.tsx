import { memo } from 'react';
import { Button } from './ui/button';
import { useTabSelectionContext } from '../contexts/TabSelectionContext';
import { useTabSelectionActions } from '../hooks/useTabSelectionActions';
import type { TabGroup } from '../types/models';
import { Copy, FolderPlus, Trash2, X } from 'lucide-react';

interface TabSelectionToolbarProps {
  groups: TabGroup[];
  setGroups: (groups: TabGroup[]) => void;
  isDraggingTabs?: boolean;
}

export const TabSelectionToolbar = memo(function TabSelectionToolbar({
  groups,
  setGroups,
  isDraggingTabs = false,
}: TabSelectionToolbarProps) {
  const {
    state: { isSelectionMode },
    selectedCount,
    clearSelection,
  } = useTabSelectionContext();

  const { deleteSelectedTabs, copySelectedTabLinks, createGroupFromSelectedTabs } =
    useTabSelectionActions({ groups, setGroups });

  // Don't show when dragging (drag toolbar takes over) or no selection
  if (!isSelectionMode || selectedCount === 0 || isDraggingTabs) return null;

  return (
    <div
      data-selection-toolbar
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                 bg-bg-1 border border-border rounded-xl shadow-2xl
                 px-4 py-3 flex items-center gap-3"
    >
      <span className="text-sm font-medium text-text-strong">
        {selectedCount} tab{selectedCount > 1 ? 's' : ''} selected
      </span>

      <div className="w-px h-6 bg-border" />

      <Button
        size="sm"
        variant="ghost"
        onClick={copySelectedTabLinks}
        title="Copy links"
        className="gap-1.5"
      >
        <Copy className="h-4 w-4" />
        Copy
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={createGroupFromSelectedTabs}
        title="Create new group"
        className="gap-1.5"
      >
        <FolderPlus className="h-4 w-4" />
        New Group
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 gap-1.5"
        onClick={deleteSelectedTabs}
        title="Delete selected"
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </Button>

      <div className="w-px h-6 bg-border" />

      <Button
        size="sm"
        variant="ghost"
        onClick={clearSelection}
        title="Clear selection (ESC)"
        className="px-2"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
});
