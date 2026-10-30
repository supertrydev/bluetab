/**
 * Tests for format-time utility: formatRelativeTime.
 * Covers all 6 time format branches using Jest fake timers.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initI18n, setTimeFormatPreference } from '@/i18n';
import { formatRelativeTime } from './format-time';

const turkish = JSON.parse(readFileSync(resolve(process.cwd(), 'src/i18n/locales/tr.json'), 'utf8'));

// Pin "now" to March 16 2026, 14:30:00 for all tests
const NOW = new Date(2026, 2, 16, 14, 30, 0).getTime(); // month is 0-indexed

describe('formatRelativeTime', () => {
    beforeAll(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        await initI18n({ language: 'en' });
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    // --- "just now" branch (< 60s) ---

    it('returns "just now" for a timestamp 30 seconds ago', () => {
        const ts = NOW - 30_000;
        expect(formatRelativeTime(ts)).toBe('just now');
    });

    it('returns "just now" for a timestamp 45 seconds ago', () => {
        const ts = NOW - 45_000;
        expect(formatRelativeTime(ts)).toBe('just now');
    });

    it('returns "just now" for a timestamp 59 seconds ago', () => {
        const ts = NOW - 59_000;
        expect(formatRelativeTime(ts)).toBe('just now');
    });

    // --- "N min ago" branch (>= 60s, < 1h) ---

    it('returns "5 min ago" for a timestamp 5 minutes ago', () => {
        const ts = NOW - 300_000;
        expect(formatRelativeTime(ts)).toBe('5 min ago');
    });

    it('returns "1 min ago" for a timestamp exactly 1 minute ago', () => {
        const ts = NOW - 60_000;
        expect(formatRelativeTime(ts)).toBe('1 min ago');
    });

    it('returns "59 min ago" for a timestamp 59 minutes ago', () => {
        const ts = NOW - 59 * 60_000;
        expect(formatRelativeTime(ts)).toBe('59 min ago');
    });

    // --- "today HH:mm" branch (same calendar day, >= 1h ago) ---
    // These cases pin the 24-hour setting; the locale default is covered below.
    beforeEach(() => setTimeFormatPreference('24h'));
    afterEach(() => setTimeFormatPreference('system'));

    it('returns "today 09:00" for a timestamp today at 09:00', () => {
        // NOW is March 16 2026, 14:30 — so 09:00 is 5.5h ago (> 1h)
        const ts = new Date(2026, 2, 16, 9, 0, 0).getTime();
        expect(formatRelativeTime(ts)).toBe('today 09:00');
    });

    it('returns "today HH:mm" with zero-padded minutes', () => {
        const ts = new Date(2026, 2, 16, 8, 5, 0).getTime();
        expect(formatRelativeTime(ts)).toBe('today 08:05');
    });

    // --- "yesterday HH:mm" branch ---

    it('returns "yesterday 02:31" for March 15 2026 at 02:31', () => {
        const ts = new Date(2026, 2, 15, 2, 31, 0).getTime();
        expect(formatRelativeTime(ts)).toBe('yesterday 02:31');
    });

    it('returns "yesterday HH:mm" at midnight boundary (midnight yesterday)', () => {
        const ts = new Date(2026, 2, 15, 0, 0, 0).getTime();
        expect(formatRelativeTime(ts)).toBe('yesterday 00:00');
    });

    // --- "N days ago" branch (2-6 days) ---

    it('returns "3 days ago" for a timestamp 3 days ago', () => {
        const ts = NOW - 3 * 86_400_000;
        expect(formatRelativeTime(ts)).toBe('3 days ago');
    });

    it('returns "6 days ago" for a timestamp 6 days ago', () => {
        const ts = NOW - 6 * 86_400_000;
        expect(formatRelativeTime(ts)).toBe('6 days ago');
    });

    // --- Full date branch (>= 7 days) ---

    it('returns a full date string like "Mar 6, 2026" for 10 days ago', () => {
        const ts = NOW - 10 * 86_400_000;
        const result = formatRelativeTime(ts);
        // Should contain the month abbreviation and year — not relative
        expect(result).not.toContain('ago');
        expect(result).not.toContain('today');
        expect(result).not.toContain('yesterday');
        // Should look like a date string
        expect(result.length).toBeGreaterThan(5);
    });

    it('returns a full date string for 365 days ago (different year)', () => {
        const ts = NOW - 365 * 86_400_000;
        const result = formatRelativeTime(ts);
        expect(result).not.toContain('ago');
        expect(result).not.toContain('today');
        expect(result).not.toContain('yesterday');
        // Should contain the year "2025" since it is ~1 year ago from 2026
        expect(result).toContain('2025');
    });
});

describe('formatRelativeTime in Turkish', () => {
    beforeAll(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        await initI18n({ language: 'tr' });
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    it('returns Turkish labels for recent timestamps', () => {
        const ts = NOW - 5 * 60_000;
        expect(formatRelativeTime(ts)).toBe(turkish.time.minutesAgo_other.replace('{{count}}', '5'));
    });

    it('returns Turkish today/yesterday labels', () => {
        const todayTs = new Date(2026, 2, 16, 9, 0, 0).getTime();
        const yesterdayTs = new Date(2026, 2, 15, 2, 31, 0).getTime();

        expect(formatRelativeTime(todayTs)).toBe(turkish.time.todayAt.replace('{{time}}', '09:00'));
        expect(formatRelativeTime(yesterdayTs)).toBe(turkish.time.yesterdayAt.replace('{{time}}', '02:31'));
    });
});

describe('formatRelativeTime clock style', () => {
    beforeAll(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        await initI18n({ language: 'en' });
    });

    afterAll(() => {
        jest.useRealTimers();
        setTimeFormatPreference('system');
    });

    it('follows the locale by default (English uses a 12-hour clock without a leading zero)', () => {
        setTimeFormatPreference('system');
        expect(formatRelativeTime(new Date(2026, 2, 16, 9, 0, 0).getTime())).toMatch(/^today 9:00\s?AM$/);
    });

    it('uses a 12-hour clock when the user picks 12h', () => {
        setTimeFormatPreference('12h');
        expect(formatRelativeTime(new Date(2026, 2, 16, 13, 5, 0).getTime())).toMatch(/^today 1:05\s?PM$/);
    });
});
