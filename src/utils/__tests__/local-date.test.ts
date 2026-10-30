import {
  addLocalDays,
  parseLocalDateKey,
  toLocalDateKey,
  toLocalDateTimeInputValue,
  toLocalIsoWithOffset,
} from '../local-date';
import { getLocaleWeekInfo, getOrderedWeekdays, withTimeFormatPreference } from '@/i18n/format';
import { setTimeFormatPreference } from '@/i18n';

describe('local date helpers', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // 00:30 local time is still "today" locally even where UTC is the previous day.
    const justAfterMidnight = new Date(2026, 9, 1, 0, 30);
    expect(toLocalDateKey(justAfterMidnight)).toBe('2026-10-01');
    const lateEvening = new Date(2026, 9, 1, 23, 45);
    expect(toLocalDateKey(lateEvening)).toBe('2026-10-01');
  });

  it('parses keys back to local midnight and steps whole calendar days', () => {
    const parsed = parseLocalDateKey('2026-03-29');
    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours()]).toEqual([2026, 2, 29, 0]);
    expect(toLocalDateKey(addLocalDays(parsed, -1))).toBe('2026-03-28');
    expect(toLocalDateKey(addLocalDays(new Date(2026, 11, 31, 12), 1))).toBe('2027-01-01');
  });

  it('builds datetime-local values and offset ISO strings from local fields', () => {
    const date = new Date(2026, 9, 1, 9, 5);
    expect(toLocalDateTimeInputValue(date)).toBe('2026-10-01T09:05');
    expect(toLocalIsoWithOffset(date)).toMatch(/^2026-10-01T09:05[+-]\d\d:\d\d$/);
    expect(new Date(toLocalIsoWithOffset(date)).getTime()).toBe(date.getTime());
  });
});

describe('time format preference', () => {
  afterEach(() => setTimeFormatPreference('system'));

  it('leaves the locale default for system and forces 12h / 24h when chosen', () => {
    const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
    expect(withTimeFormatPreference(options)).toEqual(options);
    setTimeFormatPreference('12h');
    expect(withTimeFormatPreference(options)).toEqual({ ...options, hour12: true });
    setTimeFormatPreference('24h');
    expect(withTimeFormatPreference(options)).toEqual({ ...options, hourCycle: 'h23' });
  });

  it('does not touch date-only options or an explicit caller choice', () => {
    setTimeFormatPreference('12h');
    expect(withTimeFormatPreference({ month: 'short' })).toEqual({ month: 'short' });
    expect(withTimeFormatPreference({ hour: 'numeric', hour12: false })).toEqual({ hour: 'numeric', hour12: false });
  });
});

describe('locale week info', () => {
  it('returns first day and weekend in Date#getDay numbering', () => {
    const info = getLocaleWeekInfo('en-GB');
    expect(info.firstDay).toBe(1);
    expect(info.weekend.sort()).toEqual([0, 6]);
  });

  it('follows regions with other week rules when the runtime knows them', () => {
    const us = getLocaleWeekInfo('en-US');
    const egypt = getLocaleWeekInfo('ar-EG');
    // Runtimes without week data fall back to Monday-first, Sat-Sun weekend.
    expect([0, 1]).toContain(us.firstDay);
    expect([[5, 6], [0, 6]]).toContainEqual([...egypt.weekend].sort());
    expect(getOrderedWeekdays('en-GB')).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('falls back safely for invalid tags', () => {
    expect(getLocaleWeekInfo('not a locale!!')).toEqual({ firstDay: 1, weekend: [6, 0] });
  });
});
