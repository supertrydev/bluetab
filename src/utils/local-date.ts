/**
 * @module utils/local-date
 *
 * WHY:  `date.toISOString().slice(0, 10)` gives the UTC calendar day. For a
 *       user in UTC+3 the hours 00:00-03:00 land on "yesterday"; in UTC-5
 *       the evening lands on "tomorrow". Day buckets and date inputs must use
 *       the user's local calendar instead.
 *
 * WHAT: Local-calendar helpers: day keys (YYYY-MM-DD), parsing them back to
 *       local midnight, calendar-day arithmetic, and values for
 *       <input type="date"> / <input type="datetime-local">.
 */

const pad = (value: number) => String(value).padStart(2, '0');

function toDate(value: number | Date): Date {
    return value instanceof Date ? value : new Date(value);
}

/** Local calendar day as YYYY-MM-DD. */
export function toLocalDateKey(value: number | Date = Date.now()): string {
    const date = toDate(value);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Local midnight for a YYYY-MM-DD key. `new Date('2026-10-01')` would be UTC
 * midnight, which is the previous evening west of Greenwich.
 */
export function parseLocalDateKey(key: string): Date {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
}

/** Same wall-clock time, `days` calendar days later (DST-safe, unlike adding 86_400_000). */
export function addLocalDays(value: number | Date, days: number): Date {
    const date = new Date(toDate(value).getTime());
    date.setDate(date.getDate() + days);
    return date;
}

/** Value for <input type="date"> in local time. */
export function toLocalDateInputValue(value: number | Date = Date.now()): string {
    return toLocalDateKey(value);
}

/** Value for <input type="datetime-local"> (YYYY-MM-DDTHH:mm) in local time. */
export function toLocalDateTimeInputValue(value: number | Date = Date.now()): string {
    const date = toDate(value);
    return `${toLocalDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "2026-10-01T09:00+03:00": local wall-clock time with its UTC offset. */
export function toLocalIsoWithOffset(value: number | Date): string {
    const date = toDate(value);
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absolute = Math.abs(offsetMinutes);
    return `${toLocalDateTimeInputValue(date)}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
