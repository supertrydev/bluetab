/**
 * Tests for history-aggregator.ts (DETECT-02, DETECT-10)
 *
 * Verifies:
 *   - aggregateHistory groups visits by hostname (stripping www.)
 *   - Uses VisitItem.visitTime (NOT HistoryItem.visitCount) for 30-day counts
 *   - sessionCount increments on >30min gap
 *   - timeOfDay is a 24-length array summing to visitCount
 *   - hasMinimumHistoryDays returns false when chrome.history.search for the
 *     last 7 days returns empty, true when it returns >= 1 item
 */

import { aggregateHistory, hasMinimumHistoryDays } from '../history-aggregator';

// Chrome history mocks are part of the global chrome mock in jest-setup.ts.
// We extend them here for history-specific tests.
const mockHistorySearch = jest.fn();
const mockHistoryGetVisits = jest.fn();

beforeEach(() => {
  (global as Record<string, unknown>).chrome = {
    ...((global as Record<string, unknown>).chrome as object),
    history: {
      search: mockHistorySearch,
      getVisits: mockHistoryGetVisits,
    },
  };
  jest.clearAllMocks();
});

// Helper to make a HistoryItem
function makeHistoryItem(url: string, id = '1') {
  return { id, url, title: url, lastVisitTime: Date.now(), visitCount: 999 };
}

// Helper to make a VisitItem with a specific timestamp
function makeVisit(visitTime: number) {
  return { visitId: String(visitTime), visitTime, referringVisitId: '0', transition: 'typed' };
}

