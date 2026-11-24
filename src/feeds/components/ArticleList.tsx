import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/i18n/format';
import { toLocalDateKey } from '@/utils/local-date';
import type { RSSArticle, RSSFeed } from '@/types/rss';
import { groupByDay } from '../feed-view';
import { ArticleRow, type ArticleRowActions } from './ArticleRow';

/** Rows added at a time; more come in before the end is reached. */
const PAGE = 60;

interface ArticleListProps extends ArticleRowActions {
  /** Changes when the list is another one, so it starts from the top. */
  listKey: string;
  articles: RSSArticle[];
  feedById: Map<string, RSSFeed>;
  openId: string | null;
  cursorId: string | null;
  selectedIds: Set<string>;
  isCompact: boolean;
  empty: ReactNode;
}

export function ArticleList({
  listKey, articles, feedById, openId, cursorId, selectedIds, isCompact, empty, ...actions
}: ArticleListProps) {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    setLimit(PAGE);
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [listKey]);

  // Keep the keyboard cursor on screen, also past the rows drawn so far.
  useEffect(() => {
    if (!cursorId) return;
    const index = articles.findIndex((article) => article.id === cursorId);
    if (index >= limit) {
      setLimit(index + PAGE);
      return;
    }
    const row = scrollerRef.current?.querySelector(`[data-article-id="${CSS.escape(cursorId)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    // Only when the cursor moves, not whenever an article changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorId, limit]);

  const hasMore = articles.length > limit;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((current) => current + PAGE);
    }, { root: scrollerRef.current, rootMargin: '600px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, limit]);

  const days = useMemo(() => groupByDay(articles.slice(0, limit)), [articles, limit]);
  const today = toLocalDateKey();
  const yesterday = toLocalDateKey(Date.now() - 24 * 60 * 60 * 1000);
  const dayLabel = (key: string, article: RSSArticle) => {
    if (key === today) return t('options.feeds.today');
    if (key === yesterday) return t('options.feeds.yesterday');
    return formatDate(article.pubDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  if (articles.length === 0) {
    return <div className="flex min-h-0 flex-1 items-center justify-center p-6">{empty}</div>;
  }

  return (
    <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-transparent">
      <div className="w-full max-w-4xl px-2 pb-8">
        {days.map((day) => (
          <section key={day.key}>
            <h3 className="sticky top-0 z-20 bg-bg-0 px-3 py-2 text-xs font-medium text-text-muted">{dayLabel(day.key, day.articles[0])}</h3>
            <ul className="space-y-0.5">
              {day.articles.map((article) => (
                <ArticleRow
                  key={article.id}
                  article={article}
                  feed={feedById.get(article.feedId)}
                  isOpen={article.id === openId}
                  isCursor={article.id === cursorId}
                  isSelected={selectedIds.has(article.id)}
                  isSelecting={selectedIds.size > 0}
                  isCompact={isCompact}
                  {...actions}
                />
              ))}
            </ul>
          </section>
        ))}
        {hasMore && <div ref={sentinelRef} className="h-10" />}
      </div>
    </div>
  );
}
