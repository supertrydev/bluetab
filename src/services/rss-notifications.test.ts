import { initI18n } from '@/i18n';
import type { RSSFeed, RSSNotificationFilter } from '@/types/rss';
import { buildFeedNotification, isFolderMuted, passesWordRules } from './rss-notifications';

const rule = (mode: 'mute' | 'allow', type: 'category' | 'keyword', value: string, enabled = true): RSSNotificationFilter =>
  ({ id: `${mode}${type}${value}`, mode, type, value, enabled });
const feed = (over: Partial<RSSFeed> = {}) => ({ id: 'f', title: 'Feed', notificationsEnabled: true, category: 'News', ...over }) as RSSFeed;
const result = (...titles: string[]) => ({ count: titles.length, articles: titles.map((title) => ({ title, link: `https://a.example/${title}` })) });

beforeAll(() => initI18n({ language: 'en' }));

describe('feed notifications', () => {
  it('stays quiet for feeds that are off and for folders a rule mutes', () => {
    expect(buildFeedNotification(feed({ notificationsEnabled: false }), result('a'), [])).toBeNull();
    expect(buildFeedNotification(feed(), result('a'), [rule('mute', 'category', ' news')])).toBeNull();
    expect(buildFeedNotification(feed(), result('a'), [rule('mute', 'category', 'news', false)])).not.toBeNull();
    expect(isFolderMuted(undefined, [rule('allow', 'category', 'News')])).toBe(true);
    expect(isFolderMuted('NEWS', [rule('allow', 'category', 'News')])).toBe(false);
  });

  it('applies word rules to every title, not only the first few', () => {
    expect(passesWordRules('Big Sale today', [rule('mute', 'keyword', 'sale')])).toBe(false);
    expect(passesWordRules('Other', [rule('allow', 'keyword', 'sale')])).toBe(false);
    const notification = buildFeedNotification(feed(), result('1', '2', '3', '4', '5', 'sale'), [rule('allow', 'keyword', 'sale')]);
    expect(notification).toEqual({ title: 'Feed', message: 'sale', link: 'https://a.example/sale' });
  });

  it('counts all articles and lists the first five', () => {
    const notification = buildFeedNotification(feed(), result('1', '2', '3', '4', '5', '6', '7'), [])!;
    expect(notification.message.split('\n')).toEqual(['7 new articles', '- 1', '- 2', '- 3', '- 4', '- 5', '\u2026']);
    expect(notification.link).toBeUndefined();
  });

  it('speaks the language of the interface', async () => {
    await initI18n({ language: 'tr' });
    expect(buildFeedNotification(feed(), result('1', '2'), [])!.message).toContain('2 yeni makale');
    await initI18n({ language: 'en' });
  });
});
