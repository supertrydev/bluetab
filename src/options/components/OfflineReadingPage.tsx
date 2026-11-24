import { matchesSearch, normalizeForSearch } from '@/utils/search-text';
import * as React from 'react';
import { BookMarked, Pin, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { OfflineReadingService } from '@/services/offline-reading-service';
import { Storage } from '@/utils/storage';
import type { OfflineArticle, OfflineFailureRecord, OfflineQuota } from '@/types/offline-reading';
import type { TabGroup } from '@/types/models';
import { OfflineReaderView } from './OfflineReaderView';
import { OfflineFailureBanner } from './OfflineFailureBanner';
import { OfflineCleanupDialog } from './OfflineCleanupDialog';
import { isolateBidi } from '@/i18n/bidi';

export interface OfflineReadingPageProps {
  sidebarTrigger?: React.ReactNode;
  initialArticleUrl?: string | null;
  /** Transient failure records for the global banner above the sub-header. */
  failures?: OfflineFailureRecord[];
  /** Retry-all handler wired to OfflineReadingService.retryFailedMany. */
  onRetryFailureMany?: (articleIds: string[]) => void;
  /** Dismiss handler wired to OfflineReadingService.clearFailures. */
  onDismissFailures?: () => void;
}

type FilterChip = 'all' | 'unread' | 'pinned';

export function OfflineReadingPage({
  sidebarTrigger,
  initialArticleUrl,
  failures = [],
  onRetryFailureMany,
  onDismissFailures,
}: OfflineReadingPageProps): JSX.Element {
  const { t } = useTranslation();
  const [articles, setArticles] = React.useState<OfflineArticle[] | null>(null);
  const [groupNames, setGroupNames] = React.useState<Map<string, string>>(new Map());
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<FilterChip>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = React.useState(false);
  const [quota, setQuota] = React.useState<OfflineQuota | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  const loadArticles = React.useCallback(async () => {
    try {
      const all = await OfflineReadingService.getAllArticles();
      setArticles(all);
    } catch (err) {
      console.error('[BlueTab][OfflineReading] load failed', err);
      setArticles([]);
    }
  }, []);

  const loadGroupNames = React.useCallback(async () => {
    try {
      const groups = (await Storage.get<TabGroup[]>('groups')) ?? [];
      const map = new Map<string, string>();
      for (const g of groups) map.set(g.id, g.name);
      setGroupNames(map);
    } catch (err) {
      console.error('[BlueTab][OfflineReading] loadGroupNames failed', err);
    }
  }, []);

  const loadQuota = React.useCallback(async () => {
    try {
      const q = await OfflineReadingService.getOfflineQuota();
      setQuota(q);
    } catch (err) {
      console.error('[BlueTab][OfflineReading] quota failed', err);
    }
  }, []);

  // Load articles + group-name map + hydrate persisted failures on mount.
  // Reactively refresh group names on rename.
  React.useEffect(() => {
    void loadArticles();
    void loadGroupNames();
    void loadQuota();
    // Hydrate failures from storage so the banner and row badges survive a
    // page refresh. Idempotent at the service layer.
    void OfflineReadingService.hydrateFailures();

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes['groups']) void loadGroupNames();
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [loadArticles, loadGroupNames, loadQuota]);

  // When initialArticleUrl arrives (from context menu hash routing), resolve to a saved article
  React.useEffect(() => {
    if (!initialArticleUrl || !articles) return;
    const match = articles.find(a => a.url === initialArticleUrl);
    if (match) setSelectedId(match.id);
  }, [initialArticleUrl, articles]);

  const filtered = React.useMemo(() => {
    if (!articles) return [];
    const q = normalizeForSearch(search);
    return articles.filter(a => {
      if (filter === 'unread' && a.readAt !== null) return false;
      if (filter === 'pinned' && a.pinned !== 1) return false;
      if (q && !(matchesSearch(a.title, q) || matchesSearch(a.url, q)))
        return false;
      return true;
    });
  }, [articles, search, filter]);

  const grouped = React.useMemo(() => {
    const buckets = new Map<string, OfflineArticle[]>();
    for (const a of filtered) {
      const key = a.sourceGroupId || a.groupId;
      const list = buckets.get(key) ?? [];
      list.push(a);
      buckets.set(key, list);
    }
    // Sort groups by most-recently-extracted first
    return Array.from(buckets.entries()).sort((a, b) => {
      const maxSavedA = Math.max(...a[1].map(x => x.savedAt));
      const maxSavedB = Math.max(...b[1].map(x => x.savedAt));
      return maxSavedB - maxSavedA;
    });
  }, [filtered]);

  async function retryArticle(articleId: string): Promise<void> {
    await OfflineReadingService.retryFailed(articleId);
    await loadArticles();
  }

  function toggleCollapsed(groupId: string): void {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  // Opening an article marks it read in IDB; re-load so the unread dot
  // disappears live without a manual refresh.
  function handleSelectArticle(articleId: string): void {
    setSelectedId(articleId);
    const art = articles?.find(a => a.id === articleId);
    if (art && art.readAt === null) {
      // Optimistic: flip locally now; IDB update happens inside the reader
      // via OfflineReadingService.markRead.
      setArticles(prev => prev ? prev.map(a => a.id === articleId ? { ...a, readAt: Date.now() } : a) : prev);
    }
  }

  // Loading state
  if (articles === null) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        <div className="sticky top-0 z-50 flex items-center gap-4 px-4 h-16 border-b border-border-glass shrink-0 bg-glass-bg backdrop-blur-md">
          <div className="flex items-center gap-2">
            {sidebarTrigger}
            <BookMarked className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold text-text-strong">{t('options.offlineReadingPage.title')}</h1>
          </div>
        </div>
        <div className="p-6 text-muted-foreground">{t('options.offlineReadingPage.loadingLibrary')}</div>
      </div>
    );
  }

  // Global failure banner between the header and the sub-header (search bar).
  // Transformed into the shape OfflineFailureBanner expects.
  const bannerFailures = failures.map(f => ({
    articleId: f.id,
    url: f.url,
    failureBucket: f.failureBucket,
  }));

  const hasSelection = selectedId !== null;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Page header — mirrors FeedsPage glass header. Storage controls live
          in Settings → Readings to keep this header responsive on narrow
          viewports. */}
      <div className="sticky top-0 z-50 flex items-center gap-4 px-4 h-16 border-b border-border-glass shrink-0 bg-glass-bg backdrop-blur-md">
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          {hasSelection && (
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden h-8 w-8 p-0"
              onClick={() => setSelectedId(null)}
              aria-label={t('options.offlineReadingPage.back')}
            >
              <ChevronRight className="h-4 w-4 rotate-180 rtl:rotate-0" />
            </Button>
          )}
          {sidebarTrigger}
          <BookMarked className="h-5 w-5 text-primary" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-text-strong">{t('options.offlineReadingPage.title')}</h1>
            <p className="text-xs text-text-muted truncate">
              {t('options.offlineReadingPage.savedArticles', { count: articles.length })}
            </p>
          </div>
        </div>
      </div>

      {/* Global failure banner — single, between main header and sub-header */}
      {bannerFailures.length > 0 && (
        <div className="shrink-0 px-4 pt-3">
          <OfflineFailureBanner
            failures={bannerFailures}
            onRetry={(id) => { void retryArticle(id); }}
            onRetryAll={(ids) => { onRetryFailureMany?.(ids); }}
            onDismiss={() => { onDismissFailures?.(); }}
          />
        </div>
      )}

      {/* Body — responsive drill-down:
            mobile: single pane, reader replaces list when an article is selected
            md/lg : library + reader side by side, reader shows placeholder when empty */}
      <div className="flex flex-1 min-h-0 overflow-hidden [&>*+*]:border-s">
        {/* Library pane */}
        <div className={`${hasSelection ? 'hidden md:flex' : 'flex'} flex-col min-h-0 w-full md:w-80 lg:w-96 md:shrink-0`}>
          {/* Search (top row, full width) + filter chips (below) */}
          <div className="shrink-0 px-4 pt-3 pb-2 border-b border-border bg-background flex flex-col gap-2">
            <Input
              placeholder={t('options.offlineReadingPage.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full"
              aria-label={t('options.offlineReadingPage.searchPlaceholder')}
            />
            <div className="flex items-center gap-1.5 flex-wrap">
              {(['all', 'unread', 'pinned'] as FilterChip[]).map(chip => (
                <Button
                  key={chip}
                  type="button"
                  variant={filter === chip ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setFilter(chip)}
                  className="capitalize"
                >
                  {t(`options.offlineReadingPage.filters.${chip}`)}
                </Button>
              ))}
            </div>
          </div>

          {/* Scrollable list */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* 80% soft-warning cleanup banner */}
            {quota?.isWarning && !quota.isBlocked && (
              <div className="border border-warning/30 bg-warning-muted p-3 flex items-start gap-2 text-sm mx-4 mt-4">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" aria-hidden="true" />
                <div className="flex-1">
                  <div className="font-medium text-warning">
                    {t('options.offlineReadingPage.storageLow', {
                      percent: Math.round(quota.percentUsed * 100),
                    })}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t('options.offlineReadingPage.reviewOldestDescription')}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCleanupOpen(true)}
                  className="h-7 px-2 text-xs shrink-0"
                >
                  {t('options.offlineReadingPage.reviewOldest')}
                </Button>
              </div>
            )}

            {/* Empty state */}
            {articles.length === 0 ? (
              <div className="text-sm text-muted-foreground py-12 text-center">
                {t('options.offlineReadingPage.emptySaved')}
              </div>
            ) : grouped.length === 0 ? (
              <div className="text-sm text-muted-foreground py-12 text-center">
                {t('options.offlineReadingPage.emptyFiltered')}
              </div>
            ) : (
              <div className="flex flex-col">
                {grouped.map(([gid, list]) => {
                  const isCollapsed = collapsed.has(gid);
                  const displayName = groupNames.get(gid) ?? t('options.offlineReadingPage.untitledGroup');
                  return (
                    <section key={gid} aria-label={t('options.offlineReadingPage.groupAria', { name: isolateBidi(displayName) })} className="border-b border-border">
                      <button
                        type="button"
                        onClick={() => toggleCollapsed(gid)}
                        className="w-full flex items-center gap-1.5 px-4 py-2 text-start bg-muted/40 hover:bg-muted/60 transition-colors"
                        aria-expanded={!isCollapsed}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground rtl:rotate-180" />
                        ) : (
                          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <h2 className="text-xs font-semibold text-muted-foreground truncate">
                          <bdi dir="auto">{displayName}</bdi>
                        </h2>
                        <span dir="ltr" className="text-xs font-medium text-muted-foreground/70 shrink-0">
                          {list.length}
                        </span>
                      </button>
                      {!isCollapsed && (
                        <ul className="flex flex-col">
                          {list.map(a => {
                            const isUnread = a.readAt === null;
                            return (
                              <li key={a.id}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectArticle(a.id)}
                                  className={`w-full text-start px-4 py-3 border-t border-border flex items-start gap-2 transition-colors ${
                                    selectedId === a.id
                                      ? 'bg-accent'
                                      : 'hover:bg-muted/40'
                                  }`}
                                >
                                  <span
                                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isUnread ? 'bg-primary' : 'bg-transparent'}`}
                                    aria-label={isUnread ? t('options.offlineReadingPage.unread') : undefined}
                                  />
                                  <span className="flex-1 min-w-0">
                                    <span className={`block truncate text-sm ${isUnread ? 'font-medium text-text-strong' : 'text-muted-foreground'}`}>
                                      <bdi dir={a.title ? 'auto' : 'ltr'}>{a.title || a.url}</bdi>
                                    </span>
                                  </span>
                                  {a.pinned === 1 && (
                                    <Pin className="h-3.5 w-3.5 mt-1 shrink-0 text-primary" aria-label={t('options.offlineReadingPage.pinned')} />
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Reader pane — independent scroll; always visible on md+ with
            a placeholder when no article is selected (matches FeedsPage pattern). */}
        <div className={`${hasSelection ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 min-h-0 overflow-hidden flex-col`}>
          {hasSelection ? (
            <OfflineReaderView
              articleId={selectedId}
              onClose={() => setSelectedId(null)}
              onPinChanged={() => { void loadArticles(); }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              {t('options.offlineReadingPage.selectArticle')}
            </div>
          )}
        </div>
      </div>

      {/* Cleanup dialog */}
      <OfflineCleanupDialog
        open={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        onDeleted={() => { void loadArticles(); void loadQuota(); }}
      />
    </div>
  );
}
