/**
 * Tests for brain-dump-service.ts
 *
 * Covers ADHD-21 (zero required fields beyond thought text), ADHD-22
 * (tabContext attach/detach + remembers-last-choice prefs), and the
 * RingBuffer(200) eviction invariant that bounds the Inbox so it never
 * exceeds STORAGE_BUDGETS.BRAIN_DUMP.
 *
 * Storage IO is mocked via @/utils/storage.
 */

import {
  BrainDumpService,
  BRAIN_DUMP_MERGE_SEPARATOR,
  skipsConfiguredRouting,
} from './brain-dump-service';
import { Storage } from '@/utils/storage';
import {
  BRAIN_DUMP_INBOX_KEY,
  BRAIN_DUMP_PREFS_KEY,
  BRAIN_DUMP_CAPACITY,
  type BrainDumpEntry,
} from '@/types/adhd';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

const mockStorageGet = Storage.get as jest.Mock;
const mockStorageSet = Storage.set as jest.Mock;

beforeEach(() => {
  // mockReset (not clearAllMocks) also wipes any leftover mockResolvedValueOnce
  // queue from the prior test — the "rejects empty text" tests queue a value
  // that is never consumed because add() throws before reaching Storage.get.
  mockStorageGet.mockReset();
  mockStorageSet.mockReset();
  mockStorageSet.mockResolvedValue(undefined);
});

// ============================================================================
// add — capture semantics + required-fields contract (ADHD-21)
// ============================================================================

