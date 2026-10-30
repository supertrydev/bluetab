/**
 * @module options/components/ArticleListPanel
 *
 * WHY:  The middle panel of the RSS reader must display rich article cards with
 *       title, source, relative timestamp, snippet, thumbnail, and action buttons
 *       for starring and opening in a new tab. Multi-select enables Save to Bluetab.
 *
 * WHAT: Article list component with ScrollArea, filter tabs (All/Unread/Starred),
 *       read/unread visual treatment, star toggle, open-in-tab action, and
 *       checkbox multi-select for Save to Bluetab.
 *
 * NOT:  Does not call RSSService directly — all actions delegated via props.
 */

import { useState } from 'react';
import { Star, ExternalLink, CheckCheck, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/utils/format-time';
import type { RSSArticle } from '@/types/rss';

type ArticleFilter = 'all' | 'unread' | 'starred';

interface ArticleListPanelProps {
  articles: RSSArticle[];
  selectedArticleId: string | null;
  feedTitle: string;
  isLoading?: boolean;
  /** IDs of articles currently checked for multi-select */
  selectedArticleIds: Set<string>;
  onSelectArticle: (id: string) => void;
  onToggleStar: (articleId: string, feedId: string) => void;
  onOpenInTab: (url: string) => void;
  onMarkAllRead: () => void;
  onToggleSelect: (articleId: string) => void;
}

export function ArticleListPanel({
  articles,
  selectedArticleId,
  feedTitle,
  isLoading,
  selectedArticleIds,
  onSelectArticle,
  onToggleStar,
  onOpenInTab,
  onMarkAllRead,
  onToggleSelect,
}: ArticleListPanelProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ArticleFilter>('all');

  // Sort by pubDate descending (safety sort — service should already return sorted)
  const sorted = [...articles].sort((a, b) => b.pubDate - a.pubDate);

  // Apply filter
  const filtered = sorted.filter((a) => {
    if (filter === 'unread') return !a.isRead;
    if (filter === 'starred') return a.isStarred;
    return true;
  });

  const unreadCount = articles.filter((a) => !a.isRead).length;
  const isMultiSelectActive = selectedArticleIds.size > 0;
  const filterLabels: Record<ArticleFilter, string> = {
    all: t('options.articleList.filters.all'),
    unread: t('options.articleList.filters.unread'),
    starred: t('options.articleList.filters.starred'),
  };

  const handleSelectAll = () => {
    filtered.forEach((a) => {
      if (!selectedArticleIds.has(a.id)) onToggleSelect(a.id);
    });
  };

  const handleClearSelection = () => {
    Array.from(selectedArticleIds).forEach((id) => onToggleSelect(id));
  };

  return (
    <div className="flex flex-col h-full w-full min-w-0 overflow-hidden">
      {/* Panel header */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate"><bdi dir="auto">{feedTitle}</bdi></h2>
            <p className="text-xs text-muted-foreground">
              {t('options.articleList.summary', { count: articles.length })}
              {unreadCount > 0 && ` · ${t('options.articleList.unread', { count: unreadCount })}`}
            </p>
          </div>
          {unreadCount > 0 && !isMultiSelectActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs shrink-0 ms-2"
              onClick={onMarkAllRead}
              title={t('options.articleList.markAllReadTitle')}
            >
              <CheckCheck className="h-3 w-3 me-1" />
              {t('options.articleList.markAllRead')}
            </Button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1">
          {(['all', 'unread', 'starred'] as ArticleFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors capitalize ${
                filter === f
                  ? 'bg-primary text-white'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              {filterLabels[f]}
            </button>
          ))}
        </div>

        {/* Multi-select controls — visible when any article is selected */}
        {isMultiSelectActive && (
          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border/60">
            <span className="text-xs text-muted-foreground">
              {t('options.articleList.selected', { count: selectedArticleIds.size })}
            </span>
            <div className="flex gap-1">
              <button
                className="text-xs text-primary hover:text-primary/80 transition-colors"
                onClick={handleSelectAll}
              >
                {t('options.articleList.selectAll')}
              </button>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={handleClearSelection}
              >
                {t('options.articleList.clear')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Article list */}
      {isLoading ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">{t('options.articleList.loading')}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center flex-1 px-4 text-center text-sm text-muted-foreground">
          {articles.length === 0
            ? t('options.articleList.emptyInitial')
            : filter === 'unread'
            ? t('options.articleList.emptyUnread')
            : filter === 'starred'
            ? t('options.articleList.emptyStarred')
            : t('options.articleList.emptyDefault')}
        </div>
      ) : (
        // Radix wraps the viewport content in a `display: table` div that grows
        // with its content, which defeats line-clamp/truncate on long titles.
        <ScrollArea className="flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
          <div className="divide-y divide-border/50">
            {filtered.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                isSelected={selectedArticleId === article.id}
                isChecked={selectedArticleIds.has(article.id)}
                showCheckbox={isMultiSelectActive}
                onSelect={() => onSelectArticle(article.id)}
                onToggleStar={() => onToggleStar(article.id, article.feedId)}
                onOpenInTab={() => onOpenInTab(article.link)}
                onToggleSelect={() => onToggleSelect(article.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArticleCard sub-component
// ---------------------------------------------------------------------------

interface ArticleCardProps {
  article: RSSArticle;
  isSelected: boolean;
  isChecked: boolean;
  showCheckbox: boolean;
  onSelect: () => void;
  onToggleStar: () => void;
  onOpenInTab: () => void;
  onToggleSelect: () => void;
}

function ArticleCard({
  article,
  isSelected,
  isChecked,
  showCheckbox,
  onSelect,
  onToggleStar,
  onOpenInTab,
  onToggleSelect,
}: ArticleCardProps) {
  const { t } = useTranslation();
  // Strip HTML tags from description for snippet display
  const snippet = article.description
    ? article.description.replace(/<[^>]+>/g, '').trim().slice(0, 200)
    : null;

  return (
    <div
      className={`group relative flex gap-2 px-3 py-3 cursor-pointer transition-colors border-s-2 ${
        isSelected
          ? 'bg-primary/10 border-s-primary'
          : 'hover:bg-muted/50 border-s-transparent'
      }`}
      onClick={onSelect}
    >
      {/* Checkbox (left side — visible when multi-select active or hovered) */}
      <div className="pt-1 shrink-0 flex flex-col items-center gap-1.5">
        <input
          type="checkbox"
          checked={isChecked}
          className={`h-3.5 w-3.5 rounded accent-primary cursor-pointer transition-opacity ${
            showCheckbox ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
          }`}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          onClick={(e) => e.stopPropagation()}
        />
        {/* Read/unread dot — below checkbox */}
        <div
          className={`h-2 w-2 rounded-full transition-colors ${
            article.isRead ? 'bg-transparent' : 'bg-primary'
          }`}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-1">
        {/* Title */}
        <p
          title={article.title}
          className={`text-sm line-clamp-2 leading-snug break-words ${
            article.isRead ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground'
          }`}
        >
          <bdi dir="auto">{article.title}</bdi>
        </p>

        {/* Relative timestamp */}
        <p dir="ltr" className="text-xs text-muted-foreground truncate">
          {formatRelativeTime(article.pubDate)}
        </p>

        {/* Snippet */}
        {snippet && (
          <p dir="auto" className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {snippet}
          </p>
        )}

        {/* Action row */}
        <div className="flex items-center gap-1 pt-0.5">
          <button
            className={`h-5 w-5 flex items-center justify-center rounded transition-colors ${
              article.isStarred
                ? 'text-yellow-500 hover:text-yellow-600'
                : 'text-muted-foreground/50 hover:text-yellow-500 opacity-0 group-hover:opacity-100'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar();
            }}
            title={article.isStarred ? t('options.articleList.unstar') : t('options.articleList.star')}
          >
            <Star className={`h-3.5 w-3.5 ${article.isStarred ? 'fill-current' : ''}`} />
          </button>
          {article.link && (
            <button
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onOpenInTab();
              }}
              title={t('options.articleList.openInNewTab')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Thumbnail */}
      {article.thumbnailUrl && (
        <div className="shrink-0 self-start mt-0.5">
          <img
            src={article.thumbnailUrl}
            alt=""
            className="h-14 w-14 rounded object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}
    </div>
  );
}
