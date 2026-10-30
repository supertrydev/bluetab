import { getLocaleTag, getTimeFormatPreference, t } from './index';

function toDate(value: number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Applies Settings > General > Time format to options that show an hour.
 * 'system' leaves the locale default (en-US 12h, tr/en-GB 24h). Callers that
 * set hour12/hourCycle themselves keep their choice.
 */
export function withTimeFormatPreference(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  if (!options.hour || options.hour12 !== undefined || options.hourCycle !== undefined) return options;
  const preference = getTimeFormatPreference();
  if (preference === '12h') return { ...options, hour12: true };
  if (preference === '24h') return { ...options, hourCycle: 'h23' };
  return options;
}

/**
 * Builds a formatter that shows "09:05" on 24-hour clocks and "9:05 AM"
 * (no leading zero) on 12-hour clocks.
 */
function createTimeFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = getLocaleTag();
  const effective = withTimeFormatPreference(options);
  const formatter = new Intl.DateTimeFormat(locale, effective);
  if (effective.hour === '2-digit' && formatter.resolvedOptions().hour12) {
    return new Intl.DateTimeFormat(locale, { ...effective, hour: 'numeric' });
  }
  return formatter;
}

export function formatTime(
  value: number | Date,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
): string {
  return createTimeFormatter(options).format(toDate(value));
}

/** "09:00" / "9 AM" style label for an hour of the day (0-23), following the time format. */
export function formatHourOfDay(hour: number): string {
  const date = new Date(2000, 0, 1, hour, 0, 0);
  return formatTime(date, { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(
  value: number | Date,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  return new Intl.DateTimeFormat(getLocaleTag(), options).format(toDate(value));
}

export function formatDateTime(
  value: number | Date,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
): string {
  return createTimeFormatter(options).format(toDate(value));
}

export interface LocaleWeekInfo {
  /** First day of the week in Date#getDay numbering (0 = Sunday). */
  firstDay: number;
  /** Weekend days in Date#getDay numbering, e.g. [6, 0] or [5, 6]. */
  weekend: number[];
}

const DEFAULT_WEEK_INFO: LocaleWeekInfo = { firstDay: 1, weekend: [6, 0] };

/**
 * Week rules for the user's locale (first day, weekend) from Intl.Locale.
 * Chrome 130+ exposes getWeekInfo(), 99-129 the weekInfo getter; anything
 * else falls back to Monday-first with a Saturday-Sunday weekend.
 */
export function getLocaleWeekInfo(localeTag: string = getLocaleTag()): LocaleWeekInfo {
  try {
    const locale = new Intl.Locale(localeTag) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number; weekend: number[] };
      weekInfo?: { firstDay: number; weekend: number[] };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (!info || typeof info.firstDay !== 'number' || !Array.isArray(info.weekend)) return DEFAULT_WEEK_INFO;
    // Intl uses ISO numbering (1 = Monday ... 7 = Sunday).
    return {
      firstDay: info.firstDay % 7,
      weekend: info.weekend.map((day) => day % 7),
    };
  } catch {
    return DEFAULT_WEEK_INFO;
  }
}

/** Date#getDay values ordered from the locale's first day of the week. */
export function getOrderedWeekdays(localeTag?: string): number[] {
  const { firstDay } = getLocaleWeekInfo(localeTag);
  return Array.from({ length: 7 }, (_, index) => (firstDay + index) % 7);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocaleTag()).format(value);
}

export function compareLocalizedStrings(left: string, right: string): number {
  return left.localeCompare(right, getLocaleTag());
}

export function formatRelativeTimeFromPast(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t('time.justNow');

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });

  const date = new Date(timestamp);
  const today = new Date(now);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) {
    return t('time.todayAt', { time: formatTime(date) });
  }
  if (isSameDay(date, yesterday)) {
    return t('time.yesterdayAt', { time: formatTime(date) });
  }

  const daysAgo = Math.floor(diff / 86_400_000);
  if (daysAgo < 7) {
    return t('time.daysAgo', { count: daysAgo });
  }

  return formatDate(date);
}

export function formatCompactPastTime(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp;
  if (diff < 0) return t('time.justNow');

  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });

  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });

  const days = Math.round(hours / 24);
  return t('time.daysAgo', { count: days });
}

export function formatFutureRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = timestamp - now;
  if (diff <= 0) return t('time.overdue');

  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return t('time.inMinutes', { count: minutes });

  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.inHours', { count: hours });

  const days = Math.round(hours / 24);
  return t('time.inDays', { count: days });
}

export function formatReminderAbsoluteTime(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isSameDay(date, now)) {
    return t('time.todayAt', { time: formatTime(date) });
  }
  if (isSameDay(date, tomorrow)) {
    return t('time.tomorrowAt', { time: formatTime(date) });
  }

  return `${formatDate(date, { month: 'short', day: 'numeric' })} ${formatTime(date)}`;
}
