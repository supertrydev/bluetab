import { useCallback, useEffect, useMemo, useState } from 'react';
import { RSSService } from '@/services/rss-service';
import { Storage } from '@/utils/storage';
import { RSS_STORAGE_KEYS, type RSSArticle, type RSSFeed, type RSSFolder } from '@/types/rss';
import { countUnread } from './feed-view';

const flatten = (record: Record<string, RSSArticle[]> | null | undefined): RSSArticle[] =>
  Object.values(record ?? {}).flat().sort((a, b) => b.pubDate - a.pubDate);

/**
 * Feeds, folders and articles, kept in step with storage. Changes show at once
 * and are then written; the write comes back through the storage listener.
 */
export function useFeeds() {
  const [feeds, setFeeds] = useState<RSSFeed[]>([]);
  const [folders, setFolders] = useState<RSSFolder[]>([]);
  const [articles, setArticles] = useState<RSSArticle[]>([]);
  const [isReady, setIsReady] = useState(false);

  const reload = useCallback(async () => {
    const loadedFolders = await RSSService.getFolders();
    const [loadedFeeds, loadedArticles] = await Promise.all([
      RSSService.getFeeds(),
      RSSService.getArticles('all'),
    ]);
    setFolders(loadedFolders);
    setFeeds(loadedFeeds);
    setArticles(loadedArticles);
    setIsReady(true);
  }, []);

  useEffect(() => {
    void reload();
    const handleChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return;
      if (changes[RSS_STORAGE_KEYS.FEEDS]) setFeeds(changes[RSS_STORAGE_KEYS.FEEDS].newValue ?? []);
      if (changes[RSS_STORAGE_KEYS.ARTICLES]) setArticles(flatten(changes[RSS_STORAGE_KEYS.ARTICLES].newValue));
      if (changes[RSS_STORAGE_KEYS.FOLDERS]) {
        const next: RSSFolder[] = changes[RSS_STORAGE_KEYS.FOLDERS].newValue ?? [];
        setFolders([...next].sort((a, b) => a.order - b.order));
      }
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
  }, [reload]);

  const setRead = useCallback(async (ids: string[], isRead: boolean) => {
    const changed = new Set(ids);
    setArticles((prev) => prev.map((a) => (changed.has(a.id) ? { ...a, isRead } : a)));
    await RSSService.setArticlesRead(ids, isRead);
  }, []);

  const toggleStar = useCallback(async (article: RSSArticle) => {
    setArticles((prev) => prev.map((a) => (a.id === article.id ? { ...a, isStarred: !a.isStarred } : a)));
    await RSSService.toggleStar(article.id, article.feedId);
  }, []);

  const unread = useMemo(() => countUnread(articles), [articles]);
  const feedById = useMemo(() => new Map(feeds.map((feed) => [feed.id, feed])), [feeds]);

  return { feeds, folders, articles, unread, feedById, isReady, reload, setRead, toggleStar };
}

export interface FeedViewState {
  collapsedFolders: string[];
  sort: 'newest' | 'oldest';
  readerSize: number;
  readerWide: boolean;
  readerSerif: boolean;
}

const DEFAULT_VIEW: FeedViewState = {
  collapsedFolders: [],
  sort: 'newest',
  readerSize: 1,
  readerWide: false,
  readerSerif: false,
};

/** How this device last had the page set up. Not synced, not backed up. */
export function useFeedViewState(): [FeedViewState, (patch: Partial<FeedViewState>) => void] {
  const [view, setView] = useState<FeedViewState>(DEFAULT_VIEW);

  useEffect(() => {
    void Storage.get<Partial<FeedViewState>>(RSS_STORAGE_KEYS.VIEW).then((saved) => {
      if (saved) setView((prev) => ({ ...prev, ...saved }));
    });
  }, []);

  const update = useCallback((patch: Partial<FeedViewState>) => {
    setView((prev) => {
      const next = { ...prev, ...patch };
      void Storage.set(RSS_STORAGE_KEYS.VIEW, next);
      return next;
    });
  }, []);

  return [view, update];
}
