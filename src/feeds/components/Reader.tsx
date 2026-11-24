import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown, ArrowLeft, ArrowUp, BookmarkPlus, Circle, CircleCheck, ExternalLink, Loader2, Minus, Plus, Star, Type, X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '@/i18n/format';
import { cn } from '@/lib/utils';
import { hasFeedHostAccess, requestFeedHostAccess } from '@/services/rss-host-permissions';
import { RSSService } from '@/services/rss-service';
import type { RSSArticle, RSSFeed } from '@/types/rss';
import { extractArticle, readingMinutes, sanitizeArticle } from '../article-content';
import type { FeedViewState } from '../use-feeds';
import { FeedIcon } from './FeedIcon';

const SIZES = ['0.9375rem', '1.0625rem', '1.1875rem', '1.3125rem', '1.5rem'];

interface ReaderProps {
  article: RSSArticle;
  feed: RSSFeed | undefined;
  view: FeedViewState;
  onViewChange: (patch: Partial<FeedViewState>) => void;
  /** Covers the list instead of standing next to it. */
  isOverlay: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onToggleStar: (article: RSSArticle) => void;
  onToggleRead: (article: RSSArticle) => void;
  onSave: (article: RSSArticle) => void;
  onOpenInTab: (article: RSSArticle) => void;
}

type ReaderState =
  | { status: 'loading' }
  | { status: 'full'; content: string; byline: string | null }
  /** Only what the feed itself carries. */
  | { status: 'summary'; needsAccess: boolean };

function IconButton({ icon: Icon, label, onClick, disabled, className, fill }: {
  icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; className?: string; fill?: boolean;
}) {
  return (
    <Button variant="ghost" size="sm" className={cn('h-8 w-8 p-0 text-text-muted hover:text-text-strong', className)} onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      <Icon className={cn('h-4 w-4', fill && 'fill-current')} />
    </Button>
  );
}

