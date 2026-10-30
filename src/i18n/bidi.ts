export type BidiIsolationDirection = 'auto' | 'ltr' | 'rtl';

const ISOLATE_START: Record<BidiIsolationDirection, string> = {
  auto: '\u2068',
  ltr: '\u2066',
  rtl: '\u2067',
};

const POP_DIRECTIONAL_ISOLATE = '\u2069';

/** Keep dynamic text as one visual unit inside a sentence with another direction. */
export function isolateBidi(
  value: string | number,
  direction: BidiIsolationDirection = 'auto',
): string {
  return `${ISOLATE_START[direction]}${String(value)}${POP_DIRECTIONAL_ISOLATE}`;
}
