/**
 * @module services/pomodoro-service
 *
 * WHY:  The Pomodoro technique requires precise time tracking that survives
 *       MV3 service worker termination. Traditional setInterval-based timers
 *       die after 30 seconds of inactivity. By using chrome.alarms and storing
 *       absolute end-times in chrome.storage.local, the timer continues
 *       accurately regardless of service worker lifecycle.
 *
 * WHAT: Static PomodoroService class managing the full Pomodoro lifecycle:
 *       start/pause/resume/stop timer, auto-cycle between work and break
 *       sessions, badge updates, notification on session end, and session
 *       history tracking.
 *
 * HOW:  - POMODORO_END alarm fires at the absolute endTime for session completion
 *       - POMODORO_TICK repeating alarm (1min) triggers badge text updates
 *       - State persisted to chrome.storage.local as absolute timestamps
 *       - Auto-cycle: work -> shortBreak -> work -> ... -> longBreak (every N)
 *       - History capped at 200 entries via RingBuffer FIFO eviction
 *
 * NOT:  Does not render UI — consumed by sidepanel PomodoroBar, popup status,
 *       and service-worker alarm handlers. Does not manage alarm registration
 *       — see service-worker.ts for onAlarm dispatch.
 */

import { ALARM_NAMES } from '@/config/alarms';
import { initI18n, t as translate } from '@/i18n';
import { Storage } from '@/utils/storage';
import { RingBuffer } from '@/utils/ring-buffer';
import type {
  PomodoroState,
  PomodoroSession,
  PomodoroSettings,
  PomodoroPreset,
} from '@/types/productivity';
import { POMODORO_PRESETS } from '@/types/productivity';
import { ADHDService } from './adhd-service';
import { StatsService } from './stats-service';
import {
  computeBreakMinutes,
  FLOWTIME_BREAK_PROPOSAL_KEY,
  type FlowtimeBreakProposal,
} from './flowtime-helpers';

const LOG_PREFIX = '[BlueTab][Pomodoro]';
const HISTORY_MAX = 200;
const historyBuffer = new RingBuffer<PomodoroSession>(HISTORY_MAX);

function getDefaultState(): PomodoroState {
  return {
    isActive: false,
    isPaused: false,
    sessionType: 'work',
    endTime: 0,
    pausedRemaining: 0,
    sessionsCompleted: 0,
    preset: 'classic',
  };
}

function getDefaultSettings(): PomodoroSettings {
  return {
    preset: 'classic',
    customWork: 25,
    customShortBreak: 5,
    customLongBreak: 15,
    longBreakInterval: 4,
  };
}

/**
 * Resolve the active preset durations from settings.
 */
function getPresetDurations(settings: PomodoroSettings): PomodoroPreset {
  if (settings.preset === 'custom') {
    return {
      work: settings.customWork,
      shortBreak: settings.customShortBreak,
      longBreak: settings.customLongBreak,
    };
  }
  return POMODORO_PRESETS[settings.preset];
}

/**
 * Get the duration in minutes for a given session type.
 */
function getSessionDuration(
  sessionType: PomodoroState['sessionType'],
  durations: PomodoroPreset,
): number {
  switch (sessionType) {
    case 'work':
      return durations.work;
    case 'shortBreak':
      return durations.shortBreak;
    case 'longBreak':
      return durations.longBreak;
  }
}

