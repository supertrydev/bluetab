import { matchesSearch, normalizeForSearch, findSearchMatch } from '@/utils/search-text';
import { memo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Input } from './ui/input';
import PinButton from './PinButton';
import { TagManager } from '../utils/tags';
import { formatRelativeTime } from '../utils/format-time';
import { useTabSelection } from '../hooks/useTabSelection';
import { getHeavyListDisplayTabs, getHiddenTabCount } from './group-card-heavy-list';
import type { TabGroup, Tag, TabItem, Project } from '../types/models';
import { CopyLinkButton } from './CopyLinkButton';
import { getSearchVisibleTabs } from '@/utils/group-search';
import { ProjectBadge, projectTint } from './ProjectBadge';
import { RestoreGroupButton } from './RestoreGroupButton';
import type { OfflineArticle, OfflineFailureRecord } from '../types/offline-reading';
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Folder,
  Calendar,
  Bell,
  BookmarkCheck,
  Loader2,
  AlertCircle,
} from 'lucide-react';

interface MasonryGroupCardProps {
  group: TabGroup;
  tags: Tag[];
  project?: Project;
  allProjects?: Project[];
  isPinned: boolean;
  isSelected: boolean;
  isDragOver: boolean;
  bulkMode: boolean;
  isCollapsed: boolean;
  editingId: string | null;
  editName: string;
  tabLayout?: 'list' | 'grid' | 'masonry' | 'dashboard';
  heavyTabPreview?: boolean;
  tabUrlDisplay?: 'full' | 'hostname';
  groupNotesDisplay?: 'full' | 'preview';
  onEditNotes?: () => void;
  // Group-level handlers
  onTogglePin: () => void;
  onToggleSelect: () => void;
  onToggleCollapse: () => void;
  onOpenTab: (url: string, tabId: string) => void;
  onCopyLink: (url: string) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onTabDragStart: (e: React.DragEvent, tab: TabItem) => void;
  onTabDragEnd: (e: React.DragEvent) => void;
  menuContent: React.ReactNode;
  onRestoreGroup: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditNameChange: (value: string) => void;
  onAssignToProject?: (projectId: string | undefined) => void;
  searchQuery?: string;
  hasReminder?: boolean;
  offlineArticles?: Map<string, OfflineArticle>;
  offlineInFlight?: Set<string>;
  offlineFailures?: Map<string, OfflineFailureRecord>;
  onRetryOffline?: (articleId: string) => void;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const match = findSearchMatch(text, query);
  if (!match) return text;
  return (
    <>
      {text.slice(0, match.start)}
      <mark className="bg-mark text-mark-foreground rounded-xs px-0.5">{text.slice(match.start, match.end)}</mark>
      {text.slice(match.end)}
    </>
  );
}

