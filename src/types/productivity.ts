/**
 * @module types/productivity
 *
 * WHY:  Phase 2 introduces three productivity features (Pomodoro, Reminders,
 *       Session Backup) that share common patterns: alarm-driven scheduling,
 *       chrome.storage persistence, and notification-based user interaction.
 *       Without a shared type system, each service would define its own
 *       incompatible shapes, leading to serialization bugs and integration
 *       friction when the UI consumes data from multiple services.
 *
 * WHAT: All TypeScript interfaces and constants for Phase 2 productivity features.
 *       Covers Pomodoro (state, sessions, presets, settings), Reminders, and
 *       Session Backup (snapshots, windows, tabs, tab groups, settings).
 *
 * HOW:  Pure type definitions + one const object (POMODORO_PRESETS).
 *       No runtime dependencies. Imported by services, UI components, and
 *       service-worker alarm handlers.
 *
 * NOT:  Does not contain runtime logic, storage access, or Chrome API calls.
 *       Does not define the alarm name registry (see config/alarms.ts).
 */

import type { TabGroup, Tag, Project } from '@/types/models';
import type { BrainDumpEntry } from '@/types/adhd';
import type { ArchiveStorage } from '@/types/archive';
import type { NotificationSound } from '@/types/rss';

// ---------------------------------------------------------------------------
// Pomodoro types
// ---------------------------------------------------------------------------

export interface PomodoroState {
  isActive: boolean;
  isPaused: boolean;
  sessionType: 'work' | 'shortBreak' | 'longBreak';
  endTime: number;           // absolute ms timestamp when session ends
  pausedRemaining: number;   // ms remaining when paused (0 if running)
  sessionsCompleted: number; // work sessions in current cycle (resets after long break)
  preset: 'classic' | 'short' | 'deepWork' | 'custom';
  /** Local date string (YYYY-MM-DD) of the last session; used to reset counter on new day */
  lastSessionDate?: string;
  /**
   * Phase 12 (ADHD-26): Timer mode governs mutual exclusion between Pomodoro and Flowtime.
   * Optional for backward compatibility — absent/undefined means 'pomodoro'.
   * When 'flowtime': no POMODORO_END alarm; count-up timer; startTime is the anchor.
   * When 'flowtime-break': countdown break started from Flowtime break card.
   *   Does NOT advance sessionsCompleted. Does NOT record in pomodoroHistory.
   *   On completion or manual stop: returns to idle (mode cleared, isActive=false).
   *   No auto-advance to work session.
   */
  mode?: 'pomodoro' | 'flowtime' | 'flowtime-break';
  /**
   * Phase 12 (ADHD-24): Epoch ms when the Flowtime session started.
   * Present only when mode === 'flowtime'. Used to compute elapsed work minutes
   * on stop (elapsed = floor((Date.now() - startTime) / 60000)).
   * Absent in Pomodoro mode; readers must guard with `state.mode === 'flowtime'`.
   */
  startTime?: number;
}

export interface PomodoroPreset {
  work: number;       // minutes
  shortBreak: number;
  longBreak: number;
}

export const POMODORO_PRESETS: Record<PomodoroState['preset'], PomodoroPreset> = {
  classic: { work: 25, shortBreak: 5, longBreak: 15 },
  short: { work: 15, shortBreak: 3, longBreak: 10 },
  deepWork: { work: 50, shortBreak: 10, longBreak: 20 },
  custom: { work: 25, shortBreak: 5, longBreak: 15 }, // defaults, overridden by user
};

export interface PomodoroSession {
  id: string;
  type: 'work' | 'shortBreak' | 'longBreak';
  duration: number;    // minutes
  startedAt: number;   // epoch ms
  completedAt: number; // epoch ms
  /**
   * Phase 12 (ADHD-27): Mode discriminator for the pomodoroHistory ring buffer.
   * Optional for backward compatibility — absent/undefined means 'pomodoro'.
   * Flowtime sessions set this to 'flowtime' so the Stats dashboard can label
   * and count each mode separately (see 12-CONTEXT.md §decisions Flowtime Timer).
   * Missing field at read time: treat as 'pomodoro' (no explicit migration needed).
   */
  mode?: 'pomodoro' | 'flowtime';
}

export interface PomodoroSettings {
  preset: PomodoroState['preset'];
  customWork: number;
  customShortBreak: number;
  customLongBreak: number;
  longBreakInterval: number; // default 4
  sounds?: {
    enabled: boolean;
    workStart: NotificationSound;
    shortBreak: NotificationSound;
    longBreak: NotificationSound;
  };
}

