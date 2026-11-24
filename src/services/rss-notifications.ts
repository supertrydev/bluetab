/**
 * @module services/rss-notifications
 *
 * WHY:  Decides which new articles are worth a notification and what it says.
 *
 * NOT:  Does not create notifications or play sounds; the service worker does.
 */

import { t } from '@/i18n';
import type { FeedRefreshNotification, RSSFeed, RSSNotificationFilter } from '@/types/rss';

/** Titles listed in one notification; the count covers all of them. */
const LISTED = 5;

export interface FeedNotification {
  title: string;
  message: string;
  /** Present when it is about one article. */
  link?: string;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether a folder rule keeps the feeds of this folder quiet. */
export function isFolderMuted(folderName: string | undefined, filters: RSSNotificationFilter[]): boolean {
  const rules = filters.filter((rule) => rule.enabled && rule.type === 'category');
  const names = (rule: RSSNotificationFilter) => folderName !== undefined && same(rule.value, folderName);
  if (rules.some((rule) => rule.mode === 'mute' && names(rule))) return true;
  const allowed = rules.filter((rule) => rule.mode === 'allow');
  return allowed.length > 0 && !allowed.some(names);
}

/** Whether the word rules let an article with this title through. */
export function passesWordRules(title: string, filters: RSSNotificationFilter[]): boolean {
  const rules = filters.filter((rule) => rule.enabled && rule.type === 'keyword');
  const contains = (rule: RSSNotificationFilter) => title.toLowerCase().includes(rule.value.toLowerCase());
  if (rules.some((rule) => rule.mode === 'mute' && contains(rule))) return false;
  const allowed = rules.filter((rule) => rule.mode === 'allow');
  return allowed.length === 0 || allowed.some(contains);
}

export function buildFeedNotification(
  feed: RSSFeed,
  result: FeedRefreshNotification,
  filters: RSSNotificationFilter[],
): FeedNotification | null {
  if (!feed.notificationsEnabled || isFolderMuted(feed.category, filters)) return null;
  const articles = result.articles.filter((article) => passesWordRules(article.title, filters));
  if (articles.length === 0) return null;
  if (articles.length === 1) {
    return { title: feed.title, message: articles[0].title, ...(articles[0].link ? { link: articles[0].link } : {}) };
  }
  const listed = articles.slice(0, LISTED).map((article) => `- ${article.title}`);
  if (articles.length > LISTED) listed.push('…');
  return {
    title: feed.title,
    message: `${t('options.feeds.newArticles', { count: articles.length })}\n${listed.join('\n')}`,
  };
}
