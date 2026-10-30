/**
 * @module services/wrapped-service
 *
 * WHY:  Bluetab Wrapped delivers a Spotify-style year-end stats story to users.
 *       The data layer must be solid before any UI can be built. TDD ensures
 *       correctness of date logic (year-boundary edge cases), personality
 *       assignment (highest-margin algorithm), and storage bounds (5-year cap).
 *
 * WHAT: Static WrappedService class providing:
 *       - Seasonal window detection (Nov 25 – Jan 7)
 *       - Wrapped year resolution (Jan = previous year, Nov/Dec = current year)
 *       - Snapshot generation by aggregating Phase 3 stats_state data
 *       - Personality title assignment via highest-margin algorithm (19 titles)
 *       - Bounded snapshot storage via RingBuffer(5) with same-year upsert
 *
 * HOW:  - isSeasonalWindowOpen checks month/day against Nov 25 – Jan 7 range
 *       - getWrappedYear returns current year in Nov/Dec, previous year in Jan
 *       - generateSnapshot reads 'stats_state' key (Phase 3 StatsService format)
 *         and computes derived metrics in one isolated function for easy adaptation
 *       - assignPersonalityTitle iterates TITLE_DEFINITIONS, picks highest margin
 *       - saveSnapshot filters same year, pushes via RingBuffer(5), writes back
 *
 * NOT:  Does not render UI — consumed by story components and statistics page.
 *       Does not manage alarms — WRAPPED_SEASONAL_CHECK registration is in
 *       service-worker.ts when seasonal checks are wired up.
 *       Does not import from StatsService directly — reads raw storage keys to
 *       avoid circular dependencies and remain adapter-ready for Phase 3 changes.
 */

import { Storage } from '@/utils/storage';
import { RingBuffer } from '@/utils/ring-buffer';
import { parseLocalDateKey } from '@/utils/local-date';
import { getLocaleWeekInfo } from '@/i18n/format';
import type {
  WrappedSnapshot,
  PersonalityTitle,
  TitleDefinition,
  DerivedMetrics,
} from '@/types/wrapped';
import type { StatsState, DailyStats } from '@/types/stats';

const LOG_PREFIX = '[BlueTab][WrappedService]';
const SNAPSHOTS_KEY = 'wrapped_snapshots';
const STATS_KEY = 'stats_state';
const SNAPSHOT_MAX = 5;
const MIN_TRACKED_DAYS = 7;
const TOP_DOMAINS_LIMIT = 5;

const snapshotBuffer = new RingBuffer<WrappedSnapshot>(SNAPSHOT_MAX);

// ---------------------------------------------------------------------------
// Personality title catalogue (19 titles, organised by category)
// ---------------------------------------------------------------------------
// Trigger function convention:
//   margin = (actual / threshold) - 1
//   Returns null when the condition is not met.
// ---------------------------------------------------------------------------