export class PomodoroService {
  /**
   * Start a new Pomodoro session.
   * Calculates the absolute end-time and creates alarms for session end + badge tick.
   *
   * Phase 12 (ADHD-26): Enforces mutex — if a Flowtime session is active, it is
   * aborted silently (no break card) before starting Pomodoro.
   */
  static async start(sessionType?: PomodoroState['sessionType']): Promise<void> {
    // Phase 12 mutex: abort active Flowtime session before starting Pomodoro (ADHD-26)
    const currentState = (await Storage.get<PomodoroState>('pomodoroState')) || getDefaultState();
    if (currentState.isActive && currentState.mode === 'flowtime') {
      await PomodoroService._abortFlowtime();
    }

    const settings = (await Storage.get<PomodoroSettings>('pomodoroSettings')) || getDefaultSettings();
    const state = (await Storage.get<PomodoroState>('pomodoroState')) || getDefaultState();
    const durations = getPresetDurations(settings);
    const type = sessionType || state.sessionType || 'work';
    const durationMs = getSessionDuration(type, durations) * 60 * 1000;
    const endTime = Date.now() + durationMs;

    // New day reset: if last session was on a different local date, start a fresh cycle
    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let sessionsCompleted = state.sessionsCompleted;
    if (state.lastSessionDate && state.lastSessionDate !== todayLocal) {
      sessionsCompleted = 0;
    }

    // Race condition safety: always clear before create
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_END);
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);

    await chrome.alarms.create(ALARM_NAMES.POMODORO_END, { when: endTime });
    // Explicit delayInMinutes ensures first tick fires promptly (Chrome may
    // ignore periodInMinutes-only alarms until the first period elapses).
    await chrome.alarms.create(ALARM_NAMES.POMODORO_TICK, {
      delayInMinutes: 0.08, // ~5 seconds for quick first badge update
      periodInMinutes: 0.5, // 30-second ticks for precise badge updates
    });

    const newState: PomodoroState = {
      ...state,
      isActive: true,
      isPaused: false,
      sessionType: type,
      endTime,
      pausedRemaining: 0,
      preset: settings.preset,
      sessionsCompleted,
      lastSessionDate: todayLocal,
    };

    await Storage.set('pomodoroState', newState);

    // Immediately update badge so user sees correct time from the start
    await PomodoroService.updateBadge();

    console.log(`${LOG_PREFIX} Started ${type} session (${getSessionDuration(type, durations)}min)`);
  }

  /**
   * Pause the active session.
   * Clears alarms and stores remaining time for later resume.
   */
  static async pause(): Promise<void> {
    const state = await Storage.get<PomodoroState>('pomodoroState');
    if (!state || !state.isActive || state.isPaused) return;

    const remaining = Math.max(0, state.endTime - Date.now());

    await chrome.alarms.clear(ALARM_NAMES.POMODORO_END);
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);

    await Storage.set('pomodoroState', {
      ...state,
      isPaused: true,
      pausedRemaining: remaining,
    });

    await PomodoroService.updateBadge();
    console.log(`${LOG_PREFIX} Paused (${Math.ceil(remaining / 60000)}min remaining)`);
  }

  /**
   * Resume a paused session.
   * Recreates alarms from the stored remaining time.
   */
  static async resume(): Promise<void> {
    const state = await Storage.get<PomodoroState>('pomodoroState');
    if (!state || !state.isActive || !state.isPaused) return;

    const newEndTime = Date.now() + state.pausedRemaining;

    // Race condition safety: clear before create
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_END);
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);

    await chrome.alarms.create(ALARM_NAMES.POMODORO_END, { when: newEndTime });
    await chrome.alarms.create(ALARM_NAMES.POMODORO_TICK, {
      delayInMinutes: 0.08,
      periodInMinutes: 0.5,
    });

    await Storage.set('pomodoroState', {
      ...state,
      isPaused: false,
      pausedRemaining: 0,
      endTime: newEndTime,
    });

    await PomodoroService.updateBadge();
    console.log(`${LOG_PREFIX} Resumed (${Math.ceil(state.pausedRemaining / 60000)}min remaining)`);
  }

  /**
   * Stop the timer completely.
   * Clears alarms, resets state, and clears badge.
   */
  static async stop(): Promise<void> {
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_END);
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);

    const state = (await Storage.get<PomodoroState>('pomodoroState')) || getDefaultState();

    await Storage.set('pomodoroState', {
      ...state,
      isActive: false,
      isPaused: false,
      endTime: 0,
      pausedRemaining: 0,
    });

    await chrome.action.setBadgeText({ text: '' });
    console.log(`${LOG_PREFIX} Stopped`);
  }

  /**
   * Handle session end: record to history, notify user, auto-advance to next session.
   *
   * Auto-cycle logic:
   * - Work session ends: increment sessionsCompleted
   *   - If sessionsCompleted % longBreakInterval === 0: next is longBreak
   *   - Otherwise: next is shortBreak
   * - Short break ends: next is work
   * - Long break ends: reset sessionsCompleted to 0, next is work
   */
  static async handleSessionEnd(): Promise<void> {
    await initI18n();
    const state = (await Storage.get<PomodoroState>('pomodoroState')) || getDefaultState();

    // FT3: Flowtime break mode — isolated countdown, NO auto-advance, NO history record.
    // When a flowtime-break alarm fires, simply clear state and return to idle.
    if (state.mode === 'flowtime-break') {
      await chrome.alarms.clear(ALARM_NAMES.POMODORO_END);
      await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);

      await Storage.set('pomodoroState', {
        ...state,
        isActive: false,
        isPaused: false,
        mode: undefined,
        endTime: 0,
        pausedRemaining: 0,
      });
      await chrome.action.setBadgeText({ text: '' });
      console.log(`${LOG_PREFIX} [Flowtime] Break complete — returning to idle (no auto-advance)`);
      return;
    }

    const settings = (await Storage.get<PomodoroSettings>('pomodoroSettings')) || getDefaultSettings();
    const durations = getPresetDurations(settings);

    // Record completed session in history
    const duration = getSessionDuration(state.sessionType, durations);
    const session: PomodoroSession = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: state.sessionType,
      duration,
      startedAt: state.endTime - duration * 60 * 1000,
      completedAt: Date.now(),
    };

    const history = (await Storage.get<PomodoroSession[]>('pomodoroHistory')) || [];
    const updatedHistory = historyBuffer.push(history, session);
    await Storage.set('pomodoroHistory', updatedHistory);

    // Determine next session type
    let nextSessionType: PomodoroState['sessionType'];
    let nextSessionsCompleted = state.sessionsCompleted;

    if (state.sessionType === 'work') {
      nextSessionsCompleted = state.sessionsCompleted + 1;
      if (nextSessionsCompleted % settings.longBreakInterval === 0) {
        nextSessionType = 'longBreak';
      } else {
        nextSessionType = 'shortBreak';
      }
    } else if (state.sessionType === 'longBreak') {
      nextSessionType = 'work';
      nextSessionsCompleted = 0;
    } else {
      // shortBreak -> work (sessionsCompleted preserved from initialization)
      nextSessionType = 'work';
      nextSessionsCompleted = state.sessionsCompleted;
    }

    // Create notification
    const message =
      state.sessionType === 'work'
        ? translate('notifications.pomodoroWorkComplete')
        : translate('notifications.pomodoroBreakComplete');

    await chrome.notifications.create(`pomodoro-${Date.now()}`, {
      type: 'basic',
      title: translate('notifications.pomodoroTitle'),
      message,
      iconUrl: chrome.runtime.getURL('src/assets/icon48.png'),
    });

    console.log(
      `${LOG_PREFIX} Session ended (${state.sessionType}). Next: ${nextSessionType}`,
    );

    // Update state for next session and auto-start
    const nextDurationMs = getSessionDuration(nextSessionType, durations) * 60 * 1000;
    const nextEndTime = Date.now() + nextDurationMs;

    // Clear and recreate alarms for next session
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_END);
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);

    await chrome.alarms.create(ALARM_NAMES.POMODORO_END, { when: nextEndTime });
    await chrome.alarms.create(ALARM_NAMES.POMODORO_TICK, {
      delayInMinutes: 0.08,
      periodInMinutes: 0.5,
    });

    const nowDate = new Date();
    const nowLocal = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;

    await Storage.set('pomodoroState', {
      ...state,
      isActive: true,
      isPaused: false,
      sessionType: nextSessionType,
      endTime: nextEndTime,
      pausedRemaining: 0,
      sessionsCompleted: nextSessionsCompleted,
      lastSessionDate: nowLocal,
    });

    await PomodoroService.updateBadge();
  }

  /**
   * Update the extension badge with remaining time (Pomodoro) or elapsed time (Flowtime).
   *
   * - Pomodoro mode: shows countdown minutes remaining (e.g. "23m"), red for work / green for break.
   * - Flowtime mode (Phase 12 ADHD-24): shows elapsed minutes (e.g. "12m"), blue badge.
   * - Clears badge if inactive or paused.
   *
   * Pitfall 3 (12-RESEARCH.md): must branch on state.mode to avoid NaN in Flowtime
   * (Flowtime has no endTime, so `endTime - now()` would be negative/zero).
   */
  static async updateBadge(): Promise<void> {
    const state = await Storage.get<PomodoroState>('pomodoroState');

    if (!state || !state.isActive || state.isPaused) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }

    // Phase 12: Flowtime mode shows elapsed minutes (count-up badge)
    // FT1: use Math.floor so 01:05 elapsed → badge shows "1m" (completed minute), not "2m".
    if (state.mode === 'flowtime' && state.startTime) {
      const elapsedMs = Math.max(0, Date.now() - state.startTime);
      const elapsedMinutes = Math.floor(elapsedMs / 60000);
      const focusState = await Storage.get<{ isActive: boolean }>('focusState');
      const badgeColor = focusState?.isActive ? '#f97316' : '#3b82f6';
      await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
      await chrome.action.setBadgeText({ text: `${elapsedMinutes}m` });
      // I2: Schedule a one-shot alarm to fire at the next minute boundary so the
      // badge flips exactly when elapsed minutes increment (e.g., "1m" at 01:00).
      const msUntilNextMinute = 60000 - (elapsedMs % 60000);
      if (msUntilNextMinute > 0 && msUntilNextMinute < 59500) {
        chrome.alarms.create('pomodoro-badge-sync', { when: Date.now() + msUntilNextMinute });
      }
      return;
    }

    // Phase 12: Flowtime break mode — shows countdown like Pomodoro but with blue badge.
    // FT3: flowtime-break is isolated from Pomodoro; never triggers Focus integration.
    if (state.mode === 'flowtime-break') {
      const remaining = Math.max(0, state.endTime - Date.now());
      const minutes = Math.ceil(remaining / 60000);
      await chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
      await chrome.action.setBadgeText({ text: minutes > 0 ? `${minutes}m` : '' });
      return;
    }

    // Pomodoro mode: countdown badge (existing behavior)
    const remaining = Math.max(0, state.endTime - Date.now());
    const minutes = Math.ceil(remaining / 60000);

    await chrome.action.setBadgeText({ text: minutes > 0 ? `${minutes}m` : '' });

    // Focus Mode active → orange badge; otherwise work=red, break=green
    const focusState = await Storage.get<{ isActive: boolean }>('focusState');
    const badgeColor = focusState?.isActive ? '#f97316'
      : state.sessionType === 'work' ? '#ef4444' : '#22c55e';
    await chrome.action.setBadgeBackgroundColor({ color: badgeColor });

    // Schedule a precise one-shot alarm at the next minute boundary so the
    // badge flips exactly when the displayed minute should change (e.g. 24m→23m).
    // This supplements the periodic POMODORO_TICK which has ±5s jitter.
    if (remaining > 0) {
      const msUntilNextMinute = remaining % 60000;
      if (msUntilNextMinute > 0 && msUntilNextMinute < 59500) {
        // Fire slightly after the minute boundary (+500ms safety margin)
        const when = Date.now() + msUntilNextMinute + 500;
        chrome.alarms.create('pomodoro-badge-sync', { when });
      }
    }
  }

  /**
   * Get the current Pomodoro state from storage.
   */
  static async getState(): Promise<PomodoroState> {
    return (await Storage.get<PomodoroState>('pomodoroState')) || getDefaultState();
  }

  /**
   * Get session history, optionally filtered to the last N days.
   */
  static async getHistory(days?: number): Promise<PomodoroSession[]> {
    const history = (await Storage.get<PomodoroSession[]>('pomodoroHistory')) || [];

    if (days === undefined) return history;

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return history.filter((s) => s.completedAt >= cutoff);
  }

  /**
   * Get today's summary: work sessions completed and total focus minutes.
   */
  static async getTodaySummary(): Promise<{
    sessionsCompleted: number;
    totalFocusMinutes: number;
  }> {
    const history = (await Storage.get<PomodoroSession[]>('pomodoroHistory')) || [];

    const todayStart = new Date(Date.now());
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const todayWork = history.filter(
      (s) => s.type === 'work' && s.completedAt >= todayMs,
    );

    return {
      sessionsCompleted: todayWork.length,
      totalFocusMinutes: todayWork.reduce((sum, s) => sum + s.duration, 0),
    };
  }

  /**
   * Update the active preset and apply new durations.
   */
  static async setPreset(preset: PomodoroState['preset']): Promise<void> {
    const settings = (await Storage.get<PomodoroSettings>('pomodoroSettings')) || getDefaultSettings();
    await Storage.set('pomodoroSettings', { ...settings, preset });
    console.log(`${LOG_PREFIX} Preset changed to ${preset}`);
  }

  // ---------------------------------------------------------------------------
  // Phase 12: Flowtime Timer methods (ADHD-24, ADHD-25, ADHD-26, ADHD-27)
  // ---------------------------------------------------------------------------

  /**
   * Start a Flowtime session (count-up, user-stopped).
   *
   * Differences from Pomodoro start():
   * - No POMODORO_END alarm (Flowtime is user-stopped, not alarm-driven)
   * - Sets mode='flowtime' and startTime=Date.now() instead of endTime
   * - POMODORO_TICK alarm is scheduled for badge updates (elapsed display)
   *
   * Mutex (ADHD-26): if a classic Pomodoro session is currently active, it is
   * stopped first (alarms cleared, state reset) before Flowtime begins.
   *
   * @see stopFlowtime for the corresponding stop path
   */
  static async startFlowtime(): Promise<void> {
    const state = (await Storage.get<PomodoroState>('pomodoroState')) || getDefaultState();

    // Mutex: if Pomodoro is active (not Flowtime), stop it first (ADHD-26)
    if (state.isActive && state.mode !== 'flowtime') {
      await chrome.alarms.clear(ALARM_NAMES.POMODORO_END);
      await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);
      console.log(`${LOG_PREFIX} [Flowtime] Stopping active Pomodoro for Flowtime mutex`);
    }

    // Race condition safety: always clear before create
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_END);
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);

    // POMODORO_TICK keeps the badge updated with elapsed minutes
    await chrome.alarms.create(ALARM_NAMES.POMODORO_TICK, {
      delayInMinutes: 0.08,
      periodInMinutes: 0.5,
    });

    const flowtimeState: PomodoroState = {
      isActive: true,
      isPaused: false,
      sessionType: 'work',
      mode: 'flowtime',
      startTime: Date.now(),
      endTime: 0,
      pausedRemaining: 0,
      sessionsCompleted: state.sessionsCompleted ?? 0,
      preset: state.preset ?? 'classic',
    };

    await Storage.set('pomodoroState', flowtimeState);
    await PomodoroService.updateBadge();

    console.log(`${LOG_PREFIX} [Flowtime] Started`);
  }

  /**
   * Stop a Flowtime session and compute the break proposal.
   *
   * Returns null when:
   * - No Flowtime session is active (state.mode !== 'flowtime')
   * - Elapsed work time is < 5 minutes (silent end per ADHD-25 — no break card)
   *
   * Returns `{ workMinutes, proposedBreakMinutes }` when workMinutes >= 5.
   * proposedBreakMinutes = max(1, round(workMinutes × coefficient)).
   *
   * Also appends a PomodoroSession with mode='flowtime' to pomodoroHistory (ADHD-27).
   * Calls StatsService.recordFocusMinutes (mode-agnostic daily aggregate).
   */
  static async stopFlowtime(): Promise<{ workMinutes: number; proposedBreakMinutes: number } | null> {
    const state = (await Storage.get<PomodoroState>('pomodoroState')) || getDefaultState();

    if (!state.isActive || state.mode !== 'flowtime') {
      return null;
    }

    const startTime = state.startTime ?? Date.now();
    const workMinutes = Math.floor((Date.now() - startTime) / 60000);

    // Clear alarms and state regardless of workMinutes threshold
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_END);
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);

    const clearedState: PomodoroState = {
      ...state,
      isActive: false,
      isPaused: false,
      mode: undefined,
      startTime: undefined,
      endTime: 0,
      pausedRemaining: 0,
    };
    await Storage.set('pomodoroState', clearedState);
    await chrome.action.setBadgeText({ text: '' });

    // Silent end for sessions < 5 minutes (no break card, no session record) — ADHD-25
    if (workMinutes < 5) {
      console.log(`${LOG_PREFIX} [Flowtime] Silent end (${workMinutes}min < 5min threshold)`);
      return null;
    }

    // Read Flowtime coefficient from ADHDSettings
    const adhdSettings = await ADHDService.getSettings();
    const coefficient = adhdSettings.flowtimeTimer.coefficient;
    // Use computeBreakMinutes from flowtime-helpers (pure, testable, importable by Settings preview)
    // computeBreakMinutes returns null for workMinutes < FLOWTIME_MIN_WORK_MINUTES, but we only
    // reach this branch when workMinutes >= 5, so the result is always a number here.
    const proposedBreakMinutes = computeBreakMinutes(workMinutes, coefficient) ?? Math.max(1, Math.round(workMinutes * coefficient));

    // Record Flowtime session in pomodoroHistory (ADHD-27)
    const session: PomodoroSession = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'work',
      mode: 'flowtime',
      duration: workMinutes,
      startedAt: startTime,
      completedAt: Date.now(),
    };

    const history = (await Storage.get<PomodoroSession[]>('pomodoroHistory')) || [];
    const updatedHistory = historyBuffer.push(history, session);
    await Storage.set('pomodoroHistory', updatedHistory);

    // Record focus minutes in StatsService (mode-agnostic daily aggregate)
    await StatsService.recordFocusMinutes(workMinutes, 'flowtime');

    // NEW (Plan 12-04): Write transient break proposal to storage so PomodoroBar
    // can pick it up via storage.onChanged and render the FlowtimeBreakCard.
    const proposal: FlowtimeBreakProposal = {
      workMinutes,
      proposedBreakMinutes,
      createdAt: Date.now(),
    };
    await Storage.set(FLOWTIME_BREAK_PROPOSAL_KEY, proposal);

    console.log(
      `${LOG_PREFIX} [Flowtime] Stopped: ${workMinutes}min work → ${proposedBreakMinutes}min break proposed`
    );

    return { workMinutes, proposedBreakMinutes };
  }

  /**
   * Pause an active Flowtime session (L-fix).
   *
   * Stores elapsed ms in `pausedRemaining` and sets `isPaused: true`.
   * The POMODORO_TICK alarm is cleared — no badge update while paused.
   * Does nothing if not in flowtime mode or already paused.
   */
  static async pauseFlowtime(): Promise<void> {
    const state = (await Storage.get<PomodoroState>('pomodoroState')) || getDefaultState();
    if (!state.isActive || state.mode !== 'flowtime' || state.isPaused) return;

    const elapsedMs = Date.now() - (state.startTime ?? Date.now());

    await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);

    await Storage.set('pomodoroState', {
      ...state,
      isPaused: true,
      // Repurpose pausedRemaining to store elapsed ms at pause time (Flowtime semantics).
      // On resume, startTime is recalculated as Date.now() - pausedRemaining.
      pausedRemaining: elapsedMs,
    });

    await PomodoroService.updateBadge();
    console.log(`${LOG_PREFIX} [Flowtime] Paused at ${Math.floor(elapsedMs / 1000)}s`);
  }

  /**
   * Resume a paused Flowtime session (L-fix).
   *
   * Recalculates `startTime` so elapsed = pausedRemaining continues from where it
   * stopped. Re-creates the POMODORO_TICK alarm for badge updates.
   * Does nothing if not in flowtime mode or not paused.
   */
  static async resumeFlowtime(): Promise<void> {
    const state = (await Storage.get<PomodoroState>('pomodoroState')) || getDefaultState();
    if (!state.isActive || state.mode !== 'flowtime' || !state.isPaused) return;

    // Recalculate startTime so that: Date.now() - startTime = pausedRemaining
    const newStartTime = Date.now() - state.pausedRemaining;

    await chrome.alarms.create(ALARM_NAMES.POMODORO_TICK, {
      delayInMinutes: 0.08,
      periodInMinutes: 0.5,
    });

    await Storage.set('pomodoroState', {
      ...state,
      isPaused: false,
      pausedRemaining: 0,
      startTime: newStartTime,
    });

    await PomodoroService.updateBadge();
    console.log(`${LOG_PREFIX} [Flowtime] Resumed`);
  }

  /**
   * Abort an active Flowtime session silently (no break card, no history record).
   * Used by the Pomodoro mutex: when start() is called while Flowtime is active.
   *
   * @internal — called by start() only; not part of the public API.
   */
  private static async _abortFlowtime(): Promise<void> {
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_END);
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);

    const state = (await Storage.get<PomodoroState>('pomodoroState')) || getDefaultState();
    await Storage.set('pomodoroState', {
      ...state,
      isActive: false,
      isPaused: false,
      mode: undefined,
      startTime: undefined,
      endTime: 0,
      pausedRemaining: 0,
    });
    await chrome.action.setBadgeText({ text: '' });
    console.log(`${LOG_PREFIX} [Flowtime] Aborted (Pomodoro mutex)`);
  }

  // ---------------------------------------------------------------------------
  // Phase 12 (Plan 12-04): Break-card state machine methods
  // ---------------------------------------------------------------------------

  /**
   * Called from the break card "Start break" button.
   *
   * FT3: Uses mode='flowtime-break' — an isolated countdown that:
   *   - Does NOT advance sessionsCompleted or touch Pomodoro cycle counters.
   *   - Does NOT record a session in pomodoroHistory.
   *   - On completion (POMODORO_END alarm) or manual stop: returns to idle.
   *     No auto-advance to the next Pomodoro work session.
   *
   * Break minutes are user-chosen (may differ from PomodoroSettings.customShortBreak);
   * written directly into endTime so the user's choice is honored even if their
   * Pomodoro settings specify a different shortBreak value.
   *
   * @param minutes - User-confirmed break duration (possibly edited from proposal)
   */
  static async startProposedBreak(minutes: number): Promise<void> {
    if (minutes <= 0) {
      console.warn(`${LOG_PREFIX} [Flowtime] startProposedBreak: invalid minutes=${minutes}, no-op`);
      return;
    }

    // Clear the transient break proposal from storage
    await Storage.remove(FLOWTIME_BREAK_PROPOSAL_KEY);

    // Build PomodoroState directly with user-chosen duration — bypass start() to
    // avoid reading customShortBreak from PomodoroSettings (ADHD-25: user's edit wins).
    const state = (await Storage.get<PomodoroState>('pomodoroState')) || getDefaultState();
    const endTime = Date.now() + minutes * 60 * 1000;

    // Race condition safety: always clear before create
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_END);
    await chrome.alarms.clear(ALARM_NAMES.POMODORO_TICK);

    await chrome.alarms.create(ALARM_NAMES.POMODORO_END, { when: endTime });
    await chrome.alarms.create(ALARM_NAMES.POMODORO_TICK, {
      delayInMinutes: 0.08,
      periodInMinutes: 0.5,
    });

    // FT3: mode='flowtime-break' prevents handleSessionEnd from auto-advancing
    // to a Pomodoro work session and prevents session recording in pomodoroHistory.
    const breakState: PomodoroState = {
      ...state,
      isActive: true,
      isPaused: false,
      sessionType: 'shortBreak',
      mode: 'flowtime-break',
      startTime: undefined,
      endTime,
      pausedRemaining: 0,
      preset: 'custom',
    };
    await Storage.set('pomodoroState', breakState);
    await PomodoroService.updateBadge();

    console.log(`${LOG_PREFIX} [Flowtime] Started ${minutes}min Flowtime break (isolated countdown, no Pomodoro auto-advance)`);
  }

  /**
   * Called from the break card "Skip" button.
   *
   * Clears flowtime_break_proposal from storage; no break session started.
   * PomodoroState stays inactive (stopFlowtime already cleared it when the
   * Flowtime session ended and the proposal was written).
   */
  static async skipProposedBreak(): Promise<void> {
    await Storage.remove(FLOWTIME_BREAK_PROPOSAL_KEY);
    console.log(`${LOG_PREFIX} [Flowtime] Break proposal skipped`);
  }

  /**
   * Read current flowtime_break_proposal from storage.
   * Returns null if absent or cleared.
   *
   * UI polls this via storage.onChanged (same pattern as PomodoroState consumption
   * in PomodoroBar) — see Plan 12-05 FlowtimeBreakCard implementation.
   */
  static async getFlowtimeBreakProposal(): Promise<FlowtimeBreakProposal | null> {
    return (await Storage.get<FlowtimeBreakProposal>(FLOWTIME_BREAK_PROPOSAL_KEY)) ?? null;
  }
}
