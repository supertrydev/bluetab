import { memo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Input } from './ui/input';
import PinButton from './PinButton';
import { TagManager } from '../utils/tags';
import { formatRelativeTime } from '../utils/format-time';
import { useTabSelection } from '../hooks/useTabSelection';
import { getHeavyListDisplayTabs, getHiddenTabCount } from './group-card-heavy-list';
import { isolateBidi } from '@/i18n/bidi';
import type { TabGroup, Tag, TabItem, Project } from '../types/models';
import { PROJECT_COLORS } from '../types/models';
import { PROJECT_ICONS, getProjectBackgroundColor } from './ProjectModal';
import type { OfflineArticle, OfflineFailureRecord } from '../types/offline-reading';
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Pin,
  ExternalLink,
  Folder,
  Calendar,
  Copy,
  Check,
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
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200/60 dark:bg-yellow-500/30 rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
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
  const [copiedTabId, setCopiedTabId] = useState<string | null>(null);

  // Search: filter tabs and highlight helper
  const q = searchQuery.trim().toLowerCase();
  const groupNameMatches = q && group.name.toLowerCase().includes(q);
  const displayTabs = q && !groupNameMatches
    ? group.tabs.filter(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q))
    : group.tabs;
  const shouldPreviewTabs = heavyTabPreview && tabLayout === 'grid' && !q;
  const visibleTabs = getHeavyListDisplayTabs(displayTabs, {
    enabled: shouldPreviewTabs,
    isHovered,
  });
  const hiddenTabCount = getHiddenTabCount(displayTabs.length, visibleTabs.length);

  const handleCopyWithAnimation = (tabUrl: string, tabId: string) => {
    onCopyLink(tabUrl);
    setCopiedTabId(tabId);
    setTimeout(() => setCopiedTabId(null), 1500);
  };

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

  // Get project badge - positioned on left edge top of card.
  // Decorative label (metadata) — hidden under Default Simplify and
  // hover-revealed under Aggressive on the Options-shell group row.
  const ProjectBadge = project ? (
    <div
      className="bt-decor bt-aggressive-hide absolute -start-3 -top-[10px] flex items-center gap-1.5 px-2 py-1 rounded-full shadow-md z-10 bg-background border border-border"
      style={{
        color: PROJECT_COLORS[project.color],
      }}
      title={`${t('components.groupInfo.project')}: ${isolateBidi(project.name)}`}
    >
      {(() => {
        const Icon = PROJECT_ICONS[project.icon];
        return <Icon className="w-3.5 h-3.5" />;
      })()}
      <span className="text-xs font-medium max-w-[80px] truncate"><bdi dir="auto">{project.name}</bdi></span>
    </div>
  ) : null;

  return (
    <div
      data-group-card
      className={`
        bt-group-row
        relative bg-bg-1 rounded-xl border border-border
        transition-all duration-200 mb-4 sm:p-[10px] w-full mx-auto group
        ${tabLayout === 'list' ? 'sm:!w-auto sm:min-w-[450px] sm:max-w-[600px]' : ''}
        ${tabLayout === 'masonry' ? '!w-full max-w-[600px]' : ''}
        ${tabLayout === 'dashboard' ? 'h-full flex flex-col' : ''}
        ${isHovered ? 'shadow-lg border-blue-300 dark:shadow-[10px_10px_10px_-10px_rgba(45,49,57,0.5)]' : 'shadow-sm'}
        ${isSelected ? 'ring-2 ring-blue-500 dark:ring-blue-400' : ''}
        ${isDragOver ? 'ring-2 ring-green-500 dark:ring-green-400 bg-green-50 dark:bg-green-900/20' : ''}
        ${isPinned ? 'group-pinned' : ''}
        ${bulkMode ? 'cursor-pointer' : ''}
      `}
      style={project ? { backgroundColor: getProjectBackgroundColor(project.color, 0.1) } : undefined}
      onClick={bulkMode ? onToggleSelect : undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Project Badge - left edge center */}
      {ProjectBadge}

      {/* Header */}
      <div className={`p-4 relative ${group.notes ? 'border-b' : ''}`} style={{ borderBottomColor: 'var(--tab-border-color)' }}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
            {bulkMode && (
              <label className="custom-checkbox-container" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={isSelected} onChange={onToggleSelect} />
                <div className="custom-checkbox-button"></div>
              </label>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse();
              }}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {isCollapsed
                ? <ChevronRight className="w-3 h-3 text-gray-500 dark:text-gray-400 rtl:rotate-180" />
                : <ChevronDown className="w-3 h-3 text-gray-500 dark:text-gray-400" />
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
                  className="flex-1 text-sm focus-visible:ring-0 focus:ring-0 focus-visible:border-blue-500 dark:focus-visible:border-blue-400 border-gray-300 dark:border-gray-600"
                  onClick={(e) => e.stopPropagation()}
                />
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSaveEdit();
                  }}
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
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
                className="font-semibold text-gray-900 dark:text-gray-100 truncate flex-1 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!group.locked) {
                    onStartEdit();
                  }
                }}
                title={group.locked ? t('components.masonry.lockedRename') : t('components.masonry.clickRename')}
              >
                {isPinned && <Pin className="w-3.5 h-3.5 text-muted-foreground shrink-0 rotate-45" />}
                <span className="truncate"><bdi dir="auto">{highlightMatch(group.name, searchQuery)}</bdi></span>
                {group.locked && (
                  <Lock className="w-3 h-3 text-yellow-500 shrink-0" aria-label={t('sidepanel.aiUpgradePrompt.locked')} />
                )}
                {hasReminder && (
                  <Bell className="w-3 h-3 text-amber-500 shrink-0" aria-label={t('components.masonry.hasReminder')} />
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
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!group.locked) {
                    onRestoreGroup();
                  }
                }}
                disabled={group.locked}
                size="sm"
                className={`whitespace-nowrap text-xs ${
                  group.locked
                    ? 'bg-gray-400 dark:bg-gray-600 text-gray-200 dark:text-gray-400 cursor-not-allowed opacity-50'
                    : 'bg-transparent border border-green-500 text-green-500 hover:bg-green-500/10'
                }`}
                title={group.locked ? t('components.masonry.unlockRestore') : t('components.masonry.restoreTabs')}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
              <div onClick={(e) => e.stopPropagation()}>
                {menuContent}
              </div>
            </div>
          )}
        </div>

        {editingId !== group.id && (
          <>
            {/* Decorative metadata row — tab count + timestamp. Hidden under
                Default Simplify; hover-revealed under Aggressive. */}
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-2 flex-wrap bt-decor bt-aggressive-hide">
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
            {group.tags && group.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 bt-decor bt-aggressive-hide">
                {TagManager.getTagsByIds(group.tags, tags).map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium"
                    style={{
                      backgroundColor: `${tag.color}33`,
                      color: tag.color,
                    }}
                  >
                    <bdi dir="auto">{tag.name}</bdi>
                  </span>
                ))}
              </div>
            )}

            {/* Notes */}
            {group.notes && (
              <p
                className={`text-xs text-gray-500 dark:text-gray-400 mt-3 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 break-words ${
                  (groupNotesDisplay ?? 'preview') === 'preview' ? 'line-clamp-1' : 'whitespace-pre-wrap'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditNotes?.();
                }}
                title={t('components.masonry.editNotes')}
              >
                    <bdi dir="auto">{group.notes}</bdi>
              </p>
            )}
          </>
        )}
      </div>

      {/* Tabs List */}
      {!isCollapsed && (
        <div className={tabLayout === 'grid' ? 'p-4' : 'p-3'}>
          <div
            className={
              tabLayout === 'grid'
                ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'
                : 'space-y-2 max-h-96 overflow-y-auto scrollbar-transparent'
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
                    flex items-center gap-${tabLayout === 'grid' ? '3' : '2'} p-${tabLayout === 'grid' ? '3' : '2'} rounded-xl border
                    transition-all duration-200 select-none
                    ${tabSelected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-500' : ''}
                    ${group.locked ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-200/50 dark:hover:bg-gray-700/50 cursor-pointer'}
                    ${isBeingDragged ? 'opacity-50 scale-95 ring-2 ring-blue-400 ring-offset-1 rounded-xl' : ''}
                  `}
                  style={!tabSelected ? { borderColor: 'var(--tab-border-color)' } : undefined}
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
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </label>
                  )}
                  <img
                    src={
                      tab.favicon ||
                      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="gray"><circle cx="12" cy="12" r="10"/></svg>'
                    }
                    alt=""
                    className="w-4 h-4 flex-shrink-0"
                    onError={(e) => {
                      e.currentTarget.src =
                        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="gray"><circle cx="12" cy="12" r="10"/></svg>';
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
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
                              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
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
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          <bdi dir="ltr">{(tabUrlDisplay ?? 'full') === 'full' ? tab.url : new URL(tab.url).hostname}</bdi>
                    </p>
                  </div>
                  {!group.locked && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyWithAnimation(tab.url, tab.id);
                        }}
                        size="sm"
                        variant="ghost"
                        className={`transition-all duration-200 ${tabLayout === 'grid' ? 'h-6 w-6 p-0' : 'h-auto w-auto p-1'} ${copiedTabId === tab.id ? 'text-green-500 dark:text-green-400 scale-110' : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'}`}
                        title={copiedTabId === tab.id ? t('sidepanel.tabItem.copied') : t('sidepanel.tabItem.copyLink')}
                      >
                        {copiedTabId === tab.id
                          ? <Check className="w-3 h-3 transition-transform duration-200" />
                          : <Copy className="w-3 h-3 transition-transform duration-200" />
                        }
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {hiddenTabCount > 0 && (
              <div
                data-heavy-tab-preview-more
                className="col-span-full rounded-xl border border-dashed border-border bg-bg-2/60 px-3 py-2 text-center text-xs text-text-muted"
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
