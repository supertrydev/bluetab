/**
 * @module options/components/OPMLActions
 *
 * WHY:  Users need to import their existing feed subscriptions from other RSS
 *       readers (Feedly, Inoreader, etc.) and export their BlueTab subscriptions
 *       for portability. OPML is the universal feed portability format.
 *
 * WHAT: Two icon buttons — "Import OPML" (file upload, subscribe to all feeds
 *       with progress) and "Export OPML" (generate XML, trigger download).
 *
 * HOW:  Import: hidden file input → FileReader → RSSService.importOPML →
 *               sequential subscribeFeed per feed → progress toast → refresh
 *       Export: RSSService.exportOPML → Blob → anchor.click download
 *
 * NOT:  Does not manage feed state — delegates to onImportComplete for refresh.
 */

import { useRef, useState } from 'react';
import { Upload, Download } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ToastManager } from '@/components/Toast';
import { ensureFeedHostAccess } from '@/services/rss-host-permissions';
import { RSSService } from '@/services/rss-service';
import type { RSSFeed } from '@/types/rss';
import { useTranslation } from 'react-i18next';
import { t as translate } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';

interface OPMLActionsProps {
  /** Current feed list used for export */
  feeds: RSSFeed[];
  /** Called after a successful import so the parent can reload the feed list */
  onImportComplete: () => void | Promise<unknown>;
}

export function OPMLActions({ feeds, onImportComplete }: OPMLActionsProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset the input so the same file can be re-imported if needed
    e.target.value = '';

    setIsImporting(true);
    const toast = ToastManager.getInstance();
    const toastId = `feed-import-${Date.now()}`;

    try {
      const fileContent = await readFileAsText(file);
      const opmlFeeds = await RSSService.importOPML(fileContent);

      if (opmlFeeds.length === 0) {
        toast.warning(t('options.opml.noFeedsFound'));
        return;
      }

      const granted = await ensureFeedHostAccess(opmlFeeds.map((feed) => feed.xmlUrl));
      if (!granted) {
        sonnerToast.error(t('options.opml.siteAccessRequired'), {
          id: toastId,
        });
        return;
      }

      let successCount = 0;
      let failCount = 0;

      sonnerToast.loading(t('options.opml.importingCount', { current: 0, total: opmlFeeds.length }), {
        id: toastId,
        description: t('options.opml.preparing'),
      });

      // Subscribe to feeds sequentially with live progress feedback
      for (let i = 0; i < opmlFeeds.length; i++) {
        const feed = opmlFeeds[i];
        sonnerToast.loading(t('options.opml.importingCount', { current: i + 1, total: opmlFeeds.length }), {
          id: toastId,
          description: t('options.opml.currentFeed', {
            label: isolateBidi(formatFeedLabel(feed.title, feed.xmlUrl), feed.title.trim() ? 'auto' : 'ltr'),
          }),
        });
        try {
          await RSSService.subscribeFeed(feed.xmlUrl);
          successCount++;
        } catch {
          failCount++;
          console.warn(`[OPMLActions] Failed to subscribe to ${feed.xmlUrl}`);
        }
      }

      if (successCount > 0) {
        const message =
          failCount > 0
            ? t('options.opml.importedWithFailures', { successCount, failCount })
            : t('options.opml.imported', { count: successCount });

        if (failCount > 0) {
          sonnerToast.warning(message, { id: toastId });
        } else {
          sonnerToast.success(message, { id: toastId });
        }
      } else {
        sonnerToast.error(t('options.opml.failedImportCount', { count: failCount }), {
          id: toastId,
        });
      }

      await onImportComplete();
    } catch (err) {
      sonnerToast.error(
        err instanceof Error ? t('options.opml.importFailedWithMessage', { message: isolateBidi(err.message) }) : t('options.opml.importFailed'),
        { id: toastId },
      );
    } finally {
      setIsImporting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  const handleExport = () => {
    if (feeds.length === 0) {
      ToastManager.getInstance().warning(t('options.opml.noFeedsToExport'));
      return;
    }

    const xml = RSSService.exportOPML(feeds);
    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'bluetab-feeds.opml';
    anchor.click();

    URL.revokeObjectURL(url);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex items-center gap-1">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".opml,.xml"
        className="hidden"
        onChange={handleFileChange}
      />

      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 gap-1.5 text-xs"
        onClick={handleImportClick}
        disabled={isImporting}
        title={t('options.opml.importTitle')}
      >
        <Upload className="h-3.5 w-3.5" />
        {isImporting ? t('options.opml.importing') : t('options.opml.import')}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 gap-1.5 text-xs"
        onClick={handleExport}
        disabled={feeds.length === 0}
        title={t('options.opml.exportTitle')}
      >
        <Download className="h-3.5 w-3.5" />
        {t('options.opml.export')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string ?? '');
    reader.onerror = () => reject(new Error(translate('components.opml.readFailed')));
    reader.readAsText(file);
  });
}

function formatFeedLabel(title: string, xmlUrl: string): string {
  const trimmedTitle = title.trim();
  if (trimmedTitle) return trimmedTitle;

  try {
    return new URL(xmlUrl).hostname;
  } catch {
    return xmlUrl;
  }
}
