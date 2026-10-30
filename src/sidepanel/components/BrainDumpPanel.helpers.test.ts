/**
 * Tests for the pure helpers extracted from BrainDumpPanel.
 *
 * Post-ship iteration (Phase 9 Plan 09-03 human-verify round) reworked
 * convert-to-group mapping:
 *   - group name = captured tab title | URL hostname | "Saved from dump"
 *   - group note = dump text (lands in TabGroup.notes — the existing
 *     Phase 2 group-notes field)
 *   - group tabs = single tab built from the captured URL/title/favicon
 *
 * The helpers are pure so they can be exercised without rendering the
 * panel or mocking Storage / chrome APIs.
 */

import {
  deriveGroupNameFromEntry,
  buildGroupFromEntry,
  entryMatchesQuery,
} from './BrainDumpPanel';
import type { BrainDumpEntry } from '@/types/adhd';

function makeEntry(overrides: Partial<BrainDumpEntry> = {}): BrainDumpEntry {
  return {
    id: 'entry-1',
    text: 'remember to read this later',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('deriveGroupNameFromEntry', () => {
  it('uses tabContext.title when present and non-empty', () => {
    const entry = makeEntry({
      tabContext: {
        url: 'https://example.com/path',
        title: 'Example Page Title',
      },
    });
    expect(deriveGroupNameFromEntry(entry)).toBe('Example Page Title');
  });

  it('falls back to the URL hostname when the title is empty/whitespace', () => {
    const entry = makeEntry({
      tabContext: { url: 'https://news.example.com/story', title: '   ' },
    });
    expect(deriveGroupNameFromEntry(entry)).toBe('news.example.com');
  });

  it('falls back to the URL hostname when there is no title field', () => {
    const entry = makeEntry({
      tabContext: { url: 'https://news.example.com/story', title: '' },
    });
    expect(deriveGroupNameFromEntry(entry)).toBe('news.example.com');
  });

  it('falls back to "Saved from dump" for unparseable URLs with empty title', () => {
    const entry = makeEntry({
      tabContext: { url: 'not a url', title: '' },
    });
    expect(deriveGroupNameFromEntry(entry)).toBe('Saved from dump');
  });

  it('falls back to "Saved from dump" for linkless entries', () => {
    const entry = makeEntry({ tabContext: undefined });
    expect(deriveGroupNameFromEntry(entry)).toBe('Saved from dump');
  });

  it('truncates very long titles at 120 chars', () => {
    const longTitle = 'x'.repeat(200);
    const entry = makeEntry({
      tabContext: { url: 'https://example.com/', title: longTitle },
    });
    expect(deriveGroupNameFromEntry(entry)).toHaveLength(120);
  });
});

describe('buildGroupFromEntry', () => {
  it('maps title → name, text → notes, tabContext → single tab', () => {
    const entry = makeEntry({
      text: 'follow up on the proposal next week',
      tabContext: {
        url: 'https://example.com/proposal',
        title: 'Proposal Draft',
        favicon: 'https://example.com/favicon.ico',
      },
    });

    const group = buildGroupFromEntry(
      entry,
      { groupId: 'g-1', tabId: 't-1' },
      1_800_000_000_000,
    );

    expect(group).toEqual({
      id: 'g-1',
      name: 'Proposal Draft',
      notes: 'follow up on the proposal next week',
      tabs: [
        {
          id: 't-1',
          url: 'https://example.com/proposal',
          title: 'Proposal Draft',
          favicon: 'https://example.com/favicon.ico',
          timestamp: entry.createdAt,
          groupId: 'g-1',
        },
      ],
      created: 1_800_000_000_000,
      modified: 1_800_000_000_000,
    });
  });

  it('uses URL hostname for name when title is blank', () => {
    const entry = makeEntry({
      text: 'thought body',
      tabContext: { url: 'https://docs.example.com/spec', title: '' },
    });
    const group = buildGroupFromEntry(entry);
    expect(group.name).toBe('docs.example.com');
    expect(group.notes).toBe('thought body');
  });

  it('throws when the entry has no tabContext.url (linkless)', () => {
    const entry = makeEntry({ tabContext: undefined });
    expect(() => buildGroupFromEntry(entry)).toThrow();
  });

  it('always produces exactly one tab in the group', () => {
    const entry = makeEntry({
      tabContext: { url: 'https://example.com/', title: 'Example' },
    });
    const group = buildGroupFromEntry(entry);
    expect(group.tabs).toHaveLength(1);
    expect(group.tabs[0].url).toBe('https://example.com/');
  });
});

// ============================================================================
// entryMatchesQuery — post-ship iteration round 2
// ============================================================================
//
// The Dump search used to only match `entry.text`. This caused a mismatch
// between user expectation ("I captured that page about X — let me search for
// X") and behaviour (search only hit the free-text thought, not the tab
// context). The extended match covers text + tabContext.title + tabContext.url.

describe('entryMatchesQuery', () => {
  const entry = {
    id: 'e-1',
    text: 'follow up on the proposal next week',
    createdAt: 1_700_000_000_000,
    tabContext: {
      url: 'https://docs.example.com/proposal-draft',
      title: 'Proposal Draft · Docs',
    },
  } satisfies BrainDumpEntry;

  it('returns true when the query is empty / whitespace (no filter)', () => {
    expect(entryMatchesQuery(entry, '')).toBe(true);
    expect(entryMatchesQuery(entry, '   ')).toBe(true);
  });

  it('matches against entry.text (case-insensitive)', () => {
    expect(entryMatchesQuery(entry, 'PROPOSAL')).toBe(true);
    expect(entryMatchesQuery(entry, 'next week')).toBe(true);
  });

  it('matches against tabContext.title (case-insensitive)', () => {
    expect(entryMatchesQuery(entry, 'docs')).toBe(true);
    expect(entryMatchesQuery(entry, 'DRAFT')).toBe(true);
  });

  it('matches against tabContext.url (case-insensitive)', () => {
    expect(entryMatchesQuery(entry, 'docs.example.com')).toBe(true);
    expect(entryMatchesQuery(entry, 'proposal-draft')).toBe(true);
  });

  it('returns false when the query matches none of the three fields', () => {
    expect(entryMatchesQuery(entry, 'zzzz-not-found')).toBe(false);
  });

  it('handles linkless entries (no tabContext) without throwing', () => {
    const linkless = makeEntry({ tabContext: undefined, text: 'random thought' });
    expect(entryMatchesQuery(linkless, 'random')).toBe(true);
    expect(entryMatchesQuery(linkless, 'docs')).toBe(false);
  });

  it('does not match on title/url when only partial fields are present', () => {
    const urlOnly = makeEntry({
      text: 'thought body',
      tabContext: { url: 'https://example.org/x', title: '' },
    });
    expect(entryMatchesQuery(urlOnly, 'example.org')).toBe(true);
    expect(entryMatchesQuery(urlOnly, 'completely-different')).toBe(false);
  });
});