// ---------------------------------------------------------------------------
// Reminder types
// ---------------------------------------------------------------------------

export interface Reminder {
  id: string;
  targetType: 'tab' | 'group';
  targetId: string;
  targetName: string;
  targetUrls: string[];
  fireAt: number;
  createdAt: number;
  alarmName: string;
  snoozedFrom?: number;
  recurring?: {
    interval: 'daily' | 'weekly' | 'weekdays' | 'custom';
    customDays?: number[]; // 0=Sun, 1=Mon, etc.
  };
  /**
   * Notification-only reminder (post-ship iteration — Phase 9 Brain Dump).
   * When true, handleFired shows the notification but opens no tabs — used
   * for linkless Brain Dump entries that have no deep-link target. An
   * optional `notificationBody` carries extra copy shown in the toast body
   * (e.g. the captured thought text).
   */
  notificationOnly?: boolean;
  notificationBody?: string;
}

export interface ReminderSettings {
  showBadge: boolean;       // Show bell icon on group cards (default OFF)
  soundEnabled: boolean;    // Play sound on reminder fire (default true)
  sound: NotificationSound; // Which sound to play (default 'gentle-bell')
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  showBadge: false,
  soundEnabled: true,
  sound: 'gentle-bell',
};

// ---------------------------------------------------------------------------
// Backup types
// ---------------------------------------------------------------------------

export interface BackupSavedData {
  groups: TabGroup[];
  tags: Tag[];
  projects: Project[];
  brain_dump_inbox: BrainDumpEntry[];
  archivedGroups: ArchiveStorage | null;
}

export interface BackupSnapshot {
  id: string;
  timestamp: number;
  windows: BackupWindow[];
  /** Absent in legacy, browser-only snapshots. Archive data stays encrypted. */
  savedData?: BackupSavedData;
  totalTabs: number;
  totalGroups: number;
  sizeBytes: number;
}

export interface BackupWindow {
  id: number;
  focused: boolean;
  tabs: BackupTab[];
  tabGroups: BackupTabGroup[];
}

export interface BackupTab {
  url: string;
  title: string;
  favicon?: string;
  pinned: boolean;
  groupId: number;
  index: number;
}

export interface BackupTabGroup {
  id: number;
  title?: string;
  color: chrome.tabGroups.ColorEnum;
  collapsed: boolean;
}

export interface BackupSettings {
  enabled: boolean;
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
}

// ---------------------------------------------------------------------------
// Focus Mode types
// ---------------------------------------------------------------------------

export interface FocusSettings {
  enabled: boolean;                    // Master toggle for Focus mode
  blockDuringBreaks: boolean;          // Whether to keep blocking during breaks (default: false)
  /** Auto-start focus when Pomodoro work session begins (default: true). */
  autoEnableWithPomodoro: boolean;
  presets: {
    socialMedia: boolean;
    newsMedia: boolean;
    entertainment: boolean;
    shopping: boolean;
  };
  customDomains: string[];             // User-added domains (bare domains, e.g., "example.com")
  blockedPhrases: string[];            // Case-insensitive URL/title contains matches
}

export interface FocusState {
  isActive: boolean;
  activatedAt: number;                // Epoch ms, 0 when inactive
  source?: 'manual' | 'pomodoro' | 'flowtime';
  countingStartedAt?: number;
}

/**
 * Phase 12 (ADHD-13/14): Hard Focus runtime state persisted under
 * chrome.storage.local key 'hardFocusState'.
 *
 * Hard Focus is whitelist mode: while active, only URLs from the current-window
 * snapshot taken at start time are reachable.
 *
 * Manual stop only (no auto-end). The confirm dialog lives in the sidepanel
 * UI (Plan 12-05); this service persists the raw state flag only.
 *
 * Mirrors FocusState shape for parity. domainMode is a snapshot of the
 * ADHDSettings.hardFocus.domainMode value at the time Hard Focus was started.
 */
export interface HardFocusState {
  isActive: boolean;
  activatedAt: number;    // epoch ms; 0 when inactive
  domainMode: boolean;    // snapshot of the setting at start time
  /**
   * Phase 12 continuation 5 (T5): snapshot of the whitelisted URL list at start() time.
   * Record-only — not used for rule reconstruction (rules persist on disk via dNR).
   * Optional for backward compatibility with stored states from prior continuations.
   */
  snapshotUrls?: string[];
}