const TITLE_DEFINITIONS: TitleDefinition[] = [
  // ---- Collectors and Chaos Agents ----------------------------------------

  {
    id: 'tab-hoarder-supreme',
    title: 'Tab Hoarder Supreme',
    description: 'Your RAM is screaming, but your heart is full.',
    category: 'Collectors and Chaos Agents',
    trigger: (m) => {
      const threshold = 100;
      if (m.avgOpenTabs < threshold) return null;
      return m.avgOpenTabs / threshold - 1;
    },
  },
  {
    id: 'the-collector',
    title: 'The Collector',
    description: "You aren't finished with these. You'll never be finished.",
    category: 'Collectors and Chaos Agents',
    trigger: (m) => {
      const threshold = 50;
      if (m.maxTabsInGroup < threshold) return null;
      return m.maxTabsInGroup / threshold - 1;
    },
  },
  {
    id: 'chaos-architect',
    title: 'Chaos Architect',
    description: "Organization is a suggestion you've chosen to ignore.",
    category: 'Collectors and Chaos Agents',
    // groupSwitchesHourly >= 10 across 5+ windows is approximated via groupSwitchesHourly
    trigger: (m) => {
      const threshold = 10;
      if (m.groupSwitchesHourly < threshold) return null;
      return m.groupSwitchesHourly / threshold - 1;
    },
  },
  {
    id: 'digital-archaeologist',
    title: 'Digital Archaeologist',
    description: 'You treat your browser history like an excavation site.',
    category: 'Collectors and Chaos Agents',
    // avgTabLifespanSeconds >= 30 days * 86400 sec = 2592000 sec (dormant tab reopener)
    // We use a derived proxy: avgTabLifespanSeconds > 2592000 (30 days in seconds)
    trigger: (m) => {
      const threshold = 2592000; // 30 days in seconds
      if (m.avgTabLifespanSeconds < threshold) return null;
      return m.avgTabLifespanSeconds / threshold - 1;
    },
  },
  {
    id: 'the-window-shopper',
    title: 'The Window Shopper',
    description: "You're just looking, thanks.",
    category: 'Collectors and Chaos Agents',
    // avgTabLifespanSeconds <= 60 and maxTabsInSession >= 200
    trigger: (m) => {
      if (m.maxTabsInSession < 200 || m.avgTabLifespanSeconds > 60) return null;
      // Margin: how far below 60 seconds (lower lifespan = higher margin)
      return 60 / Math.max(m.avgTabLifespanSeconds, 1) - 1;
    },
  },

  // ---- Productivity Purists -----------------------------------------------

  {
    id: 'focus-samurai',
    title: 'Focus Samurai',
    description: "Distractions don't stand a chance against your blade.",
    category: 'Productivity Purists',
    trigger: (m) => {
      const threshold = 10;
      if (m.dailyPomodoroMax < threshold) return null;
      return m.dailyPomodoroMax / threshold - 1;
    },
  },
  {
    id: 'deep-diver',
    title: 'Deep Diver',
    description: 'You found the rabbit hole and moved in.',
    category: 'Productivity Purists',
    trigger: (m) => {
      const threshold = 4; // 4+ hours on a single domain
      if (m.singleDomainFocusHours < threshold) return null;
      return m.singleDomainFocusHours / threshold - 1;
    },
  },
  {
    id: 'the-executor',
    title: 'The Executor',
    description: 'The digital equivalent of a power wash.',
    category: 'Productivity Purists',
    trigger: (m) => {
      const threshold = 50; // 50+ tabs in a single bulk close
      if (m.bulkCloseActions < 1 || m.maxTabsInSession < threshold) return null;
      return m.maxTabsInSession / threshold - 1;
    },
  },
  {
    id: 'zero-tab-zen',
    title: 'Zero-Tab Zen',
    description: 'Your mind is a blank slate. Your browser is a temple.',
    category: 'Productivity Purists',
    // zeroDayEndings >= 20 consecutive zero-ending days
    trigger: (m) => {
      const threshold = 20;
      if (m.zeroDayEndings < threshold) return null;
      return m.zeroDayEndings / threshold - 1;
    },
  },
  {
    id: 'context-king',
    title: 'Context King',
    description: 'You juggle workflows like a pro.',
    category: 'Productivity Purists',
    trigger: (m) => {
      const threshold = 10; // 10+ distinct tab group switches per hour
      if (m.groupSwitchesHourly < threshold) return null;
      return m.groupSwitchesHourly / threshold - 1;
    },
  },

  // ---- Time Lords ---------------------------------------------------------

  {
    id: 'night-owl',
    title: 'Night Owl',
    description: 'The sun is your enemy. The blue light is your god.',
    category: 'Time Lords',
    trigger: (m) => {
      const threshold = 70; // 70% of activity between 11 PM and 4 AM
      if (m.nightOwlPercent < threshold) return null;
      return m.nightOwlPercent / threshold - 1;
    },
  },
  {
    id: 'early-riser',
    title: 'Early Riser',
    description: "You're caffeinated and clicking while the world sleeps.",
    category: 'Time Lords',
    trigger: (m) => {
      const threshold = 20; // first tab before 6 AM for 20+ consecutive days
      if (m.earlyRiserDays < threshold) return null;
      return m.earlyRiserDays / threshold - 1;
    },
  },
  {
    id: 'weekend-warrior',
    title: 'Weekend Warrior',
    description: "You don't browse for work. You browse for glory.",
    category: 'Time Lords',
    trigger: (m) => {
      const threshold = 80; // 80% of tab volume on weekends
      if (m.weekendVolumePercent < threshold) return null;
      return m.weekendVolumePercent / threshold - 1;
    },
  },
  {
    id: 'the-speedster',
    title: 'The Speedster',
    description: 'You get in, get the data, and get out.',
    category: 'Time Lords',
    // avgTabLifespanSeconds <= 30 seconds
    trigger: (m) => {
      if (m.avgTabLifespanSeconds > 30 || m.avgTabLifespanSeconds <= 0) return null;
      return 30 / m.avgTabLifespanSeconds - 1;
    },
  },
  {
    id: 'marathoner',
    title: 'Marathoner',
    description: 'That one YouTube essay really gripped you.',
    category: 'Time Lords',
    // singleDomainFocusHours >= 12 hours
    trigger: (m) => {
      const threshold = 12;
      if (m.singleDomainFocusHours < threshold) return null;
      return m.singleDomainFocusHours / threshold - 1;
    },
  },

  // ---- Social and Niche ---------------------------------------------------

  {
    id: 'the-trendsetter',
    title: 'The Trendsetter',
    description: 'You are the pulse of the internet.',
    category: 'Social and Niche',
    trigger: (m) => {
      const threshold = 10; // 10+ social platforms daily
      if (m.socialPlatformsDaily < threshold) return null;
      return m.socialPlatformsDaily / threshold - 1;
    },
  },
  {
    id: 'the-specialist',
    title: 'The Specialist',
    description: "You know what you like, and you ignore the rest.",
    category: 'Social and Niche',
    trigger: (m) => {
      const threshold = 90; // 90% on a single domain
      if (m.singleDomainPercent < threshold) return null;
      return m.singleDomainPercent / threshold - 1;
    },
  },
  {
    id: 'the-curator',
    title: 'The Curator',
    description: "Knowledge is meant to be shared, and you're the librarian.",
    category: 'Social and Niche',
    trigger: (m) => {
      const threshold = 20; // 20+ groups shared
      if (m.groupsShared < threshold) return null;
      return m.groupsShared / threshold - 1;
    },
  },
  {
    id: 'duplicate-detective',
    title: 'Duplicate Detective',
    description: 'You like to be sure. Very, very sure.',
    category: 'Social and Niche',
    trigger: (m) => {
      const threshold = 3; // same URL in 3+ tabs simultaneously
      if (m.duplicateUrlMax < threshold) return null;
      return m.duplicateUrlMax / threshold - 1;
    },
  },
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute longest consecutive day streak from a sorted array of ISO date strings.
 */
function computeStreakDays(sortedDates: string[]): number {
  if (sortedDates.length === 0) return 0;
  let max = 1;
  let current = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1]);
    const curr = new Date(sortedDates[i]);
    const diffMs = curr.getTime() - prev.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays === 1) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 1;
    }
  }
  return max;
}

