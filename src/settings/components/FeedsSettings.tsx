import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Bell, ChevronRight, ListFilter, Play, Plus, Rss, Trash2, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FeedIcon } from '@/feeds/components/FeedIcon';
import { NO_FOLDER, feedsInFolder } from '@/feeds/feed-view';
import { formatNumber } from '@/i18n/format';
import { isolateBidi } from '@/i18n/bidi';
import { cn } from '@/lib/utils';
import { previewNotificationSound } from '@/platform/extension-platform';
import { isFolderMuted } from '@/services/rss-notifications';
import { RSSService } from '@/services/rss-service';
import { Storage } from '@/utils/storage';
import {
  RSS_DEFAULTS, RSS_STORAGE_KEYS,
  type NotificationSound, type RSSFeed, type RSSFolder, type RSSNotificationFilter, type RSSSettings,
} from '@/types/rss';

const SOUND_KEYS = {
  ping: 'ping',
  drop: 'drop',
  blip: 'blip',
  'soft-chime': 'softChime',
  ripple: 'ripple',
  'level-up': 'levelUp',
  'gentle-bell': 'gentleBell',
  crystal: 'crystal',
  shimmer: 'shimmer',
  breeze: 'breeze',
} as const satisfies Record<NotificationSound, string>;

const previewSound = (sound: NotificationSound) => previewNotificationSound(sound, 'Previewing notification sound');

const headingClass = 'flex items-center gap-2 text-sm font-medium text-text-strong';

