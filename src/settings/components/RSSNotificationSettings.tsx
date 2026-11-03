import { previewNotificationSound } from '@/platform/extension-platform';
import { useState, useEffect } from 'react';
import { Rss, Play, Plus, Trash2, Filter, Archive } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Storage } from '@/utils/storage';
import { formatNumber } from '@/i18n/format';
import { RSS_STORAGE_KEYS, RSS_DEFAULTS } from '@/types/rss';
import type { RSSSettings, RSSFeed, NotificationSound, RSSNotificationFilter } from '@/types/rss';
import { useTranslation } from 'react-i18next';

function getSoundOptions(t: (key: string) => string): { value: NotificationSound; label: string }[] {
  return [
    { value: 'ping', label: t('common.sounds.ping') },
    { value: 'drop', label: t('common.sounds.drop') },
    { value: 'blip', label: t('common.sounds.blip') },
    { value: 'soft-chime', label: t('common.sounds.softChime') },
    { value: 'ripple', label: t('common.sounds.ripple') },
    { value: 'level-up', label: t('common.sounds.levelUp') },
    { value: 'gentle-bell', label: t('common.sounds.gentleBell') },
    { value: 'crystal', label: t('common.sounds.crystal') },
    { value: 'shimmer', label: t('common.sounds.shimmer') },
    { value: 'breeze', label: t('common.sounds.breeze') },
  ];
}

/** Preview a sound via the offscreen document (same mechanism as service worker). */
async function previewSound(sound: NotificationSound): Promise<void> {
  await previewNotificationSound(sound, 'Previewing notification sound');
}

