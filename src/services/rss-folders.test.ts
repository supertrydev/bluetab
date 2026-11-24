/**
 * Folders, migration, safe refresh, reader texts, discovery and backup, run
 * against an in-memory storage.
 */

import { RSSService } from './rss-service';
import { discoverFeedLinks } from './rss-discovery';
import type { RSSArticle, RSSFeed, RSSFolder, RSSSettings } from '@/types/rss';

const store = new Map<string, unknown>();
jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => {
      const value = store.get(key);
      return value === undefined ? null : JSON.parse(JSON.stringify(value));
    }),
    set: jest.fn(async (key: string, value: unknown) => { store.set(key, JSON.parse(JSON.stringify(value))); }),
    remove: jest.fn(async (key: string) => { store.delete(key); }),
  },
}));

const feed = (id: string, over: Partial<RSSFeed> = {}): RSSFeed => ({
  id, url: `https://${id}.example/feed`, title: id, description: '', siteUrl: `https://${id}.example`, faviconUrl: '',
  format: 'rss2', addedAt: 1, lastFetchedAt: 1, nextPollAt: 0, pollIntervalMinutes: 60, unreadCount: 0,
  isPinned: false, notificationsEnabled: true, ...over,
});
const article = (feedId: string, guid: string, over: Partial<RSSArticle> = {}): RSSArticle => ({
  id: `${feedId}:${guid}`, feedId, guid, title: guid, link: `https://${feedId}.example/${guid}`, description: '',
  thumbnailUrl: '', pubDate: 1000, isRead: false, isStarred: false, ...over,
});
const rss = (guids: string[]) => `<rss version="2.0"><channel><title>T</title><link>https://a.example</link><description>d</description>${
  guids.map((g, i) => `<item><title>${g}</title><link>https://a.example/${g}</link><guid>${g}</guid><pubDate>${new Date(Date.UTC(2026, 0, 20 - i)).toUTCString()}</pubDate></item>`).join('')
}</channel></rss>`;
const respond = (body: string | Record<string, string>) => {
  global.fetch = jest.fn(async (url: string) => {
    const text = typeof body === 'string' ? body : body[url];
    return { ok: text !== undefined, status: text === undefined ? 404 : 200, text: async () => text } as Response;
  }) as unknown as typeof fetch;
};
const feeds = () => store.get('rssFeeds') as RSSFeed[];
const articles = () => store.get('rssArticles') as Record<string, RSSArticle[]>;
const folders = () => store.get('rssFolders') as RSSFolder[];
const feedById = (id: string) => feeds().find((item) => item.id === id)!;

beforeEach(() => {
  store.clear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (chrome.permissions.contains as jest.Mock).mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe('categories become folders', () => {
  beforeEach(() => {
    store.set('rssFeeds', [
      feed('a', { category: 'News' }), feed('b', { category: ' news ' }),
      feed('c', { category: 'Tech' }), feed('d'),
    ]);
    store.set('rssArticles', { a: [article('a', '1', { isRead: true, isStarred: true, cachedContent: '<p>text</p>' }), article('a', '2')] });
  });

  it('merges names that differ only in case or spaces and loses nothing', async () => {
    const result = await RSSService.getFolders();
    expect(result.map((item) => item.name)).toEqual(['News', 'Tech']);
    expect(feedById('a').folderId).toBe(feedById('b').folderId);
    expect(feedById('b').category).toBe('News');
    expect(feedById('d').folderId).toBeUndefined();
    expect(articles().a[0]).toMatchObject({ isRead: true, isStarred: true });
  });

  it('moves reader texts out of the article list and can still read them', async () => {
    await RSSService.getFolders();
    expect(articles().a[0].cachedContent).toBeUndefined();
    expect(await RSSService.getArticleContent(articles().a[0])).toBe('<p>text</p>');
  });

  it('runs once, also when two pages ask at the same time', async () => {
    const [first, second] = await Promise.all([RSSService.getFolders(), RSSService.getFolders()]);
    expect(first).toEqual(second);
    await RSSService.deleteFolder(first[0].id);
    expect(await RSSService.getFolders()).toHaveLength(1);
  });

  it('does not create folders for someone without feeds', async () => {
    store.clear();
    expect(await RSSService.getFolders()).toEqual([]);
    expect(store.has('rssFeeds')).toBe(false);
  });
});

describe('folders', () => {
  beforeEach(async () => {
    store.set('rssFeeds', [feed('a'), feed('b')]);
    store.set('rssSettings', { notificationFilters: [
      { id: '1', mode: 'allow', type: 'category', value: 'NEWS', enabled: true },
      { id: '2', mode: 'mute', type: 'keyword', value: 'news', enabled: true },
    ] });
  });
  const filters = () => (store.get('rssSettings') as RSSSettings).notificationFilters;

  it('keeps one folder per name', async () => {
    const first = await RSSService.createFolder('News');
    expect((await RSSService.createFolder(' news')).id).toBe(first.id);
    expect(folders()).toHaveLength(1);
  });

  it('renames a folder together with its feeds and notification filters', async () => {
    const folder = await RSSService.createFolder('News');
    await RSSService.moveFeeds(['a'], folder.id);
    await RSSService.renameFolder(folder.id, 'World');
    expect(feedById('a')).toMatchObject({ folderId: folder.id, category: 'World' });
    expect(filters().map((item) => item.value)).toEqual(['World', 'news']);
  });

  it('refuses a name another folder has', async () => {
    const folder = await RSSService.createFolder('News');
    await RSSService.createFolder('Tech');
    await expect(RSSService.renameFolder(folder.id, 'tech')).rejects.toMatchObject({ code: 'duplicate' });
  });

  it('keeps the feeds of a deleted folder and drops its filters, so nothing stays silenced', async () => {
    const folder = await RSSService.createFolder('News');
    await RSSService.moveFeeds(['a', 'b'], folder.id);
    await RSSService.deleteFolder(folder.id);
    expect(feeds()).toHaveLength(2);
    expect(feedById('a').folderId).toBeUndefined();
    expect(feedById('a').category).toBeUndefined();
    expect(filters().map((item) => item.type)).toEqual(['keyword']);
  });

  it('reorders folders and sets notifications for some feeds', async () => {
    const one = await RSSService.createFolder('One');
    const two = await RSSService.createFolder('Two');
    await RSSService.reorderFolders([two.id, one.id]);
    expect((await RSSService.getFolders()).map((item) => item.name)).toEqual(['Two', 'One']);
    await RSSService.moveFeeds(['a'], one.id);
    await RSSService.setNotifications(['a'], false);
    expect([feedById('a').notificationsEnabled, feedById('b').notificationsEnabled]).toEqual([false, true]);
  });
});

describe('refresh', () => {
  it('checks every feed when the user asks, due or not', async () => {
    store.set('rssFeeds', [feed('a', { nextPollAt: Date.now() + 1e9 })]);
    respond(rss(['1', '2']));
    expect(await RSSService.refreshAllFeeds()).toEqual({});
    expect((await RSSService.refreshAllFeeds({ force: true })).a.count).toBe(2);
    expect(feedById('a').unreadCount).toBe(2);
  });

  it('keeps what the user did while the feeds were being fetched', async () => {
    store.set('rssFeeds', [feed('a'), feed('gone')]);
    store.set('rssArticles', { a: [article('a', 'old')], gone: [] });
    global.fetch = jest.fn(async () => {
      await RSSService.setArticlesRead(['a:old'], true);
      if (feeds().some((item) => item.id === 'gone')) await RSSService.unsubscribeFeed('gone');
      return { ok: true, status: 200, text: async () => rss(['new']) } as Response;
    }) as unknown as typeof fetch;
    await RSSService.refreshAllFeeds({ force: true });
    expect(articles().a.find((item) => item.guid === 'old')?.isRead).toBe(true);
    expect(feeds().map((item) => item.id)).toEqual(['a']);
    expect(articles().gone).toBeUndefined();
    expect(feedById('a').unreadCount).toBe(1);
  });

  it('keeps the newest articles and every starred one, and does not report dropped ones as new', async () => {
    store.set('rssSettings', { articlesPerFeed: 10 });
    store.set('rssFeeds', [feed('a')]);
    store.set('rssArticles', { a: [article('a', 'starred', { isStarred: true, pubDate: 1 })] });
    const guids = Array.from({ length: 30 }, (_, i) => `g${i}`);
    respond(rss(guids));
    expect((await RSSService.refreshAllFeeds({ force: true })).a.count).toBe(10);
    expect(articles().a.map((item) => item.guid)).toEqual(['starred', ...guids.slice(0, 10)]);
    expect((await RSSService.refreshAllFeeds({ force: true })).a.count).toBe(0);
  });

  it('notes why a feed failed and since when, and clears it on success', async () => {
    store.set('rssFeeds', [feed('a')]);
    respond({});
    await RSSService.refreshAllFeeds({ force: true });
    const { since } = feedById('a').lastError!;
    expect(feedById('a').lastError).toMatchObject({ code: 'http', status: 404 });
    respond('<html></html>');
    await RSSService.refreshAllFeeds({ force: true });
    expect(feedById('a').lastError).toEqual({ code: 'format', since });
    respond(rss(['1']));
    await RSSService.refreshAllFeeds({ force: true });
    expect(feedById('a').lastError).toBeUndefined();
  });
});

describe('reading', () => {
  it('marks articles of several feeds read and back, and never loses quick successive changes', async () => {
    store.set('rssFeeds', [feed('a'), feed('b')]);
    store.set('rssArticles', { a: [article('a', '1'), article('a', '2')], b: [article('b', '1')] });
    await Promise.all([RSSService.setArticlesRead(['a:1'], true), RSSService.setArticlesRead(['a:2', 'b:1'], true), RSSService.toggleStar('a:1', 'a')]);
    expect(feeds().map((item) => item.unreadCount)).toEqual([0, 0]);
    expect(articles().a[0]).toMatchObject({ isRead: true, isStarred: true });
    await RSSService.setArticlesRead(['a:1', 'b:1'], false);
    expect(feeds().map((item) => item.unreadCount)).toEqual([1, 1]);
  });

  it('stores reader texts apart from the articles and forgets the oldest', async () => {
    store.set('rssArticles', { a: [article('a', '1')] });
    const before = JSON.stringify(articles());
    for (let i = 0; i < 101; i++) await RSSService.setArticleContent('a', `a:${i}`, `<p>${i}</p>`);
    expect(JSON.stringify(articles())).toBe(before);
    expect(await RSSService.getArticleContent(article('a', '0'))).toBeUndefined();
    expect(await RSSService.getArticleContent(article('a', '100'))).toBe('<p>100</p>');
  });
});

describe('adding', () => {
  it('finds the feeds a page announces', () => {
    expect(discoverFeedLinks(
      `<head><link rel="alternate" type="application/rss+xml" title="All &amp; more" href="/rss?a=1&amp;b=2">
       <link href='https://cdn.example/atom' type='application/atom+xml' rel='alternate'>
       <link rel="stylesheet" href="/x.css"><link rel="alternate" hreflang="tr" href="/tr">
       <link rel="alternate" type="application/rss+xml" href="javascript:alert(1)"></head>`,
      'https://a.example/blog',
    )).toEqual([
      { url: 'https://a.example/rss?a=1&b=2', title: 'All & more' },
      { url: 'https://cdn.example/atom', title: '' },
    ]);
  });

  it('accepts the feed address itself, or tries the usual paths of a site', async () => {
    respond(rss(['1']));
    expect(await RSSService.discoverFeeds('https://a.example/feed')).toMatchObject([{ articleCount: 1, sampleTitles: ['1'] }]);
    respond({ 'https://a.example/': '<html></html>', 'https://a.example/rss.xml': rss(['1', '2']) });
    expect(await RSSService.discoverFeeds('https://a.example/')).toMatchObject([{ url: 'https://a.example/rss.xml', articleCount: 2 }]);
    respond({ 'https://a.example/': '<html></html>' });
    expect(await RSSService.discoverFeeds('https://a.example/')).toEqual([]);
  });

  it('does not subscribe twice and puts the feed in its folder', async () => {
    const folder = await RSSService.createFolder('News');
    respond(rss(['1']));
    const added = await RSSService.subscribeFeed('https://a.example/feed', { folderId: folder.id });
    expect(added).toMatchObject({ folderId: folder.id, category: 'News' });
    await expect(RSSService.subscribeFeed('https://a.example/feed')).rejects.toMatchObject({ code: 'duplicate' });
    expect(feeds()).toHaveLength(1);
  });
});

describe('OPML', () => {
  it('keeps folders on the way out and back in', async () => {
    const list: RSSFolder[] = [{ id: 'f', name: 'Read & watch', order: 0 }, { id: 'empty', name: 'Empty', order: 1 }];
    const xml = RSSService.exportOPML([feed('a', { folderId: 'f' }), feed('b'), feed('c', { folderId: 'deleted' })], list);
    const back = await RSSService.importOPML(xml);
    expect(back.map((item) => [item.title, item.folder])).toEqual([['a', 'Read &amp; watch'], ['b', undefined], ['c', undefined]].map(
      ([title, name]) => [title, name?.replace('&amp;', '&')],
    ));
  });
});

describe('backup', () => {
  it('brings feeds, folders and stars back, without duplicating what is there', async () => {
    const folder = await RSSService.createFolder('News');
    store.set('rssFeeds', [feed('a', { folderId: folder.id, isPinned: true, pollIntervalMinutes: 240 }), feed('b')]);
    store.set('rssArticles', { a: [article('a', '1', { isStarred: true }), article('a', '2')], b: [] });
    const backup = JSON.parse(JSON.stringify(await RSSService.exportBackup()));
    expect(backup.starred).toHaveLength(1);

    store.clear();
    expect(await RSSService.importBackup(backup)).toBe(2);
    const restored = feeds().find((item) => item.url === 'https://a.example/feed')!;
    expect(restored).toMatchObject({ isPinned: true, pollIntervalMinutes: 240, category: 'News', folderId: folders()[0].id });
    expect(articles()[restored.id]).toMatchObject([{ guid: '1', isStarred: true, feedId: restored.id }]);

    expect(await RSSService.importBackup(backup)).toBe(0);
    expect(feeds()).toHaveLength(2);
    expect(folders()).toHaveLength(1);
  });

  it.each([[null], ['x'], [{ feeds: 'no' }], [{ feeds: [{ id: 1 }, { id: 'a', url: 'javascript:alert(1)' }, { id: 'b', url: 'http://127.0.0.1/feed' }] }]])(
    'ignores data that is not a feed backup: %j', async (data) => {
      expect(await RSSService.importBackup(data)).toBe(0);
      expect(store.has('rssFeeds')).toBe(false);
    },
  );
});