export const MasonryGroupCard = memo(function MasonryGroupCard({
  group,
  tags,
  project,
  isPinned,
  isSelected,
  isDragOver,
  bulkMode,
  isCollapsed,
  editingId,
  editName,
  tabLayout = 'list',
  heavyTabPreview = false,
  tabUrlDisplay,
  groupNotesDisplay,
  onEditNotes,
  onTogglePin,
  onToggleSelect,
  onToggleCollapse,
  onOpenTab,
  onCopyLink,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onTabDragStart,
  onTabDragEnd,
  menuContent,
  onRestoreGroup,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditNameChange,
  searchQuery = '',
  hasReminder = false,
  offlineArticles,
  offlineInFlight,
  offlineFailures,
  onRetryOffline,
}: MasonryGroupCardProps) {
  const { t } = useTranslation();
  // Use context for tab selection - no more prop drilling!
  const {
    isTabSelected,
    state: { isSelectionMode, isDragging },
    handleTabClick,
  } = useTabSelection();

  const [isHovered, setIsHovered] = useState(false);

  // Search: filter tabs and highlight helper
  const q = normalizeForSearch(searchQuery);
  const displayTabs = getSearchVisibleTabs(group, q);
  const noteMatches = q !== '' && matchesSearch(group.notes ?? '', q);
  const shouldPreviewTabs = heavyTabPreview && tabLayout === 'grid' && !q;
  const visibleTabs = getHeavyListDisplayTabs(displayTabs, {
    enabled: shouldPreviewTabs,
    isHovered,
  });
  const hiddenTabCount = getHiddenTabCount(displayTabs.length, visibleTabs.length);

  const onTabClick = useCallback(
    (e: React.MouseEvent, tab: TabItem) => {
      e.stopPropagation();
      if (group.locked) return;

      // Let the hook handle Ctrl+click and selection mode
      const handled = handleTabClick(tab, group.id, e);

      // If not handled as selection, open the tab
      if (!handled) {
        onOpenTab(tab.url, tab.id);
      }
    },
    [group.id, group.locked, handleTabClick, onOpenTab]
  );

  const groupTags = group.tags?.length ? TagManager.getTagsByIds(group.tags, tags) : [];

  return (
    <div
      data-group-card
      className={`
        bt-group-row
        ${project ? 'project-tint' : ''}
        relative bg-bg-1 rounded-lg border border-border
        transition-all duration-200 mb-4 w-full mx-auto group
        ${tabLayout === 'list' ? 'sm:!w-auto sm:min-w-[450px] sm:max-w-[600px]' : ''}
        ${tabLayout === 'masonry' ? '!w-full max-w-[600px]' : ''}
        ${tabLayout === 'dashboard' ? 'h-full flex flex-col' : ''}
        ${isHovered ? 'shadow-lg border-primary/40' : 'shadow-sm'}
        ${isSelected ? 'ring-2 ring-primary' : ''}
        ${isDragOver ? 'ring-2 ring-success bg-success-muted' : ''}
        ${isPinned ? 'group-pinned' : ''}
        ${bulkMode ? 'cursor-pointer' : ''}
      `}
      style={projectTint(project)}
      onClick={bulkMode ? onToggleSelect : undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {project && (
        <ProjectBadge project={project}><bdi dir="auto">{project.name}</bdi></ProjectBadge>
      )}

      {/* Header */}
      <div className="p-4 relative">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {bulkMode && (
              <label className="custom-checkbox-container flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={isSelected} onChange={onToggleSelect} className="h-4 w-4 cursor-pointer accent-primary" aria-label={group.name} />
                <div className="custom-checkbox-button"></div>
              </label>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse();
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-accent hover:text-text-strong transition-colors"
              aria-expanded={!isCollapsed}
            >
              {isCollapsed
                ? <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
                : <ChevronDown className="w-3.5 h-3.5" />
              }
            </button>

            {editingId === group.id ? (
              <div className="flex-1 flex items-center gap-2">
                <Input
                  type="text"
                  dir="auto"
                  value={editName}
                  onChange={(e) => onEditNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      onSaveEdit();
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      onCancelEdit();
                    }
                  }}
                  placeholder={t('components.newGroupModal.namePlaceholder')}
                  autoFocus
                  className="h-8 flex-1 text-sm"
                  onClick={(e) => e.stopPropagation()}
                />
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSaveEdit();
                  }}
                  size="sm"
                >
                  {t('common.save')}
                </Button>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelEdit();
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {t('common.cancel')}
                </Button>
              </div>
            ) : (
              <h3
                className="font-semibold text-text-strong truncate flex-1 min-h-8 cursor-pointer hover:text-primary transition-colors flex items-center gap-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!group.locked) {
                    onStartEdit();
                  }
                }}
                title={group.locked ? t('components.masonry.lockedRename') : t('components.masonry.clickRename')}
              >
                <span className="truncate"><bdi dir="auto">{highlightMatch(group.name, searchQuery)}</bdi></span>
                {group.locked && (
                  <Lock className="w-3 h-3 text-warning shrink-0" aria-label={t('sidepanel.aiUpgradePrompt.locked')} />
                )}
                {hasReminder && (
                  <Bell className="w-3 h-3 text-warning shrink-0" aria-label={t('components.masonry.hasReminder')} />
                )}
              </h3>
            )}
          </div>

          {editingId !== group.id && (
            <div className="flex items-center gap-1 flex-shrink-0 bt-aggressive-hide">
              <div onClick={(e) => e.stopPropagation()}>
                <PinButton
                  groupId={group.id}
                  isPinned={isPinned}
                  onToggle={() => onTogglePin()}
                  size="small"
                />
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                {menuContent}
              </div>
              <RestoreGroupButton locked={group.locked} onRestore={onRestoreGroup} />
            </div>
          )}
        </div>

        {editingId !== group.id && (
          <>
            {/* Decorative metadata row — tab count + timestamp. Hidden under
                Default Simplify; hover-revealed under Aggressive. */}
            <div className="flex items-center gap-4 ps-[34px] text-xs text-text-muted flex-wrap bt-decor bt-aggressive-hide">
              <div className="flex items-center gap-1">
                <Folder className="w-3 h-3" />
                <span>
                  {q && displayTabs.length !== group.tabs.length
                    ? `${displayTabs.length}/${t('common.tabsCount', { count: group.tabs.length })}`
                    : t('common.tabsCount', { count: group.tabs.length })}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                    <span dir="ltr">{formatRelativeTime(group.created)}</span>
              </div>
            </div>

            {/* Tags — decorative metadata. Hidden under Default Simplify,
                hover-revealed under Aggressive. */}
            {groupTags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 bt-decor bt-aggressive-hide">
                {groupTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-text-strong"
                    style={{ backgroundColor: `color-mix(in srgb, ${tag.color} 25%, var(--chip-base, transparent))` }}
                  >
                    <span className="truncate"><bdi dir="auto">{tag.name}</bdi></span>
                  </span>
                ))}
              </div>
            )}

            {/* Notes */}
            {group.notes && (
              <p
                className={`text-sm text-text-muted mt-3 cursor-pointer hover:text-text-strong transition-colors break-words ${
                  (groupNotesDisplay ?? 'preview') === 'preview' && !noteMatches ? 'line-clamp-1' : 'whitespace-pre-wrap'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditNotes?.();
                }}
                title={t('components.masonry.editNotes')}
              >
                    <bdi dir="auto">{highlightMatch(group.notes, searchQuery)}</bdi>
              </p>
            )}
          </>
        )}
      </div>

      {/* Tabs List */}
      {!isCollapsed && (
        <div className="border-t border-border p-2">
          <div
            className={
              tabLayout === 'grid'
                ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1'
                : 'space-y-0.5 max-h-96 overflow-y-auto scrollbar-transparent'
            }
          >
            {visibleTabs.map((tab) => {
              const tabSelected = isTabSelected(tab.id);
              const isBeingDragged = isDragging && tabSelected;

              return (
                <div
                  key={tab.id}
                  data-tab-selectable
                  draggable={!group.locked}
                  onDragStart={(e) => !group.locked && onTabDragStart(e, tab)}
                  onDragEnd={onTabDragEnd}
                  onClick={(e) => onTabClick(e, tab)}
                  className={`
                    group/tab flex min-h-10 items-center gap-3 rounded-sm px-2.5 py-2
                    transition-all duration-200 select-none
                    ${tabSelected ? 'bg-primary-muted' : ''}
                    ${group.locked ? 'opacity-85 cursor-not-allowed' : `cursor-pointer ${tabSelected ? '' : 'hover:bg-accent'}`}
                    ${isBeingDragged ? 'opacity-50 scale-95 ring-2 ring-primary ring-offset-1 ring-offset-bg-1' : ''}
                  `}
                >
                  {/* Selection checkbox - show when in selection mode or tab is selected */}
                  {(isSelectionMode || tabSelected) && (
                    <label
                      data-selection-checkbox
                      className="flex-shrink-0 cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={tabSelected}
                        onChange={() =>
                          handleTabClick(tab, group.id, { ctrlKey: true } as React.MouseEvent)
                        }
                        className="w-4 h-4 cursor-pointer accent-primary"
                      />
                    </label>
                  )}
                  <img
                    src={
                      tab.favicon ||
                      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="gray"><circle cx="12" cy="12" r="10"/></svg>'
                    }
                    alt=""
                    width={20}
                    height={20}
                    className="w-5 h-5 rounded-xs flex-shrink-0"
                    onError={(e) => {
                      e.currentTarget.src =
                        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="gray"><circle cx="12" cy="12" r="10"/></svg>';
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-strong truncate flex items-center gap-1.5">
                          <bdi dir="auto">{highlightMatch(tab.title, searchQuery)}</bdi>
                      {/* Offline indicator */}
                      {(() => {
                        const offlineId = `${group.id}::${tab.id}`;
                        if (offlineInFlight?.has(offlineId)) {
                          return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" aria-label={t('components.masonry.savingOffline')} />;
                        }
                        // Failure source is the transient failureMap, not IDB.
                        // Dismissing the banner clears the map → badge vanishes.
                        const failure = offlineFailures?.get(offlineId);
                        if (failure) {
                          return (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onRetryOffline?.(failure.id); }}
                              className="inline-flex items-center shrink-0"
                              aria-label={t('components.masonry.extractionRetry', { reason: t(`options.offlineReadingPage.failureBuckets.${failure.failureBucket}`) })}
                              title={t('components.masonry.extractionRetry', { reason: t(`options.offlineReadingPage.failureBuckets.${failure.failureBucket}`) })}
                            >
                              <AlertCircle className="h-3.5 w-3.5 text-warning" />
                            </button>
                          );
                        }
                        const art = offlineArticles?.get(offlineId);
                        if (art) {
                          return (
                            <BookmarkCheck
                              className="h-3.5 w-3.5 text-primary shrink-0"
                              aria-label={t('components.masonry.savedOffline')}
                            />
                          );
                        }
                        return null;
                      })()}
                    </p>
                    <p className="text-xs text-text-muted truncate">
                          <bdi dir="ltr">{(tabUrlDisplay ?? 'full') === 'full' ? tab.url : new URL(tab.url).hostname}</bdi>
                    </p>
                  </div>
                  {!group.locked && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <CopyLinkButton onCopy={() => onCopyLink(tab.url)} />
                    </div>
                  )}
                </div>
              );
            })}
            {hiddenTabCount > 0 && (
              <div
                data-heavy-tab-preview-more
                className="col-span-full rounded-sm bg-muted px-3 py-2 text-center text-xs text-text-muted"
              >
                {t('components.masonry.moreTabs', { count: hiddenTabCount })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
