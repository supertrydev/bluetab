/**
 * Unit tests for RSSService
 *
 * Tests: subscribeFeed (RSS 2.0 + Atom), unsubscribeFeed, getFeeds, getArticles,
 *        refreshAllFeeds (deduplication, RingBuffer eviction, concurrent batching),
 *        toggleStar, togglePin, updateFeedSettings,
 *        importOPML (flat + nested), exportOPML,
 *        parseFeed edge cases (single-item, missing guid, Atom link attribute)
 *
 * All tests mock Storage and global fetch.
 */

import { RSSService } from './rss-service';
import { Storage } from '@/utils/storage';
import type { RSSFeed, RSSArticle } from '@/types/rss';
import { RSS_STORAGE_KEYS } from '@/types/rss';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;

// ---------------------------------------------------------------------------
// Sample feed XML fixtures
// ---------------------------------------------------------------------------

const RSS2_SINGLE_ITEM = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Blog</title>
    <link>https://example.com</link>
    <description>A test blog</description>
    <item>
      <title>Hello World</title>
      <link>https://example.com/hello</link>
      <guid>urn:uuid:abc123</guid>
      <description>First post</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const RSS2_MULTI_ITEM = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Multi Blog</title>
    <link>https://multi.com</link>
    <description>Multi item blog</description>
    <item>
      <title>Post One</title>
      <link>https://multi.com/post-1</link>
      <guid>guid-1</guid>
      <description>Post one desc</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Post Two</title>
      <link>https://multi.com/post-2</link>
      <guid>guid-2</guid>
      <description>Post two desc</description>
      <pubDate>Tue, 02 Jan 2024 00:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const RSS2_NO_GUID = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>No Guid Blog</title>
    <link>https://noguid.com</link>
    <description>Feed without guids</description>
    <item>
      <title>Guidless Post</title>
      <link>https://noguid.com/post</link>
      <description>No guid here</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <link href="https://atom.com" rel="alternate"/>
  <subtitle>An Atom feed</subtitle>
  <entry>
    <title>Atom Post One</title>
    <link href="https://atom.com/post-1" rel="alternate"/>
    <id>urn:uuid:atom-1</id>
    <summary>Atom post one summary</summary>
    <published>2024-01-01T00:00:00Z</published>
  </entry>
  <entry>
    <title>Atom Post Two</title>
    <link href="https://atom.com/post-2" rel="alternate"/>
    <id>urn:uuid:atom-2</id>
    <summary>Atom post two summary</summary>
    <published>2024-01-02T00:00:00Z</published>
  </entry>
</feed>`;

const ATOM_TEXT_TITLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Text Title Feed</title>
  <link href="https://texttitle.com"/>
  <entry>
    <title>Entry</title>
    <link href="https://texttitle.com/entry"/>
    <id>texttitle-1</id>
    <published>2024-01-01T00:00:00Z</published>
  </entry>
</feed>`;

const OPML_FLAT = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My Feeds</title></head>
  <body>
    <outline text="Example" title="Example" type="rss" xmlUrl="https://example.com/feed" htmlUrl="https://example.com"/>
    <outline text="Multi" title="Multi" type="rss" xmlUrl="https://multi.com/feed" htmlUrl="https://multi.com"/>
  </body>
</opml>`;

const OPML_NESTED = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Categorized</title></head>
  <body>
    <outline text="Tech">
      <outline text="Hacker News" type="rss" xmlUrl="https://hn.com/feed"/>
      <outline text="Lobsters" type="rss" xmlUrl="https://lobste.rs/rss"/>
    </outline>
    <outline text="News">
      <outline text="BBC" type="rss" xmlUrl="https://feeds.bbci.co.uk/news/rss.xml"/>
    </outline>
    <outline text="Direct" type="rss" xmlUrl="https://direct.com/feed"/>
  </body>
</opml>`;

// ---------------------------------------------------------------------------
// Helper: build an RSSFeed object
// ---------------------------------------------------------------------------

