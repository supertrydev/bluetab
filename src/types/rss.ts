/**
 * @module types/rss
 *
 * WHY:  Phase 4 RSS Reader needs a shared type system for feed subscriptions,
 *       articles, settings, OPML import/export, and parsed XML shapes.
 *       Without a central type definition, RSSService, UI components, and the
 *       service-worker alarm handler would all define incompatible shapes.
 *
 * WHAT: All TypeScript interfaces and constants for the RSS Reader feature.
 *       Covers feed subscriptions (RSSFeed), articles (RSSArticle), settings
 *       (RSSSettings), OPML portability (OPMLFeed), and parsed XML intermediate
 *       shapes (ParsedFeed, ParsedFeedItem).
 *
 * HOW:  Pure type definitions + const objects.
 *       No runtime dependencies. Imported by RSSService, UI components, and
 *       service-worker alarm handlers.
 *
 * NOT:  Does not contain runtime logic, storage access, or Chrome API calls.
 *       Does not define the alarm name registry (see config/alarms.ts).
 */

// ---------------------------------------------------------------------------
// Poll interval type
// ---------------------------------------------------------------------------

/** Allowed poll interval values in minutes */
export type PollInterval = 15 | 30 | 60 | 240 | 1440;

// ---------------------------------------------------------------------------
// Feed types
// ---------------------------------------------------------------------------

/** Supported RSS feed formats */
export type FeedFormat = 'rss2' | 'atom' | 'rss1';

export interface RSSFeed {
  /** Unique feed ID: composite of addedAt + random suffix */
  id: string;
  /** The RSS/Atom feed URL */
  url: string;
  /** Feed display title */
  title: string;
  /** Feed description or subtitle */
  description: string;
  /** The website URL associated with the feed (e.g. https://example.com) */
  siteUrl: string;
  /** Favicon URL fetched via Chrome _favicon API */
  faviconUrl: string;
  /** Detected feed format */
  format: FeedFormat;
  /** Epoch ms when user subscribed */
  addedAt: number;
  /** Epoch ms of last successful fetch (0 if never fetched) */
  lastFetchedAt: number;
  /** Epoch ms when this feed should next be polled */
  nextPollAt: number;
  /** How often to poll, in minutes */
  pollIntervalMinutes: PollInterval;
  /** Count of unread articles for this feed */
  unreadCount: number;
  /** Whether this feed is pinned at the top of the feed list */
  isPinned: boolean;
  /** Whether to fire Chrome notifications when new articles arrive */
  notificationsEnabled: boolean;
  /** User-assigned category label (e.g. "Technology", "News") */
  category?: string;
}

// ---------------------------------------------------------------------------
// Article types
// ---------------------------------------------------------------------------

export interface RSSArticle {
  /** Composite ID: feedId + ':' + guid */
  id: string;
  /** The parent feed's ID */
  feedId: string;
  /**
   * Globally unique article identifier from <guid> or <id> element.
   * Falls back to link when absent.
   */
  guid: string;
  /** Article title */
  title: string;
  /** Article URL */
  link: string;
  /** Article description or excerpt */
  description: string;
  /** Thumbnail image URL (if available from media:thumbnail or enclosure) */
  thumbnailUrl: string;
  /** Epoch ms publication date */
  pubDate: number;
  /** Whether the user has read this article */
  isRead: boolean;
  /** Whether the user has starred this article */
  isStarred: boolean;
  /** Cached reader-mode HTML content (set by RSSService.setCachedContent) */
  cachedContent?: string;
}

// ---------------------------------------------------------------------------
// Settings types
// ---------------------------------------------------------------------------

/** Available notification sound file names (without extension) */
export type NotificationSound =
  | 'ping' | 'drop' | 'blip' | 'soft-chime' | 'ripple'
  | 'level-up' | 'gentle-bell' | 'crystal' | 'shimmer' | 'breeze';

/** A notification filter rule for RSS articles */
export interface RSSNotificationFilter {
  id: string;
  /** 'mute' = suppress matching, 'allow' = only allow matching */
  mode: 'mute' | 'allow';
  /** Filter target */
  type: 'category' | 'keyword';
  /** The category name or keyword string to match */
  value: string;
  /** Whether this filter is active */
  enabled: boolean;
}

export interface RSSSettings {
  /** Default poll interval in minutes for newly subscribed feeds */
  defaultPollIntervalMinutes: PollInterval;
  /** Whether to play a sound on new article notifications (default true) */
  notificationSoundEnabled: boolean;
  /** Which sound to play (default 'ping') */
  notificationSound: NotificationSound;
  /** User-defined category labels */
  categories: string[];
  /** Notification filter rules */
  notificationFilters: RSSNotificationFilter[];
  /**
   * Maximum number of articles retained per feed before FIFO eviction.
   * Configurable from the RSS settings panel. Falls back to
   * RSS_DEFAULTS.ARTICLES_PER_FEED when unset.
   * Use the literal 'unlimited' to disable eviction entirely (the extension
   * holds `unlimitedStorage` permission, so the quota cap does not apply).
   */
  articlesPerFeed?: number | 'unlimited';
}

/** Summary of new articles for a single feed, used by notification logic */
export interface FeedRefreshNotification {
  count: number;
  /** First 5 new article titles (truncated for notification display) */
  titles: string[];
  /** First new article link (used for single-article click-to-open) */
  firstLink: string | null;
}

// ---------------------------------------------------------------------------
// OPML types
// ---------------------------------------------------------------------------

export interface OPMLFeed {
  /** Feed title from OPML outline @text or @title attribute */
  title: string;
  /** Feed URL from OPML outline @xmlUrl attribute */
  xmlUrl: string;
}

// ---------------------------------------------------------------------------
// Parsed XML intermediate shapes (internal to RSSService)
// ---------------------------------------------------------------------------

export interface ParsedFeedItem {
  /** Article title */
  title: string;
  /** Article URL (optional — some feeds omit it) */
  link?: string;
  /** Description or excerpt */
  description?: string;
  /** Publication date string (ISO or RFC 2822) */
  pubDate?: string;
  /** Globally unique ID from <guid> or Atom <id> */
  guid?: string;
  /** Thumbnail URL (from media:thumbnail or similar) */
  thumbnail?: string;
}

export interface ParsedFeed {
  /** Detected feed format */
  format: FeedFormat;
  /** Feed title */
  title: string;
  /** Feed description */
  description: string;
  /** Feed's associated website URL */
  link: string;
  /** Parsed article items */
  items: ParsedFeedItem[];
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

export const RSS_STORAGE_KEYS = {
  /** Key for RSSFeed[] array */
  FEEDS: 'rssFeeds',
  /** Key for Record<feedId, RSSArticle[]> */
  ARTICLES: 'rssArticles',
  /** Key for RSSSettings */
  SETTINGS: 'rssSettings',
} as const;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const RSS_DEFAULTS = {
  /** Default poll interval in minutes */
  POLL_INTERVAL_MINUTES: 60 as PollInterval,
  /**
   * Default max articles per feed (RingBuffer FIFO eviction target).
   * User-overridable via RSSSettings.articlesPerFeed.
   */
  ARTICLES_PER_FEED: 1000,
  /** Minimum value accepted for the per-feed article limit setting */
  ARTICLES_PER_FEED_MIN: 10,
  /** Maximum value accepted for the per-feed article limit setting */
  ARTICLES_PER_FEED_MAX: 10000,
  /** Advisory max feeds (not enforced) */
  MAX_FEEDS: 20,
} as const;
