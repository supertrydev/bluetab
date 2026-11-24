/**
 * @module settings/components/ReminderSettings
 *
 * WHY:  Users need a central place to view all active reminders and delete
 *       ones they no longer need. Without this, reminders are fire-and-forget
 *       with no visibility or management.
 *
 * WHAT: Settings section showing a list of all active reminders with target
 *       name, relative time until fire, absolute fire time, and a delete button.
 *
 * HOW:  - Loads ReminderService.listActive() on mount
 *       - Listens to chrome.storage.onChanged for 'reminders' key to
 *         reactively update when reminders are created/snoozed/dismissed
 *       - Delete calls ReminderService.delete(id) and shows toast
 *       - Formats fireAt with Intl.DateTimeFormat and relative time calculation
 *
 * NOT:  Does not create reminders -- that is ReminderQuickPicker.tsx.
 *       Does not handle notification routing -- that is service-worker.ts.
 */

import { previewNotificationSound } from '@/platform/extension-platform';
import { useState, useEffect } from 'react';
import { Bell, Trash2, Play } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Storage } from '@/utils/storage';
import { ReminderService } from '@/services/reminder-service';
import { ToastManager } from '@/components/Toast';
import { formatFutureRelativeTime, formatReminderAbsoluteTime } from '@/i18n/format';
import type { Reminder, ReminderSettings as ReminderSettingsType } from '@/types/productivity';
import { DEFAULT_REMINDER_SETTINGS } from '@/types/productivity';
import type { NotificationSound } from '@/types/rss';
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

async function previewSound(sound: NotificationSound): Promise<void> {
  await previewNotificationSound(sound, 'Previewing reminder notification sound');
}

export function ReminderSettings() {
  const { t } = useTranslation();
  const translate = (key: string) => t(key as never) as unknown as string;
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reminderConfig, setReminderConfig] = useState<ReminderSettingsType>(DEFAULT_REMINDER_SETTINGS);
  const soundOptions = getSoundOptions(translate);

  // Load active reminders and settings on mount
  useEffect(() => {
    ReminderService.listActive().then(setReminders);
    Storage.get<ReminderSettingsType>('reminderSettings').then((stored) => {
      if (stored) setReminderConfig({ ...DEFAULT_REMINDER_SETTINGS, ...stored });
    });
  }, []);

  // Listen for storage changes to reactively update
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.reminders) {
        const all: Reminder[] = changes.reminders.newValue || [];
        const now = Date.now();
        const active = all
          .filter((r) => r.fireAt > now)
          .sort((a, b) => a.fireAt - b.fireAt);
        setReminders(active);
      }
      if (changes.reminderSettings) {
        const s = changes.reminderSettings.newValue;
        if (s) setReminderConfig({ ...DEFAULT_REMINDER_SETTINGS, ...s });
      }
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  const updateSettings = async (patch: Partial<ReminderSettingsType>) => {
    const updated = { ...reminderConfig, ...patch };
    setReminderConfig(updated);
    await Storage.set('reminderSettings', updated);
  };

  const handleDelete = async (reminderId: string, targetName: string) => {
    setDeletingId(reminderId);
    try {
      await ReminderService.delete(reminderId);
      ToastManager.getInstance().success({
        key: 'settings.reminders.deleteSuccess',
        values: { target: targetName },
      });
    } catch {
      ToastManager.getInstance().error({ key: 'settings.reminders.deleteError' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
        <Bell className="w-5 h-5" />
        {t('settings.reminders.title')}
      </h3>

      {/* Show Badge Toggle */}
      <div className="space-y-4 mb-4">
        <div className="flex items-start gap-3 p-3 rounded-md border border-border bg-bg-1">
          <Switch
            id="reminder-show-badge"
            checked={reminderConfig.showBadge}
            onCheckedChange={(checked) => updateSettings({ showBadge: checked })}
          />
          <Label htmlFor="reminder-show-badge" className="flex-1 cursor-pointer space-y-1">
            <div className="text-sm font-medium text-text-strong">
              {t('settings.reminders.showBadgeTitle')}
            </div>
            <div className="text-xs text-text-muted">
              {t('settings.reminders.showBadgeDescription')}
            </div>
          </Label>
        </div>

        {/* Sound Toggle */}
        <div className="flex items-start gap-3 p-3 rounded-md border border-border bg-bg-1">
          <Switch
            id="reminder-sound"
            checked={reminderConfig.soundEnabled}
            onCheckedChange={(checked) => updateSettings({ soundEnabled: checked })}
          />
          <Label htmlFor="reminder-sound" className="flex-1 cursor-pointer space-y-1">
            <div className="text-sm font-medium text-text-strong">
              {t('settings.reminders.notificationSoundTitle')}
            </div>
            <div className="text-xs text-text-muted">
              {t('settings.reminders.notificationSoundDescription')}
            </div>
          </Label>
        </div>

        {reminderConfig.soundEnabled && (
          <div className="flex items-center gap-3 p-3 rounded-md bg-muted ms-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-text-strong block mb-1.5">
                {t('settings.reminders.soundLabel')}
              </label>
              <Select
                value={reminderConfig.sound}
                onValueChange={(v) => {
                  updateSettings({ sound: v as NotificationSound });
                  previewSound(v as NotificationSound);
                }}
                >
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
              onClick={() => previewSound(reminderConfig.sound)}
              title={t('common.previewSound')}
            >
              <Play className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div>
        <h4 className="text-sm font-medium text-text-strong mb-2">
          {t('settings.reminders.activeReminders')}
        </h4>

        {reminders.length === 0 ? (
          <div className="p-4 rounded-md bg-muted text-center">
            <p className="text-sm text-muted-foreground">{t('settings.reminders.noActiveReminders')}</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg divide-y divide-border">
            {reminders.map((reminder) => (
              <div
                key={reminder.id}
                className="flex items-center justify-between px-3 py-2.5 text-sm"
              >
                <div className="flex flex-col min-w-0 flex-1 me-3">
                  <span className="font-medium text-foreground truncate flex items-center gap-1">
                    <bdi dir="auto">{reminder.targetName}</bdi>
                    {reminder.recurring && (
                      <span dir="ltr" className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium ms-1">
                        {reminder.recurring.interval}
                      </span>
                    )}
                  </span>
                  <time dir="ltr" className="text-xs text-muted-foreground">
                    {formatFutureRelativeTime(reminder.fireAt)} ({formatReminderAbsoluteTime(reminder.fireAt)})
                  </time>
                </div>
                <button
                  onClick={() => handleDelete(reminder.id, reminder.targetName)}
                  disabled={deletingId === reminder.id}
                  className="flex-shrink-0 p-1.5 text-muted-foreground hover:text-danger transition-colors disabled:opacity-50"
                  title={t('settings.reminders.deleteTitle')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