function makeFeed(overrides: Partial<RSSFeed> = {}): RSSFeed {
  return {
    id: 'feed-1',
    url: 'https://example.com/feed',
    title: 'Example Blog',
    description: 'A test blog',
    siteUrl: 'https://example.com',
    faviconUrl: '',
    format: 'rss2',
    addedAt: 1000000,
    lastFetchedAt: 0,
    nextPollAt: 0,
    pollIntervalMinutes: 60,
    unreadCount: 0,
    isPinned: false,
    notificationsEnabled: false,
    ...overrides,
  };
}

function makeArticle(overrides: Partial<RSSArticle> = {}): RSSArticle {
  return {
    id: 'feed-1:guid-1',
    feedId: 'feed-1',
    guid: 'guid-1',
    title: 'Post One',
    link: 'https://example.com/post-1',
    description: 'Post one desc',
    thumbnailUrl: '',
    pubDate: 1704067200000,
    isRead: false,
    isStarred: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

function mockFetch(xml: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(xml),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(2000000);
  mockedStorage.set.mockResolvedValue(undefined);
  mockedStorage.get.mockResolvedValue(null);
  (chrome.permissions.contains as jest.Mock).mockResolvedValue(true);
  (chrome.permissions.request as jest.Mock).mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// parseFeed (tested indirectly via subscribeFeed)
// ---------------------------------------------------------------------------

describe('RSSService.subscribeFeed', () => {
  it('parses a valid RSS 2.0 feed and returns structured RSSFeed', async () => {
    mockFetch(RSS2_MULTI_ITEM);
    mockedStorage.get.mockResolvedValue(null); // no existing feeds

    const feed = await RSSService.subscribeFeed('https://multi.com/feed');

    expect(feed.title).toBe('Multi Blog');
    expect(feed.siteUrl).toBe('https://multi.com');
    expect(feed.format).toBe('rss2');
    expect(feed.url).toBe('https://multi.com/feed');
    expect(feed.pollIntervalMinutes).toBe(60);
    expect(feed.unreadCount).toBeGreaterThanOrEqual(0);
  });

  it('parses a valid Atom 1.0 feed and returns structured RSSFeed', async () => {
    mockFetch(ATOM_FEED);
    mockedStorage.get.mockResolvedValue(null);

    const feed = await RSSService.subscribeFeed('https://atom.com/feed');

    expect(feed.title).toBe('Atom Blog');
    expect(feed.siteUrl).toBe('https://atom.com');
    expect(feed.format).toBe('atom');
  });

  it('stores feed in rssFeeds array in storage', async () => {
    mockFetch(RSS2_MULTI_ITEM);
    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.FEEDS) return [];
      return null;
    });

    await RSSService.subscribeFeed('https://multi.com/feed');

    expect(mockedStorage.set).toHaveBeenCalledWith(
      RSS_STORAGE_KEYS.FEEDS,
      expect.arrayContaining([expect.objectContaining({ title: 'Multi Blog' })]),
    );
  });

  it('rejects and throws when feed XML is invalid', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<not-a-feed>garbage</not-a-feed>'),
    } as unknown as Response);

    await expect(
      RSSService.subscribeFeed('https://bad.com/feed'),
    ).rejects.toThrow();
  });

  it('rejects when feed source access is not granted for the host', async () => {
    (chrome.permissions.contains as jest.Mock).mockResolvedValue(false);

    await expect(
      RSSService.subscribeFeed('https://forbidden.example/feed.xml'),
    ).rejects.toThrow('Feed source access is required for https://forbidden.example');
  });

  it('handles Atom feed with title as text-type object', async () => {
    mockFetch(ATOM_TEXT_TITLE);
    mockedStorage.get.mockResolvedValue(null);

    const feed = await RSSService.subscribeFeed('https://texttitle.com/feed');

    expect(feed.title).toBe('Text Title Feed');
  });
});

// ---------------------------------------------------------------------------
// single-item feed (isArray pitfall)
// ---------------------------------------------------------------------------