export function FeedsSettings() {
  const { t } = useTranslation();
  const [feeds, setFeeds] = useState<RSSFeed[]>([]);
  const [folders, setFolders] = useState<RSSFolder[]>([]);
  const [settings, setSettings] = useState<Partial<RSSSettings>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ruleMode, setRuleMode] = useState<'mute' | 'allow'>('mute');
  const [ruleWord, setRuleWord] = useState('');
  const [limitInput, setLimitInput] = useState(String(RSS_DEFAULTS.ARTICLES_PER_FEED));

  useEffect(() => {
    void RSSService.getFolders().then(setFolders);
    void RSSService.getFeeds().then(setFeeds);
    void Storage.get<RSSSettings>(RSS_STORAGE_KEYS.SETTINGS).then((stored) => setSettings(stored ?? {}));

    const handleChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return;
      if (changes[RSS_STORAGE_KEYS.FEEDS]) setFeeds(changes[RSS_STORAGE_KEYS.FEEDS].newValue ?? []);
      if (changes[RSS_STORAGE_KEYS.SETTINGS]) setSettings(changes[RSS_STORAGE_KEYS.SETTINGS].newValue ?? {});
      if (changes[RSS_STORAGE_KEYS.FOLDERS]) {
        const next: RSSFolder[] = changes[RSS_STORAGE_KEYS.FOLDERS].newValue ?? [];
        setFolders([...next].sort((a, b) => a.order - b.order));
      }
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
  }, []);

  const limit = settings.articlesPerFeed ?? RSS_DEFAULTS.ARTICLES_PER_FEED;
  useEffect(() => {
    if (limit !== 'unlimited') setLimitInput(String(limit));
  }, [limit]);

  const updateSettings = async (patch: Partial<RSSSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    const current = await Storage.get<RSSSettings>(RSS_STORAGE_KEYS.SETTINGS);
    await Storage.set(RSS_STORAGE_KEYS.SETTINGS, { ...current, ...patch });
  };

  // -------------------------------------------------------------------------
  // Notifications per folder and feed
  // -------------------------------------------------------------------------

  const groups = useMemo(() => [
    ...folders.map((folder) => ({ id: folder.id, name: folder.name, feeds: feedsInFolder(feeds, folders, folder.id) })),
    { id: NO_FOLDER, name: undefined, feeds: feedsInFolder(feeds, folders, NO_FOLDER) },
  ].filter((group) => group.feeds.length > 0), [feeds, folders]);

  const setNotifications = (list: RSSFeed[], enabled: boolean) => {
    const ids = new Set(list.map((feed) => feed.id));
    setFeeds((prev) => prev.map((feed) => (ids.has(feed.id) ? { ...feed, notificationsEnabled: enabled } : feed)));
    void RSSService.setNotifications([...ids], enabled);
  };
  const countOn = (list: RSSFeed[]) => list.filter((feed) => feed.notificationsEnabled).length;
  const countText = (list: RSSFeed[]) => t('settings.rss.countOn', { on: formatNumber(countOn(list)), total: formatNumber(list.length) });
  const toggleExpanded = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------

  const rules = settings.notificationFilters ?? [];
  const saveRules = (next: RSSNotificationFilter[]) => updateSettings({ notificationFilters: next });

  const addRule = async (event: FormEvent) => {
    event.preventDefault();
    const value = ruleWord.trim();
    if (!value) return;
    setRuleWord('');
    await saveRules([...rules, { id: crypto.randomUUID(), mode: ruleMode, type: 'keyword', value, enabled: true }]);
  };

  const ruleText = (rule: RSSNotificationFilter): string => {
    const value = isolateBidi(rule.value);
    if (rule.type === 'category') {
      return rule.mode === 'mute' ? t('settings.rss.folderMuteText', { name: value }) : t('settings.rss.folderAllowText', { name: value });
    }
    return rule.mode === 'mute' ? t('settings.rss.wordMuteText', { word: value }) : t('settings.rss.wordAllowText', { word: value });
  };

  // -------------------------------------------------------------------------
  // Storage
  // -------------------------------------------------------------------------

  const commitLimit = async (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const next = Math.min(
      RSS_DEFAULTS.ARTICLES_PER_FEED_MAX,
      Math.max(RSS_DEFAULTS.ARTICLES_PER_FEED_MIN, Number.isFinite(parsed) ? parsed : RSS_DEFAULTS.ARTICLES_PER_FEED),
    );
    setLimitInput(String(next));
    await updateSettings({ articlesPerFeed: next });
  };

  const soundEnabled = settings.notificationSoundEnabled !== false;
  const sound = settings.notificationSound ?? 'ping';
  const openFeeds = () => { void chrome.tabs.create({ url: chrome.runtime.getURL('src/feeds/index.html') }); };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-text-strong">
          <Rss className="h-5 w-5" />
          {t('settings.rss.title')}
        </h3>

        <h4 className={headingClass}><Bell className="h-4 w-4" />{t('settings.rss.notificationsTitle')}</h4>
        <p className="mb-3 mt-1 text-xs text-text-muted">{t('settings.rss.notificationsDescription')}</p>

        {feeds.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted p-4">
            <p className="min-w-48 flex-1 text-sm text-text-muted">{t('settings.rss.noFeeds')}</p>
            <Button size="sm" variant="secondary" onClick={openFeeds}>{t('settings.rss.openFeeds')}</Button>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            <div className="flex min-h-12 items-center gap-3 px-4 py-2">
              <Label htmlFor="feed-notify-all" className="flex-1 cursor-pointer text-sm font-medium text-text-strong">{t('settings.rss.allFeeds')}</Label>
              <span className="text-xs tabular-nums text-text-muted">{countText(feeds)}</span>
              <Switch id="feed-notify-all" checked={countOn(feeds) === feeds.length} onCheckedChange={(checked) => setNotifications(feeds, checked)} />
            </div>
            {groups.map((group) => {
              const name = group.name ?? t('options.feeds.noFolder');
              const isOpen = expanded.has(group.id);
              const isMuted = isFolderMuted(group.name, rules);
              return (
                <div key={group.id}>
                  <div className="flex min-h-12 items-center gap-3 py-2 pe-4 ps-2">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(group.id)}
                      aria-expanded={isOpen}
                      className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-sm text-start"
                    >
                      <ChevronRight className={cn('h-4 w-4 shrink-0 text-text-muted transition-transform', isOpen ? 'rotate-90' : 'rtl:rotate-180')} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-text-strong"><bdi dir="auto">{name}</bdi></span>
                        {isMuted && <span className="block text-xs text-warning">{t('settings.rss.mutedByRule')}</span>}
                      </span>
                    </button>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">{countText(group.feeds)}</span>
                    <Switch
                      aria-label={t('settings.rss.notifyFor', { name: isolateBidi(name) })}
                      checked={countOn(group.feeds) === group.feeds.length}
                      onCheckedChange={(checked) => setNotifications(group.feeds, checked)}
                    />
                  </div>
                  {isOpen && (
                    <ul className="pb-2 pe-4 ps-10">
                      {group.feeds.map((feed) => (
                        <li key={feed.id} className="flex min-h-10 items-center gap-2.5">
                          <FeedIcon feed={feed} />
                          <Label htmlFor={`feed-notify-${feed.id}`} className="min-w-0 flex-1 cursor-pointer truncate text-sm font-normal text-text"><bdi dir="auto">{feed.title}</bdi></Label>
                          <Switch id={`feed-notify-${feed.id}`} checked={feed.notificationsEnabled} onCheckedChange={(checked) => setNotifications([feed], checked)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-border p-4">
          <Switch id="rss-notification-sound" checked={soundEnabled} onCheckedChange={(checked) => { void updateSettings({ notificationSoundEnabled: checked }); }} />
          <Label htmlFor="rss-notification-sound" className="min-w-48 flex-1 cursor-pointer space-y-1">
            <span className={headingClass}><Volume2 className="h-4 w-4" />{t('settings.rss.notificationSoundTitle')}</span>
            <span className="block text-xs font-normal text-text-muted">{t('settings.rss.notificationSoundDescription')}</span>
          </Label>
          {soundEnabled && (
            <span className="flex items-center gap-1">
              <Select
                value={sound}
                onValueChange={(value) => {
                  void updateSettings({ notificationSound: value as NotificationSound });
                  void previewSound(value as NotificationSound);
                }}
              >
                <SelectTrigger className="w-40" aria-label={t('settings.rss.soundLabel')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(SOUND_KEYS) as NotificationSound[]).map((value) => (
                    <SelectItem key={value} value={value}>{t(`common.sounds.${SOUND_KEYS[value]}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => { void previewSound(sound); }} aria-label={t('common.previewSound')} title={t('common.previewSound')}>
                <Play className="h-4 w-4" />
              </Button>
            </span>
          )}
        </div>
      </div>

      <div>
        <h4 className={headingClass}><ListFilter className="h-4 w-4" />{t('settings.rss.rulesTitle')}</h4>
        <p className="mb-3 mt-1 text-xs text-text-muted">{t('settings.rss.rulesDescription')}</p>
        <form onSubmit={(event) => { void addRule(event); }} className="flex flex-wrap gap-2">
          <Select value={ruleMode} onValueChange={(value) => setRuleMode(value as 'mute' | 'allow')}>
            <SelectTrigger className="w-56" aria-label={t('settings.rss.ruleKind')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mute">{t('settings.rss.ruleMute')}</SelectItem>
              <SelectItem value="allow">{t('settings.rss.ruleAllow')}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            dir="auto"
            value={ruleWord}
            maxLength={80}
            placeholder={t('settings.rss.wordPlaceholder')}
            aria-label={t('settings.rss.wordPlaceholder')}
            onChange={(event) => setRuleWord(event.target.value)}
            className="h-9 min-w-40 flex-1"
          />
          <Button type="submit" size="sm" variant="secondary" className="h-9" disabled={!ruleWord.trim()}>
            <Plus className="h-4 w-4" />{t('common.add')}
          </Button>
        </form>
        {rules.length > 0 && (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {rules.map((rule) => (
              <li key={rule.id} className="flex min-h-12 items-center gap-3 py-2 pe-2 ps-4">
                <Switch
                  id={`feed-rule-${rule.id}`}
                  checked={rule.enabled}
                  onCheckedChange={(enabled) => { void saveRules(rules.map((item) => (item.id === rule.id ? { ...item, enabled } : item))); }}
                />
                <Label htmlFor={`feed-rule-${rule.id}`} className={cn('min-w-0 flex-1 cursor-pointer break-words text-sm font-normal', rule.enabled ? 'text-text-strong' : 'text-text-muted')}>
                  {ruleText(rule)}
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 text-text-muted hover:text-danger"
                  onClick={() => { void saveRules(rules.filter((item) => item.id !== rule.id)); }}
                  aria-label={t('settings.rss.deleteRule')}
                  title={t('settings.rss.deleteRule')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className={headingClass}><Archive className="h-4 w-4" />{t('settings.rss.articlesPerFeedTitle')}</h4>
        <p className="mb-3 mt-1 text-xs text-text-muted">{t('settings.rss.articlesPerFeedDescription')}</p>
        <div className="space-y-3 rounded-md border border-border p-4">
          <div className="flex items-center gap-3">
            <Switch
              id="rss-articles-unlimited"
              checked={limit === 'unlimited'}
              onCheckedChange={(checked) => {
                if (checked) void updateSettings({ articlesPerFeed: 'unlimited' });
                else void commitLimit(limitInput);
              }}
            />
            <Label htmlFor="rss-articles-unlimited" className="cursor-pointer text-sm text-text-strong">{t('settings.rss.unlimited')}</Label>
          </div>
          {limit !== 'unlimited' && (
            <div className="flex flex-wrap items-center gap-3">
              <Input
                type="number"
                dir="ltr"
                min={RSS_DEFAULTS.ARTICLES_PER_FEED_MIN}
                max={RSS_DEFAULTS.ARTICLES_PER_FEED_MAX}
                value={limitInput}
                aria-label={t('settings.rss.articlesPerFeedTitle')}
                onChange={(event) => setLimitInput(event.target.value)}
                onBlur={(event) => { void commitLimit(event.target.value); }}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                className="h-9 w-28"
              />
              <span className="text-xs text-text-muted">
                {t('settings.rss.articlesRange', {
                  defaultCount: formatNumber(RSS_DEFAULTS.ARTICLES_PER_FEED),
                  min: formatNumber(RSS_DEFAULTS.ARTICLES_PER_FEED_MIN),
                  max: formatNumber(RSS_DEFAULTS.ARTICLES_PER_FEED_MAX),
                })}
              </span>
              {limit !== RSS_DEFAULTS.ARTICLES_PER_FEED && (
                <Button variant="ghost" size="sm" onClick={() => { void commitLimit(String(RSS_DEFAULTS.ARTICLES_PER_FEED)); }}>{t('common.reset')}</Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
