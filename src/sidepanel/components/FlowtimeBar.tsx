/**
 * @module sidepanel/components/FlowtimeBar
 *
 * WHY:  When Flowtime Timer is enabled and a session is active, this component
 *       replaces the PomodoroBar slot. It shows elapsed time (count-up) and
 *       Pause / Resume / Stop buttons.
 *
 * WHAT: Count-up MM:SS display + Pause/Resume icon + Stop icon (no text labels).
 *       Reads startTime + isPaused from PomodoroState.
 *
 * HOW:  - Receives PomodoroState as a prop (matches PomodoroBar's existing pattern)
 *       - Local 1-second setInterval for elapsed display when not paused
 *       - When paused: interval clears; elapsed is fixed at pausedRemaining value
 *         (PomodoroService.pauseFlowtime stores elapsed ms in pausedRemaining)
 *       - Pause button → PomodoroService.pauseFlowtime()
 *       - Resume button → PomodoroService.resumeFlowtime()
 *       - Stop button → PomodoroService.stopFlowtime()
 *
 * NOT:  Does not manage alarms (PomodoroService handles POMODORO_TICK for badge).
 *       Does not render any audio or fullscreen (ADHD-29).
 *       Copy is SAFETY-02 safe: no forbidden words in tooltips.
 *
 * L-fix: Pause/Resume added; Stop is icon-only (no text); separators removed.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Pause, Play, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PomodoroService } from '@/services/pomodoro-service';
import type { PomodoroState } from '@/types/productivity';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface FlowtimeBarProps {
  state: PomodoroState;
}

export function FlowtimeBar({ state }: FlowtimeBarProps) {
  const { t } = useTranslation();
  const [elapsedMs, setElapsedMs] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPaused = state.isPaused ?? false;

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isPaused) {
      // When paused: show elapsed at pause time (stored in pausedRemaining by pauseFlowtime)
      setElapsedMs(state.pausedRemaining ?? 0);
      return;
    }

    const startTime = state.startTime ?? Date.now();

    // Set immediately to avoid 1-second blank flicker
    setElapsedMs(Math.max(0, Date.now() - startTime));

    intervalRef.current = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startTime));
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state.startTime, state.pausedRemaining, isPaused]);

  const handlePause = useCallback(async () => {
    await PomodoroService.pauseFlowtime();
  }, []);

  const handleResume = useCallback(async () => {
    await PomodoroService.resumeFlowtime();
  }, []);

  const handleStop = useCallback(async () => {
    await PomodoroService.stopFlowtime();
    // stopFlowtime writes flowtime_break_proposal to storage.
    // PomodoroBar's storage.onChanged listener picks it up and swaps to FlowtimeBreakCard.
  }, []);

  const btnBase = 'flex items-center justify-center p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors';

  return (
    <div className="mb-2 px-3 py-2" data-testid="flowtime-bar">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-micro font-medium text-blue-500 uppercase tracking-wide">
            {t('sidepanel.flowtimeBar.elapsed')}
          </span>
          <span className="text-lg font-mono font-semibold text-foreground tabular-nums">
            {formatElapsed(elapsedMs)}
          </span>
        </div>
        {/* L-fix: icon-only controls; Pause morphs to Resume when paused */}
        <div className="flex items-center gap-1" data-testid="flowtime-controls">
          {isPaused ? (
            <button
              type="button"
              onClick={handleResume}
              className={btnBase}
              aria-label={t('sidepanel.flowtimeBar.resumeAria')}
              title={t('sidepanel.flowtimeBar.resume')}
              data-testid="flowtime-resume-btn"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePause}
              className={btnBase}
              aria-label={t('sidepanel.flowtimeBar.pauseAria')}
              title={t('sidepanel.flowtimeBar.pause')}
              data-testid="flowtime-pause-btn"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}
          {/* L2-fix: Stop is icon-only (no "Stop" text), tooltip only */}
          <button
            type="button"
            onClick={handleStop}
            className={btnBase}
            aria-label={t('sidepanel.flowtimeBar.stopAria')}
            title={t('sidepanel.flowtimeBar.stop')}
            data-testid="flowtime-stop-btn"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
