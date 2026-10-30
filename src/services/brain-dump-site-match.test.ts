import { BRAIN_DUMP_PREVIEW_MAX_CHARS, getBrainDumpSiteMatch, hasMatchingBrainDumpSite, normalizeBrainDumpLink } from './brain-dump-site-match';
import type { BrainDumpEntry } from '@/types/adhd';

function entry(url?: string): BrainDumpEntry {
  return {
    id: 'entry-1',
    text: 'Test dump',
    createdAt: Date.now(),
    ...(url
      ? {
          tabContext: {
            url,
            title: 'Source page',
          },
        }
      : {}),
  };
}

describe('brain dump site matching', () => {
  it('normalizes exact links while ignoring fragment differences', () => {
    expect(normalizeBrainDumpLink('https://www.example.com/path?b=2&a=1#section')).toBe(
      'https://www.example.com/path?a=1&b=2',
    );
  });

  it('matches dumps when the normalized link is exactly the same', () => {
    expect(
      hasMatchingBrainDumpSite('https://example.com/current?b=2&a=1#later', [
        entry('https://example.com/current?a=1&b=2'),
      ]),
    ).toBe(true);
  });

  it('ignores linkless and invalid entries', () => {
    expect(
      hasMatchingBrainDumpSite('https://example.com/current', [
        entry(),
        entry('not-a-url'),
      ]),
    ).toBe(false);
  });

  it('does not match different paths on the same domain', () => {
    expect(
      hasMatchingBrainDumpSite('https://example.com/current', [
        entry('https://example.com/other'),
      ]),
    ).toBe(false);
  });

  it('does not match sibling subdomains anymore', () => {
    expect(
      hasMatchingBrainDumpSite('https://app.example.com/page', [
        entry('https://docs.example.com/page'),
      ]),
    ).toBe(false);
  });

  it('does not match unrelated domains that only look similar', () => {
    expect(
      hasMatchingBrainDumpSite('https://example.com/current', [
        entry('https://notexample.com/post'),
      ]),
    ).toBe(false);
  });
});


describe('getBrainDumpSiteMatch', () => {
  const page = 'https://example.com/post?b=2&a=1#section';
  const linked = (id: string, text: string, createdAt: number, url = 'https://example.com/post?a=1&b=2'): BrainDumpEntry => ({
    id, text, createdAt, tabContext: { url, title: 'Source page' },
  });

  it('returns the newest matching note as a whitespace-collapsed preview with the match count', () => {
    const result = getBrainDumpSiteMatch(page, [
      linked('old', 'older note', 1),
      linked('new', '  call   Ayse\nabout the  draft ', 5),
      linked('other', 'elsewhere', 9, 'https://example.com/other'),
    ]);
    expect(result).toEqual({ count: 2, preview: 'call Ayse about the draft' });
  });

  it('prefers updatedAt over createdAt when choosing the newest note', () => {
    const edited = { ...linked('edited', 'edited later', 1), updatedAt: 10 };
    expect(getBrainDumpSiteMatch(page, [edited, linked('b', 'created later', 5)]).preview).toBe('edited later');
  });

  it('caps long notes so the page only receives a short preview', () => {
    const { preview } = getBrainDumpSiteMatch(page, [linked('long', 'x'.repeat(1000), 1)]);
    expect(preview.length).toBe(BRAIN_DUMP_PREVIEW_MAX_CHARS);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('returns an empty match when nothing is linked to the page', () => {
    expect(getBrainDumpSiteMatch(page, [entry('https://example.com/other')])).toEqual({ count: 0, preview: '' });
  });
});
