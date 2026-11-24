/**
 * @module sidepanel/components/FlowtimeBreakRunning
 *
 * WHY:  FT3 — Flowtime break must use an isolated 'flowtime-break' mode that does
 *       NOT display the "N/4" Pomodoro session counter and does NOT auto-advance
 *       to a Pomodoro work session after the break ends.
 *
 * WHAT: Countdown display for an in-progress Flowtime break.
 *       - Shows MM:SS countdown from state.endTime.
 *       - Stop button calls PomodoroService.stop() which returns state to idle.
 *       - No session counter. No Pomodoro cycle UI.
 *
 * HOW:  - Receives PomodoroState as prop (passed from PomodoroBar slot-swap).
 *       - Local 1-second interval for display.
 *       - Stop button calls PomodoroService.stop().
 *
 * NOT:  Does not render audio or fullscreen (ADHD-29).
 *       Does not show N/4 counter (FT3 — flowtime-break is Pomodoro-isolated).
 *
 * SAFETY-02: Copy is neutral. "Break" / "Stop" — no forbidden words.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PomodoroService } from '@/services/pomodoro-service';
import type { PomodoroState } from '@/types/productivity';

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface FlowtimeBreakRunningProps {
  state: PomodoroState;
}

export function FlowtimeBreakRunning({ state }: FlowtimeBreakRunningProps) {
  const { t } = useTranslation();
  const [remainingMs, setRemainingMs] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const endTime = state.endTime;

    // Set immediately to avoid 1-second blank flicker
    setRemainingMs(Math.max(0, endTime - Date.now()));

    intervalRef.current = setInterval(() => {
      setRemainingMs(Math.max(0, endTime - Date.now()));
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state.endTime]);

  const handleStop = useCallback(async () => {
    await PomodoroService.stop();
  }, []);

  return (
    <div className="mb-2 rounded-lg border border-border bg-bg-1 px-4 py-3" data-testid="flowtime-break-running">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-success">
            {t('sidepanel.flowtimeBreakRunning.break')}
          </span>
          <span className="text-lg font-mono font-medium text-foreground tabular-nums">
            {formatCountdown(remainingMs)}
          </span>
        </div>
        <button
          type="button"
          onClick={handleStop}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-full transition-colors"
          aria-label={t('sidepanel.flowtimeBreakRunning.stopAria')}
        >
          <Square className="w-3.5 h-3.5" />
          {t('sidepanel.pomodoroBar.stop')}
        </button>
      </div>
    </div>
  );
}
