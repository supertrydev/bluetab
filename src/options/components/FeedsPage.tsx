/**
 * @module options/components/FeedsPage
 *
 * WHY:  Replaces the Plan 02 placeholder with the full three-panel RSS reading
 *       experience: feed list (left), article list (middle), reader panel (right).
 *       All state and async operations are owned here and passed down as props.
 *
 * WHAT: Three-panel layout container loading feeds and articles from RSSService,
 *       with a storage listener for reactive background-refresh updates.
 *       Includes OPML import/export actions and Save to Bluetab multi-select.
 *
 * NOT:  Does not manage navigation state — that belongs to options/main.tsx.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, PlusCircle, Bookmark, Rss, Search, X, ArrowLeft, Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToastManager } from '@/components/Toast';
import { formatDateTime } from '@/i18n/format';
import { isolateBidi } from '@/i18n/bidi';
import { ensureFeedHostAccess } from '@/services/rss-host-permissions';
import { RSSService } from '@/services/rss-service';
import { Storage } from '@/utils/storage';
import { RSS_STORAGE_KEYS } from '@/types/rss';
import { FeedListPanel } from './FeedListPanel';
import { ArticleListPanel } from './ArticleListPanel';
import { ReaderPanel } from './ReaderPanel';
import { OPMLActions } from './OPMLActions';
import { AddFeedDialog } from './AddFeedDialog';
import type { RSSFeed, RSSArticle, RSSSettings } from '@/types/rss';
import type { TabGroup, TabItem } from '@/types/models';

type MobileView = 'feeds' | 'articles' | 'reader';

interface FeedsPageProps {
  sidebarTrigger?: React.ReactNode;
}

export function FeedsPage({ sidebarTrigger }: FeedsPageProps = {}) {
  const { t } = useTranslation();
  const [feeds, setFeeds] = useState<RSSFeed[]>([]);
  const [articles, setArticles] = useState<RSSArticle[]>([]);
  const [allArticles, setAllArticles] = useState<RSSArticle[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>('all');
  const [categoryFilter, setCategoryFilter] = useState('__all__');
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [settingsCategories, setSettingsCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileView, setMobileView] = useState<MobileView>('articles');
  const [showFeedListMd, setShowFeedListMd] = useState(false);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadFeeds = useCallback(async () => {
    const loadedFeeds = await RSSService.getFeeds();
    setFeeds(loadedFeeds);
    return loadedFeeds;
  }, []);

  const loadArticles = useCallback(async (feedId: string) => {
    setIsLoading(true);
    try {
      const loaded = await RSSService.getArticles(feedId);
      setArticles(loaded);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadFeeds();
    RSSService.getArticles('all').then(setAllArticles);
    Storage.get<RSSSettings>(RSS_STORAGE_KEYS.SETTINGS).then((settings) => {
      if (settings?.categories) {
        setSettingsCategories(settings.categories);
      }
    });
  }, [loadFeeds]);

  // Load articles when selectedFeedId changes
  useEffect(() => {
    if (selectedFeedId) {
      loadArticles(selectedFeedId);
    } else {
      setArticles([]);
    }
  }, [selectedFeedId, loadArticles]);

  // ---------------------------------------------------------------------------
  // Storage listener — reactive updates when background refresh writes new data
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes[RSS_STORAGE_KEYS.FEEDS]) {
        setFeeds(changes[RSS_STORAGE_KEYS.FEEDS].newValue ?? []);
      }
      if (changes[RSS_STORAGE_KEYS.ARTICLES]) {
        const articlesRecord: Record<string, RSSArticle[]> =
          changes[RSS_STORAGE_KEYS.ARTICLES].newValue ?? {};
        const all: RSSArticle[] = Object.values(articlesRecord)
          .flat()
          .sort((a, b) => b.pubDate - a.pubDate);
        setAllArticles(all);
        if (selectedFeedId === 'all') {
          setArticles(all);
        } else if (selectedFeedId) {
          setArticles(articlesRecord[selectedFeedId] ?? []);
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [selectedFeedId]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSelectFeed = useCallback((feedId: string) => {
    setSelectedFeedId(feedId);
    setSearchQuery('');
    setSelectedArticleId(null);
    setSelectedArticleIds(new Set());
    setMobileView('articles');
    setShowFeedListMd(false);
  }, []);

  const handleSelectArticle = useCallback(async (articleId: string) => {
    setSelectedArticleId(articleId);
    setMobileView('reader');
    const article =
      articles.find((a) => a.id === articleId) ??
      allArticles.find((a) => a.id === articleId);
    if (article && !article.isRead) {
      // Optimistic update
      const markRead = (a: RSSArticle) => (a.id === articleId ? { ...a, isRead: true } : a);
      setArticles((prev) => prev.map(markRead));
      setAllArticles((prev) => prev.map(markRead));
      setFeeds((prev) =>
        prev.map((f) =>
          f.id === article.feedId ? { ...f, unreadCount: Math.max(0, f.unreadCount - 1) } : f,
        ),
      );
      await RSSService.markRead(articleId, article.feedId);
    }
  }, [articles, allArticles]);

  const handleMobileBack = useCallback(() => {
    setMobileView((current) => {
      if (current === 'reader') return 'articles';
      return 'feeds';
    });
  }, []);

  const handleToggleStar = useCallback(async (articleId: string, feedId: string) => {
    // Optimistic update
    const toggleStar = (a: RSSArticle) =>
      a.id === articleId ? { ...a, isStarred: !a.isStarred } : a;
    setArticles((prev) => prev.map(toggleStar));
    setAllArticles((prev) => prev.map(toggleStar));
    await RSSService.toggleStar(articleId, feedId);
  }, []);

  const handleTogglePin = useCallback(async (feedId: string) => {
    // Optimistic update
    setFeeds((prev) =>
      prev.map((f) => (f.id === feedId ? { ...f, isPinned: !f.isPinned } : f)),
    );
    await RSSService.togglePin(feedId);
  }, []);

  const handleOpenInTab = useCallback((url: string) => {
    chrome.tabs.create({ url, active: false });
  }, []);

  const handleUnsubscribe = useCallback(async (feedId: string) => {
    await RSSService.unsubscribeFeed(feedId);
    await loadFeeds();
    if (selectedFeedId === feedId) {
      setSelectedFeedId('all');
      setSelectedArticleId(null);
    }
    ToastManager.getInstance().success(t('options.feedsPage.feedRemoved'));
  }, [loadFeeds, selectedFeedId, t]);

  const handleMarkAllRead = useCallback(async (feedId: string) => {
    // Optimistic update
    const markRead = (a: RSSArticle) =>
      a.feedId === feedId ? { ...a, isRead: true } : a;
    setArticles((prev) => prev.map(markRead));
    setAllArticles((prev) => prev.map(markRead));
    setFeeds((prev) =>
      prev.map((f) => (f.id === feedId ? { ...f, unreadCount: 0 } : f)),
    );
    await RSSService.markAllRead(feedId);
  }, []);

  const handleMarkAllReadForSelected = useCallback(async () => {
    if (!selectedFeedId || selectedFeedId === 'all') return;
    await handleMarkAllRead(selectedFeedId);
  }, [selectedFeedId, handleMarkAllRead]);

  const handleAddFeed = useCallback(async (url: string, category?: string) => {
    try {
      const feed = await RSSService.subscribeFeed(url);
      const normalizedCategory = category?.trim();
      if (normalizedCategory) {
        await RSSService.updateFeedSettings(feed.id, { category: normalizedCategory });
      }
      await loadFeeds();
      ToastManager.getInstance().success(t('options.feedsPage.feedAdded'));
    } catch (err) {
      ToastManager.getInstance().error(
        err instanceof Error
          ? t('options.feedsPage.feedAddFailedWithMessage', { message: isolateBidi(err.message) })
          : t('options.feedsPage.feedAddFailed'),
      );
    }
  }, [loadFeeds, t]);

  const handleUpdateFeedSettings = useCallback(async (
    feedId: string,
    settings: Partial<Pick<RSSFeed, 'pollIntervalMinutes' | 'notificationsEnabled' | 'category'>>,
  ) => {
    // Optimistic update
    setFeeds((prev) =>
      prev.map((f) => (f.id === feedId ? { ...f, ...settings } : f)),
    );
    await RSSService.updateFeedSettings(feedId, settings);
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const granted = await ensureFeedHostAccess(feeds.map((feed) => feed.url));
      if (!granted) {
        ToastManager.getInstance().warning(t('options.feedsPage.siteAccessRequired'));
        return;
      }

      const newCounts = await RSSService.refreshAllFeeds();
      const total = Object.values(newCounts).reduce((a, b) => a + b.count, 0);
      if (total > 0) {
        ToastManager.getInstance().success(t('options.feedsPage.newArticlesFetched', { count: total }));
      } else {
        ToastManager.getInstance().success(t('options.feedsPage.upToDate'));
      }
      await loadFeeds();
      if (selectedFeedId) {
        await loadArticles(selectedFeedId);
      }
    } catch (err) {
      ToastManager.getInstance().error(t('options.feedsPage.refreshFailed'));
    } finally {
      setIsRefreshing(false);
    }
  }, [feeds, loadFeeds, loadArticles, selectedFeedId, t]);

  // ---------------------------------------------------------------------------
  // Multi-select: toggle article selection
  // ---------------------------------------------------------------------------

  const handleToggleSelect = useCallback((articleId: string) => {
    setSelectedArticleIds((prev) => {
      const next = new Set(prev);
      if (next.has(articleId)) {
        next.delete(articleId);
      } else {
        next.add(articleId);
      }
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Save to Bluetab
  // ---------------------------------------------------------------------------

  const handleSaveToBlueTab = useCallback(async () => {
    const selectedArticles = articles.filter((a) => selectedArticleIds.has(a.id));
    if (selectedArticles.length === 0) return;

    const tabs: TabItem[] = selectedArticles
      .filter((a) => a.link)
      .map((a) => ({
        id: crypto.randomUUID(),
        url: a.link,
        title: a.title,
        favicon: undefined,
        timestamp: Date.now(),
        groupId: 'rss',
      }));

    if (tabs.length === 0) {
      ToastManager.getInstance().warning(t('options.feedsPage.noSelectedUrls'));
      return;
    }

    const newGroup: TabGroup = {
      id: crypto.randomUUID(),
      name: t('options.feedsPage.defaultGroupName', { date: isolateBidi(formatDateTime(Date.now())) }),
      tabs,
      created: Date.now(),
      modified: Date.now(),
    };

    const existingGroups = (await Storage.get<TabGroup[]>('groups')) ?? [];
    await Storage.set('groups', [...existingGroups, newGroup]);

    setSelectedArticleIds(new Set());
    ToastManager.getInstance().success(t('options.feedsPage.savedArticles', { count: tabs.length }));
  }, [articles, selectedArticleIds, t]);

  // ---------------------------------------------------------------------------
  // Save single article to Bluetab (from reader panel)
  // ---------------------------------------------------------------------------

  const handleSaveArticleToBluetab = useCallback(async (article: RSSArticle) => {
    if (!article.link) return;

    const tab: TabItem = {
      id: crypto.randomUUID(),
      url: article.link,
      title: article.title,
      favicon: undefined,
      timestamp: Date.now(),
      groupId: 'rss',
    };

    const newGroup: TabGroup = {
      id: crypto.randomUUID(),
      name: article.title,
      tabs: [tab],
      created: Date.now(),
      modified: Date.now(),
    };

    const existingGroups = (await Storage.get<TabGroup[]>('groups')) ?? [];
    await Storage.set('groups', [...existingGroups, newGroup]);
    ToastManager.getInstance().success(t('options.feedsPage.articleSaved'));
  }, [t]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const isSearching = searchQuery.trim() !== '';

  // Global full-text search across all articles: matches title, description,
  // and feed title so users can surface articles by any of those fields.
  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const q = searchQuery.trim().toLowerCase();
    const feedTitleById = new Map(feeds.map((f) => [f.id, f.title.toLowerCase()]));
    return allArticles.filter((a) => {
      if (a.title.toLowerCase().includes(q)) return true;
      if (a.description && a.description.toLowerCase().includes(q)) return true;
      const feedTitle = feedTitleById.get(a.feedId);
      if (feedTitle && feedTitle.includes(q)) return true;
      return false;
    });
  }, [isSearching, searchQuery, allArticles, feeds]);

  const selectedFeedTitle = isSearching
    ? t('options.feedsPage.searchTitle', { query: searchQuery.trim() })
    : selectedFeedId === 'all'
      ? (categoryFilter !== '__all__'
          ? (categoryFilter === '__uncategorized__' ? t('options.feedsPage.uncategorized') : categoryFilter)
          : t('options.feedsPage.allFeeds'))
      : feeds.find((f) => f.id === selectedFeedId)?.title ?? t('options.feedsPage.fallbackTitle');

  // Combine categories from settings + categories already assigned to feeds
  const categories = Array.from(
    new Set([
      ...settingsCategories,
      ...feeds.map((f) => f.category).filter((c): c is string => Boolean(c)),
    ]),
  );

  // Filter articles by category when viewing 'all' and a category is selected.
  // Search results override everything — they span all feeds regardless of
  // current selection or category filter.
  const displayArticles = useMemo(() => {
    if (isSearching) return searchResults;
    if (selectedFeedId !== 'all' || categoryFilter === '__all__') return articles;
    const feedIdsInCategory = new Set(
      feeds
        .filter((f) => categoryFilter === '__uncategorized__' ? !f.category : f.category === categoryFilter)
        .map((f) => f.id),
    );
    return articles.filter((a) => feedIdsInCategory.has(a.feedId));
  }, [articles, feeds, selectedFeedId, categoryFilter, isSearching, searchResults]);

  const selectedArticle = displayArticles.find((a) => a.id === selectedArticleId) ?? null;

  const showMobileBack = mobileView !== 'feeds';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header bar */}
      <div className="sticky top-0 z-50 flex items-center gap-4 px-4 h-16 border-b border-border-glass shrink-0 bg-glass-bg backdrop-blur-md">
        <div className="flex items-center gap-2 shrink-0">
          {sidebarTrigger}
          {showMobileBack && (
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden h-8 w-8 p-0"
              onClick={handleMobileBack}
              aria-label={t('options.feedsPage.back')}
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex lg:hidden h-8 w-8 p-0"
            onClick={() => setShowFeedListMd((v) => !v)}
            aria-label={t('options.feedsPage.toggleFeedList')}
          >
            <Menu className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Rss className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold text-text-strong">{t('options.feedsPage.title')}</h1>
              <p className="text-xs text-text-muted">{t('options.feedsPage.subscriptions', { count: feeds.length })}</p>
            </div>
          </div>
        </div>

        {/* Global search — matches article title, description, and feed title
            across every subscribed feed regardless of current selection.
            Hidden on narrow mobile where it would crowd the refresh/add buttons. */}
        <div className="hidden sm:flex flex-1 justify-center min-w-0">
          <div className="relative w-full max-w-md">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
            <Input
              type="text"
              placeholder={t('options.feedsPage.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
              className="h-8 ps-8 pe-8 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute end-2 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center rounded-sm text-text-muted hover:text-text-strong transition-colors"
                aria-label={t('options.feedsPage.clearSearch')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* OPML import/export */}
          <div className="hidden sm:block">
            <OPMLActions feeds={feeds} onImportComplete={loadFeeds} />
          </div>

          {/* Save to Bluetab — visible when articles are selected */}
          {selectedArticleIds.size > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5 h-7 px-3 text-xs"
              onClick={handleSaveToBlueTab}
            >
              <Bookmark className="h-3.5 w-3.5" />
              {t('options.feedsPage.saveSelected', { count: selectedArticleIds.size })}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 sm:me-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('options.feedsPage.refresh')}</span>
          </Button>
          <Button size="sm" onClick={() => setShowAddFeed(true)}>
            <PlusCircle className="h-4 w-4 sm:me-1.5" />
            <span className="hidden sm:inline">{t('options.feedsPage.addFeed')}</span>
          </Button>
        </div>
      </div>

      {/* Three-panel body */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Left panel: Feed list */}
        <div
          className={[
            mobileView === 'feeds' ? 'flex' : 'hidden',
            'w-full md:w-56 xl:w-64 shrink-0 md:border-e border-border overflow-hidden bg-background',
            'md:absolute md:inset-y-0 md:start-0 md:z-20 md:shadow-lg lg:shadow-none lg:relative',
            showFeedListMd ? 'md:flex' : 'md:hidden',
            'lg:flex',
          ].join(' ')}
        >
          <FeedListPanel
            feeds={feeds}
            selectedFeedId={selectedFeedId}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            onSelectFeed={handleSelectFeed}
            onTogglePin={handleTogglePin}
            onUnsubscribe={handleUnsubscribe}
            onMarkAllRead={handleMarkAllRead}
            categories={categories}
            onUpdateFeedSettings={handleUpdateFeedSettings}
          />
        </div>

        {showFeedListMd && (
          <div
            className="absolute inset-0 bg-black/20 z-10 hidden md:block lg:hidden"
            onClick={() => setShowFeedListMd(false)}
            aria-hidden="true"
          />
        )}

        {/* Middle panel: Article list */}
        <div
          className={[
            mobileView === 'articles' ? 'flex' : 'hidden',
            'md:flex w-full md:w-72 xl:w-96 shrink-0 md:border-e border-border overflow-hidden',
          ].join(' ')}
        >
          <ArticleListPanel
            articles={displayArticles}
            selectedArticleId={selectedArticleId}
            feedTitle={selectedFeedTitle}
            isLoading={isLoading}
            selectedArticleIds={selectedArticleIds}
            onSelectArticle={handleSelectArticle}
            onToggleStar={handleToggleStar}
            onOpenInTab={handleOpenInTab}
            onMarkAllRead={handleMarkAllReadForSelected}
            onToggleSelect={handleToggleSelect}
          />
        </div>

        {/* Right panel: ReaderPanel */}
        <div
          className={[
            mobileView === 'reader' ? 'flex' : 'hidden',
            'md:flex flex-1 min-w-0 overflow-hidden',
          ].join(' ')}
        >
          <ReaderPanel
            article={selectedArticle}
            onOpenInTab={handleOpenInTab}
            onSaveToBluetab={handleSaveArticleToBluetab}
          />
        </div>
      </div>

      {/* Add Feed dialog */}
      <AddFeedDialog
        open={showAddFeed}
        onOpenChange={setShowAddFeed}
        onSubscribe={handleAddFeed}
        categories={categories}
      />
    </div>
  );
}
