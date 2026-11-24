/**
 * @module settings/components/ReadingsSettings
 *
 * WHY:  The Readings page header was cramped on narrow viewports when the
 *       quota bar + "Clear everything" button sat beside the title. Storage
 *       controls are low-frequency actions, so they belong in Settings where
 *       they get breathing room.
 *
 * WHAT: Quota visualization + one-click "Clear everything" for the offline
 *       reading library (OFFL-08 + OFFL-10).
 */

import { useEffect, useState } from 'react';
import { BookMarked, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { OfflineReadingService } from '@/services/offline-reading-service';
import type { OfflineQuota } from '@/types/offline-reading';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function ReadingsSettings() {
  const { t } = useTranslation();
  const [quota, setQuota] = useState<OfflineQuota | null>(null);
  const [articleCount, setArticleCount] = useState<number>(0);
  const [pinnedCount, setPinnedCount] = useState<number>(0);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function refresh(): Promise<void> {
    try {
      const [q, arts] = await Promise.all([
        OfflineReadingService.getOfflineQuota(),
        OfflineReadingService.getAllArticles(),
      ]);
      setQuota(q);
      setArticleCount(arts.length);
      setPinnedCount(arts.filter(a => a.pinned === 1).length);
    } catch (err) {
      console.error('[BlueTab][ReadingsSettings] refresh failed', err);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleClearAll(): Promise<void> {
    setClearing(true);
    try {
      await OfflineReadingService.deleteAll();
      await refresh();
    } finally {
      setClearing(false);
      setClearOpen(false);
    }
  }

  const pct = quota ? Math.round(quota.percentUsed * 100) : 0;
  const barTone = quota?.isBlocked
    ? 'bg-danger'
    : quota?.isWarning
      ? 'bg-warning'
      : 'bg-primary';
  const librarySummary = pinnedCount > 0
    ? t('settings.readings.librarySummaryWithPinned', { count: articleCount, pinnedCount })
    : t('settings.readings.librarySummary', { count: articleCount });

  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-text-strong flex items-center gap-2">
        <BookMarked className="h-5 w-5" />
        {t('settings.readings.title')}
      </h3>
      <p className="text-sm text-muted-foreground -mt-4">
        {t('settings.readings.description')}
      </p>

      {/* Storage summary */}
      <section className="rounded-md border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-4 text-sm">
          <div className="text-text-strong font-medium">{t('settings.readings.storageTitle')}</div>
          <div className="text-muted-foreground text-xs">
            {quota
              ? t('options.offlineReadingPage.storageUsing', {
                used: formatBytes(quota.usedBytes),
                total: formatBytes(quota.quotaBytes),
                percent: pct,
              })
              : t('options.offlineReadingPage.loadingStorageInfo')}
          </div>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full ${barTone} transition-all`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('settings.readings.storageDescription')}
        </p>
      </section>

      {/* Library summary */}
      <section className="rounded-md border border-border p-4 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-text-strong font-medium">{t('settings.readings.libraryTitle')}</div>
            <div className="text-xs text-muted-foreground">
              {librarySummary}
            </div>
          </div>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => setClearOpen(true)}
            disabled={articleCount === 0}
          >
            <Trash2 className="h-4 w-4" />
            {t('settings.readings.clearEverything')}
          </Button>
        </div>
      </section>

      {/* Clear-all confirm dialog */}
      <Dialog open={clearOpen} onOpenChange={(v) => { if (!v && !clearing) setClearOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.readings.clearConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.readings.clearConfirmDescription', { count: pinnedCount })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setClearOpen(false)} disabled={clearing}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="danger" onClick={() => { void handleClearAll(); }} disabled={clearing}>
              {clearing ? t('settings.readings.clearing') : t('settings.readings.clearEverything')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
