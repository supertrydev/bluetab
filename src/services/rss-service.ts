/**
 * @module services/rss-service
 *
 * WHY:  The RSS Reader feature requires a centralized service for all feed and
 *       article operations: subscribing, refreshing, reading, starring, pinning,
 *       OPML portability, and reader-mode content caching. Without a single
 *       service, UI components and the service-worker alarm handler would each
 *       implement fragmented storage access and parsing logic.
 *
 * WHAT: Static RSSService class providing all RSS feed CRUD, background refresh,
 *       deduplication, RingBuffer eviction, OPML import/export, and reader-mode
 *       content caching operations.
 *
 * HOW:  - feed parsing uses fast-xml-parser with isArray normalization
 *       - refresh uses Promise.allSettled in batches of 5 for concurrency
 *       - articles stored as Record<feedId, RSSArticle[]> under ARTICLES key
 *       - the newest articles per feed are kept; starred ones are never evicted
 *       - every write runs under one lock, so a background refresh and the page
 *         never overwrite each other
 *       - deduplication by guid prevents re-insertion on refresh
 *       - all storage operations via Storage.get/set
 *
 * NOT:  Does not render UI. Does not perform DOMParser HTML extraction
 *       (Readability runs in the feeds page, writes back via setArticleContent).
 *       Does not manage the RSS_REFRESH alarm lifecycle (handled by service-worker).
 */

import { siteFaviconUrl } from '@/platform/extension-platform';
import { XMLParser } from 'fast-xml-parser';
import { Storage } from '@/utils/storage';
import { discoverFeedLinks, WELL_KNOWN_FEED_PATHS } from '@/services/rss-discovery';
import { assertFeedHostAccess } from '@/services/rss-host-permissions';
import type {
  RSSFeed,
  RSSArticle,
  RSSSettings,
  OPMLFeed,
  ParsedFeed,
  ParsedFeedItem,
  FeedFormat,
  PollInterval,
  FeedRefreshNotification,
  RSSFolder,
  RSSErrorCode,
  RSSFeedError,
  RSSBackup,
  DiscoveredFeed,
} from '@/types/rss';
import { POLL_INTERVALS, RSS_STORAGE_KEYS, RSS_DEFAULTS } from '@/types/rss';

const LOG_PREFIX = '[BlueTab][RSSService]';

/** An error the UI can explain; `message` stays for logs. */
export class RSSError extends Error {
  constructor(readonly code: RSSErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = 'RSSError';
  }
}

function toFeedError(error: unknown, previous: RSSFeedError | undefined, now: number): RSSFeedError {
  const known = error instanceof RSSError ? error : undefined;
  return {
    code: known?.code ?? 'network',
    ...(known?.status ? { status: known.status } : {}),
    since: previous?.since ?? now,
  };
}

// One writer at a time, across the service worker and open pages.
let pendingWrite: Promise<unknown> = Promise.resolve();
function withLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks) return locks.request('bluetab-rss', run) as Promise<T>;
  const next = pendingWrite.catch(() => {}).then(run);
  pendingWrite = next;
  return next;
}

type ArticlesRecord = Record<string, RSSArticle[]>;

const readFeeds = async () => (await Storage.get<RSSFeed[]>(RSS_STORAGE_KEYS.FEEDS)) ?? [];
const readArticles = async () => (await Storage.get<ArticlesRecord>(RSS_STORAGE_KEYS.ARTICLES)) ?? {};
const readFolders = async () => (await Storage.get<RSSFolder[]>(RSS_STORAGE_KEYS.FOLDERS)) ?? [];
const contentKey = (feedId: string) => `${RSS_STORAGE_KEYS.CONTENT_PREFIX}${feedId}`;
const unreadOf = (articles: RSSArticle[] | undefined) => (articles ?? []).filter((a) => !a.isRead).length;

/** Two names are the same folder when they differ only in case or outer space. */
const folderKey = (name: string) => name.trim().toLowerCase();

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** The newest articles up to the limit, plus every starred one. */
function keepNewest(articles: RSSArticle[], capacity: number): RSSArticle[] {
  if (articles.length <= capacity) return articles;
  const newest = new Set(
    [...articles].sort((a, b) => b.pubDate - a.pubDate).slice(0, capacity).map((a) => a.id),
  );
  return articles.filter((a) => a.isStarred || newest.has(a.id));
}

// fast-xml-parser instance shared across calls
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['item', 'entry', 'outline'].includes(name),
});

/**
 * Resolve the current per-feed article capacity from user settings,
 * clamped to the supported range. Read again on every refresh, so edits in
 * the settings panel take effect without a restart.
 *
 * Returns Infinity when the setting is 'unlimited'.
 */
async function getArticleCapacity(): Promise<number> {
  const settings = await Storage.get<RSSSettings>(RSS_STORAGE_KEYS.SETTINGS);
  const raw = settings?.articlesPerFeed ?? RSS_DEFAULTS.ARTICLES_PER_FEED;
  if (raw === 'unlimited') return Infinity;
  return Math.min(
    RSS_DEFAULTS.ARTICLES_PER_FEED_MAX,
    Math.max(RSS_DEFAULTS.ARTICLES_PER_FEED_MIN, Math.floor(raw)),
  );
}

