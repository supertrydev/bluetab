import { normalizeEventDateTime } from '../calendar-date-time';

describe('normalizeEventDateTime', () => {
  it.each([
    ['2026-10-12T14:00', '2026-10-12T14:00:00'],
    ['2026-10-12 14:00', '2026-10-12T14:00:00'],
    ['2026-10-12T14:00:00', '2026-10-12T14:00:00'],
    ['2026-10-12T14:00+0300', '2026-10-12T14:00:00+03:00'],
    ['2026-10-12T14:00:00+03:00', '2026-10-12T14:00:00+03:00'],
    ['2026-10-12T14:00:00.000Z', '2026-10-12T14:00:00.000Z'],
    ['2026-10-12t14:00z', '2026-10-12T14:00:00Z'],
  ])('completes %s to %s', (input, expected) => {
    expect(normalizeEventDateTime(input)).toBe(expected);
  });

  it('leaves values it does not recognise for the provider to reject', () => {
    expect(normalizeEventDateTime('tomorrow 2pm')).toBe('tomorrow 2pm');
    expect(normalizeEventDateTime('2026-10-12')).toBe('2026-10-12');
  });
});
