/**
 * Unit tests for WrappedService
 *
 * Tests: isSeasonalWindowOpen (boundary dates), getWrappedYear (year boundary),
 *        assignPersonalityTitle (highest-margin algorithm, null cases),
 *        generateSnapshot (aggregation, minimum day threshold),
 *        saveSnapshot (RingBuffer(5) eviction, same-year upsert).
 *
 * All tests mock Storage and RingBuffer internals.
 */

import { WrappedService } from './wrapped-service';
import { Storage } from '@/utils/storage';
import type { WrappedSnapshot, DerivedMetrics } from '@/types/wrapped';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<DerivedMetrics> = {}): DerivedMetrics {
  return {
    avgOpenTabs: 0,
    maxTabsInGroup: 0,
    nightOwlPercent: 0,
    earlyRiserDays: 0,
    weekendVolumePercent: 0,
    avgTabLifespanSeconds: 120,
    maxTabsInSession: 0,
    singleDomainFocusHours: 0,
    bulkCloseActions: 0,
    zeroDayEndings: 0,
    dailyPomodoroMax: 0,
    socialPlatformsDaily: 0,
    singleDomainPercent: 0,
    groupsShared: 0,
    duplicateUrlMax: 0,
    groupSwitchesHourly: 0,
    ...overrides,
  };
}

