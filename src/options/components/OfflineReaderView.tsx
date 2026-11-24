import * as React from 'react';
import { ArrowLeft, Pin, PinOff, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { OfflineReadingService } from '@/services/offline-reading-service';
import type { OfflineArticle } from '@/types/offline-reading';

// READER_STYLES copy: mirrors Phase 4 ReaderPanel.tsx READER_STYLES constant.
// NOTE: Phase 4 declares READER_STYLES as a module-local constant, not exported.
// To avoid touching ReaderPanel.tsx (keep Wave 3 surgery tight), the same constant
// is inlined below. A future refactor could extract to a shared styles file.
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

export interface OfflineReaderViewProps {
  articleId: string;
  onClose: () => void;
  onPinChanged?: () => void;
}

export function OfflineReaderView({ articleId, onClose, onPinChanged }: OfflineReaderViewProps): JSX.Element {
  const { t } = useTranslation();
  const [article, setArticle] = React.useState<OfflineArticle | null>(null);
  const [heroUrl, setHeroUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      const art = await OfflineReadingService.getArticle(articleId);
      if (cancelled || !art) return;
      setArticle(art);
      await OfflineReadingService.markRead(articleId);
      const blob = await OfflineReadingService.getHeroBlob(articleId);
      if (cancelled) return;
      if (blob) {
        createdUrl = URL.createObjectURL(blob);
        setHeroUrl(createdUrl);
      }
    })().catch(err => console.error('[BlueTab][OfflineReading] reader load', err));
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [articleId]);

  async function togglePin(): Promise<void> {
    if (!article) return;
    const next = article.pinned === 1 ? false : true;
    await OfflineReadingService.setPinned(article.id, next);
    setArticle({ ...article, pinned: next ? 1 : 0 });
    onPinChanged?.();
  }

  if (!article) {
    return <div className="p-6 text-sm text-muted-foreground">{t('options.offlineReaderView.loading')}</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <style>{READER_STYLES}</style>
      <div className="flex items-center justify-between gap-2 p-3 border-b shrink-0">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {t('options.offlineReaderView.library')}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { void togglePin(); }}
            aria-pressed={article.pinned === 1}
          >
            {article.pinned === 1
              ? <PinOff className="h-4 w-4" />
              : <Pin className="h-4 w-4" />
            }
            {article.pinned === 1 ? t('options.offlineReaderView.unpin') : t('options.offlineReaderView.pin')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { void chrome.tabs.create({ url: article.url }); }}
          >
            <ExternalLink className="h-4 w-4" />
            {t('options.offlineReaderView.openInTab')}
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto reader-scroll p-6">
        <article dir="auto" className="reader-content max-w-prose mx-auto">
          {heroUrl && (
            <img src={heroUrl} alt="" loading="lazy" className="w-full rounded-md mb-6" />
          )}
          <h1 className="text-2xl font-semibold leading-tight mb-3 text-foreground">
            <bdi dir={article.title ? 'auto' : 'ltr'}>{article.title || article.url}</bdi>
          </h1>
          {article.byline && (
            <p className="text-sm text-muted-foreground mb-4">
              <em><bdi dir="auto">{article.byline}</bdi></em>
            </p>
          )}
          <div dangerouslySetInnerHTML={{ __html: article.contentHtml }} />
        </article>
      </div>
    </div>
  );
}
