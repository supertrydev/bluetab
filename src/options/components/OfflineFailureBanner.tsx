import * as React from 'react';
import { AlertCircle, ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { OfflineExtractionFailureBucket } from '@/types/offline-reading';

export interface OfflineFailureBannerProps {
  failures: Array<{ articleId: string; url: string; failureBucket: OfflineExtractionFailureBucket }>;
  onRetry: (articleId: string) => void;
  onRetryAll?: (articleIds: string[]) => void;
  onDismiss?: () => void;
}

function bucketLabel(b: OfflineExtractionFailureBucket, t: TFunction<'translation'>): string {
  if (b === 'network_error') return t('options.offlineReadingPage.failureBuckets.network_error');
  if (b === 'no_article_structure') return t('options.offlineReadingPage.failureBuckets.no_article_structure');
  return t('options.offlineReadingPage.failureBuckets.limited_content');
}

export function OfflineFailureBanner({
  failures,
  onRetry,
  onRetryAll,
  onDismiss,
}: OfflineFailureBannerProps): JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  if (failures.length === 0) return null;

  const counts: Record<OfflineExtractionFailureBucket, number> = {
    network_error: 0,
    no_article_structure: 0,
    limited_content: 0,
  };
  for (const f of failures) counts[f.failureBucket]++;

  const summary = (Object.entries(counts) as Array<[OfflineExtractionFailureBucket, number]>)
    .filter(([, n]) => n > 0)
    .map(([b, n]) => `${bucketLabel(b, t)}: ${n}`)
    .join(' · ');

  return (
    <div className="border border-warning/30 bg-warning-muted rounded-md p-3 text-sm mb-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-warning">
            {t('options.offlineReadingPage.failureTitle')}
          </div>
          <div dir="auto" className="text-xs text-muted-foreground mt-1">{summary}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onRetryAll && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onRetryAll(failures.map(f => f.articleId))}
              className="h-7 px-2 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('options.offlineReadingPage.retryAll')}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(o => !o)}
            className="h-7 px-2 text-xs"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? t('options.offlineReadingPage.hideDetails') : t('options.offlineReadingPage.seeDetails')}
          </Button>
          {onDismiss && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              className="h-7 w-7 p-0"
              aria-label={t('options.offlineReadingPage.dismissBanner')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {open && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {failures.map(f => (
            <li key={f.articleId} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate text-muted-foreground"><bdi dir="ltr">{f.url}</bdi></span>
              <span className="text-muted-foreground shrink-0">{bucketLabel(f.failureBucket, t)}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onRetry(f.articleId)}
                className="h-6 px-2 text-xs shrink-0"
              >
                <RefreshCw className="h-3 w-3" />
                {t('common.repeat')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
