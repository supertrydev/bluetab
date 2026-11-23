import { findSearchMatch, matchesSearch, normalizeForSearch } from './search-text';

describe('language-aware search', () => {
  it.each(['\u0130stanbul', 'Istanbul', '\u0131stanbul', 'istanbul', 'I\u0307stanbul'])(
    'matches Turkish variants: %s', (text) => {
      expect(matchesSearch(text, 'istanbul')).toBe(true);
      expect(matchesSearch('istanbul', text)).toBe(true);
    },
  );
  it.each([['Café', 'cafe'], ['Cafe\u0301', 'café'], ['العَرَبِيَّة', 'العربية'], ['Ｆｉｌｅ ﬃ', 'file ffi']])(
    'folds accents, harakat and compatibility characters: %s', (text, query) => {
      expect(matchesSearch(text, query)).toBe(true);
    },
  );
  it('keeps compatibility dotless i folding idempotent across search callers', () => {
    const text = '\u{1D6A4}';
    expect(normalizeForSearch(text)).toBe('i');
    expect(normalizeForSearch(normalizeForSearch(text))).toBe(normalizeForSearch(text));
    expect(matchesSearch(text, normalizeForSearch(text))).toBe(true);
    expect(findSearchMatch(text, 'i')).toEqual({ start: 0, end: 2 });
  });
  it('trims and collapses whitespace', () => {
    expect(normalizeForSearch('  Café\t\n\u0130stanbul  ')).toBe('cafe istanbul');
    expect(matchesSearch('Café   \u0130stanbul', ' cafe istanbul ')).toBe(true);
  });
  it('matches an empty or marks-only query and rejects unrelated text', () => {
    expect(matchesSearch('anything', '')).toBe(true);
    expect(matchesSearch('', ' \u0301 ')).toBe(true);
    expect(matchesSearch('Café', 'tea')).toBe(false);
  });
  it.each([
    ['x Cafe\u0301 z', 'cafe', 'Cafe\u0301'],
    ['x العَرَبِيَّة z', 'العربية', 'العَرَبِيَّة'],
    ['x ﬃ Café z', 'cafe', 'Café'],
    ['x a \t b z', 'a b', 'a \t b'],
    ['x ﬃ z', 'ffi', 'ﬃ'],
  ])('maps highlights to the original text: %s', (text, query, highlighted) => {
    const match = findSearchMatch(text, query)!;
    expect(text.slice(match.start, match.end)).toBe(highlighted);
  });
  it('does not highlight empty queries or missing matches', () => {
    expect(findSearchMatch('Café', ' ')).toBeNull();
    expect(findSearchMatch('Café', 'tea')).toBeNull();
  });
});