// Concurrent batch size for refreshAllFeeds
const REFRESH_BATCH_SIZE = 5;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getFaviconUrl(siteUrl: string): string {
  return siteFaviconUrl(siteUrl, 32);
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match172 = host.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host)) return true;
  return false;
}

function assertPublicHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid feed URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Feed URL must use http or https');
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error('Feed URL must be public');
  }
  return parsed;
}

async function fetchFeedXml(rawUrl: string): Promise<string> {
  const url = assertPublicHttpUrl(rawUrl);
  try {
    await assertFeedHostAccess(url.toString());
  } catch (error) {
    throw new RSSError('access', error instanceof Error ? error.message : String(error));
  }
  const response = await fetch(url.toString(), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    throw new RSSError('http', `Feed fetch failed with status ${response.status}`, response.status);
  }
  return response.text();
}

async function fetchFeed(url: string): Promise<ParsedFeed> {
  const xml = await fetchFeedXml(url);
  try {
    return parseFeed(xml);
  } catch (error) {
    throw new RSSError('format', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Detect the root element and normalise a parsed XML object into a ParsedFeed.
 * Supports RSS 2.0, Atom 1.0, and RSS 1.0.
 *
 * @throws Error when no recognised feed root element is found
 */
function parseFeed(xmlText: string): ParsedFeed {
  const parsed = xmlParser.parse(xmlText) as Record<string, unknown>;

  // RSS 2.0
  if (parsed['rss']) {
    const rss = parsed['rss'] as {
      channel?: {
        title?: string;
        link?: string;
        description?: string;
        item?: unknown[];
      };
    };
    const channel = rss.channel;
    if (!channel) throw new Error('RSS channel element missing');

    const items: ParsedFeedItem[] = ((channel.item as unknown[]) || []).map(
      (item) => {
        const i = item as Record<string, unknown>;
        return {
          title: String(i['title'] ?? ''),
          link: typeof i['link'] === 'string' ? i['link'] : undefined,
          description:
            typeof i['description'] === 'string'
              ? i['description']
              : undefined,
          pubDate: typeof i['pubDate'] === 'string' ? i['pubDate'] : undefined,
          guid:
            typeof i['guid'] === 'string'
              ? i['guid']
              : typeof (i['guid'] as Record<string, unknown>)?.['#text'] ===
                  'string'
                ? String((i['guid'] as Record<string, unknown>)['#text'])
                : undefined,
          thumbnail:
            typeof (i['media:thumbnail'] as Record<string, unknown>)?.[
              '@_url'
            ] === 'string'
              ? String(
                  (i['media:thumbnail'] as Record<string, unknown>)['@_url'],
                )
              : undefined,
        };
      },
    );

    return {
      format: 'rss2',
      title: String(channel.title ?? ''),
      description: String(channel.description ?? ''),
      link: String(channel.link ?? ''),
      items,
    };
  }

  // Atom 1.0
  if (parsed['feed']) {
    const feed = parsed['feed'] as Record<string, unknown>;

    // Title may be a string or an object with @_type and #text
    let title = '';
    if (typeof feed['title'] === 'string') {
      title = feed['title'];
    } else if (
      feed['title'] &&
      typeof (feed['title'] as Record<string, unknown>)['#text'] === 'string'
    ) {
      title = String((feed['title'] as Record<string, unknown>)['#text']);
    }

    // Feed link — look for rel="alternate" or first available href
    let feedLink = '';
    if (Array.isArray(feed['link'])) {
      const links = feed['link'] as Array<Record<string, unknown>>;
      const alt = links.find(
        (l) => l['@_rel'] === 'alternate' || !l['@_rel'],
      );
      feedLink = alt ? String(alt['@_href'] ?? '') : '';
    } else if (
      feed['link'] &&
      typeof (feed['link'] as Record<string, unknown>)['@_href'] === 'string'
    ) {
      feedLink = String((feed['link'] as Record<string, unknown>)['@_href']);
    } else if (typeof feed['link'] === 'string') {
      feedLink = feed['link'];
    }

    // Subtitle / description
    let description = '';
    if (typeof feed['subtitle'] === 'string') {
      description = feed['subtitle'];
    } else if (
      feed['subtitle'] &&
      typeof (feed['subtitle'] as Record<string, unknown>)['#text'] === 'string'
    ) {
      description = String(
        (feed['subtitle'] as Record<string, unknown>)['#text'],
      );
    }

    const entries = ((feed['entry'] as unknown[]) || []).map((entry) => {
      const e = entry as Record<string, unknown>;

      // Entry title
      let entryTitle = '';
      if (typeof e['title'] === 'string') {
        entryTitle = e['title'];
      } else if (
        e['title'] &&
        typeof (e['title'] as Record<string, unknown>)['#text'] === 'string'
      ) {
        entryTitle = String((e['title'] as Record<string, unknown>)['#text']);
      }

      // Entry link
      let entryLink = '';
      if (Array.isArray(e['link'])) {
        const links = e['link'] as Array<Record<string, unknown>>;
        const alt = links.find(
          (l) => l['@_rel'] === 'alternate' || !l['@_rel'],
        );
        entryLink = alt ? String(alt['@_href'] ?? '') : '';
      } else if (
        e['link'] &&
        typeof (e['link'] as Record<string, unknown>)['@_href'] === 'string'
      ) {
        entryLink = String((e['link'] as Record<string, unknown>)['@_href']);
      } else if (typeof e['link'] === 'string') {
        entryLink = e['link'];
      }

      // Description: summary or content
      let entryDesc = '';
      const summaryField = e['summary'] ?? e['content'];
      if (typeof summaryField === 'string') {
        entryDesc = summaryField;
      } else if (
        summaryField &&
        typeof (summaryField as Record<string, unknown>)['#text'] === 'string'
      ) {
        entryDesc = String(
          (summaryField as Record<string, unknown>)['#text'],
        );
      }

      // ID / guid
      let guid = '';
      if (typeof e['id'] === 'string') {
        guid = e['id'];
      } else if (
        e['id'] &&
        typeof (e['id'] as Record<string, unknown>)['#text'] === 'string'
      ) {
        guid = String((e['id'] as Record<string, unknown>)['#text']);
      }

      // Publication date
      const pubDate =
        typeof e['published'] === 'string'
          ? e['published']
          : typeof e['updated'] === 'string'
            ? e['updated']
            : undefined;

      return {
        title: entryTitle,
        link: entryLink || undefined,
        description: entryDesc || undefined,
        pubDate: pubDate as string | undefined,
        guid: guid || undefined,
      } satisfies ParsedFeedItem;
    });

    return {
      format: 'atom',
      title,
      description,
      link: feedLink,
      items: entries,
    };
  }

  // RSS 1.0 (RDF)
  if (parsed['rdf:RDF']) {
    const rdf = parsed['rdf:RDF'] as Record<string, unknown>;
    const channel = (rdf['channel'] as Record<string, unknown>) ?? {};
    const items: ParsedFeedItem[] = ((rdf['item'] as unknown[]) || []).map(
      (item) => {
        const i = item as Record<string, unknown>;
        return {
          title: String(i['title'] ?? ''),
          link: typeof i['link'] === 'string' ? i['link'] : undefined,
          description:
            typeof i['description'] === 'string'
              ? i['description']
              : undefined,
          guid: typeof i['link'] === 'string' ? i['link'] : undefined,
        };
      },
    );

    return {
      format: 'rss1',
      title: String(channel['title'] ?? ''),
      description: String(channel['description'] ?? ''),
      link: String(channel['link'] ?? ''),
      items,
    };
  }

  throw new Error(
    `${LOG_PREFIX} Unrecognised feed format — no <rss>, <feed>, or <rdf:RDF> root element found`,
  );
}

/**
 * Convert a ParsedFeedItem array to RSSArticle[] for a given feedId.
 * Articles without explicit guids fall back to their link.
 */
function itemsToArticles(
  items: ParsedFeedItem[],
  feedId: string,
): RSSArticle[] {
  return items
    .filter((item) => item.title)
    .map((item) => {
      const guid = item.guid || item.link || item.title;
      const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
      return {
        id: `${feedId}:${guid}`,
        feedId,
        guid,
        title: item.title,
        link: item.link ?? '',
        description: item.description ?? '',
        thumbnailUrl: item.thumbnail ?? '',
        pubDate: isNaN(pubDate) ? Date.now() : pubDate,
        isRead: false,
        isStarred: false,
      } satisfies RSSArticle;
    });
}

/**
 * Run a function in batches of REFRESH_BATCH_SIZE using Promise.allSettled.
 */
async function runInBatches<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = [];
  for (let i = 0; i < items.length; i += REFRESH_BATCH_SIZE) {
    const batch = items.slice(i, i + REFRESH_BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ---------------------------------------------------------------------------
// RSSService
// ---------------------------------------------------------------------------

export class RSSService {
  // -------------------------------------------------------------------------
  // Feeds
  // -------------------------------------------------------------------------

  /**
   * Subscribe to a feed URL: fetch XML, parse, store feed + initial articles.
   * Returns the created RSSFeed.
   *
   * @throws RSSError when the URL fails to fetch, is not a recognised feed
   *         format, or is already subscribed
   */
  static async subscribeFeed(url: string, options: { folderId?: string } = {}): Promise<RSSFeed> {
    if ((await readFeeds()).some((feed) => feed.url === url)) {
      throw new RSSError('duplicate', 'Already subscribed to this feed');
    }
    const parsed = await fetchFeed(url);

    const now = Date.now();
    const id = newId();

    // Determine site URL from feed link or fall back to feed URL origin
    let siteUrl = parsed.link;
    if (!siteUrl) {
      try {
        siteUrl = new URL(url).origin;
      } catch {
        siteUrl = url;
      }
    }

    return withLock(async () => {
      const [feeds, articles, folders, capacity] = await Promise.all([
        readFeeds(), readArticles(), readFolders(), getArticleCapacity(),
      ]);
      if (feeds.some((feed) => feed.url === url)) {
        throw new RSSError('duplicate', 'Already subscribed to this feed');
      }
      const initial = keepNewest(itemsToArticles(parsed.items, id), capacity);
      const folder = folders.find((item) => item.id === options.folderId);

      const feed: RSSFeed = {
        id,
        url,
        title: parsed.title || url,
        description: parsed.description,
        siteUrl,
        faviconUrl: getFaviconUrl(siteUrl),
        format: parsed.format,
        addedAt: now,
        lastFetchedAt: now,
        nextPollAt: now + RSS_DEFAULTS.POLL_INTERVAL_MINUTES * 60 * 1000,
        pollIntervalMinutes: RSS_DEFAULTS.POLL_INTERVAL_MINUTES,
        unreadCount: initial.length,
        isPinned: false,
        notificationsEnabled: false,
        ...(folder ? { folderId: folder.id, category: folder.name } : {}),
      };

      await Storage.set(RSS_STORAGE_KEYS.FEEDS, [...feeds, feed]);
      await Storage.set(RSS_STORAGE_KEYS.ARTICLES, { ...articles, [id]: initial });

      console.log(
        `${LOG_PREFIX} Subscribed to "${feed.title}" (${initial.length} initial articles)`,
      );
      return feed;
    });
  }

  /**
   * Unsubscribe from a feed: remove from feed list and delete its articles.
   */
  static async unsubscribeFeed(feedId: string): Promise<void> {
    await withLock(async () => {
      const feeds = await readFeeds();
      await Storage.set(RSS_STORAGE_KEYS.FEEDS, feeds.filter((f) => f.id !== feedId));

      const articles = await readArticles();
      delete articles[feedId];
      await Storage.set(RSS_STORAGE_KEYS.ARTICLES, articles);
      await Storage.remove(contentKey(feedId));
    });
    console.log(`${LOG_PREFIX} Unsubscribed from feed "${feedId}"`);
  }

  /**
   * Return all subscribed feeds.
   */
  static async getFeeds(): Promise<RSSFeed[]> {
    return readFeeds();
  }

  /**
   * Return articles for a specific feedId, or all articles sorted by pubDate
   * descending when feedId is 'all'.
   */
  static async getArticles(feedId: string): Promise<RSSArticle[]> {
    const articles = await readArticles();
    if (feedId === 'all') {
      return Object.values(articles).flat().sort((a, b) => b.pubDate - a.pubDate);
    }
    return articles[feedId] ?? [];
  }

  /**
   * Check feeds for new articles: the ones that are due, or with `force` all
   * of them. Fetches in batches of 5 and stores the results in one step, on
   * top of whatever the user changed in the meantime.
   *
   * @returns Record<feedId, FeedRefreshNotification> for feeds that were refreshed
   */
  static async refreshAllFeeds(
    options: { force?: boolean; feedIds?: string[] } = {},
  ): Promise<Record<string, FeedRefreshNotification>> {
    const startedAt = Date.now();
    const wanted = options.feedIds ? new Set(options.feedIds) : null;
    const checked = (await readFeeds()).filter((f) =>
      (!wanted || wanted.has(f.id)) && (options.force || startedAt >= f.nextPollAt),
    );
    if (checked.length === 0) return {};

    const fetched = await runInBatches(checked, (feed) => fetchFeed(feed.url));

    return withLock(async () => {
      const [feeds, articles, capacity] = await Promise.all([
        readFeeds(), readArticles(), getArticleCapacity(),
      ]);
      const now = Date.now();
      const notifications: Record<string, FeedRefreshNotification> = {};

      const updatedFeeds = feeds.map((feed) => {
        const index = checked.findIndex((item) => item.id === feed.id);
        if (index === -1) return feed;
        const nextPollAt = now + feed.pollIntervalMinutes * 60 * 1000;

        const result = fetched[index];
        if (result.status === 'rejected') {
          console.error(`${LOG_PREFIX} Failed to refresh a feed:`, result.reason);
          return { ...feed, lastError: toFeedError(result.reason, feed.lastError, now) };
        }

        const existing = articles[feed.id] ?? [];
        const knownGuids = new Set(existing.map((a) => a.guid));
        const fresh = itemsToArticles(result.value.items, feed.id).filter((a) => !knownGuids.has(a.guid));
        const kept = keepNewest([...existing, ...fresh], capacity);
        const keptIds = new Set(kept.map((a) => a.id));
        const added = fresh.filter((a) => keptIds.has(a.id));
        articles[feed.id] = kept;
        notifications[feed.id] = {
          count: added.length,
          articles: added.map(({ title, link }) => ({ title, link })),
        };

        const { lastError: _lastError, ...rest } = feed;
        return { ...rest, lastFetchedAt: now, nextPollAt, unreadCount: unreadOf(kept) };
      });

      await Storage.set(RSS_STORAGE_KEYS.ARTICLES, articles);
      await Storage.set(RSS_STORAGE_KEYS.FEEDS, updatedFeeds);

      const total = Object.values(notifications).reduce((sum, n) => sum + n.count, 0);
      console.log(`${LOG_PREFIX} Refresh complete, ${total} new articles across ${checked.length} feeds`);
      return notifications;
    });
  }

  /** Mark any number of articles, from any feeds, read or unread. */
  static async setArticlesRead(articleIds: string[], isRead: boolean): Promise<void> {
    const ids = new Set(articleIds);
    await withLock(async () => {
      const [articles, feeds] = await Promise.all([readArticles(), readFeeds()]);
      const changedFeeds = new Set<string>();
      for (const [feedId, list] of Object.entries(articles)) {
        if (!list.some((a) => ids.has(a.id) && a.isRead !== isRead)) continue;
        articles[feedId] = list.map((a) => (ids.has(a.id) ? { ...a, isRead } : a));
        changedFeeds.add(feedId);
      }
      if (changedFeeds.size > 0) await Storage.set(RSS_STORAGE_KEYS.ARTICLES, articles);
      await Storage.set(
        RSS_STORAGE_KEYS.FEEDS,
        feeds.map((f) => (articles[f.id] ? { ...f, unreadCount: unreadOf(articles[f.id]) } : f)),
      );
    });
  }

  /**
   * Toggle the isStarred flag on an article.
   */
  static async toggleStar(articleId: string, feedId: string): Promise<void> {
    await withLock(async () => {
      const articles = await readArticles();
      articles[feedId] = (articles[feedId] ?? []).map((a) =>
        a.id === articleId ? { ...a, isStarred: !a.isStarred } : a,
      );
      await Storage.set(RSS_STORAGE_KEYS.ARTICLES, articles);
    });
  }

  /**
   * Toggle the isPinned flag on a feed.
   */
  static async togglePin(feedId: string): Promise<void> {
    await RSSService.updateFeeds((f) => (f.id === feedId ? { ...f, isPinned: !f.isPinned } : f));
  }

  /**
   * Update per-feed settings. A new interval counts from the last check.
   */
  static async updateFeedSettings(
    feedId: string,
    settings: Partial<Pick<RSSFeed, 'title' | 'pollIntervalMinutes' | 'notificationsEnabled'>>,
  ): Promise<void> {
    await RSSService.updateFeeds((f) => {
      if (f.id !== feedId) return f;
      const next = { ...f, ...settings };
      if (settings.pollIntervalMinutes && f.lastFetchedAt > 0) {
        next.nextPollAt = f.lastFetchedAt + settings.pollIntervalMinutes * 60 * 1000;
      }
      return next;
    });
  }

  private static async updateFeeds(update: (feed: RSSFeed) => RSSFeed): Promise<void> {
    await withLock(async () => {
      await Storage.set(RSS_STORAGE_KEYS.FEEDS, (await readFeeds()).map(update));
    });
  }

  // -------------------------------------------------------------------------
  // Folders
  // -------------------------------------------------------------------------

  /**
   * Folders in their order. The first call after the update turns the old
   * free-text categories into folders; nothing else is changed by it.
   */
  static async getFolders(): Promise<RSSFolder[]> {
    if ((await Storage.get<RSSFolder[]>(RSS_STORAGE_KEYS.FOLDERS)) == null) {
      await withLock(() => RSSService.migrateCategories());
    }
    return (await readFolders()).sort((a, b) => a.order - b.order);
  }

  private static async migrateCategories(): Promise<void> {
    if ((await Storage.get<RSSFolder[]>(RSS_STORAGE_KEYS.FOLDERS)) != null) return;

    const [feeds, articles] = await Promise.all([readFeeds(), readArticles()]);
    const byKey = new Map<string, RSSFolder>();
    for (const feed of feeds) {
      const name = feed.category?.trim();
      if (name && !byKey.has(folderKey(name))) {
        byKey.set(folderKey(name), { id: newId(), name, order: 0 });
      }
    }
    const folders = [...byKey.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder, order) => ({ ...folder, order }));

    if (feeds.length > 0) {
      await Storage.set(RSS_STORAGE_KEYS.FEEDS, feeds.map((feed) => {
        const folder = feed.category ? byKey.get(folderKey(feed.category)) : undefined;
        return folder ? { ...feed, folderId: folder.id, category: folder.name } : feed;
      }));
    }

    // Reader texts move out of the article list, which is rewritten on every read.
    let moved = false;
    for (const [feedId, list] of Object.entries(articles)) {
      const withContent = list.filter((a) => a.cachedContent);
      if (withContent.length === 0) continue;
      moved = true;
      await Storage.set(contentKey(feedId), Object.fromEntries(
        withContent.slice(-RSS_DEFAULTS.CONTENT_PER_FEED).map((a) => [a.id, a.cachedContent]),
      ));
      articles[feedId] = list.map(({ cachedContent: _cachedContent, ...article }) => article);
    }
    if (moved) await Storage.set(RSS_STORAGE_KEYS.ARTICLES, articles);

    // Last, so an interrupted run starts over.
    await Storage.set(RSS_STORAGE_KEYS.FOLDERS, folders);
  }

  /** Create a folder, or return the one that already has this name. */
  static async createFolder(name: string): Promise<RSSFolder> {
    await RSSService.getFolders();
    return withLock(async () => {
      const folders = await readFolders();
      const existing = folders.find((f) => folderKey(f.name) === folderKey(name));
      if (existing) return existing;
      const folder: RSSFolder = {
        id: newId(),
        name: name.trim(),
        order: Math.max(-1, ...folders.map((f) => f.order)) + 1,
      };
      await Storage.set(RSS_STORAGE_KEYS.FOLDERS, [...folders, folder]);
      return folder;
    });
  }

  /**
   * Rename a folder. Its feeds and the notification filters that name it follow.
   *
   * @throws RSSError 'duplicate' when another folder has this name
   */
  static async renameFolder(folderId: string, name: string): Promise<void> {
    await withLock(async () => {
      const folders = await readFolders();
      const folder = folders.find((f) => f.id === folderId);
      const trimmed = name.trim();
      if (!folder || !trimmed) return;
      if (folders.some((f) => f.id !== folderId && folderKey(f.name) === folderKey(trimmed))) {
        throw new RSSError('duplicate', 'A folder with this name exists');
      }
      await Storage.set(RSS_STORAGE_KEYS.FOLDERS, folders.map((f) =>
        f.id === folderId ? { ...f, name: trimmed } : f,
      ));
      await Storage.set(RSS_STORAGE_KEYS.FEEDS, (await readFeeds()).map((f) =>
        f.folderId === folderId ? { ...f, category: trimmed } : f,
      ));
      await RSSService.updateFolderFilters(folder.name, trimmed);
    });
  }

  /** Delete a folder. Its feeds stay, in no folder. */
  static async deleteFolder(folderId: string): Promise<void> {
    await withLock(async () => {
      const folders = await readFolders();
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      await Storage.set(RSS_STORAGE_KEYS.FOLDERS, folders.filter((f) => f.id !== folderId));
      await Storage.set(RSS_STORAGE_KEYS.FEEDS, (await readFeeds()).map((f) => {
        if (f.folderId !== folderId) return f;
        const { folderId: _folderId, category: _category, ...rest } = f;
        return rest;
      }));
      await RSSService.updateFolderFilters(folder.name, null);
    });
  }

  /** Runs inside the lock. `null` drops the filters of a deleted folder. */
  private static async updateFolderFilters(oldName: string, newName: string | null): Promise<void> {
    const settings = await Storage.get<RSSSettings>(RSS_STORAGE_KEYS.SETTINGS);
    const filters = settings?.notificationFilters ?? [];
    const names = (value: string) => folderKey(value) === folderKey(oldName);
    if (!settings || !filters.some((f) => f.type === 'category' && names(f.value))) return;
    await Storage.set(RSS_STORAGE_KEYS.SETTINGS, {
      ...settings,
      notificationFilters: filters.flatMap((f) => {
        if (f.type !== 'category' || !names(f.value)) return [f];
        return newName === null ? [] : [{ ...f, value: newName }];
      }),
    });
  }

  /** Put the folders in this order; folders that are not listed keep their place at the end. */
  static async reorderFolders(folderIds: string[]): Promise<void> {
    await withLock(async () => {
      const folders = (await readFolders()).sort((a, b) => a.order - b.order);
      const rank = (folder: RSSFolder) => {
        const index = folderIds.indexOf(folder.id);
        return index === -1 ? folderIds.length : index;
      };
      await Storage.set(
        RSS_STORAGE_KEYS.FOLDERS,
        folders.sort((a, b) => rank(a) - rank(b)).map((folder, order) => ({ ...folder, order })),
      );
    });
  }

  /** Move feeds into a folder, or out of any with `undefined`. */
  static async moveFeeds(feedIds: string[], folderId: string | undefined): Promise<void> {
    const ids = new Set(feedIds);
    await withLock(async () => {
      const [feeds, folders] = await Promise.all([readFeeds(), readFolders()]);
      const folder = folders.find((f) => f.id === folderId);
      await Storage.set(RSS_STORAGE_KEYS.FEEDS, feeds.map((feed) => {
        if (!ids.has(feed.id)) return feed;
        const { folderId: _folderId, category: _category, ...rest } = feed;
        return folder ? { ...rest, folderId: folder.id, category: folder.name } : rest;
      }));
    });
  }

  /** Turn new-article notifications on or off for some feeds. */
  static async setNotifications(feedIds: string[], enabled: boolean): Promise<void> {
    const ids = new Set(feedIds);
    await RSSService.updateFeeds((f) => (ids.has(f.id) ? { ...f, notificationsEnabled: enabled } : f));
  }

  // -------------------------------------------------------------------------
  // Reader texts
  // -------------------------------------------------------------------------

  /** Reader-mode HTML of an article, if it was read before. */
  static async getArticleContent(article: RSSArticle): Promise<string | undefined> {
    const stored = await Storage.get<Record<string, string>>(contentKey(article.feedId));
    return stored?.[article.id] ?? article.cachedContent;
  }

  /**
   * Keep the extracted reader-mode HTML of an article, under a key of its own
   * so reading never rewrites the article list. The oldest texts make room.
   */
  static async setArticleContent(feedId: string, articleId: string, content: string): Promise<void> {
    await withLock(async () => {
      const stored = (await Storage.get<Record<string, string>>(contentKey(feedId))) ?? {};
      delete stored[articleId];
      const entries = [...Object.entries(stored), [articleId, content]];
      await Storage.set(
        contentKey(feedId),
        Object.fromEntries(entries.slice(-RSS_DEFAULTS.CONTENT_PER_FEED)),
      );
    });
  }

  // -------------------------------------------------------------------------
  // OPML
  // -------------------------------------------------------------------------

  /**
   * Parse an OPML XML string and return all feed outlines with xmlUrl
   * attributes, each with the innermost outline it is nested in.
   */
  static async importOPML(opmlXml: string): Promise<OPMLFeed[]> {
    const parsed = xmlParser.parse(opmlXml) as Record<string, unknown>;
    const opml = (parsed['opml'] as Record<string, unknown>) ?? {};
    const body = (opml['body'] as Record<string, unknown>) ?? {};
    const outlines = (body['outline'] as unknown[]) ?? [];

    function extractFeeds(items: unknown[], folder?: string): OPMLFeed[] {
      const feeds: OPMLFeed[] = [];
      for (const item of items) {
        const outline = item as Record<string, unknown>;
        const label = String(outline['@_text'] ?? outline['@_title'] ?? '');
        const xmlUrl = outline['@_xmlUrl'] as string | undefined;
        if (xmlUrl) {
          feeds.push({ title: label, xmlUrl, ...(folder ? { folder } : {}) });
        }
        // Recurse into nested outlines
        const nested = outline['outline'];
        if (Array.isArray(nested)) {
          feeds.push(...extractFeeds(nested, (xmlUrl ? folder : label.trim()) || folder));
        }
      }
      return feeds;
    }

    const result = extractFeeds(outlines);
    console.log(`${LOG_PREFIX} Imported ${result.length} feeds from OPML`);
    return result;
  }

  /**
   * Generate a valid OPML 2.0 XML string from the given feeds, nested in their
   * folders. All attribute values are XML-escaped.
   */
  static exportOPML(feeds: RSSFeed[], folders: RSSFolder[] = []): string {
    const outline = (f: RSSFeed, indent: string) => {
      const title = escapeXml(f.title);
      const xmlUrl = escapeXml(f.url);
      const htmlUrl = escapeXml(f.siteUrl);
      return `${indent}<outline text="${title}" title="${title}" type="rss" xmlUrl="${xmlUrl}" htmlUrl="${htmlUrl}"/>`;
    };
    const folderIds = new Set(folders.map((folder) => folder.id));
    const lines = folders.flatMap((folder) => {
      const inside = feeds.filter((f) => f.folderId === folder.id);
      if (inside.length === 0) return [];
      const name = escapeXml(folder.name);
      return [
        `    <outline text="${name}" title="${name}">`,
        ...inside.map((f) => outline(f, '      ')),
        '    </outline>',
      ];
    });
    lines.push(...feeds.filter((f) => !f.folderId || !folderIds.has(f.folderId)).map((f) => outline(f, '    ')));

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<opml version="2.0">',
      '  <head><title>Bluetab feeds</title></head>',
      '  <body>',
      ...lines,
      '  </body>',
      '</opml>',
    ].join('\n');
  }

  // -------------------------------------------------------------------------
  // Adding
  // -------------------------------------------------------------------------

  /**
   * Find the feeds at an address: the address itself when it is a feed, else
   * the ones its page announces, else the usual paths of the site.
   *
   * @throws RSSError when the address cannot be read
   */
  static async discoverFeeds(url: string): Promise<DiscoveredFeed[]> {
    const text = await fetchFeedXml(url);
    const asFeed = (address: string, parsed: ParsedFeed): DiscoveredFeed => ({
      url: address,
      title: parsed.title,
      articleCount: parsed.items.length,
      sampleTitles: parsed.items.slice(0, 3).map((item) => item.title).filter(Boolean),
    });
    try {
      return [asFeed(url, parseFeed(text))];
    } catch {
      // Not a feed: a web page.
    }

    const links = discoverFeedLinks(text, url);
    if (links.length > 0) return links;

    const guesses = await Promise.allSettled(WELL_KNOWN_FEED_PATHS.map(async (path) => {
      const address = new URL(path, url).toString();
      return asFeed(address, await fetchFeed(address));
    }));
    const found = guesses.find((guess) => guess.status === 'fulfilled');
    return found?.status === 'fulfilled' ? [found.value] : [];
  }

  // -------------------------------------------------------------------------
  // Backup
  // -------------------------------------------------------------------------

  /** Folders, subscriptions and starred articles; not the rest of the articles. */
  static async exportBackup(): Promise<RSSBackup> {
    const folders = await RSSService.getFolders();
    const [feeds, articles] = await Promise.all([readFeeds(), readArticles()]);
    return {
      folders,
      feeds: feeds.map(({ lastError: _lastError, ...feed }) => feed),
      starred: Object.values(articles).flat()
        .filter((a) => a.isStarred)
        .map(({ cachedContent: _cachedContent, ...article }) => article),
    };
  }

  /**
   * Add what a backup holds to what is here. Folders are matched by name and
   * feeds by address; nothing that exists is replaced.
   *
   * @returns how many feeds were added
   */
  static async importBackup(data: unknown): Promise<number> {
    const backup = data as Partial<RSSBackup> | null | undefined;
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null;
    const importedFeeds = (Array.isArray(backup?.feeds) ? backup.feeds : []).filter((f) => {
      if (!isRecord(f) || typeof f.id !== 'string' || typeof f.url !== 'string') return false;
      try {
        assertPublicHttpUrl(f.url);
        return true;
      } catch {
        return false;
      }
    });
    const importedFolders = (Array.isArray(backup?.folders) ? backup.folders : [])
      .filter((f) => isRecord(f) && typeof f.id === 'string' && typeof f.name === 'string' && f.name.trim());
    const starred = (Array.isArray(backup?.starred) ? backup.starred : [])
      .filter((a) => isRecord(a) && typeof a.guid === 'string' && typeof a.feedId === 'string' && typeof a.title === 'string');
    if (importedFeeds.length === 0 && importedFolders.length === 0) return 0;

    await RSSService.getFolders();
    return withLock(async () => {
      const [folders, feeds, articles] = await Promise.all([readFolders(), readFeeds(), readArticles()]);

      const folderByOldId = new Map<string, RSSFolder>();
      for (const imported of importedFolders) {
        let folder = folders.find((f) => folderKey(f.name) === folderKey(imported.name));
        if (!folder) {
          folder = { id: newId(), name: imported.name.trim(), order: folders.length };
          folders.push(folder);
        }
        folderByOldId.set(imported.id, folder);
      }

      const now = Date.now();
      const feedIdByOldId = new Map<string, string>();
      let added = 0;
      for (const imported of importedFeeds) {
        const existing = feeds.find((f) => f.url === imported.url);
        if (existing) {
          feedIdByOldId.set(imported.id, existing.id);
          continue;
        }
        const id = newId();
        const folder = imported.folderId ? folderByOldId.get(imported.folderId) : undefined;
        const siteUrl = typeof imported.siteUrl === 'string' ? imported.siteUrl : imported.url;
        feedIdByOldId.set(imported.id, id);
        feeds.push({
          id,
          url: imported.url,
          title: typeof imported.title === 'string' && imported.title ? imported.title : imported.url,
          description: typeof imported.description === 'string' ? imported.description : '',
          siteUrl,
          faviconUrl: getFaviconUrl(siteUrl),
          format: imported.format ?? 'rss2',
          addedAt: now,
          lastFetchedAt: 0,
          nextPollAt: now,
          pollIntervalMinutes: POLL_INTERVALS.includes(imported.pollIntervalMinutes)
            ? imported.pollIntervalMinutes
            : RSS_DEFAULTS.POLL_INTERVAL_MINUTES,
          unreadCount: 0,
          isPinned: imported.isPinned === true,
          notificationsEnabled: imported.notificationsEnabled === true,
          ...(folder ? { folderId: folder.id, category: folder.name } : {}),
        });
        articles[id] = [];
        added++;
      }

      for (const article of starred) {
        const feedId = feedIdByOldId.get(article.feedId);
        if (!feedId) continue;
        const list = articles[feedId] ?? [];
        const existing = list.find((a) => a.guid === article.guid);
        articles[feedId] = existing
          ? list.map((a) => (a === existing ? { ...a, isStarred: true } : a))
          : [...list, {
            id: `${feedId}:${article.guid}`,
            feedId,
            guid: article.guid,
            title: article.title,
            link: typeof article.link === 'string' ? article.link : '',
            description: typeof article.description === 'string' ? article.description : '',
            thumbnailUrl: typeof article.thumbnailUrl === 'string' ? article.thumbnailUrl : '',
            pubDate: typeof article.pubDate === 'number' ? article.pubDate : now,
            isRead: article.isRead === true,
            isStarred: true,
          }];
      }

      await Storage.set(RSS_STORAGE_KEYS.FOLDERS, folders);
      await Storage.set(RSS_STORAGE_KEYS.ARTICLES, articles);
      await Storage.set(RSS_STORAGE_KEYS.FEEDS, feeds.map((f) => ({ ...f, unreadCount: unreadOf(articles[f.id]) })));
      return added;
    });
  }

  /**
   * Internal static method exposed for testing — parses raw XML to ParsedFeed.
   * @internal
   */
  static _parseFeed(xmlText: string): ParsedFeed {
    return parseFeed(xmlText);
  }

  /**
   * Internal helper: get a favicon URL for a given site URL.
   * @internal
   */
  static _getFaviconUrl(siteUrl: string): string {
    return getFaviconUrl(siteUrl);
  }
}

// Re-export PollInterval and FeedFormat for service-worker and UI consumers
export type { PollInterval, FeedFormat };
