/** OPML in and out of the feeds page, with one progress toast per import. */

import { toast as sonnerToast } from 'sonner';
import { t } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { ensureFeedHostAccess } from '@/services/rss-host-permissions';
import { RSSError, RSSService } from '@/services/rss-service';
import type { OPMLFeed, RSSFeed, RSSFolder } from '@/types/rss';

export interface PendingImport {
  fileName: string;
  feeds: OPMLFeed[];
}

/** Read the chosen file. Subscribing is a separate step, see subscribeAll. */
export async function readOpmlFile(file: File): Promise<PendingImport> {
  return { fileName: file.name, feeds: await RSSService.importOPML(await file.text()) };
}

/**
 * Subscribe to many feeds, creating the folders they name. Must run right in a
 * click handler: it starts by asking for access to the sites.
 *
 * @returns whether anything was added
 */
export async function subscribeAll(list: OPMLFeed[]): Promise<boolean> {
  const toastId = `feed-import-${Date.now()}`;
  const granted = await ensureFeedHostAccess(list.map((feed) => feed.xmlUrl));
  if (!granted) {
    sonnerToast.error(t('options.opml.siteAccessRequired'), { id: toastId });
    return false;
  }

  let added = 0;
  let present = 0;
  let failed = 0;
  for (const [index, feed] of list.entries()) {
    sonnerToast.loading(t('options.opml.importingCount', { current: index + 1, total: list.length }), {
      id: toastId,
      description: t('options.opml.currentFeed', {
        label: isolateBidi(feed.title.trim() || hostOf(feed.xmlUrl), feed.title.trim() ? 'auto' : 'ltr'),
      }),
    });
    try {
      const folder = feed.folder ? await RSSService.createFolder(feed.folder) : undefined;
      await RSSService.subscribeFeed(feed.xmlUrl, { folderId: folder?.id });
      added++;
    } catch (error) {
      if (error instanceof RSSError && error.code === 'duplicate') present++;
      else failed++;
    }
  }

  if (failed > 0 && added + present === 0) {
    sonnerToast.error(t('options.opml.failedImportCount', { count: failed }), { id: toastId, description: undefined });
  } else if (failed > 0) {
    sonnerToast.warning(t('options.opml.importedWithFailures', { successCount: added, failCount: failed }), { id: toastId, description: undefined });
  } else if (added === 0) {
    sonnerToast.info(t('options.feeds.allPresent'), { id: toastId, description: undefined });
  } else {
    sonnerToast.success(t('options.opml.imported', { count: added }), { id: toastId, description: undefined });
  }
  return added > 0;
}

export function downloadOpml(feeds: RSSFeed[], folders: RSSFolder[]): void {
  const url = URL.createObjectURL(new Blob([RSSService.exportOPML(feeds, folders)], { type: 'text/xml' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'bluetab-feeds.opml';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function hostOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, '');
  } catch {
    return address;
  }
}
