/**
 * What the feeds page shows for a selection. Pure functions, no storage, no UI.
 */

import { matchesSearch, normalizeForSearch } from '@/utils/search-text';
import { toLocalDateKey } from '@/utils/local-date';
import type { RSSArticle, RSSFeed, RSSFolder } from '@/types/rss';

export type SmartView = 'today' | 'unread' | 'starred' | 'all';

export type FeedSelection =
  | { type: 'view'; view: SmartView }
  | { type: 'folder'; id: string }
  | { type: 'feed'; id: string };

export type ArticleSort = 'newest' | 'oldest';

/** Selection id for the feeds that are in no folder. */
export const NO_FOLDER = '__none__';

export const SMART_VIEWS: SmartView[] = ['today', 'unread', 'starred', 'all'];

export const isSameSelection = (a: FeedSelection, b: FeedSelection): boolean =>
  a.type === 'view' ? b.type === 'view' && a.view === b.view : a.type === b.type && 'id' in b && a.id === b.id;

const byTitle = (a: RSSFeed, b: RSSFeed) => a.title.localeCompare(b.title);

/** Feeds of a folder; a feed whose folder is gone counts as being in none. */
export function feedsInFolder(feeds: RSSFeed[], folders: RSSFolder[], folderId: string): RSSFeed[] {
  const known = new Set(folders.map((folder) => folder.id));
  return feeds
    .filter((feed) => (folderId === NO_FOLDER ? !feed.folderId || !known.has(feed.folderId) : feed.folderId === folderId))
    .sort(byTitle);
}

/** The feeds a selection stands for; a smart view stands for all of them. */
export function feedsOfSelection(selection: FeedSelection, feeds: RSSFeed[], folders: RSSFolder[]): RSSFeed[] {
  if (selection.type === 'view') return feeds;
  if (selection.type === 'feed') return feeds.filter((feed) => feed.id === selection.id);
  return feedsInFolder(feeds, folders, selection.id);
}

/** Whether the read/unread switch applies; the other views decide that themselves. */
export function hasReadFilter(selection: FeedSelection): boolean {
  return selection.type !== 'view' || selection.view === 'today';
}

export function selectArticles(
  selection: FeedSelection,
  articles: RSSArticle[],
  feeds: RSSFeed[],
  folders: RSSFolder[],
  now: number = Date.now(),
): RSSArticle[] {
  if (selection.type === 'view') {
    const today = toLocalDateKey(now);
    const keep: Record<SmartView, (article: RSSArticle) => boolean> = {
      today: (article) => toLocalDateKey(article.pubDate) === today,
      unread: (article) => !article.isRead,
      starred: (article) => article.isStarred,
      all: () => true,
    };
    return articles.filter(keep[selection.view]);
  }
  const ids = new Set(feedsOfSelection(selection, feeds, folders).map((feed) => feed.id));
  return articles.filter((article) => ids.has(article.feedId));
}

/** Title, summary and source, in all feeds. */
export function searchArticles(articles: RSSArticle[], feeds: RSSFeed[], search: string): RSSArticle[] {
  const query = normalizeForSearch(search);
  const matchingFeeds = new Set(feeds.filter((feed) => matchesSearch(feed.title, query)).map((feed) => feed.id));
  return articles.filter((article) => matchingFeeds.has(article.feedId)
    || matchesSearch(article.title, query)
    || matchesSearch(article.description, query));
}

export function sortArticles(articles: RSSArticle[], sort: ArticleSort): RSSArticle[] {
  const direction = sort === 'newest' ? -1 : 1;
  return [...articles].sort((a, b) => direction * (a.pubDate - b.pubDate));
}

export interface ArticleDay {
  key: string;
  articles: RSSArticle[];
}

/** Consecutive articles of the same local day. Expects sorted articles. */
export function groupByDay(articles: RSSArticle[]): ArticleDay[] {
  const days: ArticleDay[] = [];
  for (const article of articles) {
    const key = toLocalDateKey(article.pubDate);
    const last = days[days.length - 1];
    if (last?.key === key) last.articles.push(article);
    else days.push({ key, articles: [article] });
  }
  return days;
}

export function countUnread(articles: RSSArticle[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const article of articles) {
    if (!article.isRead) counts.set(article.feedId, (counts.get(article.feedId) ?? 0) + 1);
  }
  return counts;
}

/** Folder order after dropping one folder in front of another. */
export function moveBefore(ids: string[], moved: string, target: string): string[] {
  if (moved === target || !ids.includes(moved) || !ids.includes(target)) return ids;
  const rest = ids.filter((id) => id !== moved);
  rest.splice(rest.indexOf(target), 0, moved);
  return rest;
}

/** Folder order after moving one folder a step up or down. */
export function moveStep(ids: string[], moved: string, step: -1 | 1): string[] {
  const from = ids.indexOf(moved);
  const to = from + step;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Plain text of a summary that may hold HTML. */
export function toPlainText(html: string, maxLength: number): string {
  if (!html) return '';
  const text = new DOMParser().parseFromString(html.slice(0, maxLength * 8), 'text/html').body.textContent ?? '';
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** What the user means by "theverge.com", as an address; null when it is none. */
export function toFeedAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^[^/]+:\d+/.test(trimmed) ? trimmed : `https://${trimmed}`);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The address and its www twin: sites often redirect from one to the other. */
export function withWwwTwin(address: string): string[] {
  const url = new URL(address);
  const twin = new URL(address);
  twin.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`;
  return [address, twin.toString()];
}
