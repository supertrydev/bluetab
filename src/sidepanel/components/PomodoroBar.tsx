/**
 * @module sidepanel/components/PomodoroBar
 *
 * WHY:  The sidepanel is the primary Pomodoro control surface. Users need a
 *       persistent, always-visible timer that starts with one click and shows
 *       live countdown without opening a separate page.
 *
 * WHAT: Collapsible bar between SidepanelHeader and Tabs. Idle state shows
 *       "Start Pomodoro" button. Active state expands to show countdown,
 *       session type, pause/resume, stop, and session counter.
 *
 * HOW:  - PomodoroService.getState() on mount for initial state
 *       - chrome.storage.local.onChanged listener for real-time updates
 *       - Local 1-second setInterval for countdown display (not alarm-driven)
 *       - framer-motion AnimatePresence for expand/collapse
 *
 * NOT:  Does not manage alarms or badge — that's PomodoroService + service worker.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Timer, Play, Pause, Square, Shield, Coffee, Moon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { PomodoroService } from '@/services/pomodoro-service';
import { FocusService } from '@/services/focus-service';
import { ADHDService } from '@/services/adhd-service';
import { Storage } from '@/utils/storage';
import type { PomodoroState, PomodoroSettings, FocusState } from '@/types/productivity';
import { POMODORO_PRESETS } from '@/types/productivity';
import { VisualTimeDisc } from './VisualTimeDisc';
import { FlowtimeBar } from './FlowtimeBar';
import { FlowtimeBreakCard } from './FlowtimeBreakCard';
import { FlowtimeBreakRunning } from './FlowtimeBreakRunning';
import { HardFocusButton } from './HardFocusButton';
import type { FlowtimeBreakProposal } from '@/services/flowtime-helpers';
import { FLOWTIME_BREAK_PROPOSAL_KEY } from '@/services/flowtime-helpers';
import { useTranslation } from 'react-i18next';

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getSessionLabel(
  type: PomodoroState['sessionType'],
  t: (key: string) => string,
): string {
  switch (type) {
    case 'work':
      return t('sidepanel.pomodoroBar.work');
    case 'shortBreak':
      return t('sidepanel.pomodoroBar.shortBreak');
    case 'longBreak':
      return t('sidepanel.pomodoroBar.longBreak');
  }
}

/**
 * Derive the total session duration (ms) from the current PomodoroState +
 * PomodoroSettings pair. Inline arithmetic per Plan 09-05 Task 2 — no
 * external helper symbol introduced.
 *
 * Field names (confirmed against pomodoro-service.ts):
 *   - state.sessionType : 'work' | 'shortBreak' | 'longBreak'
 *   - settings.preset   : 'classic' | 'short' | 'deepWork' | 'custom'
 *   - custom durations  : settings.customWork / customShortBreak / customLongBreak
 *   - preset durations  : POMODORO_PRESETS[settings.preset]
 *
 * NOTE: this mirrors the pomodoro-service.ts getPresetDurations + getSessionDuration
 * pair — we re-derive it inline here (rather than exporting a helper) because the
 * service keeps those helpers private and Plan 09-05 is explicit that no new
 * helper symbol is introduced.
 */
function computeTotalMsInline(
  state: PomodoroState,
  settings: PomodoroSettings | null,
): number {
  const preset = settings?.preset ?? 'classic';
  const durations =
    preset === 'custom' && settings
      ? {
          work: settings.customWork,
          shortBreak: settings.customShortBreak,
          longBreak: settings.customLongBreak,
        }
      : POMODORO_PRESETS[preset];
  const minutes =
    state.sessionType === 'work'
      ? durations.work
      : state.sessionType === 'shortBreak'
        ? durations.shortBreak
        : durations.longBreak;
  return minutes * 60_000;
}

