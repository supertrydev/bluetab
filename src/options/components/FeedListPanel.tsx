/**
 * @module options/components/FeedListPanel
 *
 * WHY:  The feeds three-panel layout needs a left panel listing all subscribed
 *       feeds with All Feeds at top, pinned feeds section, then the rest sorted
 *       alphabetically. Each feed exposes a context menu for pin, settings,
 *       mark-all-read, and unsubscribe actions.
 *
 * WHAT: Left panel component with ScrollArea for overflow, unread count badges,
 *       FeedSettingsPopover sub-menu, and an unsubscribe confirmation dialog.
 *
 * NOT:  Does not call RSSService directly — all actions delegated via props.
 */

import { useState, useMemo } from 'react';
import { Rss, MoreHorizontal, Pin, PinOff, CheckCheck, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ModalTemplate, ModalTemplateSection } from '@/components/ui/modal-template';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FeedSettingsPopover } from './FeedSettingsPopover';
import type { RSSFeed } from '@/types/rss';
import { isolateBidi } from '@/i18n/bidi';

interface FeedListPanelProps {
  feeds: RSSFeed[];
  selectedFeedId: string | null;
  categoryFilter: string;
  onCategoryFilterChange: (category: string) => void;
  onSelectFeed: (id: string) => void;
  onTogglePin: (id: string) => void;
  onUnsubscribe: (id: string) => void;
  onMarkAllRead: (id: string) => void;
  categories: string[];
  onUpdateFeedSettings: (
    feedId: string,
    settings: Partial<Pick<RSSFeed, 'pollIntervalMinutes' | 'notificationsEnabled' | 'category'>>,
  ) => void;
}

export function FeedListPanel({
  feeds,
  selectedFeedId,
  categoryFilter,
  onCategoryFilterChange,
  onSelectFeed,
  onTogglePin,
  onUnsubscribe,
  onMarkAllRead,
  categories,
  onUpdateFeedSettings,
}: FeedListPanelProps) {
  const { t } = useTranslation();
  const [unsubscribeTarget, setUnsubscribeTarget] = useState<string | null>(null);

  // Build category options from feeds
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    let hasUncategorized = false;
    feeds.forEach((f) => {
      if (f.category) cats.add(f.category);
      else hasUncategorized = true;
    });
    return { list: [...cats].sort(), hasUncategorized };
  }, [feeds]);

  // Filter feeds by selected category
  const filteredFeeds = useMemo(() => {
    if (categoryFilter === '__all__') return feeds;
    if (categoryFilter === '__uncategorized__') return feeds.filter((f) => !f.category);
    return feeds.filter((f) => f.category === categoryFilter);
  }, [feeds, categoryFilter]);

  const allUnread = feeds.reduce((sum, f) => sum + f.unreadCount, 0);
  const pinnedFeeds = filteredFeeds.filter((f) => f.isPinned).sort((a, b) => a.title.localeCompare(b.title));
  const unpinnedFeeds = filteredFeeds.filter((f) => !f.isPinned).sort((a, b) => a.title.localeCompare(b.title));

  const feedToUnsubscribe = feeds.find((f) => f.id === unsubscribeTarget);

  const handleUnsubscribeConfirm = () => {
    if (unsubscribeTarget) {
      onUnsubscribe(unsubscribeTarget);
    }
    setUnsubscribeTarget(null);
  };

  return (
    <>
      <div className="flex flex-col h-full w-full min-w-0 overflow-hidden">
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {/* Category filter */}
            <div className="px-1 pb-1.5">
              <Select value={categoryFilter} onValueChange={(v) => { onCategoryFilterChange(v); onSelectFeed('all'); }}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <div className="flex items-center gap-1.5 w-full">
                    <Rss className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs">
                    <span className="flex items-center justify-between w-full gap-2">
                      {t('options.feedList.allFeedsOption', { count: feeds.length })}
                      {allUnread > 0 && <Badge variant="secondary" className="h-4 min-w-4 px-1 text-micro tabular-nums">{allUnread > 99 ? '99+' : allUnread}</Badge>}
                    </span>
                  </SelectItem>
                  {categoryOptions.list.map((cat) => {
                    const catFeeds = feeds.filter((f) => f.category === cat);
                    const unread = catFeeds.reduce((s, f) => s + f.unreadCount, 0);
                    return (
                      <SelectItem key={cat} value={cat} className="text-xs">
                        <span className="flex items-center justify-between w-full gap-2">
                          <bdi dir="auto">{cat}</bdi> <span dir="ltr">({catFeeds.length})</span>
                          {unread > 0 && <Badge variant="secondary" className="h-4 min-w-4 px-1 text-micro tabular-nums">{unread > 99 ? '99+' : unread}</Badge>}
                        </span>
                      </SelectItem>
                    );
                  })}
                  {categoryOptions.hasUncategorized && (() => {
                    const uncatFeeds = feeds.filter((f) => !f.category);
                    const unread = uncatFeeds.reduce((s, f) => s + f.unreadCount, 0);
                    return (
                      <SelectItem value="__uncategorized__" className="text-xs text-muted-foreground">
                        <span className="flex items-center justify-between w-full gap-2">
                          {t('options.feedList.uncategorizedOption', { count: uncatFeeds.length })}
                          {unread > 0 && <Badge variant="secondary" className="h-4 min-w-4 px-1 text-micro tabular-nums">{unread > 99 ? '99+' : unread}</Badge>}
                        </span>
                      </SelectItem>
                    );
                  })()}
                </SelectContent>
              </Select>
            </div>

            {/* Pinned feeds */}
            {pinnedFeeds.length > 0 && (
              <>
                <div className="pt-2 pb-1 px-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t('options.feedList.pinned')}
                  </span>
                </div>
                {pinnedFeeds.map((feed) => (
                  <FeedItem
                    key={feed.id}
                    feed={feed}
                    isSelected={selectedFeedId === feed.id}
                    onSelect={() => onSelectFeed(selectedFeedId === feed.id ? 'all' : feed.id)}
                    onTogglePin={() => onTogglePin(feed.id)}
                    onMarkAllRead={() => onMarkAllRead(feed.id)}
                    onUnsubscribe={() => setUnsubscribeTarget(feed.id)}
                    categories={categories}
                    onUpdateSettings={onUpdateFeedSettings}
                  />
                ))}
                {unpinnedFeeds.length > 0 && <Separator className="my-2" />}
              </>
            )}

            {/* All other feeds */}
            {unpinnedFeeds.length > 0 && (
              <>
                {pinnedFeeds.length > 0 && (
                  <div className="pb-1 px-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {t('options.feedList.feeds')}
                    </span>
                  </div>
                )}
                {unpinnedFeeds.map((feed) => (
                  <FeedItem
                    key={feed.id}
                    feed={feed}
                    isSelected={selectedFeedId === feed.id}
                    onSelect={() => onSelectFeed(selectedFeedId === feed.id ? 'all' : feed.id)}
                    onTogglePin={() => onTogglePin(feed.id)}
                    onMarkAllRead={() => onMarkAllRead(feed.id)}
                    onUnsubscribe={() => setUnsubscribeTarget(feed.id)}
                    categories={categories}
                    onUpdateSettings={onUpdateFeedSettings}
                  />
                ))}
              </>
            )}

            {/* Empty state */}
            {feeds.length === 0 && (
              <div className="px-2 py-8 text-center text-xs text-muted-foreground">
                {t('options.feedList.emptyTitle')}
                <br />
                {t('options.feedList.emptyDescription')}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Unsubscribe confirmation dialog */}
      <ModalTemplate
        open={unsubscribeTarget !== null}
        onOpenChange={(open) => { if (!open) setUnsubscribeTarget(null); }}
        className="sm:max-w-sm"
        heading={t('options.feedList.unsubscribeTitle')}
        description={t('options.feedList.unsubscribeDescription', { title: isolateBidi(feedToUnsubscribe?.title ?? '') })}
        titleIcon={<Trash2 className="h-5 w-5 text-destructive" />}
        footerClassName="bg-transparent"
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => setUnsubscribeTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" size="sm" onClick={handleUnsubscribeConfirm}>
              {t('options.feedList.unsubscribe')}
            </Button>
          </>
        )}
      >
        <ModalTemplateSection tone="danger" className="rounded-lg">
          <p className="text-sm text-text-muted">
            {t('options.feedList.unsubscribeBody')}
          </p>
        </ModalTemplateSection>
      </ModalTemplate>
    </>
  );
}

