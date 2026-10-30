/**
 * @module services/integrations/calendar-date-time
 *
 * WHY:  Google Calendar answers 400 Bad Request to a dateTime without seconds
 *       ("2026-10-12T14:00"), and the AI often writes times that way.
 *
 * WHAT: Completes a calendar date-time to the full RFC 3339 shape the
 *       providers expect: seconds added, a space separator turned into "T",
 *       a "+0300" offset written as "+03:00". Anything else is left as is so
 *       the provider still reports truly invalid input.
 */

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

export function normalizeEventDateTime(value: string): string {
  const match = DATE_TIME.exec(value.trim());
  if (!match) return value;
  const [, date, hoursMinutes, seconds = ':00', offset = ''] = match;
  const zone = offset.toUpperCase() === 'Z'
    ? 'Z'
    : offset.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  return `${date}T${hoursMinutes}${seconds}${zone}`;
}
