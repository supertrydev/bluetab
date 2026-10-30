/**
 * @module types/wrapped
 *
 * WHY:  Bluetab Wrapped (Phase 7) needs a shared type layer consumed by
 *       WrappedService, the story UI, the image card generator, and the
 *       statistics page history section. Centralising types prevents
 *       divergence between the data layer and presentation layer.
 *
 * WHAT: WrappedSnapshot — pre-aggregated yearly summary persisted in storage.
 *       PersonalityTitle — the assigned personality result for a user.
 *       TitleDefinition — static catalogue entry with trigger function for
 *       highest-margin assignment algorithm.
 *
 * HOW:  Imported by WrappedService for snapshot creation/storage, and by
 *       Wrapped story components for display. No runtime logic — types only.
 *
 * NOT:  Does not import from models.ts (avoids circular dependency).
 *       Does not carry UI state — purely data/persistence types.
 */

/** Derived metrics computed at snapshot generation time from raw daily stats. */
export interface DerivedMetrics {
  /** Average open tabs across tracked days (tabsCreated / trackedDays). */
  avgOpenTabs: number;
  /** Maximum number of tabs saved to a single group. */
  maxTabsInGroup: number;
  /** Percentage of activity between 11 PM and 4 AM (0-100). */
  nightOwlPercent: number;
  /** Number of days with first activity before 6 AM. */
  earlyRiserDays: number;
  /** Percentage of total tab volume on weekends (0-100). */
  weekendVolumePercent: number;
  /** Average tab lifespan in seconds (tabsRemoved events / total days). */
  avgTabLifespanSeconds: number;
  /** Maximum tabs created in a single day. */
  maxTabsInSession: number;
  /** Hours spent on the top single domain across the year. */
  singleDomainFocusHours: number;
  /** Number of large bulk close actions (50+ tabs at once). */
  bulkCloseActions: number;
  /** Number of days ending with zero tabs (tabsRemoved >= tabsCreated). */
  zeroDayEndings: number;
  /** Maximum Pomodoro sessions in a single day. */
  dailyPomodoroMax: number;
  /** Average daily activations of known social media platforms. */
  socialPlatformsDaily: number;
  /** Percentage of total activations going to the top single domain (0-100). */
  singleDomainPercent: number;
  /** Number of tab groups shared with other users via Bluet. */
  groupsShared: number;
  /** Maximum number of times the same URL was open simultaneously. */
  duplicateUrlMax: number;
  /** Average tab group switches per hour across tracked days. */
  groupSwitchesHourly: number;
}

/** Personality title assigned to a user based on their highest-margin trigger. */
export interface PersonalityTitle {
  /** Kebab-case identifier matching a TitleDefinition id. */
  id: string;
  /** Display title string (e.g. "Tab Hoarder Supreme"). */
  title: string;
  /** One-line description shown on the story slide and share card. */
  description: string;
  /** Category group (e.g. "Collectors and Chaos Agents"). */
  category: string;
  /** How far above the trigger threshold this user scored (margin = actual/threshold - 1). */
  triggerMargin: number;
}

/** Static catalogue entry defining one personality title and its trigger function. */
export interface TitleDefinition {
  /** Kebab-case unique identifier. */
  id: string;
  /** Display title string. */
  title: string;
  /** One-line description. */
  description: string;
  /** Category group label. */
  category: string;
  /**
   * Trigger function that computes the margin above the threshold.
   *
   * Returns margin = (actual / threshold) - 1 when the condition is met.
   * Returns null when the condition is not met or data is insufficient.
   */
  trigger: (metrics: DerivedMetrics, snapshot: Omit<WrappedSnapshot, 'personalityTitle'>) => number | null;
}

/** Pre-aggregated yearly Bluetab Wrapped snapshot stored per year (bounded to 5 years). */
export interface WrappedSnapshot {
  /** Calendar year this snapshot covers (e.g. 2026). */
  year: number;
  /** Epoch ms when this snapshot was generated. */
  generatedAt: number;
  /** Date window the underlying data covers (Jan 1 to Nov 20 of the given year). */
  dataWindow: {
    from: string; // ISO date "YYYY-MM-DD"
    to: string;   // ISO date "YYYY-MM-DD"
  };
  /** Total tabs saved to groups across the year. */
  totalTabsSaved: number;
  /** Total groups created/saved across the year. */
  totalGroupsCreated: number;
  /** Top 5 domains by activation count. Title is looked up from stored tab groups when available. */
  topDomains: Array<{ domain: string; title?: string; visits: number }>;
  /** Total Pomodoro work sessions completed. */
  pomodoroSessionsCompleted: number;
  /** Total focus mode hours active. */
  focusHoursTotal: number;
  /** Total reminders set across the year. */
  remindersSet: number;
  /** Longest consecutive day streak with tab activity. */
  streakDays: number;
  /** ISO date string of the single most productive day (most tabs created). */
  mostProductiveDay: string;
  /** Storage used at snapshot generation time in bytes. */
  storageUsedBytes: number;
  /** Assigned personality title, or null if no trigger threshold was exceeded. */
  personalityTitle: PersonalityTitle | null;
  /** Derived metrics used for personality title assignment. */
  derivedMetrics: DerivedMetrics;
}