// ---------------------------------------------------------------------------
// FeedItem sub-component
// ---------------------------------------------------------------------------

interface FeedItemProps {
  feed: RSSFeed;
  isSelected: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onMarkAllRead: () => void;
  onUnsubscribe: () => void;
  categories: string[];
  onUpdateSettings: (
    feedId: string,
    settings: Partial<Pick<RSSFeed, 'pollIntervalMinutes' | 'notificationsEnabled' | 'category'>>,
  ) => void;
}

function FeedItem({
  feed,
  isSelected,
  onSelect,
  onTogglePin,
  onMarkAllRead,
  onUnsubscribe,
  categories,
  onUpdateSettings,
}: FeedItemProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`group flex w-full min-w-0 items-center gap-2 overflow-hidden px-2 py-2 rounded-md text-sm transition-colors cursor-pointer ${
        isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60 text-foreground'
      }`}
      onClick={onSelect}
    >
      {/* Favicon or fallback icon */}
      {feed.faviconUrl ? (
        <img
          src={feed.faviconUrl}
          alt=""
          className="h-4 w-4 shrink-0 rounded-sm object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <Rss className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}

      <div className="flex w-0 min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {/* Title */}
        <span className="block w-0 min-w-0 flex-1 truncate" title={isolateBidi(feed.title)}><bdi dir="auto">{feed.title}</bdi></span>

        {/* Category badge */}
        {feed.category && (
          <span
            className="max-w-16 shrink-0 truncate rounded-full bg-muted px-1.5 py-0.5 text-micro text-muted-foreground xl:max-w-20"
            title={feed.category}
          >
            <bdi dir="auto">{feed.category}</bdi>
          </span>
        )}
      </div>

      {/* Unread badge */}
      {feed.unreadCount > 0 && (
        <Badge
          variant="secondary"
          dir="ltr"
          className="h-4 min-w-4 px-1 text-xs tabular-nums shrink-0 opacity-70 group-hover:opacity-100"
        >
          {feed.unreadCount > 99 ? '99+' : feed.unreadCount}
        </Badge>
      )}

      {/* Context menu trigger */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 shrink-0 p-0 opacity-0 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
          >
            {feed.isPinned ? (
              <><PinOff className="h-4 w-4" />{t('options.feedList.unpin')}</>
            ) : (
              <><Pin className="h-4 w-4" />{t('options.feedList.pin')}</>
            )}
          </DropdownMenuItem>

          {/* Feed Settings sub-menu */}
          <FeedSettingsPopover feed={feed} categories={categories} onUpdateSettings={onUpdateSettings} />

          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onMarkAllRead();
            }}
          >
            <CheckCheck className="h-4 w-4" />
            {t('options.feedList.markAllRead')}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onUnsubscribe();
            }}
          >
            <Trash2 className="h-4 w-4" />
            {t('options.feedList.unsubscribe')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
