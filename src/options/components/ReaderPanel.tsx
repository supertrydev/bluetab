/**
 * @module options/components/ReaderPanel
 *
 * WHY:  The RSS reader needs a right panel that shows clean article content
 *       extracted from the original web page — stripping navigation, ads, and
 *       other cruft so the user can focus on the text.
 *
 * WHAT: Right panel that fetches the article URL, parses it with
 *       @mozilla/readability, sanitises the result with DOMPurify, caches it
 *       via RSSService.setCachedContent, and renders it with readable typography.
 *       Falls back gracefully when extraction fails.
 *
 * HOW:  - Extract on article prop change (skip if cachedContent exists)
 *       - Clone the parsed document before passing to Readability (it mutates)
 *       - Set <base href> so relative URLs resolve correctly
 *       - DOMPurify.sanitize before dangerouslySetInnerHTML
 *       - Manual prose-like styles (no @tailwindcss/typography installed)
 *
 * NOT:  Does not call RSSService directly for any reads — only writes via
 *       setCachedContent. Does not manage feed or article selection state.
 */

import { useState, useEffect, useRef } from 'react';
import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { ExternalLink, BookOpen, Loader2, AlertCircle, BookmarkPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/i18n/format';
import { RSSService } from '@/services/rss-service';
import { formatRelativeTime } from '@/utils/format-time';
import type { RSSArticle } from '@/types/rss';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReaderPanelProps {
  article: RSSArticle | null;
  onOpenInTab: (url: string) => void;
  onSaveToBluetab?: (article: RSSArticle) => void;
}

interface ExtractedContent {
  title: string;
  byline: string | null;
  siteName: string | null;
  publishedTime: string | null;
  content: string; // DOMPurify-sanitized HTML
}

type ReaderState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'success'; extracted: ExtractedContent }
  | { status: 'fallback'; reason: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the article URL, parse with Readability, sanitize with DOMPurify.
 * Returns null when Readability cannot extract content from the page.
 */
async function extractContent(url: string): Promise<ExtractedContent | null> {
  const response = await fetch(url);
  const html = await response.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Set <base href> so relative image/link URLs resolve against origin
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);

  // Clone before passing to Readability — it mutates the document
  const cloned = doc.cloneNode(true) as Document;
  const result = new Readability(cloned).parse();

  if (!result) return null;

  return {
    title: result.title ?? '',
    byline: result.byline ?? null,
    siteName: result.siteName ?? null,
    publishedTime: result.publishedTime ?? null,
    content: DOMPurify.sanitize(result.content ?? ''),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReaderPanel({ article, onOpenInTab, onSaveToBluetab }: ReaderPanelProps) {
  const { t } = useTranslation();
  const [readerState, setReaderState] = useState<ReaderState>({ status: 'empty' });
  // Track article ID to avoid stale async updates
  const pendingArticleId = useRef<string | null>(null);

  useEffect(() => {
    if (!article) {
      setReaderState({ status: 'empty' });
      return;
    }

    // If cached content exists, render immediately
    if (article.cachedContent) {
      setReaderState({
        status: 'success',
        extracted: {
          title: article.title,
          byline: null,
          siteName: null,
          publishedTime: null,
          content: DOMPurify.sanitize(article.cachedContent),
        },
      });
      return;
    }

    if (!article.link) {
      setReaderState({
        status: 'fallback',
        reason: t('options.readerPanel.noUrlAvailable'),
      });
      return;
    }

    pendingArticleId.current = article.id;
    setReaderState({ status: 'loading' });

    const articleId = article.id;
    const feedId = article.feedId;
    const link = article.link;

    (async () => {
      try {
        const extracted = await extractContent(link);

        // Bail if the user selected a different article while we were loading
        if (pendingArticleId.current !== articleId) return;

        if (!extracted) {
          setReaderState({
            status: 'fallback',
            reason: t('options.readerPanel.extractFailed'),
          });
          return;
        }

        // Cache for instant re-open
        await RSSService.setCachedContent(feedId, articleId, extracted.content);

        if (pendingArticleId.current !== articleId) return;

        setReaderState({ status: 'success', extracted });
      } catch (err) {
        if (pendingArticleId.current !== articleId) return;
        console.warn('[ReaderPanel] Extraction failed:', err);
        setReaderState({
          status: 'fallback',
          reason: err instanceof Error ? err.message : t('options.readerPanel.fetchError'),
        });
      }
    })();
  }, [article, t]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (readerState.status === 'empty') {
    return <EmptyState />;
  }

  if (readerState.status === 'loading') {
    return <LoadingState />;
  }

  if (readerState.status === 'fallback') {
    return (
      <FallbackState
        article={article!}
        reason={readerState.reason}
        onOpenInTab={onOpenInTab}
      />
    );
  }

  // success
  const { extracted } = readerState;
  return (
    <div className="flex flex-col h-full w-full min-w-0 overflow-hidden">
      {/* Action bar — non-overlapping header */}
      {article?.link && (
        <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b border-border shrink-0">
          {onSaveToBluetab && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1.5"
              onClick={() => onSaveToBluetab(article)}
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              {t('options.readerPanel.saveToBluetab')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1.5"
            onClick={() => onOpenInTab(article.link)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('options.readerPanel.openInTab')}
          </Button>
        </div>
      )}

      {/* Scrollable article body — transparent scrollbar */}
      <div className="flex-1 overflow-y-auto reader-scroll">
        <div className="max-w-prose mx-auto px-6 py-8">
          {/* Title */}
          <h1 className="text-2xl font-bold leading-tight mb-3 text-foreground">
            <bdi dir="auto">{extracted.title || article?.title}</bdi>
          </h1>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-4 pb-4 border-b border-border">
            {extracted.byline && (
              <span><bdi dir="auto">{extracted.byline}</bdi></span>
            )}
            {extracted.siteName && (
              <span className="font-medium"><bdi dir="auto">{extracted.siteName}</bdi></span>
            )}
            {extracted.publishedTime && (
              <span dir="ltr">
                {formatDate(new Date(extracted.publishedTime), {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            )}
            {!extracted.publishedTime && article?.pubDate && (
              <span dir="ltr">{formatRelativeTime(article.pubDate)}</span>
            )}
          </div>

          {/* Article content — DOMPurify sanitized */}
          <div
            dir="auto"
            className="reader-content text-foreground"
            dangerouslySetInnerHTML={{ __html: extracted.content }}
          />
        </div>
      </div>

      {/* Inline reader-content typography styles */}
      <style>{READER_STYLES}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-full w-full min-w-0 gap-3 text-muted-foreground">
      <BookOpen className="h-10 w-10 opacity-30" />
      <p className="text-sm">{t('options.readerPanel.emptyState')}</p>
    </div>
  );
}

function LoadingState() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin opacity-50" />
      <p className="text-sm">{t('options.readerPanel.loadingState')}</p>
    </div>
  );
}

interface FallbackStateProps {
  article: RSSArticle;
  reason: string;
  onOpenInTab: (url: string) => void;
}

function FallbackState({ article, reason, onOpenInTab }: FallbackStateProps) {
  const { t } = useTranslation();
  const snippet = article.description
    ? article.description.replace(/<[^>]+>/g, '').trim()
    : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-prose mx-auto px-6 py-8">
        {/* Title */}
        <h1 className="text-2xl font-bold leading-tight mb-3 text-foreground">
          <bdi dir="auto">{article.title}</bdi>
        </h1>

        {/* Failure notice */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-muted/60 text-muted-foreground text-sm mb-6">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
          <span>{t('options.readerPanel.fallbackNotice', { reason })}</span>
        </div>

        {/* Description from RSS metadata */}
        {snippet && (
          <p dir="auto" className="text-sm text-muted-foreground leading-relaxed mb-6">
            {snippet}
          </p>
        )}

        {/* Prominent open-in-tab */}
        {article.link && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => onOpenInTab(article.link)}
          >
            <ExternalLink className="h-4 w-4" />
            {t('options.readerPanel.openFullArticle')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline typography styles (no @tailwindcss/typography installed)
// ---------------------------------------------------------------------------

const READER_STYLES = `
  .reader-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .reader-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .reader-scroll::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 3px;
    transition: background 0.2s;
  }
  .reader-scroll:hover::-webkit-scrollbar-thumb {
    background: hsl(var(--muted-foreground) / 0.2);
  }
  .reader-scroll::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground) / 0.4);
  }
  .reader-content {
    font-size: 1rem;
    line-height: 1.75;
    color: inherit;
  }
  .reader-content h1,
  .reader-content h2,
  .reader-content h3,
  .reader-content h4,
  .reader-content h5,
  .reader-content h6 {
    font-weight: 700;
    line-height: 1.3;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    color: inherit;
  }
  .reader-content h1 { font-size: 1.75rem; }
  .reader-content h2 { font-size: 1.4rem; }
  .reader-content h3 { font-size: 1.2rem; }
  .reader-content h4 { font-size: 1.05rem; }
  .reader-content p {
    margin-bottom: 1em;
    line-height: 1.75;
  }
  .reader-content a {
    color: hsl(var(--primary));
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .reader-content a:hover {
    opacity: 0.8;
  }
  .reader-content img {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
    margin: 1em 0;
  }
  .reader-content blockquote {
    border-inline-start: 4px solid hsl(var(--border));
    padding-inline-start: 1rem;
    font-style: italic;
    color: hsl(var(--muted-foreground));
    margin: 1em 0;
  }
  .reader-content ul {
    list-style-type: disc;
    padding-inline-start: 1.5rem;
    margin-bottom: 1em;
  }
  .reader-content ol {
    list-style-type: decimal;
    padding-inline-start: 1.5rem;
    margin-bottom: 1em;
  }
  .reader-content li {
    margin-bottom: 0.25em;
  }
  .reader-content pre {
    background: hsl(var(--muted));
    border-radius: 0.375rem;
    padding: 1rem;
    overflow-x: auto;
    font-size: 0.875em;
    margin: 1em 0;
  }
  .reader-content code {
    background: hsl(var(--muted));
    border-radius: 0.2em;
    padding: 0.15em 0.35em;
    font-size: 0.875em;
  }
  .reader-content pre code {
    background: none;
    padding: 0;
  }
  .reader-content figure {
    margin: 1em 0;
  }
  .reader-content figcaption {
    font-size: 0.85em;
    color: hsl(var(--muted-foreground));
    text-align: center;
    margin-top: 0.5em;
  }
  .reader-content table {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
    font-size: 0.9em;
  }
  .reader-content th,
  .reader-content td {
    border: 1px solid hsl(var(--border));
    padding: 0.5rem 0.75rem;
    text-align: start;
  }
  .reader-content th {
    background: hsl(var(--muted));
    font-weight: 600;
  }
  .reader-content hr {
    border: none;
    border-top: 1px solid hsl(var(--border));
    margin: 1.5em 0;
  }
`;
