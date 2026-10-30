import { memo } from 'react';
import { Button } from './ui/button';
import { useTabSelectionContext } from '../contexts/TabSelectionContext';
import { useTabSelectionActions } from '../hooks/useTabSelectionActions';
import type { TabGroup } from '../types/models';
import { Copy, FolderPlus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
        {t('components.tabSelection.selected', { count: selectedCount })}
      </span>

      <div className="w-px h-6 bg-border" />

      <Button
        size="sm"
        variant="ghost"
        onClick={copySelectedTabLinks}
        title={t('components.tabSelection.copyLinks')}
        className="gap-1.5"
      >
        <Copy className="h-4 w-4" />
        {t('common.copy')}
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={createGroupFromSelectedTabs}
        title={t('flow.proposalModal.actions.createGroup')}
        className="gap-1.5"
      >
        <FolderPlus className="h-4 w-4" />
        {t('components.newGroupModal.defaultName')}
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 gap-1.5"
        onClick={deleteSelectedTabs}
        title={t('components.tabSelection.deleteSelected')}
      >
        <Trash2 className="h-4 w-4" />
        {t('common.delete')}
      </Button>

      <div className="w-px h-6 bg-border" />

      <Button
        size="sm"
        variant="ghost"
        onClick={clearSelection}
        title={t('components.tabSelection.clearSelection')}
        className="px-2"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
});
