/**
 * @module utils/reminder-recurrence
 *
 * WHY:  The next occurrence of a repeating reminder was computed from the
 *       moment the alarm happened to fire. After sleep or a late wake-up a
 *       weekly reminder moved to a new weekday and a daily one could skip a
 *       day. "Weekdays" also assumed a Saturday-Sunday weekend.
 *
 * WHAT: Steps forward from the *scheduled* occurrence (the pre-snooze time)
 *       one local calendar day at a time, keeping the same wall-clock time,
 *       until it finds the first matching day after `now`. Weekend days come
 *       from the caller (the locale's week info).
 *
 * NOT:  On a spring-forward night a time that does not exist (e.g. 02:30) is
 *       moved forward by the platform, as Date#setHours does.
 */

import type { Reminder } from '@/types/productivity';

const MAX_DAYS_AHEAD = 400;
const DEFAULT_WEEKEND = [6, 0];

export function computeNextRecurringFireAt(
    reminder: Pick<Reminder, 'fireAt' | 'snoozedFrom' | 'recurring'>,
    now: number = Date.now(),
    weekend: number[] = DEFAULT_WEEKEND,
): number | null {
    const recurring = reminder.recurring;
    if (!recurring) return null;

    // A snooze moves fireAt; the series keeps its original time and weekday.
    const scheduled = new Date(reminder.snoozedFrom ?? reminder.fireAt);
    const hours = scheduled.getHours();
    const minutes = scheduled.getMinutes();
    const scheduledWeekday = scheduled.getDay();
    const weekendDays = new Set(weekend);
    const customDays = new Set(recurring.customDays ?? []);

    if (recurring.interval === 'custom' && customDays.size === 0) return null;

    const matches = (day: number): boolean => {
        switch (recurring.interval) {
            case 'daily':
                return true;
            case 'weekly':
                return day === scheduledWeekday;
            case 'weekdays':
                return !weekendDays.has(day);
            case 'custom':
                return customDays.has(day);
            default:
                return false;
        }
    };

    const candidate = new Date(scheduled);
    for (let step = 0; step < MAX_DAYS_AHEAD; step += 1) {
        candidate.setDate(candidate.getDate() + 1);
        candidate.setHours(hours, minutes, 0, 0);
        if (candidate.getTime() > now && matches(candidate.getDay())) {
            return candidate.getTime();
        }
    }
    return null;
}
