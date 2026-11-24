/** @jest-environment jsdom */

import type { RSSArticle, RSSFeed, RSSFolder } from '@/types/rss';
import { getFeedTemplates } from '@/config/feed-templates';
import {
  NO_FOLDER, countUnread, feedsInFolder, groupByDay, isSameSelection, moveBefore, moveStep,
  searchArticles, selectArticles, sortArticles, toFeedAddress, toPlainText, withWwwTwin,
} from './feed-view';

const NOW = new Date(2026, 10, 24, 15).getTime();
const HOUR = 3_600_000;
const feed = (id: string, folderId?: string) => ({ id, title: `Feed ${id}`, folderId }) as RSSFeed;
const article = (id: string, feedId: string, ageHours: number, over: Partial<RSSArticle> = {}) =>
  ({ id, feedId, title: `Title ${id}`, description: '', pubDate: NOW - ageHours * HOUR, isRead: false, isStarred: false, ...over }) as RSSArticle;
const folders: RSSFolder[] = [{ id: 'news', name: 'News', order: 0 }];
const feeds = [feed('b', 'news'), feed('a', 'news'), feed('c'), feed('d', 'deleted-folder')];
const articles = [
  article('1', 'a', 1), article('2', 'b', 2, { isRead: true, isStarred: true }),
  article('3', 'c', 30), article('4', 'd', 60, { description: 'About the ferry', isRead: true }),
];
const ids = (list: { id: string }[]) => list.map((item) => item.id);

describe('feed selections', () => {
  it('lists the feeds of a folder, and those whose folder is gone as being in none', () => {
    expect(ids(feedsInFolder(feeds, folders, 'news'))).toEqual(['a', 'b']);
    expect(ids(feedsInFolder(feeds, folders, NO_FOLDER))).toEqual(['c', 'd']);
  });

  it('selects the articles of each view, folder and feed', () => {
    const select = (selection: Parameters<typeof selectArticles>[0]) => ids(selectArticles(selection, articles, feeds, folders, NOW));
    expect(select({ type: 'view', view: 'today' })).toEqual(['1', '2']);
    expect(select({ type: 'view', view: 'unread' })).toEqual(['1', '3']);
    expect(select({ type: 'view', view: 'starred' })).toEqual(['2']);
    expect(select({ type: 'view', view: 'all' })).toHaveLength(4);
    expect(select({ type: 'folder', id: 'news' })).toEqual(['1', '2']);
    expect(select({ type: 'folder', id: NO_FOLDER })).toEqual(['3', '4']);
    expect(select({ type: 'feed', id: 'c' })).toEqual(['3']);
  });

  it('tells selections apart', () => {
    expect(isSameSelection({ type: 'feed', id: 'x' }, { type: 'folder', id: 'x' })).toBe(false);
    expect(isSameSelection({ type: 'view', view: 'all' }, { type: 'view', view: 'all' })).toBe(true);
  });

  it('searches titles, summaries and sources', () => {
    expect(ids(searchArticles(articles, feeds, 'FERRY'))).toEqual(['4']);
    expect(ids(searchArticles(articles, feeds, 'feed b'))).toEqual(['2']);
    expect(ids(searchArticles(articles, feeds, 'title 3'))).toEqual(['3']);
  });

  it('counts, sorts and groups by day', () => {
    expect([...countUnread(articles)]).toEqual([['a', 1], ['c', 1]]);
    expect(ids(sortArticles(articles, 'oldest'))).toEqual(['4', '3', '2', '1']);
    expect(groupByDay(articles).map((day) => day.articles.length)).toEqual([2, 1, 1]);
  });
});

describe('folder order', () => {
  it('moves by drop and by step, and ignores impossible moves', () => {
    expect(moveBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveBefore(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
    expect(moveStep(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveStep(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
  });
});

describe('addresses and texts', () => {
  it.each([
    ['theverge.com', 'https://theverge.com/'], [' https://a.example/feed ', 'https://a.example/feed'],
    ['a.example:8080/feed', 'https://a.example:8080/feed'],
    ['hello', null], ['two words.com', null], ['ftp://a.example', null], ['javascript:alert(1)', null], ['', null],
  ])('reads %j as %j', (input, expected) => expect(toFeedAddress(input)).toBe(expected));

  it('knows the www twin of an address', () => {
    expect(withWwwTwin('https://a.example/x')[1]).toBe('https://www.a.example/x');
    expect(withWwwTwin('https://www.a.example/')[1]).toBe('https://a.example/');
  });

  it('turns a summary into plain text', () => {
    expect(toPlainText('<p>Tom &amp; <b>Jerry</b>\n\n run</p><script>x</script>', 50)).toContain('Tom & Jerry run');
    expect(toPlainText('<p>abcdef</p>', 3)).toBe('abc');
  });
});

describe('suggested sources', () => {
  it('offers Turkish sources only in a Turkish interface, and first there', () => {
    expect(getFeedTemplates('en').some((template) => template.language === 'tr')).toBe(false);
    expect(getFeedTemplates('pt-BR').every((template) => template.language === 'en')).toBe(true);
    expect(getFeedTemplates('tr')[0].language).toBe('tr');
  });
});
