import { computeNextRecurringFireAt } from '../reminder-recurrence';

const at = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const day = (ts: number | null) => (ts === null ? null : new Date(ts).getDay());

describe('computeNextRecurringFireAt', () => {
  // 2026-10-05 is a Monday.
  const mondayNine = at(2026, 10, 5);

  it('daily: next day at the scheduled wall-clock time', () => {
    const next = computeNextRecurringFireAt({ fireAt: mondayNine, recurring: { interval: 'daily' } }, mondayNine + 1000);
    expect(next).toBe(at(2026, 10, 6));
  });

  it('weekly: keeps the scheduled weekday even when the alarm fires days late', () => {
    // Laptop slept; alarm delivered Thursday.
    const lateDelivery = at(2026, 10, 8, 15);
    const next = computeNextRecurringFireAt({ fireAt: mondayNine, recurring: { interval: 'weekly' } }, lateDelivery);
    expect(next).toBe(at(2026, 10, 12));
    expect(day(next)).toBe(1);
  });

  it('daily: does not skip the next slot when the alarm fires after midnight', () => {
    const afterMidnight = at(2026, 10, 6, 0, 10);
    const next = computeNextRecurringFireAt({ fireAt: at(2026, 10, 5, 23, 0), recurring: { interval: 'daily' } }, afterMidnight);
    expect(next).toBe(at(2026, 10, 6, 23, 0));
  });

  it('weekdays: skips the locale weekend (Sat/Sun or Fri/Sat)', () => {
    const friday = at(2026, 10, 9);
    expect(day(computeNextRecurringFireAt({ fireAt: friday, recurring: { interval: 'weekdays' } }, friday + 1000, [6, 0])))
      .toBe(1); // Monday
    const thursday = at(2026, 10, 8);
    expect(day(computeNextRecurringFireAt({ fireAt: thursday, recurring: { interval: 'weekdays' } }, thursday + 1000, [5, 6])))
      .toBe(0); // Sunday is a working day with a Fri/Sat weekend
  });

  it('uses the pre-snooze time for the series', () => {
    const snoozedTo = mondayNine + 15 * 60 * 1000;
    const next = computeNextRecurringFireAt(
      { fireAt: snoozedTo, snoozedFrom: mondayNine, recurring: { interval: 'daily' } },
      snoozedTo + 1000,
    );
    expect(next).toBe(at(2026, 10, 6));
  });

  it('custom days, empty custom days and non-recurring reminders', () => {
    const next = computeNextRecurringFireAt(
      { fireAt: mondayNine, recurring: { interval: 'custom', customDays: [3, 5] } },
      mondayNine + 1000,
    );
    expect(day(next)).toBe(3);
    expect(computeNextRecurringFireAt({ fireAt: mondayNine, recurring: { interval: 'custom', customDays: [] } }, mondayNine)).toBeNull();
    expect(computeNextRecurringFireAt({ fireAt: mondayNine }, mondayNine)).toBeNull();
  });

  it('keeps 09:00 local across a DST change', () => {
    // Europe/US DST changes happen in late Oct / early Nov; stepping by calendar days keeps the wall clock.
    let fireAt = at(2026, 10, 20);
    for (let i = 0; i < 21; i += 1) {
      const next = computeNextRecurringFireAt({ fireAt, recurring: { interval: 'daily' } }, fireAt + 1000)!;
      expect(new Date(next).getHours()).toBe(9);
      fireAt = next;
    }
  });
});