export function Reader({
  article, feed, view, onViewChange, isOverlay, hasPrevious, hasNext, onPrevious, onNext, onClose,
  onToggleStar, onToggleRead, onSave, onOpenInTab,
}: ReaderProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<ReaderState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef(article);
  articleRef.current = article;

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [article.id]);

  useEffect(() => {
    let isCurrent = true;
    const current = articleRef.current;
    setState({ status: 'loading' });

    const load = async (): Promise<ReaderState> => {
      const stored = await RSSService.getArticleContent(current);
      if (stored) return { status: 'full', content: sanitizeArticle(stored), byline: null };
      if (!current.link) return { status: 'summary', needsAccess: false };
      try {
        const extracted = await extractArticle(current.link);
        if (extracted) {
          await RSSService.setArticleContent(current.feedId, current.id, extracted.content);
          return { status: 'full', content: extracted.content, byline: extracted.byline };
        }
      } catch (error) {
        console.warn('[Reader] Could not load the article:', error);
        return { status: 'summary', needsAccess: !await hasFeedHostAccess([current.link]) };
      }
      return { status: 'summary', needsAccess: false };
    };

    void load().then((next) => { if (isCurrent) setState(next); });
    return () => { isCurrent = false; };
  }, [article.id, attempt]);

  const summary = useMemo(() => sanitizeArticle(article.description), [article.description]);
  const html = state.status === 'full' ? state.content : summary;
  const minutes = useMemo(() => readingMinutes(html), [html]);

  // Links would replace this page; they open in a tab of their own instead.
  const handleContentClick = (event: MouseEvent) => {
    const link = (event.target as Element).closest?.('a[href]');
    if (!link) return;
    event.preventDefault();
    const url = (link as HTMLAnchorElement).href;
    if (/^https?:/.test(url)) void chrome.tabs.create({ url, active: !(event.ctrlKey || event.metaKey) });
  };

  const starLabel = article.isStarred ? t('options.articleList.unstar') : t('options.articleList.star');
  const readLabel = article.isRead ? t('options.feeds.markUnread') : t('options.feeds.markRead');

  return (
    <article aria-label={article.title} className="flex h-full min-h-0 w-full min-w-0 flex-col bg-bg-1">
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-text-muted hover:text-text-strong" onClick={onClose} aria-label={t('options.feeds.closeReader')} title={t('options.feeds.closeReader')}>
          {isOverlay ? <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> : <X className="h-4 w-4" />}
        </Button>
        <IconButton icon={ArrowUp} label={t('options.feeds.previous')} onClick={onPrevious} disabled={!hasPrevious} />
        <IconButton icon={ArrowDown} label={t('options.feeds.next')} onClick={onNext} disabled={!hasNext} />
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-text-muted hover:text-text-strong" aria-label={t('options.feeds.readingOptions')} title={t('options.feeds.readingOptions')}>
              <Type className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 space-y-3 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              {t('options.feeds.textSize')}
              <span className="flex gap-1">
                <IconButton icon={Minus} label={t('options.feeds.smaller')} disabled={view.readerSize === 0} onClick={() => onViewChange({ readerSize: Math.max(0, view.readerSize - 1) })} />
                <IconButton icon={Plus} label={t('options.feeds.larger')} disabled={view.readerSize === SIZES.length - 1} onClick={() => onViewChange({ readerSize: Math.min(SIZES.length - 1, view.readerSize + 1) })} />
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="reader-wide" className="text-sm">{t('options.feeds.wideText')}</Label>
              <Switch id="reader-wide" checked={view.readerWide} onCheckedChange={(readerWide) => onViewChange({ readerWide })} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="reader-serif" className="text-sm">{t('options.feeds.serifText')}</Label>
              <Switch id="reader-serif" checked={view.readerSerif} onCheckedChange={(readerSerif) => onViewChange({ readerSerif })} />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton icon={article.isRead ? Circle : CircleCheck} label={readLabel} onClick={() => onToggleRead(article)} />
        <IconButton icon={Star} label={starLabel} onClick={() => onToggleStar(article)} fill={article.isStarred} className={article.isStarred ? 'text-warning hover:text-warning' : undefined} />
        {article.link && (
          <>
            <IconButton icon={BookmarkPlus} label={t('options.readerPanel.saveToBluetab')} onClick={() => onSave(article)} />
            <Button variant="soft" size="sm" className="ms-1" onClick={() => onOpenInTab(article)}>
              <ExternalLink className="h-4 w-4" />{t('options.readerPanel.openInTab')}
            </Button>
          </>
        )}
      </div>

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-transparent" tabIndex={-1}>
        <div className={cn('mx-auto px-6 py-8', view.readerWide ? 'max-w-4xl' : 'max-w-2xl')}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
            {feed && <span className="inline-flex items-center gap-1.5"><FeedIcon feed={feed} /><bdi dir="auto">{feed.title}</bdi></span>}
            <time dateTime={new Date(article.pubDate).toISOString()}>{formatDateTime(article.pubDate)}</time>
            {state.status === 'full' && <span>{t('options.feeds.readingTime', { count: minutes })}</span>}
          </p>
          <h1 className="mt-2 text-balance text-2xl font-semibold leading-tight text-text-strong"><bdi dir="auto">{article.title}</bdi></h1>
          {state.status === 'full' && state.byline && <p className="mt-2 text-sm text-text-muted"><bdi dir="auto">{state.byline}</bdi></p>}

          {state.status === 'loading' ? (
            <p role="status" className="mt-8 flex items-center gap-2 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />{t('options.readerPanel.loadingState')}
            </p>
          ) : (
            <>
              {state.status === 'summary' && (
                <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md bg-muted p-4 text-sm text-text">
                  <p className="min-w-48 flex-1">{state.needsAccess ? t('options.feeds.needsAccess') : t('options.feeds.summaryOnly')}</p>
                  {state.needsAccess ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => { if (await requestFeedHostAccess([article.link])) setAttempt((n) => n + 1); }}
                    >
                      {t('options.feeds.allowSite')}
                    </Button>
                  ) : article.link && (
                    <Button size="sm" variant="secondary" onClick={() => onOpenInTab(article)}>{t('options.readerPanel.openFullArticle')}</Button>
                  )}
                </div>
              )}
              <div
                dir="auto"
                className={cn('reader-content mt-6', view.readerSerif && 'is-serif')}
                style={{ '--reader-size': SIZES[view.readerSize] ?? SIZES[1] } as CSSProperties}
                onClick={handleContentClick}
                onAuxClick={handleContentClick}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </>
          )}
        </div>
      </div>
    </article>
  );
}
