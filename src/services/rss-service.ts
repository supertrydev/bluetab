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
 *       - RingBuffer(50) for per-feed article eviction
 *       - deduplication by guid prevents re-insertion on refresh
 *       - all storage operations via Storage.get/set
 *
 * NOT:  Does not render UI. Does not perform DOMParser HTML extraction
 *       (Readability runs in options page context, writes back via setCachedContent).
 *       Does not manage the RSS_REFRESH alarm lifecycle (handled by service-worker).
 */

import { XMLParser } from 'fast-xml-parser';
import { Storage } from '@/utils/storage';
import { RingBuffer } from '@/utils/ring-buffer';
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
} from '@/types/rss';
import { RSS_STORAGE_KEYS, RSS_DEFAULTS } from '@/types/rss';

const LOG_PREFIX = '[BlueTab][RSSService]';

// fast-xml-parser instance shared across calls
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['item', 'entry', 'outline'].includes(name),
});

/**
 * Resolve the current per-feed article capacity from user settings,
 * clamped to the supported range. Used to build a fresh RingBuffer for
 * each refresh/subscribe cycle so edits in the settings panel take effect
 * on the very next operation without requiring a restart.
 *
 * Returns Infinity when the setting is 'unlimited' — RingBuffer.push and
 * trim both handle Infinity as "never evict".
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
  return (
    chrome.runtime.getURL(
      '_favicon/?pageUrl=' + encodeURIComponent(siteUrl) + '&size=32',
    )
  );
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
  await assertFeedHostAccess(url.toString());
  const response = await fetch(url.toString(), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    throw new Error(`Feed fetch failed with status ${response.status}`);
  }
  return response.text();
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
  /**
   * Subscribe to a feed URL: fetch XML, parse, store feed + initial articles.
   * Returns the created RSSFeed.
   *
   * @throws When the URL fails to fetch or the XML is not a recognised feed format
   */
  static async subscribeFeed(url: string): Promise<RSSFeed> {
    const xml = await fetchFeedXml(url);
    const parsed = parseFeed(xml); // throws if not a feed

    const now = Date.now();
    const id =
      now.toString(36) + Math.random().toString(36).slice(2, 8);

    // Determine site URL from feed link or fall back to feed URL origin
    let siteUrl = parsed.link;
    if (!siteUrl) {
      try {
        const u = new URL(url);
        siteUrl = u.origin;
      } catch {
        siteUrl = url;
      }
    }

    // Cap initial articles to the user-configured capacity so a large
    // initial fetch cannot bypass the per-feed storage budget. Items are
    // already sorted newest-first by itemsToArticles.
    const capacity = await getArticleCapacity();
    const initialArticles = itemsToArticles(parsed.items, id);
    const newArticles =
      initialArticles.length > capacity
        ? initialArticles.slice(0, capacity)
        : initialArticles;

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
      unreadCount: newArticles.length,
      isPinned: false,
      notificationsEnabled: false,
    };

    // Store feed
    const existingFeeds =
      (await Storage.get<RSSFeed[]>(RSS_STORAGE_KEYS.FEEDS)) ?? [];
    await Storage.set(RSS_STORAGE_KEYS.FEEDS, [...existingFeeds, feed]);

    // Store initial articles
    const existingArticles =
      (await Storage.get<Record<string, RSSArticle[]>>(
        RSS_STORAGE_KEYS.ARTICLES,
      )) ?? {};
    existingArticles[id] = newArticles;
    await Storage.set(RSS_STORAGE_KEYS.ARTICLES, existingArticles);

    console.log(
      `${LOG_PREFIX} Subscribed to "${feed.title}" (${newArticles.length} initial articles)`,
    );

    return feed;
  }

  /**
   * Unsubscribe from a feed: remove from feed list and delete its articles.
   */
  static async unsubscribeFeed(feedId: string): Promise<void> {
    const feeds =
      (await Storage.get<RSSFeed[]>(RSS_STORAGE_KEYS.FEEDS)) ?? [];
    await Storage.set(
      RSS_STORAGE_KEYS.FEEDS,
      feeds.filter((f) => f.id !== feedId),
    );

    const articles =
      (await Storage.get<Record<string, RSSArticle[]>>(
        RSS_STORAGE_KEYS.ARTICLES,
      )) ?? {};
    delete articles[feedId];
    await Storage.set(RSS_STORAGE_KEYS.ARTICLES, articles);

    console.log(`${LOG_PREFIX} Unsubscribed from feed "${feedId}"`);
  }

  /**
   * Return all subscribed feeds.
   */
  static async getFeeds(): Promise<RSSFeed[]> {
    return (await Storage.get<RSSFeed[]>(RSS_STORAGE_KEYS.FEEDS)) ?? [];
  }

  /**
   * Return articles for a specific feedId, or all articles sorted by pubDate
   * descending when feedId is 'all'.
   */
  static async getArticles(feedId: string): Promise<RSSArticle[]> {
    const articlesRecord =
      (await Storage.get<Record<string, RSSArticle[]>>(
        RSS_STORAGE_KEYS.ARTICLES,
      )) ?? {};

    if (feedId === 'all') {
      const all: RSSArticle[] = Object.values(articlesRecord).flat();
      return all.sort((a, b) => b.pubDate - a.pubDate);
    }

    return articlesRecord[feedId] ?? [];
  }

  /**
   * Refresh all feeds that are due (Date.now() >= nextPollAt).
   * Uses concurrent batches of 5 via Promise.allSettled.
   * Deduplicates by guid and applies a per-feed FIFO eviction cap sourced
   * from RSSSettings.articlesPerFeed (default RSS_DEFAULTS.ARTICLES_PER_FEED).
   *
   * @returns Record<feedId, FeedRefreshNotification> for feeds that were refreshed
   */
  static async refreshAllFeeds(): Promise<Record<string, FeedRefreshNotification>> {
    const feeds =
      (await Storage.get<RSSFeed[]>(RSS_STORAGE_KEYS.FEEDS)) ?? [];
    const articlesRecord =
      (await Storage.get<Record<string, RSSArticle[]>>(
        RSS_STORAGE_KEYS.ARTICLES,
      )) ?? {};

    const now = Date.now();
    const dueFeeds = feeds.filter((f) => now >= f.nextPollAt);

    if (dueFeeds.length === 0) {
      return {};
    }

    // Build a RingBuffer sized to the current setting. Recreated on every
    // refresh so changes in the settings panel apply to the next poll cycle
    // without requiring a service-worker restart.
    const capacity = await getArticleCapacity();
    const ringBuffer = new RingBuffer<RSSArticle>(capacity);

    const newCountsMap: Record<string, FeedRefreshNotification> = {};
    const updatedFeeds = [...feeds];

    type RefreshResult = { feedId: string; newArticles: RSSArticle[]; count: number; brandNewArticles: RSSArticle[] };

    const results = await runInBatches<RSSFeed, RefreshResult>(
      dueFeeds,
      async (feed) => {
        const xml = await fetchFeedXml(feed.url);
        const parsed = parseFeed(xml);

        const existingArticles = articlesRecord[feed.id] ?? [];
        const existingGuids = new Set(existingArticles.map((a) => a.guid));

        const freshArticles = itemsToArticles(parsed.items, feed.id);
        const brandNew = freshArticles.filter(
          (a) => !existingGuids.has(a.guid),
        );

        // If the setting was lowered since last refresh, trim any legacy
        // excess before appending new articles.
        let buffer = ringBuffer.trim(existingArticles, capacity);
        for (const article of brandNew) {
          buffer = ringBuffer.push(buffer, article);
        }

        return { feedId: feed.id, newArticles: buffer, count: brandNew.length, brandNewArticles: brandNew };
      },
    );

    // Apply results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { feedId, newArticles, count, brandNewArticles } = result.value;
        articlesRecord[feedId] = newArticles;
        newCountsMap[feedId] = {
          count,
          titles: brandNewArticles.slice(0, 5).map(a => a.title),
          firstLink: brandNewArticles.length === 1 ? brandNewArticles[0].link : null,
        };

        // Update feed metadata
        const feedIndex = updatedFeeds.findIndex((f) => f.id === feedId);
        if (feedIndex !== -1) {
          const feed = updatedFeeds[feedIndex];
          const additionalUnread = count;
          updatedFeeds[feedIndex] = {
            ...feed,
            lastFetchedAt: now,
            nextPollAt: now + feed.pollIntervalMinutes * 60 * 1000,
            unreadCount: feed.unreadCount + additionalUnread,
          };
        }
      } else {
        console.error(
          `${LOG_PREFIX} Failed to refresh a feed:`,
          result.reason,
        );
      }
    }

    await Storage.set(RSS_STORAGE_KEYS.ARTICLES, articlesRecord);
    await Storage.set(RSS_STORAGE_KEYS.FEEDS, updatedFeeds);

    const totalNew = Object.values(newCountsMap).reduce((a, b) => a + b.count, 0);
    console.log(`${LOG_PREFIX} Refresh complete — ${totalNew} new articles across ${dueFeeds.length} feeds`);

    return newCountsMap;
  }

  /**
   * Mark an article as read and decrement its feed's unreadCount.
   */
  static async markRead(articleId: string, feedId: string): Promise<void> {
    const [articlesRecord, feeds] = await Promise.all([
      Storage.get<Record<string, RSSArticle[]>>(RSS_STORAGE_KEYS.ARTICLES),
      Storage.get<RSSFeed[]>(RSS_STORAGE_KEYS.FEEDS),
    ]);

    const record = articlesRecord ?? {};
    const feedList = feeds ?? [];

    const feedArticles = record[feedId] ?? [];
    const updated = feedArticles.map((a) =>
      a.id === articleId ? { ...a, isRead: true } : a,
    );
    record[feedId] = updated;

    const updatedFeeds = feedList.map((f) =>
      f.id === feedId
        ? { ...f, unreadCount: Math.max(0, f.unreadCount - 1) }
        : f,
    );

    await Promise.all([
      Storage.set(RSS_STORAGE_KEYS.ARTICLES, record),
      Storage.set(RSS_STORAGE_KEYS.FEEDS, updatedFeeds),
    ]);
  }

  /**
   * Mark all articles in a feed as read and reset unreadCount to 0.
   */
  static async markAllRead(feedId: string): Promise<void> {
    const [articlesRecord, feeds] = await Promise.all([
      Storage.get<Record<string, RSSArticle[]>>(RSS_STORAGE_KEYS.ARTICLES),
      Storage.get<RSSFeed[]>(RSS_STORAGE_KEYS.FEEDS),
    ]);

    const record = articlesRecord ?? {};
    const feedList = feeds ?? [];

    const feedArticles = record[feedId] ?? [];
    record[feedId] = feedArticles.map((a) => ({ ...a, isRead: true }));

    const updatedFeeds = feedList.map((f) =>
      f.id === feedId ? { ...f, unreadCount: 0 } : f,
    );

    await Promise.all([
      Storage.set(RSS_STORAGE_KEYS.ARTICLES, record),
      Storage.set(RSS_STORAGE_KEYS.FEEDS, updatedFeeds),
    ]);
  }

  /**
   * Toggle the isStarred flag on an article.
   */
  static async toggleStar(articleId: string, feedId: string): Promise<void> {
    const articlesRecord =
      (await Storage.get<Record<string, RSSArticle[]>>(
        RSS_STORAGE_KEYS.ARTICLES,
      )) ?? {};

    const feedArticles = articlesRecord[feedId] ?? [];
    articlesRecord[feedId] = feedArticles.map((a) =>
      a.id === articleId ? { ...a, isStarred: !a.isStarred } : a,
    );

    await Storage.set(RSS_STORAGE_KEYS.ARTICLES, articlesRecord);
  }

  /**
   * Toggle the isPinned flag on a feed.
   */
  static async togglePin(feedId: string): Promise<void> {
    const feeds =
      (await Storage.get<RSSFeed[]>(RSS_STORAGE_KEYS.FEEDS)) ?? [];
    const updated = feeds.map((f) =>
      f.id === feedId ? { ...f, isPinned: !f.isPinned } : f,
    );
    await Storage.set(RSS_STORAGE_KEYS.FEEDS, updated);
  }

  /**
   * Update per-feed settings: pollIntervalMinutes and/or notificationsEnabled.
   */
  static async updateFeedSettings(
    feedId: string,
    settings: Partial<Pick<RSSFeed, 'pollIntervalMinutes' | 'notificationsEnabled' | 'category'>>,
  ): Promise<void> {
    const feeds =
      (await Storage.get<RSSFeed[]>(RSS_STORAGE_KEYS.FEEDS)) ?? [];
    const updated = feeds.map((f) =>
      f.id === feedId ? { ...f, ...settings } : f,
    );
    await Storage.set(RSS_STORAGE_KEYS.FEEDS, updated);
  }

  /**
   * Write extracted reader-mode HTML content to an article's cachedContent field.
   * The ReaderPanel calls this after running @mozilla/readability in the UI context.
   */
  static async setCachedContent(
    feedId: string,
    articleId: string,
    content: string,
  ): Promise<void> {
    const articlesRecord =
      (await Storage.get<Record<string, RSSArticle[]>>(
        RSS_STORAGE_KEYS.ARTICLES,
      )) ?? {};

    const feedArticles = articlesRecord[feedId] ?? [];
    articlesRecord[feedId] = feedArticles.map((a) =>
      a.id === articleId ? { ...a, cachedContent: content } : a,
    );

    await Storage.set(RSS_STORAGE_KEYS.ARTICLES, articlesRecord);
  }

  /**
   * Parse an OPML XML string and return all feed outlines with xmlUrl attributes.
   * Handles both flat and nested category structures recursively.
   */
  static async importOPML(opmlXml: string): Promise<OPMLFeed[]> {
    const parsed = xmlParser.parse(opmlXml) as Record<string, unknown>;
    const opml = (parsed['opml'] as Record<string, unknown>) ?? {};
    const body = (opml['body'] as Record<string, unknown>) ?? {};
    const outlines = (body['outline'] as unknown[]) ?? [];

    function extractFeeds(items: unknown[]): OPMLFeed[] {
      const feeds: OPMLFeed[] = [];
      for (const item of items) {
        const outline = item as Record<string, unknown>;
        const xmlUrl = outline['@_xmlUrl'] as string | undefined;
        if (xmlUrl) {
          feeds.push({
            title: String(outline['@_text'] ?? outline['@_title'] ?? ''),
            xmlUrl,
          });
        }
        // Recurse into nested outlines
        const nested = outline['outline'];
        if (Array.isArray(nested)) {
          feeds.push(...extractFeeds(nested));
        }
      }
      return feeds;
    }

    const result = extractFeeds(outlines);
    console.log(`${LOG_PREFIX} Imported ${result.length} feeds from OPML`);
    return result;
  }

  /**
   * Generate a valid OPML 2.0 XML string from the given feed list.
   * All attribute values are XML-escaped.
   */
  static exportOPML(feeds: RSSFeed[]): string {
    const outlines = feeds
      .map((f) => {
        const title = escapeXml(f.title);
        const xmlUrl = escapeXml(f.url);
        const htmlUrl = escapeXml(f.siteUrl);
        return `    <outline text="${title}" title="${title}" type="rss" xmlUrl="${xmlUrl}" htmlUrl="${htmlUrl}"/>`;
      })
      .join('\n');

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<opml version="2.0">',
      '  <head><title>BlueTab RSS Feeds</title></head>',
      '  <body>',
      outlines,
      '  </body>',
      '</opml>',
    ].join('\n');
  }

  /**
   * Fetch and parse a feed URL without persisting anything.
   * Used by AddFeedDialog to show a preview before the user confirms subscription.
   *
   * @throws When the URL fails to fetch or the XML is not a recognised feed format
   */
  static async previewFeed(url: string): Promise<ParsedFeed> {
    const xml = await fetchFeedXml(url);
    return parseFeed(xml);
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