function makeSnapshot(year: number, overrides: Partial<WrappedSnapshot> = {}): WrappedSnapshot {
  return {
    year,
    generatedAt: Date.now(),
    dataWindow: { from: `${year}-01-01`, to: `${year}-11-20` },
    totalTabsSaved: 100,
    totalGroupsCreated: 10,
    topDomains: [{ domain: 'github.com', visits: 50 }],
    pomodoroSessionsCompleted: 5,
    focusHoursTotal: 2,
    remindersSet: 3,
    streakDays: 10,
    mostProductiveDay: `${year}-06-15`,
    storageUsedBytes: 50000,
    personalityTitle: null,
    derivedMetrics: makeMetrics(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedStorage.set.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// isSeasonalWindowOpen
// ---------------------------------------------------------------------------

describe('WrappedService.isSeasonalWindowOpen', () => {
  it('returns false for Nov 24 (day before window opens)', () => {
    expect(WrappedService.isSeasonalWindowOpen(new Date(2026, 10, 24))).toBe(false);
  });

  it('returns true for Nov 25 (first day of window)', () => {
    expect(WrappedService.isSeasonalWindowOpen(new Date(2026, 10, 25))).toBe(true);
  });

  it('returns true for Dec 15 (mid-window)', () => {
    expect(WrappedService.isSeasonalWindowOpen(new Date(2026, 11, 15))).toBe(true);
  });

  it('returns true for Jan 7 (last day of window)', () => {
    expect(WrappedService.isSeasonalWindowOpen(new Date(2027, 0, 7))).toBe(true);
  });

  it('returns false for Jan 8 (day after window closes)', () => {
    expect(WrappedService.isSeasonalWindowOpen(new Date(2027, 0, 8))).toBe(false);
  });

  it('returns false for Jun 15 (middle of year, far outside window)', () => {
    expect(WrappedService.isSeasonalWindowOpen(new Date(2026, 5, 15))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getWrappedYear
// ---------------------------------------------------------------------------

describe('WrappedService.getWrappedYear', () => {
  it('returns current year for a December date', () => {
    expect(WrappedService.getWrappedYear(new Date('2026-12-01'))).toBe(2026);
  });

  it('returns previous year for a January date (early Jan = last year Wrapped)', () => {
    expect(WrappedService.getWrappedYear(new Date('2027-01-05'))).toBe(2026);
  });

  it('returns current year for Nov 25 (seasonal window opens)', () => {
    expect(WrappedService.getWrappedYear(new Date('2026-11-25'))).toBe(2026);
  });
});

// ---------------------------------------------------------------------------
// assignPersonalityTitle
// ---------------------------------------------------------------------------

describe('WrappedService.assignPersonalityTitle', () => {
  it('returns null when no trigger thresholds are exceeded', () => {
    const snapshot = makeSnapshot(2026, {
      derivedMetrics: makeMetrics(), // all zero — no thresholds exceeded
    });
    const result = WrappedService.assignPersonalityTitle(snapshot);
    expect(result).toBeNull();
  });

  it('returns null for empty/zero derived metrics', () => {
    const snapshot = makeSnapshot(2026, {
      derivedMetrics: makeMetrics({
        avgOpenTabs: 0,
        nightOwlPercent: 0,
        earlyRiserDays: 0,
      }),
    });
    expect(WrappedService.assignPersonalityTitle(snapshot)).toBeNull();
  });

  it('returns the title with the highest positive margin when multiple trigger', () => {
    // avgOpenTabs >= 100 triggers "Tab Hoarder Supreme" (margin = actual/100 - 1)
    // nightOwlPercent >= 70 triggers "Night Owl" (margin = actual/70 - 1)
    // Set values so nightOwlPercent has higher margin
    const snapshot = makeSnapshot(2026, {
      derivedMetrics: makeMetrics({
        avgOpenTabs: 110,     // margin = 110/100 - 1 = 0.10
        nightOwlPercent: 84,  // margin = 84/70 - 1 = 0.20  <-- highest
      }),
    });
    const result = WrappedService.assignPersonalityTitle(snapshot);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('night-owl');
    expect(result!.triggerMargin).toBeCloseTo(0.2, 2);
  });

  it('returns the correct title when only one threshold is exceeded', () => {
    const snapshot = makeSnapshot(2026, {
      derivedMetrics: makeMetrics({
        avgOpenTabs: 150, // margin = 0.50, only trigger above threshold
      }),
    });
    const result = WrappedService.assignPersonalityTitle(snapshot);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('tab-hoarder-supreme');
  });
});

// ---------------------------------------------------------------------------
// generateSnapshot
// ---------------------------------------------------------------------------

describe('WrappedService.generateSnapshot', () => {
  it('returns null when stats_state has fewer than 7 tracked days', async () => {
    mockedStorage.get.mockResolvedValue({
      daily: [
        { date: '2026-06-01', tabsCreated: 5, tabsRemoved: 3, tabsActivated: 10, domainCounts: {}, groupsSaved: 1 },
        { date: '2026-06-02', tabsCreated: 3, tabsRemoved: 2, tabsActivated: 8, domainCounts: {}, groupsSaved: 0 },
      ],
      optOut: false,
      baselineComputed: true,
    });

    const result = await WrappedService.generateSnapshot(2026);
    expect(result).toBeNull();
  });

  it('returns a WrappedSnapshot with all required fields when data has 7+ tracked days', async () => {
    const days = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      tabsCreated: 10,
      tabsRemoved: 5,
      tabsActivated: 20,
      domainCounts: { 'github.com': 8, 'stackoverflow.com': 4 },
      groupsSaved: 2,
    }));

    mockedStorage.get.mockResolvedValue({
      daily: days,
      optOut: false,
      baselineComputed: true,
    });

    const result = await WrappedService.generateSnapshot(2026);
    expect(result).not.toBeNull();
    expect(result!.year).toBe(2026);
    expect(result!.totalTabsSaved).toBeGreaterThan(0);
    expect(result!.totalGroupsCreated).toBeGreaterThan(0);
    expect(Array.isArray(result!.topDomains)).toBe(true);
    expect(result!.topDomains.length).toBeGreaterThan(0);
    expect(result!.derivedMetrics).toBeDefined();
    expect(typeof result!.generatedAt).toBe('number');
    expect(result!.dataWindow.from).toBeDefined();
    expect(result!.dataWindow.to).toBeDefined();
  });

  it('returns null when stats_state is missing (no key in storage)', async () => {
    mockedStorage.get.mockResolvedValue(null);

    const result = await WrappedService.generateSnapshot(2026);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveSnapshot
// ---------------------------------------------------------------------------

describe('WrappedService.saveSnapshot', () => {
  it('stores new snapshot in empty storage', async () => {
    mockedStorage.get.mockResolvedValue(null); // no existing snapshots

    const snapshot = makeSnapshot(2026);
    await WrappedService.saveSnapshot(snapshot);

    expect(mockedStorage.set).toHaveBeenCalledWith(
      'wrapped_snapshots',
      expect.arrayContaining([expect.objectContaining({ year: 2026 })]),
    );
  });

  it('evicts oldest snapshot when 5 snapshots already exist (RingBuffer(5))', async () => {
    const existing = [2021, 2022, 2023, 2024, 2025].map((y) => makeSnapshot(y));
    mockedStorage.get.mockResolvedValue(existing);

    const newSnapshot = makeSnapshot(2026);
    await WrappedService.saveSnapshot(newSnapshot);

    const saved: WrappedSnapshot[] = mockedStorage.set.mock.calls[0][1];
    expect(saved).toHaveLength(5);
    // Oldest (2021) evicted, 2022-2026 remain
    expect(saved.map((s) => s.year)).not.toContain(2021);
    expect(saved.map((s) => s.year)).toContain(2026);
  });

  it('upserts (replaces) existing snapshot for the same year', async () => {
    const existing = [makeSnapshot(2026, { totalTabsSaved: 50 })];
    mockedStorage.get.mockResolvedValue(existing);

    const updated = makeSnapshot(2026, { totalTabsSaved: 200 });
    await WrappedService.saveSnapshot(updated);

    const saved: WrappedSnapshot[] = mockedStorage.set.mock.calls[0][1];
    const result2026 = saved.find((s) => s.year === 2026);
    expect(result2026).toBeDefined();
    expect(result2026!.totalTabsSaved).toBe(200);
    // Should not have duplicates for same year
    expect(saved.filter((s) => s.year === 2026)).toHaveLength(1);
  });
});
