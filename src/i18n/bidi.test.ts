import { isolateBidi } from './bidi';

describe('bidi isolation helpers', () => {
  it('isolates technical values left-to-right without changing their characters', () => {
    expect(isolateBidi('ABC-123', 'ltr')).toBe('\u2066ABC-123\u2069');
  });

  it('isolates user and external text using first-strong direction', () => {
    expect(isolateBidi('مجموعة Mixed', 'auto')).toBe('\u2068مجموعة Mixed\u2069');
  });
});