describe('BrainDumpService.add — capture (ADHD-21)', () => {
  it('writes an entry with text, a generated id, and a numeric createdAt', async () => {
    mockStorageGet.mockResolvedValueOnce(null);

    const result = await BrainDumpService.add({ text: 'hello' });

    expect(result).toHaveLength(1);
    const [entry] = result;
    expect(entry.text).toBe('hello');
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.createdAt).toBe('number');
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.tabContext).toBeUndefined();

    expect(mockStorageSet).toHaveBeenCalledTimes(1);
    const [key, value] = mockStorageSet.mock.calls[0];
    expect(key).toBe(BRAIN_DUMP_INBOX_KEY);
    expect(value).toEqual(result);
  });

  it('rejects whitespace-only text (text-only field is still required)', async () => {
    mockStorageGet.mockResolvedValueOnce(null);

    await expect(BrainDumpService.add({ text: '   ' })).rejects.toThrow();
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('rejects empty text even when tabContext is provided (text is the required field)', async () => {
    mockStorageGet.mockResolvedValueOnce(null);

    await expect(
      BrainDumpService.add({
        text: '',
        tabContext: { url: 'https://example.com', title: 'Example' },
      }),
    ).rejects.toThrow();
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('persists tabContext verbatim when provided', async () => {
    mockStorageGet.mockResolvedValueOnce(null);

    const tabContext = {
      url: 'https://example.com/path',
      title: 'Example Page',
      favicon: 'https://example.com/favicon.ico',
    };
    const result = await BrainDumpService.add({ text: 'remember this', tabContext });

    expect(result).toHaveLength(1);
    expect(result[0].tabContext).toEqual(tabContext);
  });

  it('does not run configured auto-routing when an explicit destination owns the request', async () => {
    mockStorageGet.mockResolvedValueOnce(null);

    await BrainDumpService.add({
      text: 'send this once',
      skipConfiguredRouting: true,
    });
    await Promise.resolve();

    expect(mockStorageGet).toHaveBeenCalledTimes(1);
    expect(mockStorageSet).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest entry once capacity (200) is exceeded', async () => {
    // Seed the Inbox with exactly BRAIN_DUMP_CAPACITY entries.
    const seed: BrainDumpEntry[] = Array.from({ length: BRAIN_DUMP_CAPACITY }, (_, i) => ({
      id: `seed-${i}`,
      text: `entry ${i}`,
      createdAt: 1_000 + i,
    }));
    mockStorageGet.mockResolvedValueOnce(seed);

    const result = await BrainDumpService.add({ text: 'overflow' });

    // Length is clamped to capacity, and the oldest ("seed-0") was evicted.
    expect(result).toHaveLength(BRAIN_DUMP_CAPACITY);
    expect(result[0].id).toBe('seed-1');
    expect(result[result.length - 1].text).toBe('overflow');
  });
});

// ============================================================================
// add — dedup-on-capture for same tabContext.url (post-ship iteration r2)
// ============================================================================

describe('BrainDumpService.add — URL dedup (post-ship iteration r2)', () => {
  it('merges the new text into the existing entry when tabContext.url matches', async () => {
    const existing: BrainDumpEntry = {
      id: 'existing-1',
      text: 'first thought',
      createdAt: 1111,
      tabContext: {
        url: 'https://example.com/page',
        title: 'Example Page',
        favicon: 'https://example.com/favicon.ico',
      },
    };
    mockStorageGet.mockResolvedValueOnce([existing]);
    jest.spyOn(Date, 'now').mockReturnValue(9999);

    const result = await BrainDumpService.add({
      text: 'second thought',
      tabContext: {
        url: 'https://example.com/page',
        title: 'Example Page (re-visited)',
      },
    });

    expect(result).toHaveLength(1);
    const merged = result[result.length - 1];
    // Merged text: existing + separator + new (append, not replace).
    expect(merged.id).toBe('existing-1');
    expect(merged.text).toBe(`first thought${BRAIN_DUMP_MERGE_SEPARATOR}second thought`);
    // Earliest createdAt wins; updatedAt stamped fresh.
    expect(merged.createdAt).toBe(1111);
    expect(merged.updatedAt).toBe(9999);
    // Original tabContext preserved (incoming title not used to clobber).
    expect(merged.tabContext).toEqual(existing.tabContext);

    expect(mockStorageSet).toHaveBeenCalledWith(BRAIN_DUMP_INBOX_KEY, result);
    (Date.now as jest.Mock).mockRestore?.();
  });

  it('linkless captures never dedupe — each call produces a separate entry', async () => {
    const existing: BrainDumpEntry = {
      id: 'existing-1',
      text: 'thought one',
      createdAt: 1111,
    };
    mockStorageGet.mockResolvedValueOnce([existing]);

    const result = await BrainDumpService.add({ text: 'thought two' });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('existing-1');
    expect(result[0].text).toBe('thought one');
    expect(result[1].text).toBe('thought two');
  });

  it('different tabContext.url values are never merged', async () => {
    const existing: BrainDumpEntry = {
      id: 'existing-1',
      text: 'first',
      createdAt: 1111,
      tabContext: { url: 'https://a.example.com/', title: 'A' },
    };
    mockStorageGet.mockResolvedValueOnce([existing]);

    const result = await BrainDumpService.add({
      text: 'second',
      tabContext: { url: 'https://b.example.com/', title: 'B' },
    });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('existing-1');
    expect(result[1].text).toBe('second');
    expect(result[1].tabContext?.url).toBe('https://b.example.com/');
  });

  it('preserves createdAt on merge and stamps updatedAt', async () => {
    const existing: BrainDumpEntry = {
      id: 'existing-1',
      text: 'original',
      createdAt: 100,
      tabContext: { url: 'https://example.com/x', title: 'X' },
    };
    mockStorageGet.mockResolvedValueOnce([existing]);
    jest.spyOn(Date, 'now').mockReturnValue(500);

    const result = await BrainDumpService.add({
      text: 'addition',
      tabContext: { url: 'https://example.com/x', title: 'X' },
    });

    const merged = result[result.length - 1];
    expect(merged.createdAt).toBe(100);
    expect(merged.updatedAt).toBe(500);

    (Date.now as jest.Mock).mockRestore?.();
  });

  it('merged entry does not bypass the text required-field contract', async () => {
    const existing: BrainDumpEntry = {
      id: 'existing-1',
      text: 'first',
      createdAt: 1111,
      tabContext: { url: 'https://example.com/y', title: 'Y' },
    };
    mockStorageGet.mockResolvedValueOnce([existing]);

    await expect(
      BrainDumpService.add({
        text: '   ',
        tabContext: { url: 'https://example.com/y', title: 'Y' },
      }),
    ).rejects.toThrow();

    expect(mockStorageSet).not.toHaveBeenCalled();
  });
});

// ============================================================================
// list / delete
// ============================================================================

describe('BrainDumpService.list / delete', () => {
  it('returns [] when storage is empty', async () => {
    mockStorageGet.mockResolvedValueOnce(null);

    await expect(BrainDumpService.list()).resolves.toEqual([]);
  });

  it('removes the matching entry and preserves the others', async () => {
    const entries: BrainDumpEntry[] = [
      { id: 'a', text: 'first', createdAt: 1 },
      { id: 'b', text: 'second', createdAt: 2 },
      { id: 'c', text: 'third', createdAt: 3 },
    ];
    mockStorageGet.mockResolvedValueOnce(entries);

    const result = await BrainDumpService.delete('b');

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(['a', 'c']);

    const [key, value] = mockStorageSet.mock.calls[0];
    expect(key).toBe(BRAIN_DUMP_INBOX_KEY);
    expect(value).toEqual(result);
  });
});

// ============================================================================
// search / getEntry — AI access helpers
// ============================================================================

describe('BrainDumpService.search / getEntry', () => {
  const seed: BrainDumpEntry[] = [
    {
      id: 'older',
      text: 'Need to compare Claude and Gemini pricing for side projects',
      createdAt: 1000,
      tabContext: { url: 'https://example.com/pricing', title: 'Pricing Notes' },
    },
    {
      id: 'newer',
      text: 'Remember to check current GPT-4o and Gemini 2.5 Pro launch notes',
      createdAt: 2000,
      updatedAt: 2500,
      tabContext: { url: 'https://openai.com/blog', title: 'Model launch notes' },
    },
    {
      id: 'latest',
      text: 'Brain dump without a link but with a long enough body to need truncation in compact search results.',
      createdAt: 3000,
    },
  ];

  it('searches text, tab title, and tab URL, returning newest-first compact matches', async () => {
    mockStorageGet.mockResolvedValueOnce(seed);

    const result = await BrainDumpService.search('gemini', 10);

    expect(result.results).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.results.map((entry) => entry.id)).toEqual(['newer', 'older']);
    expect(result.results[0].snippet).toContain('Gemini');
    expect(result.results[0].tabTitle).toBe('Model launch notes');
    expect(result.results[1].tabUrl).toBe('https://example.com/pricing');
    expect(result.results[0].fullText).toBeUndefined();
  });

  it('returns newest entries when query is empty', async () => {
    mockStorageGet.mockResolvedValueOnce(seed);

    const result = await BrainDumpService.search('', 2);

    expect(result.totalCount).toBe(3);
    expect(result.results.map((entry) => entry.id)).toEqual(['latest', 'newer']);
  });

  it('can include full text for compact search results when explicitly requested', async () => {
    mockStorageGet.mockResolvedValueOnce(seed);

    const result = await BrainDumpService.search('launch', 5, { includeFullText: true });

    expect(result.results).toHaveLength(1);
    expect(result.totalCount).toBe(1);
    expect(result.results[0].id).toBe('newer');
    expect(result.results[0].fullText).toBe(seed[1].text);
  });

  it('matches natural-language queries even when word forms differ', async () => {
    mockStorageGet.mockResolvedValueOnce([
      {
        id: 'games',
        text: 'research the strongest parts of games in our genre',
        createdAt: 4000,
        tabContext: { url: 'https://youtube.com/watch?v=1', title: 'Game Design Notes' },
      },
    ] satisfies BrainDumpEntry[]);

    const result = await BrainDumpService.search('anything about gaming in brain dump?', 10);

    expect(result.totalCount).toBe(1);
    expect(result.results[0]?.id).toBe('games');
  });

  it('returns the newest 20 entries by default while keeping the true total count', async () => {
    const manyEntries: BrainDumpEntry[] = Array.from({ length: 25 }, (_, index) => ({
      id: `entry-${index}`,
      text: `entry ${index}`,
      createdAt: index + 1,
    }));
    mockStorageGet.mockResolvedValueOnce(manyEntries);

    const result = await BrainDumpService.search('');

    expect(result.totalCount).toBe(25);
    expect(result.results).toHaveLength(20);
    expect(result.results[0]?.id).toBe('entry-24');
    expect(result.results[19]?.id).toBe('entry-5');
  });

  it('returns the exact entry by id for full-content fetches', async () => {
    mockStorageGet.mockResolvedValueOnce(seed);

    const result = await BrainDumpService.getEntry('older');

    expect(result).toEqual(seed[0]);
  });

  it('returns null for unknown full-content fetches', async () => {
    mockStorageGet.mockResolvedValueOnce(seed);

    const result = await BrainDumpService.getEntry('missing');

    expect(result).toBeNull();
  });
});

// ============================================================================
// updateEntry — inline click-to-edit (post-ship iteration)
// ============================================================================

describe('BrainDumpService.updateEntry', () => {
  it('updates matching entry text and stamps updatedAt while preserving createdAt', async () => {
    const entries: BrainDumpEntry[] = [
      { id: 'a', text: 'first', createdAt: 1111 },
      { id: 'b', text: 'second', createdAt: 2222 },
    ];
    mockStorageGet.mockResolvedValueOnce(entries);
    jest.spyOn(Date, 'now').mockReturnValue(9999);

    const result = await BrainDumpService.updateEntry('b', { text: 'second edited' });

    expect(result).toHaveLength(2);
    const edited = result.find((e) => e.id === 'b')!;
    expect(edited.text).toBe('second edited');
    expect(edited.createdAt).toBe(2222);
    expect(edited.updatedAt).toBe(9999);

    const untouched = result.find((e) => e.id === 'a')!;
    expect(untouched.updatedAt).toBeUndefined();
    expect(untouched.text).toBe('first');

    expect(mockStorageSet).toHaveBeenCalledWith(BRAIN_DUMP_INBOX_KEY, result);

    (Date.now as jest.Mock).mockRestore?.();
  });

  it('trims whitespace around the new text', async () => {
    const entries: BrainDumpEntry[] = [{ id: 'a', text: 'old', createdAt: 1 }];
    mockStorageGet.mockResolvedValueOnce(entries);

    const result = await BrainDumpService.updateEntry('a', { text: '   padded   ' });

    expect(result[0].text).toBe('padded');
  });

  it('rejects whitespace-only new text (text is still required)', async () => {
    const entries: BrainDumpEntry[] = [{ id: 'a', text: 'old', createdAt: 1 }];
    mockStorageGet.mockResolvedValueOnce(entries);

    await expect(BrainDumpService.updateEntry('a', { text: '   ' })).rejects.toThrow();
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('is a no-op write when the id is not found in the current inbox', async () => {
    const entries: BrainDumpEntry[] = [{ id: 'a', text: 'old', createdAt: 1 }];
    mockStorageGet.mockResolvedValueOnce(entries);

    const result = await BrainDumpService.updateEntry('missing', { text: 'whatever' });

    expect(result).toEqual(entries);
    expect(mockStorageSet).not.toHaveBeenCalled();
  });
});

// ============================================================================
// prefs — remembers-last-choice (ADHD-22)
// ============================================================================

describe('BrainDumpService prefs — ADHD-22 remembers-last-choice', () => {
  it('returns default-on prefs when prefs storage is unset', async () => {
    mockStorageGet.mockResolvedValueOnce(null);

    const prefs = await BrainDumpService.getPrefs();

    expect(prefs).toEqual({
      enabled: true,
      tabContextDefault: true,
      linkedPageIndicatorEnabled: true,
    });
    expect(mockStorageGet).toHaveBeenCalledWith(BRAIN_DUMP_PREFS_KEY);
  });

  it('merges setPrefs with defaults so single-field writes keep Brain Dump enabled', async () => {
    mockStorageGet.mockResolvedValueOnce(null);

    await BrainDumpService.setPrefs({ tabContextDefault: false });
    expect(mockStorageSet).toHaveBeenCalledWith(BRAIN_DUMP_PREFS_KEY, {
      enabled: true,
      tabContextDefault: false,
      linkedPageIndicatorEnabled: true,
    });

    mockStorageGet.mockResolvedValueOnce({ enabled: true, tabContextDefault: false });
    await expect(BrainDumpService.getPrefs()).resolves.toEqual({
      enabled: true,
      tabContextDefault: false,
      linkedPageIndicatorEnabled: true,
    });
  });

  it('isEnabled defaults true and honors explicit disable', async () => {
    mockStorageGet.mockResolvedValueOnce(null);
    await expect(BrainDumpService.isEnabled()).resolves.toBe(true);

    mockStorageGet.mockResolvedValueOnce({
      enabled: false,
      tabContextDefault: true,
      linkedPageIndicatorEnabled: true,
    });
    await expect(BrainDumpService.isEnabled()).resolves.toBe(false);
  });
});

describe('skipsConfiguredRouting', () => {
  it('keeps the Notion auto-route for inbox captures and other integrations', () => {
    // The Alt+Q modal sends destinationOverride: null for "Bluetab inbox".
    expect(skipsConfiguredRouting(null)).toBe(false);
    expect(skipsConfiguredRouting(undefined)).toBe(false);
    expect(skipsConfiguredRouting({ integrationId: 'github' })).toBe(false);
  });

  it('skips it only for an explicit Notion destination to avoid a duplicate row', () => {
    expect(skipsConfiguredRouting({ integrationId: 'notion' })).toBe(true);
  });
});
