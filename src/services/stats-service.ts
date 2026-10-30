/**
 * @module services/stats-service
 *
 * WHY:  The statistics dashboard (Plan 03) and Bluetab Wrapped (Phase 7)
 *       need historical tab activity data. Without a recording layer that
 *       captures tab lifecycle events as they happen, there is nothing
 *       to display. Daily aggregates are far more compact than per-event
 *       logs and fit comfortably within the 512KB storage budget.
 *
 * WHAT: Static StatsService class that:
 *       - Records tab create/remove/activate events as daily aggregates
 *       - Extracts hostnames from URLs for domain activity tracking
 *       - Bounds the daily array to 365 entries via RingBuffer (FIFO eviction)
 *       - Queries daily stats filtered to a rolling window (e.g. last 7/30 days)
 *       - Aggregates totals and top domains across a date range
 *       - Computes a retroactive baseline from existing TabGroup data
 *       - Provides opt-out controls for privacy-conscious users
 *
 * HOW:  Single storage key 'stats_state' holds the full StatsState object.
 *       All writes are wrapped in try-catch — stats collection must never
 *       crash the MV3 service worker. RingBuffer(365) evicts the oldest
 *       daily entry when the array would exceed 365 items.
 *
 * NOT:  Does not render UI — consumed by dashboard components and service worker.
 *       Does not manage alarms — STATS_PRUNE alarm registration is in service-worker.ts.
 *       Does not fire notifications.
 */

import { Storage } from '@/utils/storage';
import { RingBuffer } from '@/utils/ring-buffer';
import { addLocalDays, toLocalDateKey } from '@/utils/local-date';
import type { DailyStats, StatsState } from '@/types/stats';
import type { TabGroup } from '@/types/models';

const LOG_PREFIX = '[BlueTab][StatsService]';
const STORAGE_KEY = 'stats_state';
const MAX_TOP_DOMAINS = 10;
const dailyBuffer = new RingBuffer<DailyStats>(365);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Today's day key (YYYY-MM-DD) in the user's local calendar. The dashboard
 * reads keys as local days; a UTC key filed late-evening / after-midnight
 * activity under the wrong day.
 */
function todayISO(): string {
  return toLocalDateKey(Date.now());
}

/**
 * Extract hostname from a URL string.
 * Returns null if parsing fails or the URL is a browser-internal URL.
 */
