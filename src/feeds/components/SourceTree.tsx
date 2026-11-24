/**
 * The one place to choose what to read: smart views, folders, feeds.
 * Feeds are dragged into folders and folders past each other; every drag also
 * has a menu entry.
 */

import { useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ArrowDown, ArrowUp, Bell, BellOff, CalendarDays, Check, CheckCheck, ChevronRight, CircleDot,
  Folder, FolderPlus, Inbox, List, MoreHorizontal, Pencil, Pin, PinOff, Plus, Settings2, Star, Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatNumber } from '@/i18n/format';
import { isolateBidi } from '@/i18n/bidi';
import { cn } from '@/lib/utils';
import type { RSSFeed, RSSFolder } from '@/types/rss';
import {
  NO_FOLDER, SMART_VIEWS, feedsInFolder, isSameSelection, moveBefore, moveStep,
  type FeedSelection, type SmartView,
} from '../feed-view';
import { FeedIcon } from './FeedIcon';

const FEED_DRAG = 'application/x-bluetab-feed';
const FOLDER_DRAG = 'application/x-bluetab-folder';

const VIEW_ICONS: Record<SmartView, LucideIcon> = {
  today: CalendarDays,
  unread: CircleDot,
  starred: Star,
  all: List,
};

export interface SourceTreeProps {
  feeds: RSSFeed[];
  folders: RSSFolder[];
  unread: Map<string, number>;
  viewCounts: Record<SmartView, number>;
  selection: FeedSelection;
  collapsedFolders: string[];
  onSelect: (selection: FeedSelection) => void;
  onToggleFolder: (folderId: string) => void;
  onAddFeed: () => void;
  onAddFolder: () => void;
  onRenameFolder: (folder: RSSFolder) => void;
  onDeleteFolder: (folder: RSSFolder) => void;
  onReorderFolders: (folderIds: string[]) => void;
  onFolderNotifications: (folder: RSSFolder, enabled: boolean) => void;
  onMoveFeed: (feedId: string, folderId: string | undefined) => void;
  onMarkAllRead: (selection: FeedSelection) => void;
  onTogglePin: (feed: RSSFeed) => void;
  onFeedSettings: (feed: RSSFeed) => void;
  onUnsubscribe: (feed: RSSFeed) => void;
}

function Count({ value }: { value: number }) {
  if (value === 0) return null;
  return <span className="shrink-0 text-xs tabular-nums text-text-muted">{formatNumber(value)}</span>;
}

interface RowProps {
  icon: ReactNode;
  label: ReactNode;
  title?: string;
  count: number;
  isActive: boolean;
  onSelect: () => void;
  leading?: ReactNode;
  menu?: ReactNode;
  className?: string;
  isDropTarget?: boolean;
  isStrong?: boolean;
}

function Row({ icon, label, title, count, isActive, onSelect, leading, menu, className, isDropTarget, isStrong }: RowProps) {
  return (
    <div
      className={cn(
        'group/row flex min-h-9 items-center rounded-sm pe-1.5 transition-colors',
        isActive ? 'bg-primary-muted text-primary' : 'text-text hover:bg-accent hover:text-text-strong',
        isDropTarget && 'ring-2 ring-inset ring-primary',
        className,
      )}
    >
      {leading}
      <button
        type="button"
        onClick={onSelect}
        aria-current={isActive ? 'true' : undefined}
        title={title}
        className={cn('flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-sm text-start text-sm', !leading && 'ps-2.5')}
      >
        {icon}
        <span className={cn('min-w-0 flex-1 truncate', (isActive || isStrong) && 'font-medium')}>{label}</span>
      </button>
      <span className={cn('flex items-center ps-1.5', menu && 'group-hover/row:hidden group-focus-within/row:hidden group-has-[[data-state=open]]/row:hidden')}>
        <Count value={count} />
      </span>
      {menu && (
        <span className="hidden group-hover/row:flex group-focus-within/row:flex group-has-[[data-state=open]]/row:flex">
          {menu}
        </span>
      )}
    </div>
  );
}

function MenuButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-text-muted hover:text-text-strong" aria-label={label} title={label}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SourceTree(props: SourceTreeProps) {
  const { feeds, folders, unread, viewCounts, selection, collapsedFolders, onSelect } = props;
  const { t } = useTranslation();
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const viewLabels: Record<SmartView, string> = {
    today: t('options.feeds.today'),
    unread: t('options.feeds.unread'),
    starred: t('options.feeds.starred'),
    all: t('options.feeds.all'),
  };
  const sumUnread = (list: RSSFeed[]) => list.reduce((sum, feed) => sum + (unread.get(feed.id) ?? 0), 0);
  const pinned = feeds.filter((feed) => feed.isPinned).sort((a, b) => a.title.localeCompare(b.title));
  const loose = feedsInFolder(feeds, folders, NO_FOLDER);
  const folderIds = folders.map((folder) => folder.id);

  const dropProps = (folderId: string) => ({
    onDragOver: (event: DragEvent) => {
      const types = event.dataTransfer.types;
      if (!types.includes(FEED_DRAG) && !(types.includes(FOLDER_DRAG) && folderId !== NO_FOLDER)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(folderId);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDropTarget(null);
      const feedId = event.dataTransfer.getData(FEED_DRAG);
      const movedFolder = event.dataTransfer.getData(FOLDER_DRAG);
      if (feedId) props.onMoveFeed(feedId, folderId === NO_FOLDER ? undefined : folderId);
      else if (movedFolder && folderId !== NO_FOLDER) props.onReorderFolders(moveBefore(folderIds, movedFolder, folderId));
    },
  });

  const renderFeed = (feed: RSSFeed, isNested: boolean) => {
    const target: FeedSelection = { type: 'feed', id: feed.id };
    return (
      <li
        key={feed.id}
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.setData(FEED_DRAG, feed.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDropTarget(null)}
      >
        <Row
          className={isNested ? 'ps-5' : undefined}
          icon={<FeedIcon feed={feed} />}
          label={(
            <span className="flex items-center gap-1.5">
              <span className="truncate"><bdi dir="auto">{feed.title}</bdi></span>
              {feed.lastError && (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-label={t('options.feeds.hasError')} />
              )}
            </span>
          )}
          title={isolateBidi(feed.title)}
          count={unread.get(feed.id) ?? 0}
          isActive={isSameSelection(selection, target)}
          onSelect={() => onSelect(target)}
          menu={(
            <MenuButton label={t('options.feeds.moreFor', { name: isolateBidi(feed.title) })}>
              <DropdownMenuItem onClick={() => props.onMarkAllRead(target)}>
                <CheckCheck className="h-4 w-4" />{t('options.feeds.markAllRead')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onTogglePin(feed)}>
                {feed.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                {feed.isPinned ? t('options.feedList.unpin') : t('options.feedList.pin')}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><Folder className="h-4 w-4" />{t('options.feeds.moveTo')}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                  {[...folders, null].map((folder) => {
                    const isCurrent = folder ? feed.folderId === folder.id : loose.includes(feed);
                    return (
                      <DropdownMenuItem key={folder?.id ?? NO_FOLDER} disabled={isCurrent} onClick={() => props.onMoveFeed(feed.id, folder?.id)}>
                        {isCurrent ? <Check className="h-4 w-4" /> : folder ? <Folder className="h-4 w-4" /> : <Inbox className="h-4 w-4" />}
                        {folder ? <bdi dir="auto">{folder.name}</bdi> : t('options.feeds.noFolder')}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => props.onFeedSettings(feed)}>
                <Settings2 className="h-4 w-4" />{t('options.feedSettings.title')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-danger focus:text-danger" onClick={() => props.onUnsubscribe(feed)}>
                <Trash2 className="h-4 w-4" />{t('options.feedList.unsubscribe')}
              </DropdownMenuItem>
            </MenuButton>
          )}
        />
      </li>
    );
  };

  const renderFolder = (folder: RSSFolder, index: number) => {
    const inside = feedsInFolder(feeds, folders, folder.id);
    const isCollapsed = collapsedFolders.includes(folder.id);
    const target: FeedSelection = { type: 'folder', id: folder.id };
    const allNotify = inside.length > 0 && inside.every((feed) => feed.notificationsEnabled);
    return (
      <li key={folder.id} {...dropProps(folder.id)}>
        <div
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(FOLDER_DRAG, folder.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setDropTarget(null)}
        >
          <Row
            isStrong
            isDropTarget={dropTarget === folder.id}
            leading={(
              <button
                type="button"
                onClick={() => props.onToggleFolder(folder.id)}
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed
                  ? t('options.feeds.expand', { name: isolateBidi(folder.name) })
                  : t('options.feeds.collapse', { name: isolateBidi(folder.name) })}
                className="ms-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-accent hover:text-text-strong"
              >
                <ChevronRight className={cn('h-4 w-4 transition-transform', isCollapsed ? 'rtl:rotate-180' : 'rotate-90')} />
              </button>
            )}
            icon={<Folder className="h-4 w-4 shrink-0" />}
            label={<bdi dir="auto">{folder.name}</bdi>}
            title={isolateBidi(folder.name)}
            count={sumUnread(inside)}
            isActive={isSameSelection(selection, target)}
            onSelect={() => onSelect(target)}
            menu={(
              <MenuButton label={t('options.feeds.moreFor', { name: isolateBidi(folder.name) })}>
                <DropdownMenuItem onClick={() => props.onMarkAllRead(target)}>
                  <CheckCheck className="h-4 w-4" />{t('options.feeds.markAllRead')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={inside.length === 0} onClick={() => props.onFolderNotifications(folder, !allNotify)}>
                  {allNotify ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                  {allNotify ? t('options.feeds.notifyOff') : t('options.feeds.notifyOn')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => props.onRenameFolder(folder)}>
                  <Pencil className="h-4 w-4" />{t('options.feeds.renameFolder')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === 0} onClick={() => props.onReorderFolders(moveStep(folderIds, folder.id, -1))}>
                  <ArrowUp className="h-4 w-4" />{t('options.feeds.moveUp')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === folders.length - 1} onClick={() => props.onReorderFolders(moveStep(folderIds, folder.id, 1))}>
                  <ArrowDown className="h-4 w-4" />{t('options.feeds.moveDown')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-danger focus:text-danger" onClick={() => props.onDeleteFolder(folder)}>
                  <Trash2 className="h-4 w-4" />{t('options.feeds.deleteFolder')}
                </DropdownMenuItem>
              </MenuButton>
            )}
          />
        </div>
        {!isCollapsed && inside.length > 0 && <ul className="mt-0.5 space-y-0.5">{inside.map((feed) => renderFeed(feed, true))}</ul>}
      </li>
    );
  };

  return (
    <nav aria-label={t('options.feeds.sources')} className="flex h-full min-h-0 w-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2 scrollbar-transparent">
        <ul className="space-y-0.5">
          {SMART_VIEWS.map((view) => {
            const Icon = VIEW_ICONS[view];
            const target: FeedSelection = { type: 'view', view };
            return (
              <li key={view}>
                <Row
                  icon={<Icon className="h-4 w-4 shrink-0" />}
                  label={viewLabels[view]}
                  count={viewCounts[view]}
                  isActive={isSameSelection(selection, target)}
                  onSelect={() => onSelect(target)}
                />
              </li>
            );
          })}
        </ul>

        {pinned.length > 0 && (
          <section>
            <h2 className="px-2.5 pb-1 text-xs font-medium text-text-muted">{t('options.feedList.pinned')}</h2>
            <ul className="space-y-0.5">{pinned.map((feed) => renderFeed(feed, false))}</ul>
          </section>
        )}

        {folders.length > 0 && (
          <section>
            <h2 className="px-2.5 pb-1 text-xs font-medium text-text-muted">{t('options.feeds.folders')}</h2>
            <ul className="space-y-0.5">{folders.map(renderFolder)}</ul>
          </section>
        )}

        {(loose.length > 0 || folders.length > 0) && (
          <section {...dropProps(NO_FOLDER)}>
            {folders.length > 0 ? (
              <Row
                isStrong
                isDropTarget={dropTarget === NO_FOLDER}
                icon={<Inbox className="h-4 w-4 shrink-0" />}
                label={t('options.feeds.noFolder')}
                count={sumUnread(loose)}
                isActive={isSameSelection(selection, { type: 'folder', id: NO_FOLDER })}
                onSelect={() => onSelect({ type: 'folder', id: NO_FOLDER })}
              />
            ) : (
              <h2 className="px-2.5 pb-1 text-xs font-medium text-text-muted">{t('options.feedsPage.title')}</h2>
            )}
            <ul className="mt-0.5 space-y-0.5">{loose.map((feed) => renderFeed(feed, folders.length > 0))}</ul>
          </section>
        )}
      </div>

      <div className="flex shrink-0 gap-1 border-t border-border p-2">
        <Button variant="ghost" size="sm" className="min-w-0 flex-1" onClick={props.onAddFeed}>
          <Plus className="h-4 w-4" /><span className="truncate">{t('options.feeds.addShort')}</span>
        </Button>
        <Button variant="ghost" size="sm" className="min-w-0 flex-1" onClick={props.onAddFolder}>
          <FolderPlus className="h-4 w-4" /><span className="truncate">{t('options.feeds.folderShort')}</span>
        </Button>
      </div>
    </nav>
  );
}