describe('RSSService - single-item RSS 2.0 feed', () => {
  it('correctly returns one article for a single-item feed (not an object)', async () => {
    mockFetch(RSS2_SINGLE_ITEM);
    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.FEEDS) return [];
      return null;
    });

    const feed = await RSSService.subscribeFeed('https://example.com/feed');

    // subscribeFeed also stores articles; verify articles stored correctly
    const articlesCallArgs = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.ARTICLES,
    );
    expect(articlesCallArgs).toBeDefined();
    const articlesRecord = articlesCallArgs![1] as Record<string, RSSArticle[]>;
    const articles = articlesRecord[feed.id];
    expect(Array.isArray(articles)).toBe(true);
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('Hello World');
  });
});

// ---------------------------------------------------------------------------
// missing guid fallback
// ---------------------------------------------------------------------------

describe('RSSService - missing guid falls back to link', () => {
  it('uses link as guid when guid element is absent', async () => {
    mockFetch(RSS2_NO_GUID);
    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.FEEDS) return [];
      return null;
    });

    const feed = await RSSService.subscribeFeed('https://noguid.com/feed');

    const articlesCallArgs = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.ARTICLES,
    );
    const articlesRecord = articlesCallArgs![1] as Record<string, RSSArticle[]>;
    const articles = articlesRecord[feed.id];
    expect(articles[0].guid).toBe('https://noguid.com/post');
  });
});

// ---------------------------------------------------------------------------
// unsubscribeFeed
// ---------------------------------------------------------------------------

