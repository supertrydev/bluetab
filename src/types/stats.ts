/**
 * @module types/stats
 *
 * WHY:  The statistics pipeline needs shared type definitions consumed by
 *       StatsService, the dashboard UI (Plan 03), and eventually Bluetab
 *       Wrapped (Phase 7). Centralising types prevents divergence between
 *       the data layer and the presentation layer.
 *
 * WHAT: DailyStats — one entry per calendar day recording tab lifecycle events
 *       and domain activation counts. StatsState — top-level storage envelope
 *       holding the rolling 365-day array plus user preferences.
 *
 * HOW:  Imported by StatsService for storage reads/writes and by dashboard
 *       components for display. No runtime logic — types only.
 *
 * NOT:  Does not import from models.ts (avoids circular dependency).
 *       Does not carry UI state — purely data/persistence types.
 */

export interface DailyStats {
  date: string;                        // ISO date string: "2026-03-16"
  tabsCreated: number;
  tabsRemoved: number;
  tabsActivated: number;
  domainCounts: Record<string, number>; // domain -> activation count
  groupsSaved: number;                  // incremented via storage change listener
  /** Hourly tab activity (created+activated) — 24 slots, index 0 = 00:00. Optional for backwards compat. */
  hourlyCounts?: number[];
  /** Accumulated focus mode minutes for this day. Optional for backwards compat. */
  focusMinutes?: number;
}

export interface StatsState {
  daily: DailyStats[];       // 365-entry rolling window (oldest evicted first)
  optOut: boolean;           // browser tracking opt-out flag
  baselineComputed: boolean; // guard against re-running retroactive baseline
}
