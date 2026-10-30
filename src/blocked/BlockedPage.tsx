/**
 * @module blocked/BlockedPage
 *
 * WHY:  When a user navigates to a blocked domain during Focus mode, they need
 *       a branded, encouraging page instead of a harsh browser error. The page
 *       shows remaining focus time, a motivational message, and clear actions
 *       (go back to newtab, or end focus with confirmation friction).
 *
 * WHAT: Full-screen block page with countdown timer, domain name display,
 *       rotating motivational messages, Go Back and End Focus buttons.
 *
 * HOW:  - Reads blocked domain from URL search params
 *       - Reads PomodoroState for countdown via PomodoroService.getState()
 *       - 1-second interval updates countdown display
 *       - Listens to chrome.storage.onChanged for pomodoroState changes
 *       - Auto-redirects when focus session ends while on block page
 *       - Go Back navigates to newtab (not history.back to avoid redirect loops)
 *       - End Focus shows confirmation before calling FocusService.disable()
 *
 * NOT:  Does not manage the blocking rules (see services/focus-service.ts).
 *       Does not render inside popup or sidepanel.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, ArrowLeft, XCircle } from 'lucide-react';
import { PomodoroService } from '@/services/pomodoro-service';
import { FocusService } from '@/services/focus-service';
import { HardFocusService } from '@/services/hard-focus-service';
import type { PomodoroState, HardFocusState } from '@/types/productivity';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatRemainingText(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function extractOriginalUrlFromLocation(loc: Location): string | null {
  // New Hard Focus transport: #url=<raw-original-url>
  if (loc.hash.startsWith('#url=')) {
    const fromHash = loc.hash.slice('#url='.length);
    if (!fromHash) return null;
    try {
      return decodeURIComponent(fromHash);
    } catch {
      return fromHash;
    }
  }

  // Legacy transport fallback: ?url=<raw-original-url>
  // This can contain '?' and '&' as raw characters, so URLSearchParams may split it.
  const marker = '?url=';
  const markerIndex = loc.href.indexOf(marker);
  if (markerIndex >= 0) {
    let raw = loc.href.slice(markerIndex + marker.length);
    const hashIndex = raw.indexOf('#');
    if (hashIndex >= 0) {
      raw = raw.slice(0, hashIndex);
    }
    if (raw) return raw;
  }

  return null;
}

const BlockedPage = () => {
  const { t } = useTranslation();
  const [pomodoroState, setPomodoroState] = useState<PomodoroState | null>(null);
  const [hardFocusState, setHardFocusState] = useState<HardFocusState | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Read blocked domain and original URL.
  // Phase 6 Focus passes ?domain=...&url=... (both set).
  // Hard Focus now passes #url=<originalUrl> to avoid query-splitting bugs.
  // Legacy Hard Focus ?url=<originalUrl> is still supported via raw href parsing.
  // When domain is absent, derive it from the original URL's hostname.
  const { domain, originalUrl } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const url = extractOriginalUrlFromLocation(window.location) || params.get('url');
    let domain = params.get('domain');
    if (!domain && url) {
      try {
        domain = new URL(url).hostname;
      } catch {
        // Malformed URL — fall through to fallback
      }
    }
    return {
      domain: domain || t('blocked.siteFallback'),
      originalUrl: url || null,
    };
  }, [t]);

  // Pick a random motivational message on mount
  const motivationalMessage = useMemo(() => {
    const messages = [
      t('blocked.motivations.0'),
      t('blocked.motivations.1'),
      t('blocked.motivations.2'),
      t('blocked.motivations.3'),
      t('blocked.motivations.4'),
      t('blocked.motivations.5'),
      t('blocked.motivations.6'),
      t('blocked.motivations.7'),
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }, [t]);
  const headingParts = useMemo(
    () => String(t('blocked.heading', { domain })).split(domain),
    [domain, t],
  );

  // Load initial Pomodoro state
  useEffect(() => {
    PomodoroService.getState().then(setPomodoroState);
  }, []);

  // Load initial Hard Focus state
  useEffect(() => {
    HardFocusService.getState().then(setHardFocusState);
  }, []);

  // Listen for storage changes (pomodoroState + focusState + hardFocusState updates)
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.pomodoroState) {
        const newState = changes.pomodoroState.newValue as PomodoroState;
        setPomodoroState(newState);
      }
      // Redirect when Phase 6 global Focus ends
      if (changes.focusState) {
        const newFocus = changes.focusState.newValue;
        if (!newFocus?.isActive) {
          setSessionEnded(true);
          setTimeout(() => {
            window.location.href = originalUrl || `https://${domain}`;
          }, 2000);
        }
      }
      // Redirect when Hard Focus ends
      if (changes.hardFocusState) {
        const newHardFocus = changes.hardFocusState.newValue as HardFocusState;
        setHardFocusState(newHardFocus);
        if (!newHardFocus?.isActive) {
          setSessionEnded(true);
          setTimeout(() => {
            window.location.href = originalUrl || `https://${domain}`;
          }, 2000);
        }
      }
    };

    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, [domain, originalUrl]);

  // 1-second countdown interval
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!pomodoroState?.isActive) {
      setRemaining(0);
      return;
    }

    if (pomodoroState.isPaused) {
      setRemaining(pomodoroState.pausedRemaining);
      return;
    }

    setRemaining(Math.max(0, pomodoroState.endTime - Date.now()));

    intervalRef.current = setInterval(() => {
      setRemaining(Math.max(0, pomodoroState.endTime - Date.now()));
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pomodoroState?.isActive, pomodoroState?.isPaused, pomodoroState?.endTime, pomodoroState?.pausedRemaining]);

  // Go Back: navigate to newtab (NOT history.back to avoid redirect loops)
  const handleGoBack = useCallback(() => {
    const newtabUrl = chrome.runtime.getURL('src/newtab/index.html');
    window.location.href = newtabUrl;
  }, []);

  // End Focus: stop whichever focus session(s) are active, then redirect.
  // Hard Focus and global Focus can coexist (12-CONTEXT.md). Each is stopped
  // independently. If neither is definitively known to be active, both are stopped
  // (defensive — block page should always let the user escape).
  const handleEndFocus = useCallback(async () => {
    if (hardFocusState?.isActive) {
      await HardFocusService.stop();
    }
    await FocusService.disable();
    window.location.href = originalUrl || `https://${domain}`;
  }, [domain, originalUrl, hardFocusState]);

  // Session ended state
  if (sessionEnded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="text-center"
        >
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center mx-auto mb-6">
            <ShieldAlert className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white mb-2">
            {t('blocked.sessionCompleteTitle')}
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            {t('blocked.redirecting', { domain: isolateBidi(domain, 'auto') })}
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
      {/* Subtle gradient background effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-1/2 -left-1/2 w-full h-full rounded-full opacity-[0.08] dark:opacity-[0.06]"
          style={{
            background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute -bottom-1/2 -right-1/2 w-full h-full rounded-full opacity-[0.06] dark:opacity-[0.04]"
          style={{
            background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)',
          }}
        />
      </div>

      {/* Main content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative z-10 flex flex-col items-center px-6 max-w-lg w-full text-center"
      >
        {/* Shield icon */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5, ease: 'easeOut' }}
          className="w-20 h-20 rounded-2xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-8 shadow-sm"
        >
          <ShieldAlert className="w-10 h-10 text-orange-600 dark:text-orange-400" />
        </motion.div>

        {/* Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mb-3"
        >
          {headingParts[0]}
          <span className="text-orange-600 dark:text-orange-400"><bdi dir="auto">{domain}</bdi></span>
          {headingParts.slice(1).join(domain)}
        </motion.h1>

        {/* Countdown timer */}
        {pomodoroState?.isActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="mb-6"
          >
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
              {pomodoroState.isPaused
                ? t('blocked.timerPaused')
                : t('blocked.remainingInSession')}
            </p>
            <div dir="ltr" className="text-5xl md:text-6xl font-mono font-bold text-slate-900 dark:text-white tracking-tight">
              {formatCountdown(remaining)}
            </div>
          </motion.div>
        )}

        {/* Motivational message */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="text-lg text-slate-500 dark:text-slate-400 italic mb-10 max-w-md"
        >
          "{motivationalMessage}"
        </motion.p>

        {/* Action buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="flex flex-col sm:flex-row gap-3 w-full max-w-sm"
        >
          {/* Go Back button */}
          <button
            onClick={handleGoBack}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl
              bg-blue-600 hover:bg-blue-700 active:bg-blue-800
              text-white font-medium text-sm
              transition-colors shadow-sm hover:shadow-md"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
            {t('blocked.goBack')}
          </button>

          {/* End Focus button */}
          {!showEndConfirm ? (
            <button
              onClick={() => setShowEndConfirm(true)}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl
                bg-transparent border border-slate-300 dark:border-slate-600
                text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200
                hover:border-slate-400 dark:hover:border-slate-500
                font-medium text-sm transition-colors"
            >
              <XCircle className="w-4 h-4" />
              {t('blocked.endFocus')}
            </button>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col gap-2"
            >
              <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                {t('blocked.confirmEnd', {
                  remaining: isolateBidi(formatRemainingText(remaining), 'ltr'),
                })}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleEndFocus}
                  className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
                >
                  {t('blocked.confirmEndButton')}
                </button>
                <button
                  onClick={() => setShowEndConfirm(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 text-sm font-medium transition-colors hover:border-slate-400"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
};

export default BlockedPage;