export function PomodoroBar() {
  const { t } = useTranslation();
  const translate = (key: string) => t(key as never) as unknown as string;
  const [state, setState] = useState<PomodoroState | null>(null);
  const [settings, setSettings] = useState<PomodoroSettings | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [focusActive, setFocusActive] = useState(false);
  // ADHD Visual Time — swap the linear bar for VisualTimeDisc when both
  // master ADHD Mode AND the visualTime sub-toggle are ON (ADHD-28 gate).
  const [visualTimeEnabled, setVisualTimeEnabled] = useState(false);
  const [colorBlindSafe, setColorBlindSafe] = useState(false);
  // Phase 12: Flowtime Timer — slot-swap states
  const [flowtimeEnabled, setFlowtimeEnabled] = useState(false);
  const [flowtimeBreakProposal, setFlowtimeBreakProposal] =
    useState<FlowtimeBreakProposal | null>(null);
  // Phase 12: Hard Focus enabled state (for U3 row split)
  const [hardFocusEnabled, setHardFocusEnabled] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load initial state
  useEffect(() => {
    PomodoroService.getState().then(setState);
    Storage.get<PomodoroSettings>('pomodoroSettings').then((s) => setSettings(s ?? null));
    FocusService.getState().then((fs) => setFocusActive(fs.isActive));
    // ADHD — read once; the subscribe below keeps it in sync after mount.
    ADHDService.getSettings().then((adhd) => {
      setVisualTimeEnabled(adhd.masterEnabled && adhd.visualTime.enabled);
      setColorBlindSafe(adhd.visualTime.colorBlindSafe);
      // Phase 12: Flowtime Timer and Hard Focus
      setFlowtimeEnabled(adhd.masterEnabled && (adhd.flowtimeTimer?.enabled ?? false));
      setHardFocusEnabled(adhd.masterEnabled && (adhd.hardFocus?.enabled ?? false));
    });
    // Phase 12: read transient break proposal from storage on mount
    Storage.get<FlowtimeBreakProposal>(FLOWTIME_BREAK_PROPOSAL_KEY).then((proposal) => {
      setFlowtimeBreakProposal(proposal ?? null);
    });
  }, []);

  // Listen for storage changes
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.pomodoroState) {
        setState(changes.pomodoroState.newValue);
      }
      if (changes.pomodoroSettings) {
        setSettings(changes.pomodoroSettings.newValue as PomodoroSettings);
      }
      if (changes.focusState) {
        const newFocusState = changes.focusState.newValue as FocusState;
        setFocusActive(newFocusState?.isActive || false);
      }
      // Phase 12: Flowtime break proposal — when stopFlowtime() writes this key,
      // swap to FlowtimeBreakCard in the slot; when startProposedBreak/skipProposedBreak
      // deletes it (sets to undefined/null), return to idle.
      if (FLOWTIME_BREAK_PROPOSAL_KEY in changes) {
        const newProposal = changes[FLOWTIME_BREAK_PROPOSAL_KEY].newValue as FlowtimeBreakProposal | undefined;
        setFlowtimeBreakProposal(newProposal ?? null);
      }
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  // ADHD-28: subscribe to ADHDService so Visual Time flips live without
  // requiring a sidepanel reload. Master-gate enforced in-line.
  // Phase 12: also tracks flowtimeEnabled for the slot-swap.
  useEffect(() => {
    const unsubscribe = ADHDService.subscribe((next) => {
      setVisualTimeEnabled(next.masterEnabled && next.visualTime.enabled);
      setColorBlindSafe(next.visualTime.colorBlindSafe);
      setFlowtimeEnabled(next.masterEnabled && (next.flowtimeTimer?.enabled ?? false));
      setHardFocusEnabled(next.masterEnabled && (next.hardFocus?.enabled ?? false));
    });
    return unsubscribe;
  }, []);

  // 1-second countdown interval (Pomodoro mode only).
  // Flowtime mode has no countdown — FlowtimeBar manages its own count-up interval.
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Skip countdown if Flowtime is active (count-up is FlowtimeBar's job)
    if (!state?.isActive || state.mode === 'flowtime') {
      setRemaining(0);
      return;
    }

    if (state.isPaused) {
      setRemaining(state.pausedRemaining);
      return;
    }

    // Calculate and set immediately
    setRemaining(Math.max(0, state.endTime - Date.now()));

    intervalRef.current = setInterval(() => {
      const r = Math.max(0, state.endTime - Date.now());
      setRemaining(r);
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state?.isActive, state?.isPaused, state?.endTime, state?.pausedRemaining, state?.mode]);

  const handleStart = useCallback(async (type?: PomodoroState['sessionType']) => {
    await PomodoroService.start(type);
  }, []);

  const handleStartFlowtime = useCallback(async () => {
    await PomodoroService.startFlowtime();
  }, []);

  const handlePause = useCallback(async () => {
    await PomodoroService.pause();
  }, []);

  const handleResume = useCallback(async () => {
    await PomodoroService.resume();
  }, []);

  const handleStop = useCallback(async () => {
    await PomodoroService.stop();
  }, []);

  const isWork = state?.sessionType === 'work';

  // Phase 12 — Flowtime slot-swap (highest priority in the render order):
  // 1. FlowtimeBreakCard: Flowtime enabled AND break proposal in storage (post-stop).
  // 2. FlowtimeBar: Flowtime enabled AND session is active (count-up running).
  // Both supersede Visual Time (Visual Time is Pomodoro-only).
  //
  // G-fix: when hardFocusEnabled, ALL slots use a 50/50 grid — left half renders
  // the timer content, right half renders HardFocusButton. This applies to idle,
  // running, break-card, and break-running states. The Hard Focus button is NEVER
  // hidden while the timer is active (CONTINUATION-2 §G).

  // Slot 1: Flowtime break card (flowtimeEnabled + break proposal present)
  if (flowtimeEnabled && flowtimeBreakProposal != null) {
    return (
      <div className="mb-2">
        {hardFocusEnabled ? (
          <div className="flex items-stretch w-full">
            <div className="flex-1 min-w-0">
              <FlowtimeBreakCard proposal={flowtimeBreakProposal} />
            </div>
            <div className="flex items-stretch border-s border-border/40" data-testid="hard-focus-slot">
              <HardFocusButton />
            </div>
          </div>
        ) : (
          <FlowtimeBreakCard proposal={flowtimeBreakProposal} />
        )}
      </div>
    );
  }

  // Slot 2: Flowtime active bar (flowtimeEnabled + state.mode === 'flowtime' + isActive)
  if (flowtimeEnabled && state?.mode === 'flowtime' && state?.isActive) {
    return (
      <div className="mb-2">
        {hardFocusEnabled ? (
          <div className="flex items-stretch w-full">
            <div className="flex-1 min-w-0">
              <FlowtimeBar state={state} />
            </div>
            <div className="flex items-stretch border-s border-border/40" data-testid="hard-focus-slot">
              <HardFocusButton />
            </div>
          </div>
        ) : (
          <FlowtimeBar state={state} />
        )}
      </div>
    );
  }

  // Slot 2b: Flowtime break running (FT3 — isolated flowtime-break countdown).
  // Renders whenever mode='flowtime-break' is active, regardless of flowtimeEnabled toggle.
  // This prevents the Pomodoro N/4 counter from appearing during a Flowtime-proposed break.
  if (state?.mode === 'flowtime-break' && state?.isActive) {
    return (
      <div className="mb-2">
        {hardFocusEnabled ? (
          <div className="flex items-stretch w-full">
            <div className="flex-1 min-w-0">
              <FlowtimeBreakRunning state={state} />
            </div>
            <div className="flex items-stretch border-s border-border/40" data-testid="hard-focus-slot">
              <HardFocusButton />
            </div>
          </div>
        ) : (
          <FlowtimeBreakRunning state={state} />
        )}
      </div>
    );
  }

  // ADHD-28: when Visual Time is enabled AND the Pomodoro is active, swap
  // the linear bar for the shrinking disc. Exactly ONE element renders in
  // this slot per Plan 09-05 CONTEXT.md lock — bar OR disc, never both.
  // Pause/skip/stop controls reposition beside the disc so the user still
  // has full timer control without the bar's own chrome.
  if (visualTimeEnabled && state?.isActive) {
    const totalMs = computeTotalMsInline(state, settings);
    // The existing useEffect already keeps `remaining` in sync at 1s.
    const remainingMs = state.isPaused ? state.pausedRemaining : remaining;

    const visualTimeContent = (
      <div className="px-3 py-2">
        <div className="flex items-center gap-3">
          <VisualTimeDisc
            remainingMs={remainingMs}
            totalMs={totalMs}
            colorBlindSafe={colorBlindSafe}
          />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                  isWork
                    ? 'bg-red-500/10 text-red-500'
                    : 'bg-green-500/10 text-green-500'
                }`}
              >
                {getSessionLabel(state.sessionType, translate)}
              </span>
              {focusActive && (
                <span title={t('sidepanel.pomodoroBar.focusModeActive')}>
                  <Shield className="w-4 h-4" style={{ color: '#f97316' }} />
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {state.isPaused ? (
                <button
                  onClick={handleResume}
                  className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                  title={t('sidepanel.pomodoroBar.resume')}
                  aria-label={t('sidepanel.pomodoroBar.resumePomodoro')}
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={handlePause}
                  className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                  title={t('sidepanel.pomodoroBar.pause')}
                  aria-label={t('sidepanel.pomodoroBar.pausePomodoro')}
                >
                  <Pause className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={handleStop}
                className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                title={t('sidepanel.pomodoroBar.stop')}
                aria-label={t('sidepanel.pomodoroBar.stopPomodoro')}
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              {t('sidepanel.pomodoroBar.sessionCounter', {
                current: state.sessionType === 'work' ? (state.sessionsCompleted ?? 0) + 1 : (state.sessionsCompleted ?? 0),
                total: 4,
              })}
            </div>
          </div>
        </div>
      </div>
    );

    return (
      <div className="mb-2">
        {hardFocusEnabled ? (
          <div className="flex items-stretch w-full">
            <div className="flex-1 min-w-0">
              {visualTimeContent}
            </div>
            <div className="flex items-stretch border-s border-border/40" data-testid="hard-focus-slot">
              <HardFocusButton />
            </div>
          </div>
        ) : (
          visualTimeContent
        )}
      </div>
    );
  }

  return (
    <div className="mb-2">
      <AnimatePresence mode="wait">
        {!state?.isActive ? (
          <motion.div
            key="idle"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className={hardFocusEnabled ? "flex justify-between items-center w-full" : "flex justify-center w-full"}
          >
            {/* R-fix: justify-center when HF off (single element row centers naturally).
                justify-between when HF on (timer left, HF button right, space between).
                U2: Three icon-only buttons for Pomodoro idle row.
                Phase 12: when flowtimeEnabled, primary is Flowtime (Timer icon).
                When Pomodoro mode: Timer = start work, Coffee = short break, Moon = long break.
                U1: NO text labels on these buttons; tooltips for accessibility. */}
            <div className="flex items-center" data-testid="pomodoro-idle-row">
              {flowtimeEnabled ? (
                /* M2-fix: natural width button (no flex-1 stretch). */
                <button
                  onClick={handleStartFlowtime}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                  title={t('sidepanel.pomodoroBar.startFlowtime')}
                  aria-label={t('sidepanel.pomodoroBar.startFlowtimeAria')}
                  data-testid="start-flowtime-btn"
                >
                  <Timer className="w-4 h-4 shrink-0" />
                  <span>{t('sidepanel.pomodoroBar.startFlowtime')}</span>
                </button>
              ) : (
                /* Pomodoro mode: three icon-only buttons — U2, L3-fix (no separators) */
                <>
                  <button
                    onClick={() => handleStart('work')}
                    className="flex items-center justify-center px-2 py-2 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                    title={t('sidepanel.pomodoroBar.startPomodoro')}
                    aria-label={t('sidepanel.pomodoroBar.startPomodoroAria')}
                    data-testid="start-pomodoro-btn"
                  >
                    <Timer className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleStart('shortBreak')}
                    className="flex items-center justify-center px-2 py-2 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                    title={t('sidepanel.pomodoroBar.startShortBreak')}
                    aria-label={t('sidepanel.pomodoroBar.startShortBreakAria')}
                    data-testid="start-short-break-btn"
                  >
                    <Coffee className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleStart('longBreak')}
                    className="flex items-center justify-center px-2 py-2 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                    title={t('sidepanel.pomodoroBar.startLongBreak')}
                    aria-label={t('sidepanel.pomodoroBar.startLongBreakAria')}
                    data-testid="start-long-break-btn"
                  >
                    <Moon className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
            {/* M2-fix: HF button takes its natural width; no border-s forced separator.
                justify-between on the outer row provides space between timer and HF button. */}
            {hardFocusEnabled && (
              <div className="flex items-center" data-testid="hard-focus-slot">
                <HardFocusButton />
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="active"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-stretch w-full"
          >
            {/* G-fix: active Pomodoro timer in left half; HardFocusButton in right half
                when hardFocusEnabled. Both halves visible during active session. */}
            <div className="flex-1 min-w-0 px-3 py-2 space-y-1">
              {/* Session type + countdown */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      isWork
                        ? 'bg-red-500/10 text-red-500'
                        : 'bg-green-500/10 text-green-500'
                    }`}
                  >
                    {state ? getSessionLabel(state.sessionType, translate) : ''}
                  </span>
                  {focusActive && (
                    <span title={t('sidepanel.pomodoroBar.focusModeActive')}>
                      <Shield
                        className="w-4 h-4"
                        style={{ color: '#f97316' }}
                      />
                    </span>
                  )}
                  <span dir="ltr" className="text-sm font-mono font-semibold text-foreground">
                    {formatTime(remaining)}
                  </span>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-1">
                  {state?.isPaused ? (
                    <button
                      onClick={handleResume}
                      className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                      title={t('sidepanel.pomodoroBar.resume')}
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={handlePause}
                      className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                      title={t('sidepanel.pomodoroBar.pause')}
                    >
                      <Pause className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={handleStop}
                    className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                    title={t('sidepanel.pomodoroBar.stop')}
                  >
                    <Square className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Session counter */}
              <div className="text-xs text-muted-foreground">
                {t('sidepanel.pomodoroBar.sessionCounter', {
                  current: state?.sessionType === 'work' ? (state?.sessionsCompleted ?? 0) + 1 : (state?.sessionsCompleted ?? 0),
                  total: 4,
                })}
              </div>
            </div>
            {hardFocusEnabled && (
              <div className="flex items-stretch border-s border-border/40" data-testid="hard-focus-slot">
                <HardFocusButton />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
