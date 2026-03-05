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
  REMINDER_PREFIX: 'bluetab-reminder-',     // + timestamp suffix per reminder
  SESSION_BACKUP: 'bluetab-session-backup',

  // Phase 4 — reserved
  RSS_REFRESH: 'bluetab-rss-refresh',
} as const;

export type AlarmName = typeof ALARM_NAMES[keyof typeof ALARM_NAMES];
