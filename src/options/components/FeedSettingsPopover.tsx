/**
 * @module options/components/FeedSettingsPopover
 *
 * WHY:  Per-feed notification toggle, poll interval selector, and category
 *       assignment are needed inline within the feed context menu. Rendered as
 *       a DropdownMenu sub-menu since no Popover primitive is available.
 *
 * WHAT: A DropdownMenuSub group containing a notification Switch row, a poll
 *       interval Select row, and a category text input with datalist. Calls
 *       onUpdateSettings when any setting changes.
 *
 * NOT:  Does not call RSSService directly — parent (FeedsPage) owns async ops.
 */

import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { RSSFeed, PollInterval } from '@/types/rss';

// ---------------------------------------------------------------------------
// CategorySelector — Select with existing categories + inline new category input
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FeedSettingsPopover
// ---------------------------------------------------------------------------

interface FeedSettingsPopoverProps {
  feed: RSSFeed;
  categories: string[];
  onUpdateSettings: (
    feedId: string,
    settings: Partial<Pick<RSSFeed, 'pollIntervalMinutes' | 'notificationsEnabled' | 'category'>>,
  ) => void;
}

const NEW_CATEGORY_VALUE = '__new__';
const NONE_CATEGORY_VALUE = '__none__';

export function FeedSettingsPopover({ feed, categories, onUpdateSettings }: FeedSettingsPopoverProps) {
  const { t } = useTranslation();
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const pollIntervalOptions: { value: PollInterval; label: string }[] = [
    { value: 15, label: t('options.feedSettings.interval15m') },
    { value: 30, label: t('options.feedSettings.interval30m') },
    { value: 60, label: t('options.feedSettings.interval1h') },
    { value: 240, label: t('options.feedSettings.interval4h') },
    { value: 1440, label: t('options.feedSettings.intervalDaily') },
  ];

  const handleCategorySelect = (value: string) => {
    if (value === NEW_CATEGORY_VALUE) {
      setIsAddingNew(true);
      setNewCategoryName('');
      return;
    }
    setIsAddingNew(false);
    onUpdateSettings(feed.id, { category: value === NONE_CATEGORY_VALUE ? undefined : value });
  };

  const handleNewCategoryCommit = () => {
    const trimmed = newCategoryName.trim();
    if (trimmed) {
      onUpdateSettings(feed.id, { category: trimmed });
    }
    setIsAddingNew(false);
    setNewCategoryName('');
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="flex items-center gap-2">
        <Settings2 className="h-4 w-4" />
        {t('options.feedSettings.title')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56 p-3">
        <DropdownMenuLabel className="px-0 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t('options.feedSettings.title')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="-mx-3 mb-3" />

        {/* Notifications toggle */}
        <div className="flex items-center justify-between py-1.5">
          <span className="text-sm">{t('options.feedSettings.notifications')}</span>
          <Switch
            checked={feed.notificationsEnabled}
            onCheckedChange={(checked) =>
              onUpdateSettings(feed.id, { notificationsEnabled: checked })
            }
          />
        </div>

        {/* Poll interval selector */}
        <div className="flex flex-col gap-1.5 pt-2">
          <span className="text-sm">{t('options.feedSettings.checkEvery')}</span>
          <Select
            value={String(feed.pollIntervalMinutes)}
            onValueChange={(val) =>
              onUpdateSettings(feed.id, { pollIntervalMinutes: Number(val) as PollInterval })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pollIntervalOptions.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Category selector */}
        <div className="flex flex-col gap-1.5 pt-2">
          <span className="text-sm">{t('options.feedSettings.category')}</span>
          {isAddingNew ? (
            <Input
              autoFocus
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleNewCategoryCommit(); }
                if (e.key === 'Escape') { setIsAddingNew(false); }
              }}
              onBlur={handleNewCategoryCommit}
              onClick={(e) => e.stopPropagation()}
              placeholder={t('options.feedSettings.newCategoryPlaceholder')}
              className="h-8 text-xs"
            />
          ) : (
            <Select
              value={feed.category ?? NONE_CATEGORY_VALUE}
              onValueChange={handleCategorySelect}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_CATEGORY_VALUE} className="text-xs text-muted-foreground">
                  {t('options.feedSettings.none')}
                </SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat} className="text-xs">
                    <bdi dir="auto">{cat}</bdi>
                  </SelectItem>
                ))}
                <SelectItem value={NEW_CATEGORY_VALUE} className="text-xs text-primary">
                  {t('options.feedSettings.newCategory')}
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