export function RSSNotificationSettings() {
  const { t } = useTranslation();
  const translate = (key: string) => t(key as never) as unknown as string;
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedSound, setSelectedSound] = useState<NotificationSound>('ping');
  const [filters, setFilters] = useState<RSSNotificationFilter[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMode, setNewMode] = useState<'mute' | 'allow'>('mute');
  const [newType, setNewType] = useState<'category' | 'keyword'>('keyword');
  const [newValue, setNewValue] = useState('');
  const [articlesPerFeed, setArticlesPerFeed] = useState<number>(
    RSS_DEFAULTS.ARTICLES_PER_FEED,
  );
  const [articlesPerFeedInput, setArticlesPerFeedInput] = useState<string>(
    String(RSS_DEFAULTS.ARTICLES_PER_FEED),
  );
  const [articlesUnlimited, setArticlesUnlimited] = useState<boolean>(false);
  const soundOptions = getSoundOptions(translate);

  useEffect(() => {
    Storage.get<RSSSettings>(RSS_STORAGE_KEYS.SETTINGS).then((settings) => {
      if (settings?.notificationSoundEnabled !== undefined) {
        setSoundEnabled(settings.notificationSoundEnabled);
      }
      if (settings?.notificationSound) {
        setSelectedSound(settings.notificationSound);
      }
      if (settings?.notificationFilters) {
        setFilters(settings.notificationFilters);
      }
      const storedCap = settings?.articlesPerFeed ?? RSS_DEFAULTS.ARTICLES_PER_FEED;
      if (storedCap === 'unlimited') {
        setArticlesUnlimited(true);
        // Preserve a sensible numeric fallback so toggling off returns to a
        // meaningful value rather than 0.
        setArticlesPerFeed(RSS_DEFAULTS.ARTICLES_PER_FEED);
        setArticlesPerFeedInput(String(RSS_DEFAULTS.ARTICLES_PER_FEED));
      } else {
        setArticlesUnlimited(false);
        setArticlesPerFeed(storedCap);
        setArticlesPerFeedInput(String(storedCap));
      }
      // Load categories from settings + feeds
      const settingsCats = settings?.categories ?? [];
      Storage.get<RSSFeed[]>(RSS_STORAGE_KEYS.FEEDS).then((feeds) => {
        const feedCats = (feeds ?? []).map(f => f.category).filter((c): c is string => Boolean(c));
        setCategories([...new Set([...settingsCats, ...feedCats])].sort());
      });
    });
  }, []);

  const updateSettings = async (patch: Partial<RSSSettings>) => {
    const current = await Storage.get<RSSSettings>(RSS_STORAGE_KEYS.SETTINGS);
    await Storage.set(RSS_STORAGE_KEYS.SETTINGS, { ...current, ...patch });
  };

  const handleToggle = async (checked: boolean) => {
    setSoundEnabled(checked);
    await updateSettings({ notificationSoundEnabled: checked });
  };

  const handleSoundChange = async (value: string) => {
    const sound = value as NotificationSound;
    setSelectedSound(sound);
    await updateSettings({ notificationSound: sound });
    previewSound(sound);
  };

  const commitArticlesPerFeed = async (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const fallback = Number.isFinite(parsed) ? parsed : RSS_DEFAULTS.ARTICLES_PER_FEED;
    const clamped = Math.min(
      RSS_DEFAULTS.ARTICLES_PER_FEED_MAX,
      Math.max(RSS_DEFAULTS.ARTICLES_PER_FEED_MIN, fallback),
    );
    setArticlesPerFeed(clamped);
    setArticlesPerFeedInput(String(clamped));
    await updateSettings({ articlesPerFeed: clamped });
  };

  const handleUnlimitedToggle = async (checked: boolean) => {
    setArticlesUnlimited(checked);
    if (checked) {
      await updateSettings({ articlesPerFeed: 'unlimited' });
    } else {
      // Restore the last numeric value the user had entered.
      await updateSettings({ articlesPerFeed: articlesPerFeed });
    }
  };

  // ---------------------------------------------------------------------------
  // Filter management
  // ---------------------------------------------------------------------------

  const saveFilters = async (updated: RSSNotificationFilter[]) => {
    setFilters(updated);
    await updateSettings({ notificationFilters: updated });
  };

  const handleAddFilter = async () => {
    if (!newValue.trim()) return;
    const filter: RSSNotificationFilter = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      mode: newMode,
      type: newType,
      value: newValue.trim(),
      enabled: true,
    };
    await saveFilters([...filters, filter]);
    setNewValue('');
    setShowAddForm(false);
  };

  const handleToggleFilter = async (id: string) => {
    await saveFilters(filters.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f));
  };

  const handleDeleteFilter = async (id: string) => {
    await saveFilters(filters.filter(f => f.id !== id));
  };

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
        <Rss className="w-5 h-5" />
        {t('settings.rss.title')}
      </h3>

      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
          <Switch
            id="rss-notification-sound"
            checked={soundEnabled}
            onCheckedChange={handleToggle}
          />
          <Label htmlFor="rss-notification-sound" className="flex-1 cursor-pointer space-y-1">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t('settings.rss.notificationSoundTitle')}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('settings.rss.notificationSoundDescription')}
            </div>
          </Label>
        </div>

        {soundEnabled && (
          <div className="flex items-center gap-3 p-3 border border-border rounded-lg ms-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1.5">
                {t('settings.rss.soundLabel')}
              </label>
              <Select value={selectedSound} onValueChange={handleSoundChange}>
                <SelectTrigger className="h-8 text-xs w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {soundOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 shrink-0 mt-5"
              onClick={() => previewSound(selectedSound)}
              title={t('common.previewSound')}
            >
              <Play className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Per-feed article retention cap */}
        <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
          <Archive className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="flex-1 space-y-3">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t('settings.rss.articlesPerFeedTitle')}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t('settings.rss.articlesPerFeedDescription')}
              </div>
            </div>

            {/* Unlimited toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id="rss-articles-unlimited"
                checked={articlesUnlimited}
                onCheckedChange={handleUnlimitedToggle}
              />
              <Label
                htmlFor="rss-articles-unlimited"
                className="text-xs font-medium cursor-pointer"
              >
                {t('settings.rss.unlimited')}
              </Label>
            </div>

            {/* Numeric cap — disabled when unlimited is on */}
            <div className="flex items-center gap-2">
              <Input
                type="number"
                dir="ltr"
                inputMode="numeric"
                min={RSS_DEFAULTS.ARTICLES_PER_FEED_MIN}
                max={RSS_DEFAULTS.ARTICLES_PER_FEED_MAX}
                step={50}
                value={articlesPerFeedInput}
                disabled={articlesUnlimited}
                onChange={(e) => setArticlesPerFeedInput(e.target.value)}
                onBlur={(e) => commitArticlesPerFeed(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="h-8 w-28 text-xs"
              />
              <span className="text-xs text-muted-foreground">
                {t('settings.rss.articlesRange', {
                  defaultCount: formatNumber(RSS_DEFAULTS.ARTICLES_PER_FEED),
                  min: formatNumber(RSS_DEFAULTS.ARTICLES_PER_FEED_MIN),
                  max: formatNumber(RSS_DEFAULTS.ARTICLES_PER_FEED_MAX),
                })}
              </span>
              {!articlesUnlimited && articlesPerFeed !== RSS_DEFAULTS.ARTICLES_PER_FEED && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    commitArticlesPerFeed(String(RSS_DEFAULTS.ARTICLES_PER_FEED))
                  }
                >
                  {t('common.reset')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Notification Filters section */}
      <div className="pt-4 mt-4 border-t border-border">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Filter className="w-4 h-4" />
            {t('settings.rss.notificationFiltersTitle')}
          </h4>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <Plus className="h-3 w-3 me-1" />
            {t('settings.rss.addFilter')}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          {t('settings.rss.filtersDescription')}
        </p>

        {/* Add filter form */}
        {showAddForm && (
          <div className="p-3 border border-border rounded-lg mb-3 space-y-2">
            <div className="flex gap-2">
              <Select value={newMode} onValueChange={(v) => setNewMode(v as 'mute' | 'allow')}>
                <SelectTrigger className="h-8 text-xs w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mute" className="text-xs">{t('settings.rss.mute')}</SelectItem>
                  <SelectItem value="allow" className="text-xs">{t('settings.rss.allow')}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={newType} onValueChange={(v) => setNewType(v as 'category' | 'keyword')}>
                <SelectTrigger className="h-8 text-xs w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keyword" className="text-xs">{t('settings.rss.keyword')}</SelectItem>
                  <SelectItem value="category" className="text-xs">{t('settings.rss.category')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              {newType === 'category' && categories.length > 0 ? (
                <Select value={newValue} onValueChange={(v) => { setNewValue(v); }}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder={t('settings.rss.selectCategory')} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat} className="text-xs"><bdi dir="auto">{cat}</bdi></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  dir="auto"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder={newType === 'keyword' ? t('settings.rss.keywordPlaceholder') : t('settings.rss.categoryPlaceholder')}
                  className="h-8 text-xs flex-1"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddFilter(); }}
                />
              )}
              <Button size="sm" className="h-8 text-xs" onClick={handleAddFilter} disabled={!newValue.trim()}>
                {t('common.add')}
              </Button>
            </div>
          </div>
        )}

        {/* Filter list */}
        {filters.length > 0 ? (
          <div className="space-y-1.5">
            {filters.map((filter) => (
              <div
                key={filter.id}
                className="flex items-center gap-2 p-2 border border-border rounded-lg text-xs"
              >
                <Switch
                  checked={filter.enabled}
                  onCheckedChange={() => handleToggleFilter(filter.id)}
                  className="scale-75"
                />
                <span className={`px-1.5 py-0.5 rounded text-micro font-medium ${
                  filter.mode === 'mute'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                }`}>
                  {filter.mode === 'mute' ? t('settings.rss.mute').toUpperCase() : t('settings.rss.allow').toUpperCase()}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-muted text-micro text-muted-foreground">
                  {filter.type === 'keyword' ? t('settings.rss.keyword') : t('settings.rss.category')}
                </span>
                <bdi dir="auto" className={`flex-1 truncate ${!filter.enabled ? 'opacity-50' : ''}`}>
                  {filter.value}
                </bdi>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteFilter(filter.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            {t('settings.rss.noFilters')}
          </p>
        )}
      </div>
    </div>
  );
}