describe('RSSService.unsubscribeFeed', () => {
  it('removes feed from rssFeeds array', async () => {
    const feeds = [makeFeed({ id: 'feed-1' }), makeFeed({ id: 'feed-2', url: 'https://b.com' })];
    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.FEEDS) return feeds;
      if (key === RSS_STORAGE_KEYS.ARTICLES) return {};
      return null;
    });

    await RSSService.unsubscribeFeed('feed-1');

    expect(mockedStorage.set).toHaveBeenCalledWith(
      RSS_STORAGE_KEYS.FEEDS,
      expect.not.arrayContaining([expect.objectContaining({ id: 'feed-1' })]),
    );
  });

  it('removes feed articles from rssArticles record', async () => {
    const feeds = [makeFeed({ id: 'feed-1' })];
    const articles: Record<string, RSSArticle[]> = {
      'feed-1': [makeArticle()],
      'feed-2': [makeArticle({ feedId: 'feed-2', id: 'feed-2:guid-x', guid: 'guid-x' })],
    };
    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.FEEDS) return feeds;
      if (key === RSS_STORAGE_KEYS.ARTICLES) return articles;
      return null;
    });

    await RSSService.unsubscribeFeed('feed-1');

    const articlesCallArgs = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.ARTICLES,
    );
    const savedArticles = articlesCallArgs![1] as Record<string, RSSArticle[]>;
    expect(savedArticles['feed-1']).toBeUndefined();
    expect(savedArticles['feed-2']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getFeeds
// ---------------------------------------------------------------------------

describe('RSSService.getFeeds', () => {
  it('returns RSSFeed[] from storage', async () => {
    const feeds = [makeFeed()];
    mockedStorage.get.mockResolvedValue(feeds);

    const result = await RSSService.getFeeds();

    expect(result).toEqual(feeds);
  });

  it('returns empty array when no feeds stored', async () => {
    mockedStorage.get.mockResolvedValue(null);

    const result = await RSSService.getFeeds();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getArticles
// ---------------------------------------------------------------------------

describe('RSSService.getArticles', () => {
  it('returns articles for a specific feedId', async () => {
    const article1 = makeArticle({ feedId: 'feed-1', id: 'feed-1:guid-1', pubDate: 1000 });
    const article2 = makeArticle({ feedId: 'feed-2', id: 'feed-2:guid-2', guid: 'guid-2', pubDate: 2000 });
    const articlesRecord = { 'feed-1': [article1], 'feed-2': [article2] };
    mockedStorage.get.mockResolvedValue(articlesRecord);

    const result = await RSSService.getArticles('feed-1');

    expect(result).toHaveLength(1);
    expect(result[0].feedId).toBe('feed-1');
  });

  it('returns all articles sorted by pubDate desc when feedId is "all"', async () => {
    const article1 = makeArticle({ feedId: 'feed-1', id: 'feed-1:guid-1', pubDate: 1000 });
    const article2 = makeArticle({ feedId: 'feed-2', id: 'feed-2:guid-2', guid: 'guid-2', pubDate: 3000 });
    const article3 = makeArticle({ feedId: 'feed-1', id: 'feed-1:guid-3', guid: 'guid-3', pubDate: 2000 });
    const articlesRecord = { 'feed-1': [article1, article3], 'feed-2': [article2] };
    mockedStorage.get.mockResolvedValue(articlesRecord);

    const result = await RSSService.getArticles('all');

    expect(result).toHaveLength(3);
    expect(result[0].pubDate).toBe(3000);
    expect(result[1].pubDate).toBe(2000);
    expect(result[2].pubDate).toBe(1000);
  });

  it('returns empty array when no articles found for feedId', async () => {
    mockedStorage.get.mockResolvedValue({});

    const result = await RSSService.getArticles('nonexistent');

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// refreshAllFeeds
// ---------------------------------------------------------------------------

describe('RSSService.refreshAllFeeds', () => {
  it('only refreshes feeds where Date.now() >= nextPollAt', async () => {
    const dueNow = Date.now(); // mocked to 2000000
    const feedDue = makeFeed({ id: 'feed-due', nextPollAt: dueNow - 1000 });
    const feedNotDue = makeFeed({ id: 'feed-not-due', url: 'https://notdue.com/feed', nextPollAt: dueNow + 60000 });

    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.FEEDS) return [feedDue, feedNotDue];
      if (key === RSS_STORAGE_KEYS.ARTICLES) return {};
      return null;
    });
    mockFetch(RSS2_MULTI_ITEM);

    await RSSService.refreshAllFeeds();

    // Should only fetch once (for the due feed)
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(feedDue.url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });

  it('deduplicates articles by guid on refresh', async () => {
    const existingArticle = makeArticle({
      id: 'feed-1:guid-1',
      feedId: 'feed-1',
      guid: 'guid-1',
      title: 'Old Title',
    });
    const feed = makeFeed({ id: 'feed-1', url: 'https://multi.com/feed', nextPollAt: 0 });

    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.FEEDS) return [feed];
      if (key === RSS_STORAGE_KEYS.ARTICLES) return { 'feed-1': [existingArticle] };
      return null;
    });
    mockFetch(RSS2_MULTI_ITEM); // has guid-1 and guid-2

    const result = await RSSService.refreshAllFeeds();

    const articlesCallArgs = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.ARTICLES,
    );
    const saved = articlesCallArgs![1] as Record<string, RSSArticle[]>;
    const articles = saved['feed-1'];

    // guid-1 already existed, only guid-2 is new
    const guids = articles.map((a: RSSArticle) => a.guid);
    expect(guids.filter((g: string) => g === 'guid-1')).toHaveLength(1);
    // Returns notification metadata for new articles.
    expect(result['feed-1']).toMatchObject({
      count: 1,
      articles: [{ title: 'Post Two', link: 'https://multi.com/post-2' }],
    });
  });

  it('applies configured RingBuffer eviction per feed when at capacity', async () => {
    const existingArticles: RSSArticle[] = Array.from({ length: 50 }, (_, i) =>
      makeArticle({ id: `feed-1:existing-${i}`, guid: `existing-${i}` }),
    );
    const feed = makeFeed({ id: 'feed-1', url: 'https://multi.com/feed', nextPollAt: 0 });

    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.FEEDS) return [feed];
      if (key === RSS_STORAGE_KEYS.ARTICLES) return { 'feed-1': existingArticles };
      // Use a tight cap of 50 so this test validates eviction without
      // depending on the default capacity (which is user-configurable).
      if (key === RSS_STORAGE_KEYS.SETTINGS) return { articlesPerFeed: 50 };
      return null;
    });
    mockFetch(RSS2_MULTI_ITEM); // 2 new articles (guid-1, guid-2)

    await RSSService.refreshAllFeeds();

    const articlesCallArgs = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.ARTICLES,
    );
    const saved = articlesCallArgs![1] as Record<string, RSSArticle[]>;
    const articles = saved['feed-1'];

    // Should not exceed configured 50-article cap
    expect(articles.length).toBeLessThanOrEqual(50);
  });

  it('updates feed lastFetchedAt and nextPollAt after refresh', async () => {
    const feed = makeFeed({ id: 'feed-1', url: 'https://multi.com/feed', nextPollAt: 0, pollIntervalMinutes: 60 });
    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.FEEDS) return [feed];
      if (key === RSS_STORAGE_KEYS.ARTICLES) return {};
      return null;
    });
    mockFetch(RSS2_MULTI_ITEM);

    await RSSService.refreshAllFeeds();

    const feedsCallArgs = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.FEEDS,
    );
    const savedFeeds = feedsCallArgs![1] as RSSFeed[];
    const savedFeed = savedFeeds.find((f) => f.id === 'feed-1')!;

    expect(savedFeed.lastFetchedAt).toBe(2000000);
    expect(savedFeed.nextPollAt).toBe(2000000 + 60 * 60 * 1000);
  });

  it('handles fetch errors gracefully (continues with other feeds)', async () => {
    const failFeed = makeFeed({ id: 'feed-fail', url: 'https://fail.com/feed', nextPollAt: 0 });
    const okFeed = makeFeed({ id: 'feed-ok', url: 'https://ok.com/feed', nextPollAt: 0 });

    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.FEEDS) return [failFeed, okFeed];
      if (key === RSS_STORAGE_KEYS.ARTICLES) return {};
      return null;
    });

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url === 'https://fail.com/feed') return Promise.reject(new Error('Network error'));
      return Promise.resolve({ ok: true, text: () => Promise.resolve(RSS2_MULTI_ITEM) } as unknown as Response);
    });

    // Should not throw
    await expect(RSSService.refreshAllFeeds()).resolves.not.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('skips all feeds when none are due', async () => {
    const feedNotDue = makeFeed({ id: 'feed-1', nextPollAt: Date.now() + 999999 });
    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.FEEDS) return [feedNotDue];
      return null;
    });

    await RSSService.refreshAllFeeds();

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// toggleStar
// ---------------------------------------------------------------------------

