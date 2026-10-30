/**
 * Unit tests for StatsService
 *
 * Tests: recordTabEvent (created/activated/removed), getDailyStats,
 *        getAggregateStats, RingBuffer eviction at 365 entries,
 *        URL filtering, computeRetroactiveBaseline, storage budget.
 *
 * All tests mock Storage and use chrome mocks from jest-setup.ts.
 */

import { StatsService } from './stats-service';
import { Storage } from '@/utils/storage';
import type { DailyStats, StatsState } from '@/types/stats';
import type { TabGroup } from '@/types/models';
import { addLocalDays, toLocalDateKey } from '@/utils/local-date';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;

// Fixed date for deterministic tests: "2026-03-16"
const TODAY = '2026-03-16';
// Local noon, so the fixture means the same calendar day in every time zone.
const TODAY_TS = new Date(2026, 2, 16, 12, 0, 0).getTime();

function makeEmptyState(): StatsState {
  return { daily: [], optOut: false, baselineComputed: false };
}

function makeDaily(date: string, overrides: Partial<DailyStats> = {}): DailyStats {
  return {
    date,
    tabsCreated: 0,
    tabsRemoved: 0,
    tabsActivated: 0,
    domainCounts: {},
    groupsSaved: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Pin Date.now() to a fixed timestamp so today's ISO date is "2026-03-16"
  jest.spyOn(Date, 'now').mockReturnValue(TODAY_TS);
  mockedStorage.set.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('StatsService', () => {

  // ---------------------------------------------------------------------------
  // Test 1: recordTabEvent('created') creates today's entry with tabsCreated=1
  // ---------------------------------------------------------------------------
  describe('recordTabEvent - created', () => {
    it('creates a DailyStats entry for today with tabsCreated=1 on empty storage', async () => {
      mockedStorage.get.mockResolvedValue(null);

      await StatsService.recordTabEvent('created', 'https://github.com/foo');

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'stats_state',
        expect.objectContaining({
          daily: expect.arrayContaining([
            expect.objectContaining({
              date: TODAY,
              tabsCreated: 1,
              tabsRemoved: 0,
              tabsActivated: 0,
            }),
          ]),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: recordTabEvent('activated') increments tabsActivated and domainCounts
  // ---------------------------------------------------------------------------
  describe('recordTabEvent - activated', () => {
    it('increments tabsActivated to 2 and domainCounts["github.com"] to 2 after two activations', async () => {
      // First call: empty state
      mockedStorage.get.mockResolvedValueOnce(null);
      await StatsService.recordTabEvent('activated', 'https://github.com/');

      // Capture written state
      const afterFirst = mockedStorage.set.mock.calls[0][1] as StatsState;
      expect(afterFirst.daily[0].tabsActivated).toBe(1);
      expect(afterFirst.daily[0].domainCounts['github.com']).toBe(1);

      // Second call: use the state written by first call
      mockedStorage.get.mockResolvedValueOnce(afterFirst);
      await StatsService.recordTabEvent('activated', 'https://github.com/bar');

      const afterSecond = mockedStorage.set.mock.calls[1][1] as StatsState;
      expect(afterSecond.daily[0].tabsActivated).toBe(2);
      expect(afterSecond.daily[0].domainCounts['github.com']).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: recordTabEvent('removed') increments tabsRemoved
  // ---------------------------------------------------------------------------
  describe('recordTabEvent - removed', () => {
    it('increments tabsRemoved without requiring a URL', async () => {
      mockedStorage.get.mockResolvedValue(null);

      await StatsService.recordTabEvent('removed');

      const saved = mockedStorage.set.mock.calls[0][1] as StatsState;
      expect(saved.daily[0].tabsRemoved).toBe(1);
      expect(saved.daily[0].tabsCreated).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 4: getDailyStats(7) returns only entries within the last 7 days
  // ---------------------------------------------------------------------------
  describe('getDailyStats', () => {
    it('returns only entries within the last 7 days', async () => {
      const state: StatsState = {
        daily: [
          makeDaily('2026-03-09'), // 7 days ago (exactly on boundary — included)
          makeDaily('2026-03-08'), // 8 days ago — excluded
          makeDaily('2026-03-15'), // yesterday — included
          makeDaily('2026-03-16'), // today — included
        ],
        optOut: false,
        baselineComputed: false,
      };
      mockedStorage.get.mockResolvedValue(state);

      const result = await StatsService.getDailyStats(7);

      const dates = result.map((d) => d.date);
      expect(dates).toContain('2026-03-09');
      expect(dates).toContain('2026-03-15');
      expect(dates).toContain('2026-03-16');
      expect(dates).not.toContain('2026-03-08');
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: getDailyStats(30) with 400 entries returns correct filtered slice
  // ---------------------------------------------------------------------------
  describe('getDailyStats - large dataset', () => {
    it('handles 400 daily entries and filters correctly to last 30 days', async () => {
      // Generate 400 daily entries going back from today
      const daily: DailyStats[] = [];
      for (let i = 399; i >= 0; i--) {
        daily.push(makeDaily(toLocalDateKey(addLocalDays(TODAY_TS, -i))));
      }
      mockedStorage.get.mockResolvedValue({ daily, optOut: false, baselineComputed: false });

      const result = await StatsService.getDailyStats(30);

      // getDailyStats(N) returns entries with date >= (today - N days):
      // that is N+1 calendar days including today.  For N=30: 31 entries.
      expect(result.length).toBe(31);
      expect(result[result.length - 1].date).toBe(TODAY);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 6: RingBuffer eviction — daily array exceeds 365 entries
  // ---------------------------------------------------------------------------
  describe('RingBuffer eviction', () => {
    it('evicts oldest entry when daily array reaches 365 entries', async () => {
      const daily: DailyStats[] = [];
      // Create exactly 365 entries from 365 days ago to yesterday
      for (let i = 365; i >= 1; i--) {
        daily.push(makeDaily(toLocalDateKey(addLocalDays(TODAY_TS, -i))));
      }
      const state: StatsState = { daily, optOut: false, baselineComputed: false };
      mockedStorage.get.mockResolvedValue(state);

      // Record a new event for today — should push daily to 366 and evict oldest
      await StatsService.recordTabEvent('created', 'https://example.com');

      const saved = mockedStorage.set.mock.calls[0][1] as StatsState;
      expect(saved.daily.length).toBe(365);
      // Today's entry should be present
      expect(saved.daily[saved.daily.length - 1].date).toBe(TODAY);
      // The very oldest entry (365 days ago) should be gone
      const oldest365 = toLocalDateKey(addLocalDays(TODAY_TS, -365));
      expect(saved.daily.map((d) => d.date)).not.toContain(oldest365);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 7: recordTabEvent ignores chrome-extension:// and chrome:// URLs
  // ---------------------------------------------------------------------------
  describe('URL filtering', () => {
    it('returns early without writing for chrome-extension:// URLs', async () => {
      mockedStorage.get.mockResolvedValue(null);

      await StatsService.recordTabEvent('created', 'chrome-extension://abc/newtab.html');

      expect(mockedStorage.set).not.toHaveBeenCalled();
    });

    it('returns early without writing for chrome:// URLs', async () => {
      mockedStorage.get.mockResolvedValue(null);

      await StatsService.recordTabEvent('activated', 'chrome://newtab/');

      expect(mockedStorage.set).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 8: getAggregateStats returns correct totals and sorted topDomains
  // ---------------------------------------------------------------------------
  describe('getAggregateStats', () => {
    it('returns summed totals and topDomains sorted by count descending', async () => {
      const state: StatsState = {
        daily: [
          makeDaily('2026-03-15', {
            tabsCreated: 5,
            tabsRemoved: 2,
            tabsActivated: 10,
            domainCounts: { 'github.com': 5, 'google.com': 3 },
            groupsSaved: 1,
          }),
          makeDaily('2026-03-16', {
            tabsCreated: 3,
            tabsRemoved: 1,
            tabsActivated: 7,
            domainCounts: { 'github.com': 4, 'stackoverflow.com': 6 },
            groupsSaved: 2,
          }),
        ],
        optOut: false,
        baselineComputed: false,
      };
      mockedStorage.get.mockResolvedValue(state);

      const result = await StatsService.getAggregateStats(7);

      expect(result.totalCreated).toBe(8);
      expect(result.totalRemoved).toBe(3);
      expect(result.totalActivated).toBe(17);
      expect(result.totalGroupsSaved).toBe(3);
      // topDomains sorted descending: stackoverflow(6), github(9 total), google(3)
      expect(result.topDomains[0].domain).toBe('github.com');
      expect(result.topDomains[0].count).toBe(9);
      expect(result.topDomains[1].domain).toBe('stackoverflow.com');
      expect(result.topDomains[1].count).toBe(6);
      expect(result.topDomains[2].domain).toBe('google.com');
      expect(result.topDomains[2].count).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 9: computeRetroactiveBaseline extracts domain counts from TabGroup data
  // ---------------------------------------------------------------------------
  describe('computeRetroactiveBaseline', () => {
    it('creates DailyStats from TabGroup tabs and sets baselineComputed=true', async () => {
      const groups: TabGroup[] = [
        {
          id: 'g1',
          name: 'Work',
          tabs: [
            { id: 't1', url: 'https://github.com/repo', title: 'GitHub', timestamp: 0, groupId: 'g1' },
            { id: 't2', url: 'https://github.com/issues', title: 'Issues', timestamp: 0, groupId: 'g1' },
            { id: 't3', url: 'https://google.com/', title: 'Google', timestamp: 0, groupId: 'g1' },
          ],
          created: new Date(2026, 2, 10, 12, 0, 0).getTime(),
          modified: Date.now(),
        },
      ];

      mockedStorage.get.mockResolvedValue(makeEmptyState());

      await StatsService.computeRetroactiveBaseline(groups);

      const saved = mockedStorage.set.mock.calls[0][1] as StatsState;
      expect(saved.baselineComputed).toBe(true);
      const entry = saved.daily.find((d) => d.date === '2026-03-10');
      expect(entry).toBeDefined();
      expect(entry!.domainCounts['github.com']).toBe(2);
      expect(entry!.domainCounts['google.com']).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 10: Storage budget — 365 days of data stays within 500KB
  // ---------------------------------------------------------------------------
  describe('storage budget', () => {
    it('365 days of dense data serializes to less than 512KB', () => {
      const daily: DailyStats[] = [];
      for (let i = 0; i < 365; i++) {
        const d = new Date(TODAY_TS - i * 24 * 60 * 60 * 1000);
        daily.push({
          date: d.toISOString().slice(0, 10),
          tabsCreated: 50,
          tabsRemoved: 40,
          tabsActivated: 200,
          domainCounts: {
            'github.com': 20,
            'google.com': 15,
            'stackoverflow.com': 12,
            'youtube.com': 10,
            'twitter.com': 8,
            'reddit.com': 6,
            'linkedin.com': 5,
            'amazon.com': 4,
            'wikipedia.org': 3,
            'news.ycombinator.com': 2,
          },
          groupsSaved: 3,
        });
      }
      const state: StatsState = { daily, optOut: false, baselineComputed: true };
      const serialized = JSON.stringify(state);
      const byteSize = new TextEncoder().encode(serialized).length;

      expect(byteSize).toBeLessThan(512 * 1024);
    });
  });

});

// =============================================================================
// Phase 12: StatsService.recordFocusMinutes mode pass-through (ADHD-27)
// =============================================================================

describe('StatsService — Phase 12 mode pass-through (ADHD-27)', () => {
  it('recordFocusMinutes(10, "flowtime") records the same daily aggregate as recordFocusMinutes(10)', async () => {
    // Two separate state seeds — both should increment focusMinutes by 10
    const stateWithFlowtime: { focusMinutesAfterFlowtime: number } = { focusMinutesAfterFlowtime: 0 };
    const stateWithDefault: { focusMinutesAfterDefault: number } = { focusMinutesAfterDefault: 0 };

    // Call with mode='flowtime'
    mockedStorage.get.mockResolvedValueOnce(null); // loadState returns empty
    mockedStorage.set.mockImplementationOnce(async (key: string, value: unknown) => {
      if (key === 'stats_state') {
        const state = value as { daily: { focusMinutes?: number }[] };
        stateWithFlowtime.focusMinutesAfterFlowtime = state.daily[0]?.focusMinutes ?? 0;
      }
    });
    await StatsService.recordFocusMinutes(10, 'flowtime');

    // Call without mode (default Pomodoro)
    mockedStorage.get.mockResolvedValueOnce(null); // loadState returns empty
    mockedStorage.set.mockImplementationOnce(async (key: string, value: unknown) => {
      if (key === 'stats_state') {
        const state = value as { daily: { focusMinutes?: number }[] };
        stateWithDefault.focusMinutesAfterDefault = state.daily[0]?.focusMinutes ?? 0;
      }
    });
    await StatsService.recordFocusMinutes(10);

    // Both calls produce the same daily focusMinutes increment (mode-agnostic)
    expect(stateWithFlowtime.focusMinutesAfterFlowtime).toBe(10);
    expect(stateWithDefault.focusMinutesAfterDefault).toBe(10);
  });
});


describe('StatsService — local calendar days', () => {
  it('files activity just after local midnight under the local day, not the UTC day', async () => {
    const justAfterMidnight = new Date(2026, 2, 16, 0, 30).getTime();
    jest.spyOn(Date, 'now').mockReturnValue(justAfterMidnight);
    mockedStorage.get.mockResolvedValue(makeEmptyState());

    await StatsService.recordTabEvent('created', 'https://example.com');

    const saved = mockedStorage.set.mock.calls[0][1] as StatsState;
    expect(saved.daily[saved.daily.length - 1].date).toBe('2026-03-16');
  });

  it('counts the cutoff in local calendar days', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 2, 16, 23, 30).getTime());
    mockedStorage.get.mockResolvedValue({
      daily: [makeDaily('2026-03-08'), makeDaily('2026-03-09'), makeDaily('2026-03-16')],
      optOut: false,
      baselineComputed: false,
    });

    const dates = (await StatsService.getDailyStats(7)).map((d) => d.date);
    expect(dates).toEqual(['2026-03-09', '2026-03-16']);
  });
});
