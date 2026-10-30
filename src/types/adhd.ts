/**
 * @module types/adhd
 *
 * WHY:  Phase 9 ships a master ADHD Mode toggle plus calm-surface
 *       sub-features (Safe Auto-Suspend, Simplify Mode, Visual Time).
 *       Phase 12 extends with three additional sub-features: Visible Tab Limit,
 *       Hard Focus, and Flowtime Timer.
 *       Every downstream plan imports ADHDSettings + DEFAULT_ADHD_SETTINGS.
 *       Centralizing the shape here prevents drift across six files that reach
 *       for the same data.
 *
 * WHAT: Strict TypeScript contracts for:
 *       - AutoSuspendSettings — threshold dropdown + whitelist
 *       - SimplifySettings    — toggle + aggressive sub-flag
 *       - VisualTimeSettings  — toggle + color-blind palette flag
 *       - BrainDumpSettings   — legacy settings shape retained for stored data
 *       - VisibleTabLimitSettings — toggle + limit slider (Phase 12)
 *       - HardFocusSettings       — toggle + domainMode sub-option (Phase 12)
 *       - FlowtimeSettings        — toggle + coefficient slider (Phase 12)
 *       - ADHDSettings        — the composite object persisted under
 *         chrome.storage.local key 'adhd_settings'
 *       - DEFAULT_ADHD_SETTINGS — master OFF, every sub OFF
 *       - ADHD_SETTINGS_STORAGE_KEY — single source of truth for the key string
 *       - Zod schemas for all Phase 12 sub-feature settings (project convention)
 *
 * HOW:  Plain interfaces + Zod schemas co-located here (project convention for
 *       new Phase 12 types that have no pre-existing Zod pattern in this file).
 *       The key string is exported as a `const` with `as const` so callers get
 *       narrow literal typing.
 *
 * NOT:  Does not touch chrome.storage — see ADHDService for IO.
 *       Does not register syncable-key membership — see delta-tracker.
 *       Phase 12 sub-feature settings sync via the existing 'adhd_settings'
 *       OBJECT_KEY deep-merge path (see 12-CONTEXT.md §Sync deviation).
 */

import { z } from 'zod';

export interface AutoSuspendSettings {
  enabled: boolean;
  /**
   * Inactivity threshold before a tab is eligible for discard. Preset-only.
   *
   * `0.5` is a debug-only preset (30 seconds) surfaced in the dropdown so
   * developers and QA can verify the suspend/restore cycle without waiting
   * the 15-minute minimum. Chrome clamps `chrome.alarms` periods to 60s,
   * so a 30s threshold still only scans once per minute — actual discard
   * lands at the next 60s tick. The eligibility math (`thresholdMin * 60 * 1000`)
   * transparently supports fractional minutes.
   */
  thresholdMin: 0.5 | 15 | 30 | 60 | 120;
  /** Bare domains (no protocol, no www., no path) exempt from auto-suspend. */
  whitelistDomains: string[];
  /**
   * TRUE once the user has seen the first-run onboarding dialog that
   * differentiates "suspend" from "close" (ADHD-09). Gate flipping via
   * ADHDService.updateSettings when the onboarding dialog dismisses.
   * Optional for backwards compatibility with Plan 09-01 stored settings.
   */
  onboardingSeen?: boolean;
}

/**
 * In-memory record of a tab that AutoSuspendService suspended during the
 * current service-worker session. Used by SuspendedTabsSection in the
 * sidepanel to render the one-off "Close all" / "Save as group & close"
 * batch actions (each gated by two-click inline confirmation — CRIT-04).
 *
 * NOT persisted: CONTEXT.md §Safe Auto-Suspend defers a broader Bluetab-wide
 * activity log to a later feature. Phase 9 keeps this session-scoped.
 */
export interface SuspendedTabRecord {
  tabId: number;
  title: string;
  url: string;
  favicon?: string;
  suspendedAt: number;
  restored: boolean;
}

export interface SimplifySettings {
  enabled: boolean;
  /** Opt-in sub-flag that enables hover-to-reveal on Options-shell group rows. */
  aggressive: boolean;
}

export interface VisualTimeSettings {
  enabled: boolean;
  /** Swaps the default palette for an Okabe-Ito deuteranopia/protanopia-safe pair. */
  colorBlindSafe: boolean;
}

export interface BrainDumpSettings {
  enabled: boolean;
  /** Remembered-last-choice seed for the Brain Dump capture modal's tab-context chip. */
  tabContextDefault: boolean;
  /**
   * TRUE once the user has seen the first-run onboarding toast that explains
   * how to bind the `brain-dump` shortcut at chrome://extensions/shortcuts
   * (ADHD-20). Gate flipping via ADHDService.updateSettings when the toast
   * dismisses so it does not re-fire on subsequent enables.
   */
  onboardingSeen?: boolean;
}