function extractHostname(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Load StatsState from storage, returning defaults when absent.
 */
async function loadState(): Promise<StatsState> {
  const stored = await Storage.get<StatsState>(STORAGE_KEY);
  return stored ?? { daily: [], optOut: false, baselineComputed: false };
}

/**
 * Find or create the DailyStats entry for the given ISO date.
 * Returns [entry, array] where entry is the mutable object inside the array.
 */
function getOrCreateEntry(daily: DailyStats[], date: string): [DailyStats, DailyStats[]] {
  const existing = daily.find((d) => d.date === date);
  if (existing) return [existing, daily];

  const entry: DailyStats = {
    date,
    tabsCreated: 0,
    tabsRemoved: 0,
    tabsActivated: 0,
    domainCounts: {},
    groupsSaved: 0,
  };
  // Push new entry through RingBuffer (handles 365-entry eviction automatically)
  const next = dailyBuffer.push(daily, entry);
  return [next[next.length - 1], next];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class StatsService {
  /**
   * Record a tab lifecycle event as a daily aggregate.
   *
   * - 'created': increments tabsCreated
   * - 'removed': increments tabsRemoved (URL not needed)
   * - 'activated': increments tabsActivated and domainCounts[hostname]
   *
   * Silently skips chrome:// and chrome-extension:// URLs.
   * Entire body wrapped in try-catch — never crashes the service worker.
   */
  static async recordTabEvent(
    type: 'created' | 'removed' | 'activated',
    url?: string,
  ): Promise<void> {
    try {
      // Skip browser-internal URLs early
      if (url && (url.startsWith('chrome://') || url.startsWith('chrome-extension://'))) {
        return;
      }

      const state = await loadState();
      if (state.optOut) return;

      const date = todayISO();
      const [entry, updatedDaily] = getOrCreateEntry(state.daily, date);

      // Ensure hourlyCounts array exists (backwards compat with old entries)
      if (!entry.hourlyCounts) {
        entry.hourlyCounts = new Array(24).fill(0);
      }
      const hour = new Date().getHours();

      if (type === 'created') {
        entry.tabsCreated += 1;
        entry.hourlyCounts[hour] += 1;
      } else if (type === 'removed') {
        entry.tabsRemoved += 1;
      } else if (type === 'activated') {
        entry.tabsActivated += 1;
        entry.hourlyCounts[hour] += 1;
        const hostname = extractHostname(url);
        if (hostname) {
          entry.domainCounts[hostname] = (entry.domainCounts[hostname] ?? 0) + 1;
        }
      }

      await Storage.set(STORAGE_KEY, { ...state, daily: updatedDaily });
    } catch (err) {
      console.warn(`${LOG_PREFIX} recordTabEvent failed silently:`, err);
    }
  }

  /**
   * Record that one or more groups were saved.
   * Increments today's groupsSaved counter by `count`.
   */
  static async recordGroupSaved(count: number): Promise<void> {
    try {
      const state = await loadState();
      if (state.optOut) return;

      const date = todayISO();
      const [entry, updatedDaily] = getOrCreateEntry(state.daily, date);
      entry.groupsSaved += count;

      await Storage.set(STORAGE_KEY, { ...state, daily: updatedDaily });
    } catch (err) {
      console.warn(`${LOG_PREFIX} recordGroupSaved failed silently:`, err);
    }
  }

  /**
   * Record accumulated focus mode minutes for today.
   * Increments today's focusMinutes counter by `minutes`.
   *
   * Phase 12 (ADHD-27): The `mode` parameter is accepted for call-site clarity but
   * currently flows into the same daily aggregate. Per 12-CONTEXT.md §decisions:
   * "primary stat metric is focus minutes (mode-agnostic; both Pomodoro and Flowtime
   * contribute directly)." Session-level mode breakdown lives in pomodoroHistory and
   * is read by the Stats dashboard directly in Plan 12-05.
   */
  static async recordFocusMinutes(minutes: number, mode?: 'pomodoro' | 'flowtime'): Promise<void> {
    try {
      const state = await loadState();
      if (state.optOut) return;

      const date = todayISO();
      const [entry, updatedDaily] = getOrCreateEntry(state.daily, date);
      entry.focusMinutes = (entry.focusMinutes ?? 0) + minutes;

      await Storage.set(STORAGE_KEY, { ...state, daily: updatedDaily });
      console.log(`${LOG_PREFIX} recordFocusMinutes: +${minutes} minutes (mode: ${mode ?? 'pomodoro'})`);
    } catch (err) {
      console.warn(`${LOG_PREFIX} recordFocusMinutes failed silently:`, err);
    }
  }

  /**
   * Return daily entries where date >= cutoff (today minus `days` local calendar days).
   * Keys are YYYY-MM-DD, so string comparison orders them correctly.
   */
  static async getDailyStats(days: number): Promise<DailyStats[]> {
    const state = await loadState();
    const cutoff = toLocalDateKey(addLocalDays(Date.now(), -days));
    return state.daily.filter((d) => d.date >= cutoff);
  }

  /**
   * Aggregate totals over the last `days` calendar days.
   *
   * Returns:
   * - totalCreated / totalRemoved / totalActivated: summed tab event counts
   * - totalGroupsSaved: summed group saves
   * - topDomains: top-10 domains by activation count, sorted descending
   */
  static async getAggregateStats(days: number): Promise<{
    totalCreated: number;
    totalRemoved: number;
    totalActivated: number;
    topDomains: { domain: string; count: number }[];
    totalGroupsSaved: number;
  }> {
    const entries = await StatsService.getDailyStats(days);

    let totalCreated = 0;
    let totalRemoved = 0;
    let totalActivated = 0;
    let totalGroupsSaved = 0;
    const domainMap: Record<string, number> = {};

    for (const entry of entries) {
      totalCreated += entry.tabsCreated;
      totalRemoved += entry.tabsRemoved;
      totalActivated += entry.tabsActivated;
      totalGroupsSaved += entry.groupsSaved;
      for (const [domain, count] of Object.entries(entry.domainCounts)) {
        domainMap[domain] = (domainMap[domain] ?? 0) + count;
      }
    }

    const topDomains = Object.entries(domainMap)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_TOP_DOMAINS);

    return { totalCreated, totalRemoved, totalActivated, topDomains, totalGroupsSaved };
  }

  /**
   * Compute a retroactive baseline from existing TabGroup data.
   *
   * Groups tabs by the group's creation date, builds DailyStats entries
   * with domain counts extracted from tab URLs, and merges them with any
   * existing daily array. Sets `baselineComputed = true` as a guard.
   *
   * Safe to call multiple times — subsequent calls are no-ops if
   * baselineComputed is already true (caller should check state.baselineComputed).
   */
  static async computeRetroactiveBaseline(groups: TabGroup[]): Promise<void> {
    try {
      const state = await loadState();

      // Build a map of date -> DailyStats from group data
      const baselineMap: Record<string, DailyStats> = {};

      for (const group of groups) {
        const date = toLocalDateKey(group.created);
        if (!baselineMap[date]) {
          baselineMap[date] = {
            date,
            tabsCreated: 0,
            tabsRemoved: 0,
            tabsActivated: 0,
            domainCounts: {},
            groupsSaved: 0,
          };
        }
        const entry = baselineMap[date];
        for (const tab of group.tabs) {
          const hostname = extractHostname(tab.url);
          if (hostname) {
            entry.domainCounts[hostname] = (entry.domainCounts[hostname] ?? 0) + 1;
          }
        }
      }

      // Merge baseline entries with existing daily array
      // Existing entries take priority (don't overwrite recorded data)
      const existingDates = new Set(state.daily.map((d) => d.date));
      const newEntries = Object.values(baselineMap)
        .filter((e) => !existingDates.has(e.date))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Append all new entries through the ring buffer
      let daily = state.daily;
      for (const entry of newEntries) {
        daily = dailyBuffer.push(daily, entry);
      }

      await Storage.set(STORAGE_KEY, {
        ...state,
        daily,
        baselineComputed: true,
      });

      console.log(
        `${LOG_PREFIX} Retroactive baseline computed: ${newEntries.length} new entries from ${groups.length} groups`,
      );
    } catch (err) {
      console.warn(`${LOG_PREFIX} computeRetroactiveBaseline failed:`, err);
    }
  }

  /**
   * Return whether the user has opted out of statistics collection.
   */
  static async isOptedOut(): Promise<boolean> {
    const state = await loadState();
    return state.optOut;
  }

  /**
   * Set the opt-out flag (true = stop collecting stats).
   */
  static async setOptOut(optOut: boolean): Promise<void> {
    const state = await loadState();
    await Storage.set(STORAGE_KEY, { ...state, optOut });
  }

  /**
   * Return the full StatsState with defaults applied.
   */
  static async getState(): Promise<StatsState> {
    return loadState();
  }
}
