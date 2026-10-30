import type { BrainDumpEntry } from '@/types/adhd';
import { normalizeUrl } from '@/utils/normalize';

export function normalizeBrainDumpLink(url: string | undefined | null): string | null {
  if (!url) return null;

  try {
    return normalizeUrl(url);
  } catch {
    return null;
  }
}

export function hasMatchingBrainDumpSite(
  currentUrl: string,
  entries: BrainDumpEntry[],
): boolean {
  return getBrainDumpSiteMatch(currentUrl, entries).count > 0;
}

/** Longest preview sent to the page; the bubble clamps it further with CSS. */
export const BRAIN_DUMP_PREVIEW_MAX_CHARS = 280;

export interface BrainDumpSiteMatch {
  count: number;
  /** Text of the most recent matching entry, whitespace-collapsed and capped. */
  preview: string;
}

export function getBrainDumpSiteMatch(
  currentUrl: string,
  entries: BrainDumpEntry[],
): BrainDumpSiteMatch {
  const currentLink = normalizeBrainDumpLink(currentUrl);
  if (!currentLink) return { count: 0, preview: '' };

  const matches = entries.filter((entry) => normalizeBrainDumpLink(entry.tabContext?.url) === currentLink);
  if (matches.length === 0) return { count: 0, preview: '' };

  const newest = matches.reduce((latest, entry) => (
    (entry.updatedAt ?? entry.createdAt) > (latest.updatedAt ?? latest.createdAt) ? entry : latest
  ));
  const text = (newest.text ?? '').replace(/\s+/g, ' ').trim();
  const preview = text.length > BRAIN_DUMP_PREVIEW_MAX_CHARS
    ? `${text.slice(0, BRAIN_DUMP_PREVIEW_MAX_CHARS - 1).trimEnd()}…`
    : text;

  return { count: matches.length, preview };
}
