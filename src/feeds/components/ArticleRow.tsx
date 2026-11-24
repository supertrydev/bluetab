import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkPlus, Circle, CircleCheck, ExternalLink, Star } from 'lucide-react';
import { formatRelativeTime } from '@/utils/format-time';
import { cn } from '@/lib/utils';
import type { RSSArticle, RSSFeed } from '@/types/rss';
import { toPlainText } from '../feed-view';
import { FeedIcon } from './FeedIcon';

export interface ArticleRowActions {
  onOpen: (article: RSSArticle) => void;
  onToggleStar: (article: RSSArticle) => void;
  onToggleRead: (article: RSSArticle) => void;
  onSave: (article: RSSArticle) => void;
  onOpenInTab: (article: RSSArticle) => void;
  onToggleSelect: (article: RSSArticle, extend: boolean) => void;
}

interface ArticleRowProps extends ArticleRowActions {
  article: RSSArticle;
  feed: RSSFeed | undefined;
  isOpen: boolean;
  isCursor: boolean;
  isSelected: boolean;
  isSelecting: boolean;
  isCompact: boolean;
}

const actionClass = 'flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent hover:text-text-strong';

export const ArticleRow = memo(function ArticleRow({
  article, feed, isOpen, isCursor, isSelected, isSelecting, isCompact,
  onOpen, onToggleStar, onToggleRead, onSave, onOpenInTab, onToggleSelect,
}: ArticleRowProps) {
  const { t } = useTranslation();
  const summary = useMemo(() => toPlainText(article.description, 220), [article.description]);
  const readLabel = article.isRead ? t('options.feeds.markUnread') : t('options.feeds.markRead');
  const starLabel = article.isStarred ? t('options.articleList.unstar') : t('options.articleList.star');

  return (
    <li
      data-article-id={article.id}
      className={cn(
        'group/article relative flex gap-3 rounded-md px-3 py-3 transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_104px]',
        isOpen || isSelected ? 'bg-primary-muted' : 'hover:bg-accent',
        isCursor && !isOpen && 'ring-2 ring-inset ring-ring',
      )}
    >
      <div className="relative flex w-4 shrink-0 justify-center pt-0.5">
        <span
          aria-hidden="true"
          className={cn(
            'mt-1 h-2 w-2 rounded-full',
            article.isRead ? 'bg-transparent' : 'bg-primary',
            isSelecting ? 'hidden' : 'group-hover/article:hidden group-focus-within/article:hidden',
          )}
        />
        <input
          type="checkbox"
          checked={isSelected}
          aria-label={t('options.feeds.select')}
          onChange={(event) => onToggleSelect(article, (event.nativeEvent as MouseEvent).shiftKey)}
          className={cn(
            'relative z-10 h-4 w-4 cursor-pointer accent-primary',
            isSelecting ? 'block' : 'hidden group-hover/article:block group-focus-within/article:block',
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
          {feed && <FeedIcon feed={feed} />}
          {feed && <span className="truncate"><bdi dir="auto">{feed.title}</bdi></span>}
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(article.pubDate).toISOString()} className="shrink-0">{formatRelativeTime(article.pubDate)}</time>
          {article.isStarred && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-warning" aria-label={t('options.feeds.starred')} />}
        </div>
        <button
          type="button"
          onClick={() => onOpen(article)}
          className={cn(
            'mt-1 line-clamp-2 w-full break-words text-start text-sm leading-snug after:absolute after:inset-0 after:rounded-md',
            article.isRead ? 'text-text-muted' : 'font-semibold text-text-strong',
          )}
        >
          <bdi dir="auto">{article.title}</bdi>
        </button>
        {summary && (
          <p dir="auto" className={cn('mt-1 break-words text-xs leading-relaxed text-text-muted', isCompact ? 'line-clamp-1' : 'line-clamp-2')}>
            {summary}
          </p>
        )}
      </div>

      {article.thumbnailUrl && (
        <img
          src={article.thumbnailUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className={cn('shrink-0 self-start rounded-sm object-cover', isCompact ? 'h-14 w-14' : 'h-[4.5rem] w-24')}
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      )}

      {!isSelecting && (
        <div className="absolute bottom-1.5 end-2 z-10 hidden rounded-full border border-border bg-bg-1 p-0.5 shadow-md group-hover/article:flex group-focus-within/article:flex">
          <button type="button" className={cn(actionClass, article.isStarred && 'text-warning')} onClick={() => onToggleStar(article)} aria-label={starLabel} title={starLabel}>
            <Star className={cn('h-4 w-4', article.isStarred && 'fill-current')} />
          </button>
          <button type="button" className={actionClass} onClick={() => onToggleRead(article)} aria-label={readLabel} title={readLabel}>
            {article.isRead ? <Circle className="h-4 w-4" /> : <CircleCheck className="h-4 w-4" />}
          </button>
          {article.link && (
            <>
              <button type="button" className={actionClass} onClick={() => onSave(article)} aria-label={t('options.readerPanel.saveToBluetab')} title={t('options.readerPanel.saveToBluetab')}>
                <BookmarkPlus className="h-4 w-4" />
              </button>
              <button type="button" className={actionClass} onClick={() => onOpenInTab(article)} aria-label={t('options.articleList.openInNewTab')} title={t('options.articleList.openInNewTab')}>
                <ExternalLink className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
});