/**
 * Derive personality-title metrics from raw DailyStats array.
 * All metrics that require data the Phase 3 pipeline doesn't yet track
 * are approximated conservatively (defaulting to 0 / safe values).
 */
function deriveMetrics(days: DailyStats[]): DerivedMetrics {
  if (days.length === 0) {
    return {
      avgOpenTabs: 0,
      maxTabsInGroup: 0,
      nightOwlPercent: 0,
      earlyRiserDays: 0,
      weekendVolumePercent: 0,
      avgTabLifespanSeconds: 0,
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
    };
  }

  const totalCreated = days.reduce((s, d) => s + d.tabsCreated, 0);
  const totalRemoved = days.reduce((s, d) => s + d.tabsRemoved, 0);
  const n = days.length;

  // avgOpenTabs: average tabs created per day
  const avgOpenTabs = totalCreated / n;

  // maxTabsInSession: max tabsCreated in a single day
  const maxTabsInSession = Math.max(...days.map((d) => d.tabsCreated), 0);

  // avgTabLifespanSeconds: ratio of removed to created * 86400 seconds per day
  // If removal rate is high and session is short, lifespan is short
  const avgTabLifespanSeconds =
    totalCreated > 0 ? (totalRemoved / totalCreated) * 86400 : 0;

  // Weekend volume: tabs created on the locale's weekend days (Sat/Sun in
  // most regions, Fri/Sat in many others). Keys are local days, so parse
  // them as local midnight; new Date('YYYY-MM-DD') would be UTC midnight.
  const weekendDays = new Set(getLocaleWeekInfo().weekend);
  let weekendTabs = 0;
  for (const d of days) {
    const dow = parseLocalDateKey(d.date).getDay();
    if (weekendDays.has(dow)) weekendTabs += d.tabsCreated;
  }
  const weekendVolumePercent = totalCreated > 0 ? (weekendTabs / totalCreated) * 100 : 0;

  // Top domain stats
  const domainTotals: Record<string, number> = {};
  for (const d of days) {
    for (const [domain, count] of Object.entries(d.domainCounts)) {
      domainTotals[domain] = (domainTotals[domain] ?? 0) + count;
    }
  }
  const totalDomainActivations = Object.values(domainTotals).reduce((s, c) => s + c, 0);
  const topDomainCount = Object.values(domainTotals).sort((a, b) => b - a)[0] ?? 0;
  const singleDomainPercent =
    totalDomainActivations > 0 ? (topDomainCount / totalDomainActivations) * 100 : 0;

  // singleDomainFocusHours: approximate from top domain activation count
  // 1 activation ~= 3 minutes of focus time (rough heuristic)
  const singleDomainFocusHours = (topDomainCount * 3) / 60;

  // zeroDayEndings: days where tabsRemoved >= tabsCreated (ended with ≈0 tabs)
  const zeroDayEndings = days.filter((d) => d.tabsRemoved >= d.tabsCreated && d.tabsCreated > 0).length;

  // Metrics not available in Phase 3 pipeline yet — default to 0
  // These will be populated when Phase 3 adds richer event tracking.
  const nightOwlPercent = 0;
  const earlyRiserDays = 0;
  const maxTabsInGroup = 0;
  const bulkCloseActions = 0;
  const dailyPomodoroMax = 0;
  const socialPlatformsDaily = 0;
  const groupsShared = 0;
  const duplicateUrlMax = 0;
  const groupSwitchesHourly = 0;

  return {
    avgOpenTabs,
    maxTabsInGroup,
    nightOwlPercent,
    earlyRiserDays,
    weekendVolumePercent,
    avgTabLifespanSeconds,
    maxTabsInSession,
    singleDomainFocusHours,
    bulkCloseActions,
    zeroDayEndings,
    dailyPomodoroMax,
    socialPlatformsDaily,
    singleDomainPercent,
    groupsShared,
    duplicateUrlMax,
    groupSwitchesHourly,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class WrappedService {
  /**
   * Return true if the given date falls within the seasonal Wrapped window:
   * November 25 through January 7 (inclusive, spanning the year boundary).
   *
   * @param now - Date to check (defaults to current date if omitted)
   */
  static isSeasonalWindowOpen(now?: Date): boolean {
    // Debug override: localStorage.setItem('bluetab_wrapped_debug', 'true') to test seasonal features
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('bluetab_wrapped_debug') === 'true') return true;
    } catch { /* ignore in contexts where localStorage is unavailable */ }

    const d = now ?? new Date();
    const month = d.getMonth() + 1; // 1-based
    const day = d.getDate();

    // November 25 through November 30
    if (month === 11 && day >= 25) return true;
    // All of December
    if (month === 12) return true;
    // January 1 through January 7
    if (month === 1 && day <= 7) return true;

    return false;
  }

  /**
   * Return the Wrapped year for the given date.
   * - January (early Jan still within the seasonal window): previous year
   * - November / December: current year
   *
   * @param now - Date to evaluate (defaults to current date if omitted)
   */
  static getWrappedYear(now?: Date): number {
    const d = now ?? new Date();
    const month = d.getMonth() + 1; // 1-based
    const fullYear = d.getFullYear();

    // January = last year's Wrapped
    if (month === 1) return fullYear - 1;
    return fullYear;
  }

  /**
   * Assign a personality title to the given snapshot using the highest-margin algorithm.
   *
   * Iterates all TITLE_DEFINITIONS, computes each trigger margin, and returns
   * the title with the highest positive margin. Returns null if no trigger threshold
   * is exceeded.
   *
   * @param snapshot - WrappedSnapshot (personalityTitle field may be null)
   */
  static assignPersonalityTitle(
    snapshot: Omit<WrappedSnapshot, 'personalityTitle'> & { personalityTitle?: PersonalityTitle | null },
  ): PersonalityTitle | null {
    let bestTitle: TitleDefinition | null = null;
    let bestMargin = -Infinity;

    for (const def of TITLE_DEFINITIONS) {
      const margin = def.trigger(snapshot.derivedMetrics, snapshot as Omit<WrappedSnapshot, 'personalityTitle'>);
      if (margin !== null && margin > bestMargin) {
        bestMargin = margin;
        bestTitle = def;
      }
    }

    if (!bestTitle || bestMargin <= 0) return null;

    return {
      id: bestTitle.id,
      title: bestTitle.title,
      description: bestTitle.description,
      category: bestTitle.category,
      triggerMargin: bestMargin,
    };
  }

  /**
   * Generate a WrappedSnapshot for the given year by reading raw stats from storage.
   *
   * Reads 'stats_state' key (Phase 3 StatsService format). Returns null if:
   * - Key is missing or empty
   * - Fewer than 7 days of tracked activity exist for the given year
   *
   * The data reading is intentionally isolated to the first few lines of this method
   * so it can be easily adapted when Phase 3 adds richer aggregates.
   *
   * @param year - Calendar year to generate the snapshot for
   */
  static async generateSnapshot(year: number): Promise<WrappedSnapshot | null> {
    try {
      const state = await Storage.get<StatsState>(STATS_KEY);
      if (!state || !state.daily || state.daily.length === 0) {
        console.log(`${LOG_PREFIX} generateSnapshot: no stats data found for year ${year}`);
        return null;
      }

      // Filter to only entries within the given year (Jan 1 – Nov 20)
      const yearPrefix = String(year);
      const cutoffTo = `${year}-11-20`;
      const yearDays = state.daily.filter(
        (d) => d.date.startsWith(yearPrefix) && d.date <= cutoffTo,
      );

      if (yearDays.length < MIN_TRACKED_DAYS) {
        console.log(
          `${LOG_PREFIX} generateSnapshot: insufficient data (${yearDays.length} days < ${MIN_TRACKED_DAYS}) for year ${year}`,
        );
        return null;
      }

      // Sort entries for streak calculation
      const sorted = [...yearDays].sort((a, b) => a.date.localeCompare(b.date));

      // Aggregate totals
      const totalTabsSaved = sorted.reduce((s, d) => s + d.tabsCreated, 0);
      const totalGroupsCreated = sorted.reduce((s, d) => s + d.groupsSaved, 0);

      // Top 5 domains by activation count
      const domainMap: Record<string, number> = {};
      for (const d of sorted) {
        for (const [domain, count] of Object.entries(d.domainCounts)) {
          domainMap[domain] = (domainMap[domain] ?? 0) + count;
        }
      }
      const topDomains = Object.entries(domainMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_DOMAINS_LIMIT)
        .map(([domain, visits]): { domain: string; title?: string; visits: number } => ({ domain, visits }));

      // Enrich top domains with titles from stored tab groups
      try {
        const storedGroups = (await Storage.get<Array<{ tabs: Array<{ url: string; title: string }> }>>('groups')) || [];
        const allTabs = storedGroups.flatMap(g => g.tabs);
        for (const td of topDomains) {
          const cleanDomain = td.domain.replace(/^www\./, '');
          const match = allTabs.find(tab => {
            try {
              const hostname = new URL(tab.url).hostname.replace(/^www\./, '');
              return hostname === cleanDomain;
            } catch { return false; }
          });
          if (match?.title) {
            // Extract site name: "Page - SiteName" → "SiteName"
            const parts = match.title.split(/\s[-|–]\s/);
            td.title = parts.length > 1 ? parts[parts.length - 1].trim() : match.title.trim();
            // Truncate long titles
            if (td.title.length > 30) td.title = td.title.slice(0, 27) + '...';
          }
        }
      } catch {
        console.warn(`${LOG_PREFIX} generateSnapshot: title lookup failed (non-critical)`);
      }

      // Most productive day (highest tabsCreated)
      const mostProductiveDayEntry = sorted.reduce(
        (best, d) => (d.tabsCreated > best.tabsCreated ? d : best),
        sorted[0],
      );

      // Streak days
      const streakDays = computeStreakDays(sorted.map((d) => d.date));

      // Derived metrics for personality title assignment
      const derivedMetrics = deriveMetrics(sorted);

      // Assemble snapshot (without personalityTitle for now to pass to assignPersonalityTitle)
      const partialSnapshot: Omit<WrappedSnapshot, 'personalityTitle'> = {
        year,
        generatedAt: Date.now(),
        dataWindow: {
          from: `${year}-01-01`,
          to: cutoffTo,
        },
        totalTabsSaved,
        totalGroupsCreated,
        topDomains,
        pomodoroSessionsCompleted: 0, // Phase 3 pomodoro stats not yet in stats_state
        focusHoursTotal: 0,           // Phase 6 focus hours not yet aggregated in stats_state
        remindersSet: 0,              // Phase 2 reminder count not yet in stats_state
        streakDays,
        mostProductiveDay: mostProductiveDayEntry.date,
        storageUsedBytes: 0,          // Storage.getBytesInUse not yet wired here
        derivedMetrics,
      };

      const personalityTitle = WrappedService.assignPersonalityTitle(partialSnapshot);

      return {
        ...partialSnapshot,
        personalityTitle,
      };
    } catch (err) {
      console.warn(`${LOG_PREFIX} generateSnapshot failed:`, err);
      return null;
    }
  }

  /**
   * Persist a snapshot to storage using RingBuffer(5) eviction.
   *
   * Same-year snapshots are replaced (upsert) before pushing, so the buffer
   * never contains duplicate years. When the buffer is at capacity and a new
   * year is added, the oldest year is evicted.
   *
   * @param snapshot - WrappedSnapshot to save
   */
  static async saveSnapshot(snapshot: WrappedSnapshot): Promise<void> {
    const existing = (await Storage.get<WrappedSnapshot[]>(SNAPSHOTS_KEY)) ?? [];
    // Upsert: filter out any existing entry for the same year
    const filtered = existing.filter((s) => s.year !== snapshot.year);
    // Push through RingBuffer(5) — evicts oldest if at capacity
    const next = snapshotBuffer.push(filtered, snapshot);
    await Storage.set(SNAPSHOTS_KEY, next);
    console.log(`${LOG_PREFIX} saveSnapshot: stored ${next.length} snapshots (year ${snapshot.year})`);
  }

  /**
   * Retrieve a stored snapshot for the given year, or null if not found.
   *
   * @param year - Calendar year to retrieve
   */
  static async getSnapshot(year: number): Promise<WrappedSnapshot | null> {
    const snapshots = (await Storage.get<WrappedSnapshot[]>(SNAPSHOTS_KEY)) ?? [];
    return snapshots.find((s) => s.year === year) ?? null;
  }

  /**
   * Retrieve all stored Wrapped snapshots, sorted by year descending (newest first).
   */
  static async getAllSnapshots(): Promise<WrappedSnapshot[]> {
    const snapshots = (await Storage.get<WrappedSnapshot[]>(SNAPSHOTS_KEY)) ?? [];
    return [...snapshots].sort((a, b) => b.year - a.year);
  }
}
