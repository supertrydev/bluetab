/**
 * @module feeds/components/FeedsPage
 *
 * WHY:  Reading feeds: choose a source, go through its articles, read one.
 *
 * WHAT: Owns the selection, the search, the keyboard and every action. The
 *       sources are on one side, the articles next to them, and the reader
 *       only takes room while an article is open.
 *
 * NOT:  Does not store anything itself; see RSSService and useFeeds.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDirection } from '@radix-ui/react-direction';
import {
  AlertTriangle, ArrowDownUp, Bookmark, CheckCheck, CircleCheck, Download, FileUp, Keyboard, MoreHorizontal, PanelLeft, PlusCircle,
  RefreshCw, Rss, Search, Settings2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModalTemplate } from '@/components/ui/modal-template';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ToastManager } from '@/components/Toast';
import { formatDateTime } from '@/i18n/format';
import { isolateBidi } from '@/i18n/bidi';
import { cn } from '@/lib/utils';
import { ensureFeedHostAccess } from '@/services/rss-host-permissions';
import { RSSError, RSSService } from '@/services/rss-service';
import { Storage } from '@/utils/storage';
import type { RSSArticle, RSSFeed, RSSFolder } from '@/types/rss';
import type { TabGroup, TabItem } from '@/types/models';
import {
  NO_FOLDER, feedsInFolder, feedsOfSelection, hasReadFilter, searchArticles, selectArticles, sortArticles,
  type FeedSelection, type SmartView,
} from '../feed-view';
import { downloadOpml } from '../opml';
import { useFeeds, useFeedViewState } from '../use-feeds';
import { AddFeedDialog, AddFeedPanel } from './AddFeedDialog';
import { ArticleList } from './ArticleList';
import { ConfirmDialog, FeedSettingsDialog, FolderDialog, useFeedErrorText, type FeedSettingsValues } from './FeedDialogs';
import { Reader } from './Reader';
import { SourceTree } from './SourceTree';

const UNDO_MS = 10_000;

type Layout = 'wide' | 'medium' | 'narrow';

/** Three panes need room; the app sidebar may or may not be open next to them. */
function useLayout(): [(element: HTMLElement | null) => void, Layout] {
  const [layout, setLayout] = useState<Layout>('wide');
  const observerRef = useRef<ResizeObserver>();
  const ref = useCallback((element: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (!element) return;
    observerRef.current = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect;
      setLayout(width >= 1060 ? 'wide' : width >= 680 ? 'medium' : 'narrow');
    });
    observerRef.current.observe(element);
  }, []);
  return [ref, layout];
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  && !(target instanceof HTMLInputElement && target.type === 'checkbox');

interface FeedsPageProps {
  sidebarTrigger?: ReactNode;
}