describe('RSSService.toggleStar', () => {
  it('flips isStarred from false to true', async () => {
    const article = makeArticle({ isStarred: false });
    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.ARTICLES) return { 'feed-1': [article] };
      return null;
    });

    await RSSService.toggleStar('feed-1:guid-1', 'feed-1');

    const articlesSet = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.ARTICLES,
    )!;
    const saved = articlesSet[1] as Record<string, RSSArticle[]>;
    expect(saved['feed-1'][0].isStarred).toBe(true);
  });

  it('flips isStarred from true to false', async () => {
    const article = makeArticle({ isStarred: true });
    mockedStorage.get.mockImplementation(async (key: string) => {
      if (key === RSS_STORAGE_KEYS.ARTICLES) return { 'feed-1': [article] };
      return null;
    });

    await RSSService.toggleStar('feed-1:guid-1', 'feed-1');

    const articlesSet = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.ARTICLES,
    )!;
    const saved = articlesSet[1] as Record<string, RSSArticle[]>;
    expect(saved['feed-1'][0].isStarred).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// togglePin
// ---------------------------------------------------------------------------

describe('RSSService.togglePin', () => {
  it('flips isPinned from false to true', async () => {
    const feed = makeFeed({ isPinned: false });
    mockedStorage.get.mockResolvedValue([feed]);

    await RSSService.togglePin('feed-1');

    const feedsSet = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.FEEDS,
    )!;
    const savedFeeds = feedsSet[1] as RSSFeed[];
    expect(savedFeeds[0].isPinned).toBe(true);
  });

  it('flips isPinned from true to false', async () => {
    const feed = makeFeed({ isPinned: true });
    mockedStorage.get.mockResolvedValue([feed]);

    await RSSService.togglePin('feed-1');

    const feedsSet = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.FEEDS,
    )!;
    const savedFeeds = feedsSet[1] as RSSFeed[];
    expect(savedFeeds[0].isPinned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateFeedSettings
// ---------------------------------------------------------------------------

describe('RSSService.updateFeedSettings', () => {
  it('updates pollIntervalMinutes and notificationsEnabled', async () => {
    const feed = makeFeed({ pollIntervalMinutes: 60, notificationsEnabled: false });
    mockedStorage.get.mockResolvedValue([feed]);

    await RSSService.updateFeedSettings('feed-1', {
      pollIntervalMinutes: 30,
      notificationsEnabled: true,
    });

    const feedsSet = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.FEEDS,
    )!;
    const savedFeeds = feedsSet[1] as RSSFeed[];
    expect(savedFeeds[0].pollIntervalMinutes).toBe(30);
    expect(savedFeeds[0].notificationsEnabled).toBe(true);
  });

  it('allows partial update (only notificationsEnabled)', async () => {
    const feed = makeFeed({ pollIntervalMinutes: 60, notificationsEnabled: false });
    mockedStorage.get.mockResolvedValue([feed]);

    await RSSService.updateFeedSettings('feed-1', { notificationsEnabled: true });

    const feedsSet = mockedStorage.set.mock.calls.find(
      (c) => c[0] === RSS_STORAGE_KEYS.FEEDS,
    )!;
    const savedFeeds = feedsSet[1] as RSSFeed[];
    expect(savedFeeds[0].pollIntervalMinutes).toBe(60); // unchanged
    expect(savedFeeds[0].notificationsEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// importOPML
// ---------------------------------------------------------------------------

describe('RSSService.importOPML', () => {
  it('extracts flat xmlUrl outlines from OPML', async () => {
    const result = await RSSService.importOPML(OPML_FLAT);

    expect(result).toHaveLength(2);
    expect(result[0].xmlUrl).toBe('https://example.com/feed');
    expect(result[1].xmlUrl).toBe('https://multi.com/feed');
  });

  it('extracts nested category outlines from OPML', async () => {
    const result = await RSSService.importOPML(OPML_NESTED);

    // Should find 4 feeds: 2 in Tech, 1 in News, 1 direct
    expect(result).toHaveLength(4);
    const xmlUrls = result.map((f) => f.xmlUrl);
    expect(xmlUrls).toContain('https://hn.com/feed');
    expect(xmlUrls).toContain('https://lobste.rs/rss');
    expect(xmlUrls).toContain('https://feeds.bbci.co.uk/news/rss.xml');
    expect(xmlUrls).toContain('https://direct.com/feed');
  });

  it('includes title from text/title attribute', async () => {
    const result = await RSSService.importOPML(OPML_FLAT);

    expect(result[0].title).toBe('Example');
  });
});

// ---------------------------------------------------------------------------
// exportOPML
// ---------------------------------------------------------------------------

describe('RSSService.exportOPML', () => {
  it('generates valid OPML 2.0 XML string from feed list', () => {
    const feeds = [
      makeFeed({ title: 'Example Blog', url: 'https://example.com/feed', siteUrl: 'https://example.com' }),
      makeFeed({ id: 'feed-2', title: 'Multi Blog', url: 'https://multi.com/feed', siteUrl: 'https://multi.com' }),
    ];

    const opml = RSSService.exportOPML(feeds);

    expect(opml).toContain('<?xml version="1.0"');
    expect(opml).toContain('<opml version="2.0">');
    expect(opml).toContain('xmlUrl="https://example.com/feed"');
    expect(opml).toContain('xmlUrl="https://multi.com/feed"');
    expect(opml).toContain('Example Blog');
    expect(opml).toContain('Multi Blog');
  });

  it('XML-escapes special characters in attributes', () => {
    const feeds = [
      makeFeed({ title: 'Feed <Test> & "Quoted"', url: 'https://example.com/feed' }),
    ];

    const opml = RSSService.exportOPML(feeds);

    // Title should be XML-escaped
    expect(opml).not.toContain('<Test>');
    expect(opml).toContain('&amp;');
  });

  it('returns empty body when feed list is empty', () => {
    const opml = RSSService.exportOPML([]);

    expect(opml).toContain('<opml');
    expect(opml).toContain('<body>');
  });
});
