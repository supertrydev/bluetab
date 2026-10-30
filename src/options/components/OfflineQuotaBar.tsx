import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { OfflineReadingService } from '@/services/offline-reading-service';
import type { OfflineQuota } from '@/types/offline-reading';

export interface OfflineQuotaBarProps {
  refreshSignal?: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function OfflineQuotaBar({ refreshSignal = 0 }: OfflineQuotaBarProps): JSX.Element {
  const { t } = useTranslation();
  const [quota, setQuota] = React.useState<OfflineQuota | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    OfflineReadingService.getOfflineQuota()
      .then(q => {
        if (!cancelled) setQuota(q);
      })
      .catch(err =>
        console.error('[BlueTab][OfflineReading] quota read failed', err),
      );
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  if (!quota) {
    return (
      <div className="text-xs text-muted-foreground">
        {t('options.offlineReadingPage.loadingStorageInfo')}
      </div>
    );
  }

  const pct = Math.round(quota.percentUsed * 100);
  const colorClass = quota.isBlocked
    ? 'bg-red-500'
    : quota.isWarning
      ? 'bg-amber-500'
      : 'bg-primary';

  return (
    <div
      className="flex flex-col gap-1 w-full max-w-md"
      aria-label={t('options.offlineReadingPage.storageUsageAria')}
    >
      <div className="text-xs text-muted-foreground">
        {t('options.offlineReadingPage.storageUsing', {
          used: formatBytes(quota.usedBytes),
          total: formatBytes(quota.quotaBytes),
          percent: pct,
        })}
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${colorClass}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