describe('aggregateHistory (DETECT-02)', () => {
  const NOW = Date.now();
  const START_TIME = NOW - 30 * 24 * 60 * 60 * 1000;

  it('groups visits by hostname and strips www. prefix', async () => {
    const visits30Days = [
      makeVisit(START_TIME + 1000),
      makeVisit(START_TIME + 2000),
    ];

    mockHistorySearch.mockResolvedValue([makeHistoryItem('https://www.youtube.com/watch?v=1')]);
    mockHistoryGetVisits.mockResolvedValue(visits30Days);

    const result = await aggregateHistory(START_TIME);

    expect(result.length).toBe(1);
    expect(result[0].domain).toBe('youtube.com'); // www. stripped
    expect(result[0].visitCount).toBe(2);
  });

  it('uses VisitItem.visitTime (not HistoryItem.visitCount) for counts', async () => {
    // HistoryItem.visitCount is all-time (999 in this fixture).
    // aggregateHistory must count filtered VisitItems by visitTime window.
    const visits = [
      makeVisit(START_TIME + 1000),   // within window
      makeVisit(START_TIME - 5000),   // BEFORE window — must be excluded
    ];

    mockHistorySearch.mockResolvedValue([makeHistoryItem('https://github.com')]);
    mockHistoryGetVisits.mockResolvedValue(visits);

    const result = await aggregateHistory(START_TIME);

    // Only 1 visit is within the startTime window
    expect(result[0].visitCount).toBe(1);
  });

  it('increments sessionCount on >30 min gap between visits', async () => {
    const SESSION_GAP = 31 * 60 * 1000; // 31 minutes > session boundary
    const v1 = START_TIME + 1 * 60 * 1000;          // visit 1
    const v2 = v1 + SESSION_GAP;                    // visit 2, new session
    const v3 = v2 + 1 * 60 * 1000;                  // visit 3, same session as v2

    mockHistorySearch.mockResolvedValue([makeHistoryItem('https://twitter.com')]);
    mockHistoryGetVisits.mockResolvedValue([makeVisit(v1), makeVisit(v2), makeVisit(v3)]);

    const result = await aggregateHistory(START_TIME);

    expect(result[0].visitCount).toBe(3);
    expect(result[0].sessionCount).toBe(2); // gap between v1 and v2 > 30 min
  });

  it('does NOT increment sessionCount on <=30 min gap', async () => {
    const SMALL_GAP = 20 * 60 * 1000; // 20 minutes < session boundary
    const v1 = START_TIME + 1000;
    const v2 = v1 + SMALL_GAP;

    mockHistorySearch.mockResolvedValue([makeHistoryItem('https://reddit.com')]);
    mockHistoryGetVisits.mockResolvedValue([makeVisit(v1), makeVisit(v2)]);

    const result = await aggregateHistory(START_TIME);

    expect(result[0].sessionCount).toBe(1);
  });

  it('timeOfDay is a 24-length array summing to visitCount', async () => {
    const base = new Date();
    base.setMinutes(30, 0, 0);
    const hour = base.getHours(); // local time — matches new Date(timestamp).getHours() in the service
    const baseTime = base.getTime();
    const visits = [
      makeVisit(baseTime - 5 * 60 * 1000),
      makeVisit(baseTime - 3 * 60 * 1000),
    ];

    mockHistorySearch.mockResolvedValue([makeHistoryItem('https://example.com')]);
    mockHistoryGetVisits.mockResolvedValue(visits);

    const result = await aggregateHistory(Date.now() - 30 * 24 * 60 * 60 * 1000);

    expect(result[0].timeOfDay).toHaveLength(24);
    const sum = result[0].timeOfDay.reduce((a, b) => a + b, 0);
    expect(sum).toBe(result[0].visitCount);
    // Both visits are pinned inside the same local-hour bucket.
    expect(result[0].timeOfDay[hour]).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates URLs before calling getVisits', async () => {
    // Two HistoryItems with the same URL — getVisits should only be called once
    const sameUrl = 'https://github.com';
    mockHistorySearch.mockResolvedValue([
      makeHistoryItem(sameUrl, '1'),
      makeHistoryItem(sameUrl, '2'), // duplicate
    ]);
    mockHistoryGetVisits.mockResolvedValue([makeVisit(START_TIME + 1000)]);

    await aggregateHistory(START_TIME);

    expect(mockHistoryGetVisits).toHaveBeenCalledTimes(1);
  });

  it('sorts results by visitCount descending', async () => {
    mockHistorySearch.mockResolvedValue([
      makeHistoryItem('https://low-traffic.com', '1'),
      makeHistoryItem('https://high-traffic.com', '2'),
    ]);

    mockHistoryGetVisits
      .mockResolvedValueOnce([makeVisit(START_TIME + 1000)]) // 1 visit for low-traffic
      .mockResolvedValueOnce([                                // 3 visits for high-traffic
        makeVisit(START_TIME + 1000),
        makeVisit(START_TIME + 2000),
        makeVisit(START_TIME + 3000),
      ]);

    const result = await aggregateHistory(START_TIME);

    expect(result[0].visitCount).toBeGreaterThan(result[1].visitCount);
    expect(result[0].domain).toBe('high-traffic.com');
  });

  it('excludes items with no visits within the window', async () => {
    mockHistorySearch.mockResolvedValue([makeHistoryItem('https://old-site.com')]);
    // All visits are BEFORE startTime
    mockHistoryGetVisits.mockResolvedValue([makeVisit(START_TIME - 1000)]);

    const result = await aggregateHistory(START_TIME);

    expect(result).toHaveLength(0);
  });
});

describe('hasMinimumHistoryDays (DETECT-10)', () => {
  it('returns false when chrome.history.search returns empty array', async () => {
    mockHistorySearch.mockResolvedValue([]);

    const result = await hasMinimumHistoryDays(7);

    expect(result).toBe(false);
  });

  it('returns true when chrome.history.search returns at least 1 item', async () => {
    mockHistorySearch.mockResolvedValue([makeHistoryItem('https://example.com')]);

    const result = await hasMinimumHistoryDays(7);

    expect(result).toBe(true);
  });

  it('calls chrome.history.search with maxResults: 1', async () => {
    mockHistorySearch.mockResolvedValue([]);

    await hasMinimumHistoryDays(7);

    expect(mockHistorySearch).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 1 })
    );
  });
});
