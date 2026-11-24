/**
 * @module options/components/ReminderQuickPicker
 *
 * WHY:  Users need a fast, low-friction way to set reminders on groups from
 *       the 3-dot menu. Without quick presets, users would need to navigate
 *       to settings and manually input a time for every reminder.
 *
 * WHAT: Radix Dialog with 4 quick preset buttons (30min, 1h, 2h, Tomorrow 9am)
 *       plus an always-visible datetime-local custom input. On selection,
 *       calls ReminderService.create and shows a toast.
 *
 * HOW:  - Opens when user clicks "Set Reminder" in GroupMenu
 *       - Preset buttons compute fireAt from Date.now() + offset
 *       - "Tomorrow 9am" computes next day at 09:00 local time
 *       - Custom datetime starts prefilled on open with a valid future minute
 *       - On error (e.g. 50-reminder cap), shows error toast
 *
 * NOT:  Does not manage reminders -- that is ReminderSettings.tsx.
 *       Does not handle notifications -- that is service-worker.ts.
 */

import { toLocalDateTimeInputValue } from '@/utils/local-date';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Clock, Calendar } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ReminderService } from '@/services/reminder-service';
import { ToastManager } from '@/components/Toast';
import { formatFutureRelativeTime, formatReminderAbsoluteTime } from '@/i18n/format';
import { isolateBidi } from '@/i18n/bidi';
import type { TabGroup } from '@/types/models';
import type { Reminder } from '@/types/productivity';

export interface ReminderQuickPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: TabGroup;
}

interface PresetOption {
  label: string;
  getFireAt: () => number;
  icon: typeof Clock;
}

// datetime-local values are local wall-clock time; toISOString() would be UTC.
function getDefaultCustomDateTime(): string {
  return toLocalDateTimeInputValue(Date.now() + 60000);
}

function getTomorrow9am(): number {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow.getTime();
}

export function ReminderQuickPicker({ open, onOpenChange, group }: ReminderQuickPickerProps) {
  const { t } = useTranslation();
  const [customDateTime, setCustomDateTime] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recurring, setRecurring] = useState<Reminder['recurring'] | undefined>(undefined);
  const [existingReminder, setExistingReminder] = useState<Reminder | null>(null);
  const presets: PresetOption[] = [
    { label: t('options.reminderQuickPicker.presets.minutes30'), getFireAt: () => Date.now() + 30 * 60000, icon: Clock },
    { label: t('options.reminderQuickPicker.presets.hour1'), getFireAt: () => Date.now() + 60 * 60000, icon: Clock },
    { label: t('options.reminderQuickPicker.presets.hours2'), getFireAt: () => Date.now() + 120 * 60000, icon: Clock },
    { label: t('options.reminderQuickPicker.presets.tomorrow9am'), getFireAt: getTomorrow9am, icon: Calendar },
  ];

  useEffect(() => {
    if (open && group) {
      ReminderService.findByTargetId(group.id).then(setExistingReminder);
      setCustomDateTime(getDefaultCustomDateTime());
    } else {
      setExistingReminder(null);
      setRecurring(undefined);
      setCustomDateTime('');
    }
  }, [open, group]);

  const handleSelect = async (fireAt: number) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // Replace existing reminder on this group
      if (existingReminder) {
        await ReminderService.dismiss(existingReminder.id);
      }
      await ReminderService.create({
        targetType: 'group',
        targetId: group.id,
        targetName: group.name,
        targetUrls: group.tabs.map((t) => t.url),
        fireAt,
        recurring,
      });

      ToastManager.getInstance().success(
        t('options.reminderQuickPicker.setSuccess', {
          time: formatFutureRelativeTime(fireAt),
        }),
      );
      onOpenChange(false);
      setCustomDateTime('');
    } catch (error) {
      ToastManager.getInstance().error(
        (error as Error).message || t('options.reminderQuickPicker.setError'),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCustomSubmit = () => {
    if (!customDateTime) return;
    const fireAt = new Date(customDateTime).getTime();
    if (fireAt <= Date.now()) {
      ToastManager.getInstance().error(t('options.reminderQuickPicker.futureError'));
      return;
    }
    handleSelect(fireAt);
  };

  // Compute the minimum datetime-local value (current time)
  const minDateTime = toLocalDateTimeInputValue(Date.now() + 60000);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setCustomDateTime('');
          setRecurring(undefined);
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            {t('options.reminderQuickPicker.title')}
          </DialogTitle>
          <DialogDescription>
            {t('options.reminderQuickPicker.description', { name: isolateBidi(group.name) })}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          {/* Existing reminder replacement warning */}
          {existingReminder && (
            <div className="text-xs text-warning bg-warning-muted border border-warning/30 rounded-lg px-3 py-2">
              {t('options.reminderQuickPicker.existingWarning', {
                time: isolateBidi(formatReminderAbsoluteTime(existingReminder.fireAt), 'ltr'),
              })}
            </div>
          )}

          {/* Quick Presets Grid */}
          <div className="grid grid-cols-2 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => handleSelect(preset.getFireAt())}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-full border border-border bg-bg-1 text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <preset.icon className="w-4 h-4 text-muted-foreground" />
                {preset.label}
              </button>
            ))}
          </div>

          {/* Custom date selection */}
          <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              {t('options.reminderQuickPicker.customDateTime')}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={customDateTime}
                onChange={(e) => setCustomDateTime(e.target.value)}
                min={minDateTime}
                dir="ltr"
                className="flex-1 px-3 py-1.5 text-sm border border-field rounded-input bg-bg-1 text-foreground"
              />
              <button
                onClick={handleCustomSubmit}
                disabled={!customDateTime || isSubmitting}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common.set')}
              </button>
            </div>
          </div>

          {/* Recurring toggle */}
          <div className="border-t border-border pt-3">
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                id="recurring-toggle"
                checked={!!recurring}
                onChange={(e) => setRecurring(e.target.checked ? { interval: 'daily' } : undefined)}
                className="rounded border-border"
              />
              <label htmlFor="recurring-toggle" className="text-sm text-foreground cursor-pointer">
                {t('common.repeat')}
              </label>
            </div>
            {recurring && (
              <div className="flex gap-2 ms-5">
                {(['daily', 'weekly', 'weekdays'] as const).map((interval) => (
                  <button
                    key={interval}
                    onClick={() => setRecurring({ interval })}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                      recurring.interval === interval
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                    }`}
                  >
                    {interval === 'daily'
                      ? t('options.reminderQuickPicker.repeatDaily')
                      : interval === 'weekly'
                        ? t('options.reminderQuickPicker.repeatWeekly')
                        : t('options.reminderQuickPicker.repeatWeekdays')}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
