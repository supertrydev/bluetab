import { BRAIN_DUMP_INBOX_KEY, type BrainDumpEntry } from '@/types/adhd';
import { getBrainDumpSiteMatch, hasMatchingBrainDumpSite, type BrainDumpSiteMatch } from './brain-dump-site-match';

async function readBrainDumpEntries(): Promise<BrainDumpEntry[]> {
  try {
    const result = await new Promise<Record<string, BrainDumpEntry[] | undefined>>((resolve, reject) => {
      try {
        chrome.storage.local.get(BRAIN_DUMP_INBOX_KEY, (items) => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }

          resolve(items);
        });
      } catch (error) {
        reject(error);
      }
    });

    return Array.isArray(result[BRAIN_DUMP_INBOX_KEY]) ? result[BRAIN_DUMP_INBOX_KEY]! : [];
  } catch (error) {
    console.warn('[BlueTab][FloatingButton] Failed to read Brain Dump entries for site indicator', error);
    return [];
  }
}

export async function getBrainDumpSiteIndicator(currentUrl: string): Promise<boolean> {
  const entries = await readBrainDumpEntries();
  return hasMatchingBrainDumpSite(currentUrl, entries);
}

/** Match details for the floating button bubble (count + newest note preview). */
export async function getBrainDumpSiteMatchForUrl(currentUrl: string): Promise<BrainDumpSiteMatch> {
  const entries = await readBrainDumpEntries();
  return getBrainDumpSiteMatch(currentUrl, entries);
}