/**
 * A single Brain Dump Inbox entry. `tabContext` is optional — users can
 * detach the active tab chip in the capture modal (ADHD-22). The timestamp
 * is written at capture time, not insertion time, so ordering is stable
 * even if storage writes reorder. `updatedAt` is set when the user edits
 * the text inline from the Dump panel (post-ship iteration); absent on
 * entries captured before edit support landed.
 */
export interface BrainDumpEntry {
  id: string;
  text: string;
  createdAt: number;
  updatedAt?: number;
  tabContext?: {
    url: string;
    title: string;
    favicon?: string;
  };
}

/**
 * User preferences for the Brain Dump capture modal. Persisted separately
 * from ADHDSettings so Brain Dump can behave as a first-class feature
 * instead of an ADHD Mode sub-toggle. The modal can read/write this small
 * shape independently of the main settings object.
 *
 * Plan 14-07 — INTEG-11: optional `destinationOverride` lets the user route
 * a captured brain-dump entry to a connected integration in addition to the
 * Bluetab inbox. `null` means "Bluetab inbox only" (the default).
 */
export interface BrainDumpPrefs {
  /** Feature gate for shortcut injection, sidepanel tab, and capture modal. Default: true. */
  enabled: boolean;
  tabContextDefault: boolean;
  /** Highlights the floating button when the current page exactly matches a linked Brain Dump entry. */
  linkedPageIndicatorEnabled?: boolean;
  /** TRUE once the shortcut-binding nudge has been surfaced from Settings. */
  onboardingSeen?: boolean;
  destinationOverride?: { integrationId: string; accountId: string; target?: string | null } | null;
}

/** chrome.storage.local key for the Brain Dump Inbox (BrainDumpEntry[]). */
export const BRAIN_DUMP_INBOX_KEY = 'brain_dump_inbox' as const;

/** chrome.storage.local key for the Brain Dump preferences (BrainDumpPrefs). */
export const BRAIN_DUMP_PREFS_KEY = 'brain_dump_prefs' as const;

/** RingBuffer capacity for the Brain Dump Inbox (entries beyond this are evicted oldest-first). */
export const BRAIN_DUMP_CAPACITY = 200;

// ---------------------------------------------------------------------------
// Phase 12 sub-feature settings interfaces + Zod schemas
// ---------------------------------------------------------------------------

/**
 * Settings for the Visible Tab Limit sub-feature (ADHD-10, ADHD-11, ADHD-12).
 *
 * Syncs via the existing 'adhd_settings' OBJECT_KEY deep-merge path.
 * See 12-CONTEXT.md §Sync deviation for rationale.
 *
 * Default: enabled=false, limit=20.
 * Slider range: 5–30 step 1. Pinned tabs are always exempt (no toggle).
 */
export interface VisibleTabLimitSettings {
  enabled: boolean;
  /** Number of visible (non-hidden) tabs allowed. Range: 5–30. Default: 20. */
  limit: number;
  /**
   * TRUE once the user has dismissed the first-run onboarding card that explains
   * the H:* collapsed-group mechanism. Gate flipping via ADHDService.updateSettings
   * when the card dismisses so it does not re-appear on subsequent enables.
   */
  onboardingSeen?: boolean;
}

/** Zod schema for VisibleTabLimitSettings (project convention — unconditional). */
export const VisibleTabLimitSettingsSchema = z.object({
  enabled: z.boolean(),
  limit: z.number().int().min(5).max(30),
});

/**
 * Settings for the Hard Focus sub-feature (ADHD-13, ADHD-14, ADHD-15).
 *
 * Syncs via the existing 'adhd_settings' OBJECT_KEY deep-merge path.
 * See 12-CONTEXT.md §Sync deviation for rationale.
 *
 * Default: enabled=false, domainMode=false.
 * domainMode=true: whitelist by hostname; domainMode=false: whitelist by full URL.
 */
export interface HardFocusSettings {
  enabled: boolean;
  /**
   * When true, Hard Focus whitelists by hostname instead of full URL.
   * More forgiving navigation within the same domain.
   * Default: false (URL-level whitelist).
   */
  domainMode: boolean;
  /**
   * TRUE once the user has dismissed the first-run onboarding card that explains
   * the Hard Focus whitelist mechanism. Gate flipping via ADHDService.updateSettings
   * when the card dismisses so it does not re-appear on subsequent enables.
   */
  onboardingSeen?: boolean;
}

