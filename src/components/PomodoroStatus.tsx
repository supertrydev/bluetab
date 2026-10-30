/**
 * @module components/PomodoroStatus
 *
 * WHY:  Users need a quick glance at their Pomodoro timer from popup and
 *       new tab — not full controls, just status awareness.
 *
 * WHAT: Compact single-line bar showing "Session active: MM:SS" with
 *       small Pause/Stop icon buttons. Only renders when a session is active.
 *
 * HOW:  Same storage listener + 1-second local interval pattern as PomodoroBar.
 *       Returns null when no active session.
 *
 * NOT:  Not the primary control surface (that's PomodoroBar in sidepanel).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Timer, Pause, Play, Square } from 'lucide-react';
import { PomodoroService } from '@/services/pomodoro-service';
import type { PomodoroState } from '@/types/productivity';
import { useTranslation } from 'react-i18next';

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function PomodoroStatus() {
  const { t } = useTranslation();
  const [state, setState] = useState<PomodoroState | null>(null);
  const [remaining, setRemaining] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load initial state
  useEffect(() => {
    PomodoroService.getState().then(setState);
  }, []);

  // Listen for storage changes
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.pomodoroState) {
        setState(changes.pomodoroState.newValue);
      }
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  // 1-second countdown interval
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!state?.isActive) {
      setRemaining(0);
      return;
    }

    if (state.isPaused) {
      setRemaining(state.pausedRemaining);
      return;
    }

    setRemaining(Math.max(0, state.endTime - Date.now()));

    intervalRef.current = setInterval(() => {
      setRemaining(Math.max(0, state.endTime - Date.now()));
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state?.isActive, state?.isPaused, state?.endTime, state?.pausedRemaining]);

  const handlePause = useCallback(async () => {
    await PomodoroService.pause();
  }, []);

  const handleResume = useCallback(async () => {
    await PomodoroService.resume();
  }, []);

  const handleStop = useCallback(async () => {
    await PomodoroService.stop();
  }, []);

  if (!state?.isActive) return null;

  const isWork = state.sessionType === 'work';

  return (
    <div
      className={`flex items-center justify-between px-2 py-1 border-b border-border text-xs ${
        isWork
          ? 'bg-red-50 dark:bg-red-900/20'
          : 'bg-green-50 dark:bg-green-900/20'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Timer className="w-3 h-3 text-muted-foreground" />
        <span className="text-muted-foreground">
          {t('components.pomodoroStatus.sessionActive')}{' '}
          <span dir="ltr" className="font-mono font-medium text-foreground">
            {formatTime(remaining)}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        {state.isPaused ? (
          <button
            onClick={handleResume}
            className="p-0.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            title={t('sidepanel.pomodoroBar.resume')}
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={handlePause}
            className="p-0.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            title={t('sidepanel.pomodoroBar.pause')}
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={handleStop}
          className="p-0.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          title={t('sidepanel.pomodoroBar.stop')}
        >
          <Square className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
