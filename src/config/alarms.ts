/**
 * @module config/alarms
 *
 * WHY:  Alarm names are string literals scattered across files.
 *       Collision between Phase 2+ alarms (Pomodoro, Reminders, RSS, Backups)
 *       and existing alarms would cause handlers to fire for the wrong purpose.
 *       A typo in any alarm string is a silent bug — the alarm registers but
 *       no handler ever matches it.
 *
 * WHAT: Single source of truth for all chrome.alarms names used across the extension.
 *       AlarmName type provides compile-time exhaustiveness checking on switch statements.
 *
 * HOW:  Constants exported and imported wherever chrome.alarms.create is called.
 *       String values are IDENTICAL to the original hardcoded literals — backward compatible.
 *
 * NOT:  Does not manage alarm lifecycle — see service-worker.ts for registration.
 *       Does not validate that alarms are actually registered — purely a name registry.
 */

export const ALARM_NAMES = {
  // Phase 1 — existing alarms (migrated from local constants in service-worker.ts + sync-realtime.ts)
  AUTH_REFRESH: 'bluetab-auth-refresh',
  SUBSCRIPTION_CHECK: 'bluetab-subscription-check',
  BLUET_BRIDGE_HEARTBEAT: 'bluet-bridge-heartbeat',
  SYNC_POLL: 'bluetab-sync-poll',

  // Phase 2 — reserved (not yet implemented)
  POMODORO_END: 'bluetab-pomodoro-end',
  POMODORO_TICK: 'bluetab-pomodoro-tick',   // repeating 1min alarm for badge updates
  REMINDER_PREFIX: 'bluetab-reminder-',     // + timestamp suffix per reminder
  SESSION_BACKUP: 'bluetab-session-backup',

  // Phase 3 — reserved
  STATS_PRUNE: 'bluetab-stats-prune',

  // Phase 4 — reserved
  RSS_REFRESH: 'bluetab-rss-refresh',

  // Phase 7 -- reserved
  WRAPPED_SEASONAL_CHECK: 'bluetab-wrapped-seasonal',

  // Phase 9 — ADHD Mode (Safe Auto-Suspend periodic scan; handler wired in 09-02)
  ADHD_AUTOSUSPEND_SCAN: 'bluetab-adhd-autosuspend-scan',

  // Phase 11 — AI kill-switch periodic refresh (4h; handler wired in 11-02)
  // See: src/services/kill-switch-service.ts
  V3_KILL_SWITCH_REFRESH: 'v3-kill-switch-refresh',

  // Phase 9 — Brain Dump badge fallback clear. Suffix with tabId.
  BRAIN_DUMP_BADGE_CLEAR_PREFIX: 'bluetab-brain-dump-badge-clear-',

  // Opt-in auto-archive of groups inactive for 7 days (hourly scan; no-op when off).
  // See: src/services/auto-archive-service.ts
  GROUP_AUTO_ARCHIVE_SCAN: 'bluetab-group-auto-archive-scan',
} as const;

export type AlarmName = typeof ALARM_NAMES[keyof typeof ALARM_NAMES];

/**
 * V3_KILL_SWITCH_REFRESH alarm name constant — re-exported as a named export
 * for direct import in the service worker without importing the full ALARM_NAMES object.
 * Value: 'v3-kill-switch-refresh'
 *
 * INFRA-07 registry entry for Phase 11 AI kill-switch 4-hour periodic refresh.
 */
export const V3_KILL_SWITCH_REFRESH = ALARM_NAMES.V3_KILL_SWITCH_REFRESH;