/** Zod schema for HardFocusSettings (project convention — unconditional). */
export const HardFocusSettingsSchema = z.object({
  enabled: z.boolean(),
  domainMode: z.boolean(),
});

/**
 * Settings for the Flowtime Timer sub-feature (ADHD-24, ADHD-25, ADHD-26, ADHD-27).
 *
 * Syncs via the existing 'adhd_settings' OBJECT_KEY deep-merge path.
 * See 12-CONTEXT.md §Sync deviation for rationale.
 *
 * Default: enabled=false, coefficient=0.20.
 * Break formula: break_min = round(work_min × coefficient).
 * Slider range: 0.10–0.30 step 0.01.
 *
 * Note: Bluetab uses a linear coefficient (default 0.20) rather than
 * Zoë Read-Bivens' original stepped table. This is intentional — the slider
 * allows personalization the stepped model does not. See 12-RESEARCH.md §Finding 1.
 */
export interface FlowtimeSettings {
  enabled: boolean;
  /**
   * Break-duration coefficient. break_min = round(work_min × coefficient).
   * Range: 0.10–0.30. Default: 0.20.
   */
  coefficient: number;
  /**
   * Automatically turns on Focus Mode while a Flowtime session is actively
   * running. Paused or stopped Flowtime sessions do not keep Focus Mode alive.
   * Default: false.
   */
  autoFocusEnabled?: boolean;
  /**
   * TRUE once the user has dismissed the first-run onboarding card that explains
   * Flowtime Timer. Gate flipping via ADHDService.updateSettings
   * when the card dismisses so it does not re-appear on subsequent enables.
   */
  onboardingSeen?: boolean;
}

/** Zod schema for FlowtimeSettings (project convention — unconditional). */
export const FlowtimeSettingsSchema = z.object({
  enabled: z.boolean(),
  coefficient: z.number().min(0.10).max(0.30),
  autoFocusEnabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Master ADHD settings
// ---------------------------------------------------------------------------

/**
 * Master ADHD settings object persisted at chrome.storage.local['adhd_settings'].
 *
 * Invariant: `masterEnabled === false` makes every sub-feature a no-op at
 * runtime regardless of its individual `enabled` flag. Consumers must gate
 * on `ADHDService.isFeatureActive(name)` rather than reading `.enabled`
 * directly — see ADHD-02.
 *
 * Phase 12 adds three sub-objects: visibleTabLimit, hardFocus, flowtimeTimer.
 * All three sync via the existing 'adhd_settings' OBJECT_KEY deep-merge path —
 * no new top-level SYNCABLE_KEYS entries required (see 12-CONTEXT.md §Sync).
 */
export interface ADHDSettings {
  masterEnabled: boolean;
  autoSuspend: AutoSuspendSettings;
  simplify: SimplifySettings;
  visualTime: VisualTimeSettings;
  brainDump: BrainDumpSettings;
  /** Phase 12: Visible Tab Limit — moves overflow tabs into collapsed H:* groups. */
  visibleTabLimit: VisibleTabLimitSettings;
  /** Phase 12: Hard Focus — whitelists only open-group tab URLs via declarativeNetRequest. */
  hardFocus: HardFocusSettings;
  /** Phase 12: Flowtime Timer — mutually exclusive with Pomodoro; linear break formula. */
  flowtimeTimer: FlowtimeSettings;
}

export const DEFAULT_ADHD_SETTINGS: ADHDSettings = {
  masterEnabled: false,
  autoSuspend: { enabled: false, thresholdMin: 30, whitelistDomains: [] },
  simplify: { enabled: false, aggressive: false },
  visualTime: { enabled: false, colorBlindSafe: false },
  brainDump: { enabled: false, tabContextDefault: true },
  visibleTabLimit: { enabled: false, limit: 20 },
  hardFocus: { enabled: false, domainMode: false },
  flowtimeTimer: { enabled: false, coefficient: 0.20, autoFocusEnabled: false },
};

/** chrome.storage.local key for the ADHDSettings object. */
export const ADHD_SETTINGS_STORAGE_KEY = 'adhd_settings' as const;

/**
 * Valid sub-feature names that participate in the master-gate check.
 *
 * Phase 12 adds: 'visibleTabLimit' | 'hardFocus' | 'flowtimeTimer'.
 */
export type ADHDFeatureName =
  | 'autoSuspend'
  | 'simplify'
  | 'visualTime'
  | 'brainDump'
  | 'visibleTabLimit'
  | 'hardFocus'
  | 'flowtimeTimer';