export function FeedsPage({ sidebarTrigger }: FeedsPageProps) {
  const { t } = useTranslation();
  const direction = useDirection();
  const errorText = useFeedErrorText();
  const { feeds, folders, articles, unread, feedById, isReady, reload, setRead, toggleStar } = useFeeds();
  const [view, setView] = useFeedViewState();
  const [layoutRef, layout] = useLayout();

  const [selection, setSelection] = useState<FeedSelection>({ type: 'view', view: 'unread' });
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Read while this list is open: they stay until the list changes. */
  const [keptIds, setKeptIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTreeOpen, setIsTreeOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [areShortcutsOpen, setAreShortcutsOpen] = useState(false);
  const [folderDialog, setFolderDialog] = useState<{ folder?: RSSFolder } | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<RSSFolder | null>(null);
  const [feedToEdit, setFeedToEdit] = useState<RSSFeed | null>(null);
  const [feedToRemove, setFeedToRemove] = useState<RSSFeed | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const isSearching = search.trim() !== '';

  // -------------------------------------------------------------------------
  // What is shown
  // -------------------------------------------------------------------------

  const viewCounts = useMemo<Record<SmartView, number>>(() => {
    const unreadArticles = articles.filter((article) => !article.isRead);
    return {
      today: selectArticles({ type: 'view', view: 'today' }, unreadArticles, feeds, folders).length,
      unread: unreadArticles.length,
      starred: articles.filter((article) => article.isStarred).length,
      all: 0,
    };
  }, [articles, feeds, folders]);

  const base = useMemo(() => (
    isSearching
      ? searchArticles(articles, feeds, search)
      : selection.type === 'view' && selection.view === 'unread'
        ? articles
        : selectArticles(selection, articles, feeds, folders)
  ), [isSearching, articles, feeds, folders, search, selection]);

  const showsUnreadOnly = !isSearching
    && (hasReadFilter(selection) ? unreadOnly : selection.type === 'view' && selection.view === 'unread');
  const shown = useMemo(() => sortArticles(
    showsUnreadOnly ? base.filter((article) => !article.isRead || keptIds.has(article.id)) : base,
    view.sort,
  ), [base, showsUnreadOnly, keptIds, view.sort]);
  const unreadInBase = useMemo(() => base.filter((article) => !article.isRead), [base]);

  const listKey = isSearching ? `search:${search}` : `${JSON.stringify(selection)}:${unreadOnly}:${view.sort}`;
  const openArticle = openId ? articles.find((article) => article.id === openId) ?? null : null;
  const openIndex = openArticle ? shown.findIndex((article) => article.id === openArticle.id) : -1;
  const selectedFeed = !isSearching && selection.type === 'feed' ? feedById.get(selection.id) : undefined;
  const selectedFolder = selection.type === 'folder' ? folders.find((folder) => folder.id === selection.id) : undefined;

  const viewTitles: Record<SmartView, string> = {
    today: t('options.feeds.today'),
    unread: t('options.feeds.unread'),
    starred: t('options.feeds.starred'),
    all: t('options.feeds.all'),
  };
  const title = isSearching
    ? t('options.feedsPage.searchTitle', { query: isolateBidi(search.trim()) })
    : selection.type === 'view'
      ? viewTitles[selection.view]
      : selection.type === 'feed'
        ? selectedFeed?.title ?? ''
        : selectedFolder?.name ?? t('options.feeds.noFolder');

  // Opens on what is unread, or on everything when nothing is.
  const hasChosenStart = useRef(false);
  useEffect(() => {
    if (!isReady || hasChosenStart.current) return;
    hasChosenStart.current = true;
    if (articles.length > 0 && !articles.some((article) => !article.isRead)) {
      setSelection({ type: 'view', view: 'all' });
    }
  }, [isReady, articles]);

  // A feed or folder that is gone cannot stay selected.
  useEffect(() => {
    if (!isReady) return;
    const isGone = (selection.type === 'feed' && !feedById.has(selection.id))
      || (selection.type === 'folder' && selection.id !== NO_FOLDER && !folders.some((folder) => folder.id === selection.id));
    if (isGone) setSelection({ type: 'view', view: 'unread' });
  }, [isReady, selection, feedById, folders]);

  const startList = useCallback(() => {
    setKeptIds(new Set());
    setSelectedIds(new Set());
    setCursorId(null);
    setOpenId(null);
  }, []);

  const handleSelect = useCallback((next: FeedSelection) => {
    setSelection(next);
    setSearch('');
    startList();
    setIsTreeOpen(false);
    // Nothing unread there: show what it has instead of an empty list.
    setUnreadOnly(selectArticles(next, articles, feeds, folders).some((article) => !article.isRead));
  }, [articles, feeds, folders, startList]);

  // -------------------------------------------------------------------------
  // Articles
  // -------------------------------------------------------------------------

  const keep = useCallback((ids: string[]) => {
    setKeptIds((prev) => new Set([...prev, ...ids]));
  }, []);

  const handleOpen = useCallback((article: RSSArticle) => {
    setOpenId(article.id);
    setCursorId(article.id);
    if (!article.isRead) {
      keep([article.id]);
      void setRead([article.id], true);
    }
  }, [keep, setRead]);

  const handleToggleRead = useCallback((article: RSSArticle) => {
    keep([article.id]);
    void setRead([article.id], !article.isRead);
  }, [keep, setRead]);

  const handleOpenInTab = useCallback((article: RSSArticle) => {
    if (!article.link) return;
    void chrome.tabs.create({ url: article.link, active: false });
    if (!article.isRead) {
      keep([article.id]);
      void setRead([article.id], true);
    }
  }, [keep, setRead]);

  const markRead = useCallback((list: RSSArticle[]) => {
    const ids = list.filter((article) => !article.isRead).map((article) => article.id);
    if (ids.length === 0) return;
    keep(ids);
    void setRead(ids, true);
    ToastManager.getInstance().undo(t('options.feeds.markedRead', { count: ids.length }), {
      expiresAt: Date.now() + UNDO_MS,
      undo: async () => {
        await setRead(ids, false);
        return true;
      },
    });
  }, [keep, setRead, t]);

  const handleMarkAllRead = useCallback((target: FeedSelection) => {
    markRead(selectArticles(target, articles, feeds, folders));
  }, [articles, feeds, folders, markRead]);

  const saveArticles = useCallback(async (list: RSSArticle[], name: string): Promise<number> => {
    const groupId = crypto.randomUUID();
    const tabs: TabItem[] = list.filter((article) => article.link).map((article) => ({
      id: crypto.randomUUID(),
      url: article.link,
      title: article.title,
      favicon: feedById.get(article.feedId)?.faviconUrl || undefined,
      timestamp: Date.now(),
      groupId,
    }));
    if (tabs.length === 0) return 0;
    const group: TabGroup = { id: groupId, name, tabs, created: Date.now(), modified: Date.now() };
    await Storage.atomicUpdate<TabGroup[]>('groups', (current) => [...(current ?? []), group], []);
    return tabs.length;
  }, [feedById]);

  const handleSave = useCallback(async (article: RSSArticle) => {
    if (await saveArticles([article], article.title)) {
      ToastManager.getInstance().success(t('options.feedsPage.articleSaved'));
    }
  }, [saveArticles, t]);

  const handleToggleSelect = useCallback((article: RSSArticle, extend: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const last = [...prev].pop();
      const from = extend && last ? shown.findIndex((item) => item.id === last) : -1;
      const to = shown.findIndex((item) => item.id === article.id);
      if (from !== -1 && to !== -1) {
        shown.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((item) => next.add(item.id));
      } else if (!next.delete(article.id)) {
        next.add(article.id);
      }
      return next;
    });
  }, [shown]);

  const selectedArticles = shown.filter((article) => selectedIds.has(article.id));

  const handleSaveSelected = async () => {
    const count = await saveArticles(
      selectedArticles,
      t('options.feedsPage.defaultGroupName', { date: isolateBidi(formatDateTime(Date.now())) }),
    );
    if (count === 0) {
      ToastManager.getInstance().warning(t('options.feedsPage.noSelectedUrls'));
      return;
    }
    setSelectedIds(new Set());
    ToastManager.getInstance().success(t('options.feedsPage.savedArticles', { count }));
  };

  // -------------------------------------------------------------------------
  // Feeds and folders
  // -------------------------------------------------------------------------

  const refresh = useCallback(async (list: RSSFeed[]) => {
    if (list.length === 0) return;
    setIsRefreshing(true);
    try {
      const granted = await ensureFeedHostAccess(list.map((feed) => feed.url));
      if (!granted) {
        ToastManager.getInstance().warning(t('options.feedsPage.siteAccessRequired'));
        return;
      }
      const results = await RSSService.refreshAllFeeds({ force: true, feedIds: list.map((feed) => feed.id) });
      const total = Object.values(results).reduce((sum, result) => sum + result.count, 0);
      const failed = list.length - Object.keys(results).length;
      if (failed > 0) ToastManager.getInstance().warning(t('options.feeds.someFailed', { count: failed }));
      else if (total > 0) ToastManager.getInstance().success(t('options.feedsPage.newArticlesFetched', { count: total }));
      else ToastManager.getInstance().success(t('options.feedsPage.upToDate'));
    } catch {
      ToastManager.getInstance().error(t('options.feedsPage.refreshFailed'));
    } finally {
      setIsRefreshing(false);
    }
  }, [t]);

  const handleAdded = useCallback((feed?: RSSFeed) => {
    void reload();
    if (feed) {
      setSelection({ type: 'feed', id: feed.id });
      setUnreadOnly(true);
      setSearch('');
      startList();
    }
  }, [reload, startList]);

  const handleFolderName = async (name: string): Promise<string | undefined> => {
    const folder = folderDialog?.folder;
    if (!folder) {
      if (folders.some((item) => item.name.trim().toLowerCase() === name.toLowerCase())) return t('options.feeds.folderExists');
      await RSSService.createFolder(name);
      return undefined;
    }
    try {
      await RSSService.renameFolder(folder.id, name);
      return undefined;
    } catch (error) {
      if (error instanceof RSSError && error.code === 'duplicate') return t('options.feeds.folderExists');
      throw error;
    }
  };

  const handleSaveSettings = async (feed: RSSFeed, { folderId, ...settings }: FeedSettingsValues) => {
    await RSSService.updateFeedSettings(feed.id, settings);
    if (folderId !== feed.folderId) await RSSService.moveFeeds([feed.id], folderId);
  };

  const handleToggleFolder = (folderId: string) => setView({
    collapsedFolders: view.collapsedFolders.includes(folderId)
      ? view.collapsedFolders.filter((id) => id !== folderId)
      : [...view.collapsedFolders, folderId],
  });

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  const step = useCallback((offset: 1 | -1) => {
    if (shown.length === 0) return;
    const index = shown.findIndex((article) => article.id === (cursorId ?? openId));
    const next = shown[index === -1 ? (offset === 1 ? 0 : shown.length - 1) : Math.min(shown.length - 1, Math.max(0, index + offset))];
    if (openId) handleOpen(next);
    else setCursorId(next.id);
  }, [shown, cursorId, openId, handleOpen]);

  const isDialogOpen = isAdding || areShortcutsOpen || isTreeOpen || folderDialog !== null || folderToDelete !== null
    || feedToEdit !== null || feedToRemove !== null;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (isDialogOpen || feeds.length === 0 || document.querySelector('[role="menu"]')) return;
      if (event.key === 'Escape') {
        if (isSearching && event.target === searchRef.current) setSearch('');
        else if (selectedIds.size > 0) setSelectedIds(new Set());
        else if (openId) setOpenId(null);
        else return;
        event.preventDefault();
        return;
      }
      if (isTyping(event.target)) return;

      const current = shown.find((article) => article.id === (cursorId ?? openId));
      const onButton = event.target instanceof HTMLElement && event.target.closest('button, a, [role="button"]') !== null;
      const actions: Record<string, (() => void) | undefined> = {
        j: () => step(1),
        k: () => step(-1),
        o: current && (() => handleOpen(current)),
        s: current && (() => { void toggleStar(current); }),
        m: current && (() => handleToggleRead(current)),
        v: current && (() => handleOpenInTab(current)),
        r: () => { void refresh(feedsOfSelection(selection, feeds, folders)); },
        '/': () => searchRef.current?.focus(),
        '?': () => setAreShortcutsOpen(true),
      };
      const run = event.key === 'Enter'
        ? (onButton ? undefined : actions.o)
        : event.shiftKey && event.key.toLowerCase() === 'a'
          ? () => markRead(unreadInBase)
          : event.shiftKey && event.key !== '?' ? undefined : actions[event.key.toLowerCase()];
      if (!run) return;
      event.preventDefault();
      run();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isDialogOpen, feeds, folders, isSearching, selectedIds.size, openId, cursorId, shown, selection, unreadInBase,
    step, handleOpen, toggleStar, handleToggleRead, handleOpenInTab, refresh, markRead,
  ]);

  const shortcuts: [string, string][] = [
    ['J / K', t('options.feeds.shortcutMove')],
    ['Enter', t('options.feeds.shortcutOpen')],
    ['S', t('options.feeds.shortcutStar')],
    ['M', t('options.feeds.shortcutRead')],
    ['V', t('options.articleList.openInNewTab')],
    ['Shift + A', t('options.feeds.markAllRead')],
    ['R', t('options.feedsPage.refresh')],
    ['/', t('options.feeds.shortcutSearch')],
    ['Esc', t('options.feeds.shortcutClose')],
  ];

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const tree = (
    <SourceTree
      feeds={feeds}
      folders={folders}
      unread={unread}
      viewCounts={viewCounts}
      selection={selection}
      collapsedFolders={view.collapsedFolders}
      onSelect={handleSelect}
      onToggleFolder={handleToggleFolder}
      onAddFeed={() => { setIsTreeOpen(false); setIsAdding(true); }}
      onAddFolder={() => { setIsTreeOpen(false); setFolderDialog({}); }}
      onRenameFolder={(folder) => { setIsTreeOpen(false); setFolderDialog({ folder }); }}
      onDeleteFolder={(folder) => { setIsTreeOpen(false); setFolderToDelete(folder); }}
      onReorderFolders={(ids) => { void RSSService.reorderFolders(ids); }}
      onFolderNotifications={(folder, enabled) => { void RSSService.setNotifications(feedsInFolder(feeds, folders, folder.id).map((feed) => feed.id), enabled); }}
      onMoveFeed={(feedId, folderId) => { void RSSService.moveFeeds([feedId], folderId); }}
      onMarkAllRead={handleMarkAllRead}
      onTogglePin={(feed) => { void RSSService.togglePin(feed.id); }}
      onFeedSettings={(feed) => { setIsTreeOpen(false); setFeedToEdit(feed); }}
      onUnsubscribe={(feed) => { setIsTreeOpen(false); setFeedToRemove(feed); }}
    />
  );

  const emptyTexts: Record<SmartView, [string, string]> = {
    today: [t('options.feeds.emptyToday'), t('options.feeds.emptyLater')],
    unread: [t('options.feeds.allCaughtUp'), t('options.feeds.emptyLater')],
    starred: [t('options.articleList.emptyStarred'), t('options.feeds.emptyStarredHint')],
    all: [t('options.feeds.emptyArticles'), t('options.feeds.emptyLater')],
  };
  const [emptyTitle, emptyHint] = isSearching
    ? [t('options.feeds.emptySearch'), t('options.feeds.emptySearchHint')]
    : showsUnreadOnly && base.length > 0
      ? emptyTexts.unread
      : selection.type === 'view' ? emptyTexts[selection.view] : emptyTexts.all;
  const empty = (
    <div className="max-w-sm text-center">
      <CircleCheck className="mx-auto h-8 w-8 text-text-muted" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-text-strong">{emptyTitle}</p>
      <p className="mt-1 text-sm text-text-muted">{emptyHint}</p>
      {!isSearching && showsUnreadOnly && base.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => (hasReadFilter(selection) ? setUnreadOnly(false) : handleSelect({ type: 'view', view: 'all' }))}
        >
          {t('options.feeds.showAll')}
        </Button>
      )}
    </div>
  );

  const list = (
    <section aria-label={title} className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        {layout === 'narrow' && (
          <Button variant="ghost" size="sm" className="-ms-2 h-8 w-8 p-0" onClick={() => setIsTreeOpen(true)} aria-label={t('options.feeds.openSources')} title={t('options.feeds.openSources')}>
            <PanelLeft className="h-4 w-4 rtl:-scale-x-100" />
          </Button>
        )}
        <div className="min-w-32 flex-1">
          <h2 className="truncate text-sm font-semibold text-text-strong"><bdi dir="auto">{title}</bdi></h2>
          <p className="text-xs text-text-muted">
            {showsUnreadOnly
              ? t('options.articleList.unread', { count: unreadInBase.length })
              : t('options.articleList.summary', { count: base.length })}
          </p>
        </div>
        {!isSearching && hasReadFilter(selection) && (
          <div role="group" aria-label={t('options.feeds.filter')} className="flex rounded-full bg-muted p-0.5">
            {[true, false].map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={unreadOnly === value}
                onClick={() => { setUnreadOnly(value); setKeptIds(new Set()); }}
                className={cn(
                  'h-7 rounded-full px-3 text-xs font-medium transition-colors',
                  unreadOnly === value ? 'bg-segment text-text-strong shadow-sm' : 'text-text-muted hover:text-text-strong',
                )}
              >
                {value ? t('options.articleList.filters.unread') : t('options.articleList.filters.all')}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-text-muted hover:text-text-strong"
            onClick={() => setView({ sort: view.sort === 'newest' ? 'oldest' : 'newest' })}
            aria-label={view.sort === 'newest' ? t('options.feeds.sortOldest') : t('options.feeds.sortNewest')}
            title={view.sort === 'newest' ? t('options.feeds.sortOldest') : t('options.feeds.sortNewest')}
          >
            <ArrowDownUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-text-muted hover:text-text-strong"
            disabled={unreadInBase.length === 0}
            onClick={() => markRead(unreadInBase)}
            aria-label={t('options.feeds.markAllRead')}
            title={t('options.feeds.markAllRead')}
          >
            <CheckCheck className="h-4 w-4" />
          </Button>
          {selectedFeed && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-text-muted hover:text-text-strong" onClick={() => setFeedToEdit(selectedFeed)} aria-label={t('options.feedSettings.title')} title={t('options.feedSettings.title')}>
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {selectedFeed?.lastError && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-warning-muted px-4 py-2.5 text-sm text-text-strong">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <p className="min-w-48 flex-1">
            {errorText(selectedFeed.lastError)} {t('options.feeds.errorSince', { date: isolateBidi(formatDateTime(selectedFeed.lastError.since)) })}
          </p>
          <Button size="sm" variant="secondary" disabled={isRefreshing} onClick={() => { void refresh([selectedFeed]); }}>
            {selectedFeed.lastError.code === 'access' ? t('options.feeds.allowSite') : t('options.feeds.retry')}
          </Button>
        </div>
      )}

      {selectedArticles.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-primary-muted px-4 py-2">
          <span className="me-auto text-sm font-medium text-primary">{t('options.articleList.selected', { count: selectedArticles.length })}</span>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set(shown.map((article) => article.id)))}>{t('options.articleList.selectAll')}</Button>
          <Button size="sm" variant="ghost" onClick={() => { markRead(selectedArticles); setSelectedIds(new Set()); }}>
            <CheckCheck className="h-4 w-4" />{t('options.feeds.markRead')}
          </Button>
          <Button size="sm" onClick={() => { void handleSaveSelected(); }}><Bookmark className="h-4 w-4" />{t('options.readerPanel.saveToBluetab')}</Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setSelectedIds(new Set())} aria-label={t('options.articleList.clear')} title={t('options.articleList.clear')}><X className="h-4 w-4" /></Button>
        </div>
      )}

      <ArticleList
        listKey={listKey}
        articles={shown}
        feedById={feedById}
        openId={openId}
        cursorId={cursorId}
        selectedIds={selectedIds}
        isCompact={openArticle !== null}
        empty={empty}
        onOpen={handleOpen}
        onToggleStar={toggleStar}
        onToggleRead={handleToggleRead}
        onSave={handleSave}
        onOpenInTab={handleOpenInTab}
        onToggleSelect={handleToggleSelect}
      />
    </section>
  );

  const reader = openArticle && (
    <Reader
      article={openArticle}
      feed={feedById.get(openArticle.feedId)}
      view={view}
      onViewChange={setView}
      isOverlay={layout !== 'wide'}
      hasPrevious={openIndex > 0}
      hasNext={openIndex !== -1 && openIndex < shown.length - 1}
      onPrevious={() => step(-1)}
      onNext={() => step(1)}
      onClose={() => setOpenId(null)}
      onToggleStar={toggleStar}
      onToggleRead={handleToggleRead}
      onSave={handleSave}
      onOpenInTab={handleOpenInTab}
    />
  );

  const hasFeeds = feeds.length > 0;

  const searchBox = (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
      <Input
        ref={searchRef}
        type="text"
        dir="auto"
        value={search}
        placeholder={t('options.feedsPage.searchPlaceholder')}
        aria-label={t('options.feedsPage.searchPlaceholder')}
        autoComplete="off"
        onChange={(event) => { setSearch(event.target.value); setKeptIds(new Set()); setSelectedIds(new Set()); setCursorId(null); }}
        className="h-9 ps-9 pe-9 text-sm"
      />
      {search && (
        <button
          type="button"
          onClick={() => { setSearch(''); searchRef.current?.focus(); }}
          className="absolute end-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-text-muted hover:bg-accent hover:text-text-strong"
          aria-label={t('options.feedsPage.clearSearch')}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <div ref={layoutRef} className="flex h-svh min-w-0 flex-col bg-bg-0">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border-glass bg-glass-bg px-4 backdrop-blur-md">
        <div className="flex shrink-0 items-center gap-2">
          {sidebarTrigger}
          <Rss className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold text-text-strong">{t('options.feedsPage.title')}</h1>
            <p className="text-xs text-text-muted">{t('options.feedsPage.subscriptions', { count: feeds.length })}</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 justify-center">
          {hasFeeds && layout !== 'narrow' && searchBox}
        </div>

        {hasFeeds && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0" disabled={isRefreshing} onClick={() => { void refresh(feeds); }} aria-label={t('options.feedsPage.refresh')} title={t('options.feedsPage.refresh')}>
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0" aria-label={t('common.more')} title={t('common.more')}><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsAdding(true)}><FileUp className="h-4 w-4" />{t('options.feeds.importFile')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadOpml(feeds, folders)}><Download className="h-4 w-4" />{t('options.feeds.exportFile')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setAreShortcutsOpen(true)}><Keyboard className="h-4 w-4" />{t('options.feeds.shortcuts')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" className="h-9" onClick={() => setIsAdding(true)} aria-label={t('options.feedsPage.addFeed')}>
              <PlusCircle className="h-4 w-4" />
              {layout !== 'narrow' && t('options.feedsPage.addFeed')}
            </Button>
          </div>
        )}
      </header>
      {hasFeeds && layout === 'narrow' && !reader && (
        <div className="flex shrink-0 justify-center border-b border-border px-4 py-2">{searchBox}</div>
      )}

      {!isReady ? null : !hasFeeds ? (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-transparent">
          <div className="mx-auto w-full max-w-xl px-6 py-12">
            <h2 className="text-balance text-2xl font-semibold text-text-strong">{t('options.feeds.welcomeTitle')}</h2>
            <p className="mb-8 mt-2 text-sm text-text-muted">{t('options.feeds.welcomeDescription')}</p>
            <AddFeedPanel feeds={feeds} folders={folders} onAdded={handleAdded} />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {layout !== 'narrow' && <div className={cn('shrink-0 border-e border-border', layout === 'wide' ? 'w-64' : 'w-56')}>{tree}</div>}
          {layout === 'wide' ? (
            <>
              <div className={cn('min-w-0', reader ? 'w-[22rem] shrink-0 border-e border-border xl:w-96' : 'flex-1')}>{list}</div>
              {reader && <div className="min-w-0 flex-1">{reader}</div>}
            </>
          ) : (
            // The list stays mounted behind the reader, so closing it returns to the same place.
            <div className="relative min-w-0 flex-1">
              <div className="h-full" {...(reader ? { inert: '' } : {})}>{list}</div>
              {reader && <div className="absolute inset-0 z-30">{reader}</div>}
            </div>
          )}
        </div>
      )}

      <Sheet open={isTreeOpen && layout === 'narrow'} onOpenChange={setIsTreeOpen}>
        <SheetContent side={direction === 'rtl' ? 'right' : 'left'} className="w-72 p-0 pt-12 sm:w-72 sm:p-0 sm:pt-12 lg:w-72" aria-describedby={undefined}>
          <SheetTitle className="sr-only">{t('options.feeds.sources')}</SheetTitle>
          {tree}
        </SheetContent>
      </Sheet>

      <AddFeedDialog
        open={isAdding}
        onClose={() => setIsAdding(false)}
        feeds={feeds}
        folders={folders}
        initialFolderId={selectedFolder?.id ?? folders.find((folder) => folder.id === selectedFeed?.folderId)?.id}
        onAdded={handleAdded}
      />
      <FolderDialog open={folderDialog !== null} folder={folderDialog?.folder} onClose={() => setFolderDialog(null)} onSubmit={handleFolderName} />
      <FeedSettingsDialog
        feed={feedToEdit}
        folders={folders}
        onClose={() => setFeedToEdit(null)}
        onSave={(feed, values) => { void handleSaveSettings(feed, values); }}
        onUnsubscribe={setFeedToRemove}
      />
      <ConfirmDialog
        open={folderToDelete !== null}
        heading={t('options.feeds.deleteFolder')}
        description={t('options.feeds.deleteFolderDescription', { name: isolateBidi(folderToDelete?.name ?? '') })}
        confirmLabel={t('common.delete')}
        onConfirm={() => { if (folderToDelete) void RSSService.deleteFolder(folderToDelete.id); }}
        onClose={() => setFolderToDelete(null)}
      />
      <ConfirmDialog
        open={feedToRemove !== null}
        heading={t('options.feedList.unsubscribeTitle')}
        description={t('options.feedList.unsubscribeDescription', { title: isolateBidi(feedToRemove?.title ?? '') })}
        confirmLabel={t('options.feedList.unsubscribe')}
        onConfirm={() => {
          if (!feedToRemove) return;
          if (openArticle?.feedId === feedToRemove.id) setOpenId(null);
          void RSSService.unsubscribeFeed(feedToRemove.id).then(() => ToastManager.getInstance().success(t('options.feedsPage.feedRemoved')));
        }}
        onClose={() => setFeedToRemove(null)}
      />
      <ModalTemplate
        open={areShortcutsOpen}
        onOpenChange={setAreShortcutsOpen}
        className="sm:max-w-sm"
        heading={t('options.feeds.shortcuts')}
        titleIcon={<Keyboard className="h-5 w-5 text-primary" />}
      >
        <dl className="pb-3">
          {shortcuts.map(([keys, label]) => (
            <div key={keys} className="flex items-center justify-between gap-4 py-1.5 text-sm">
              <dt className="text-text">{label}</dt>
              <dd dir="ltr"><kbd className="rounded-xs border border-border bg-muted px-2 py-0.5 text-xs font-medium text-text-strong">{keys}</kbd></dd>
            </div>
          ))}
        </dl>
      </ModalTemplate>
    </div>
  );
}
