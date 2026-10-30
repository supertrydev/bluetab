/**
 * @module sidepanel/components/HardFocusButton
 *
 * WHY:  Hard Focus must be startable/stoppable from the sidepanel (ADHD-13).
 *       The button self-gates on ADHDSettings.hardFocus.enabled — if the feature
 *       is off, it renders nothing (safe to include in PomodoroBar unconditionally).
 *
 * WHAT: - Idle state: Shield icon; click → HardFocusService.start()
 *       - Active state: static filled styling (NO animation — HF2 revision)
 *         + click → opens confirm Dialog ("End Hard Focus?")
 *         + Confirm "Stop" → HardFocusService.stop()
 *
 * HOW:  - Reads HardFocusState from storage.onChanged (reactive)
 *       - Reads ADHDSettings.hardFocus.enabled via ADHDService.subscribe (reactive)
 *       - HF2: NO framer-motion animation. Active state is static fill only.
 *       - HF3: Calm styling — matches the existing "Start Pomodoro" button look
 *         (text-muted-foreground hover:text-foreground hover:bg-accent/50).
 *         Active state: subtle bg-accent/30 fill to indicate active, no orange accent.
 *       - Confirm dialog uses existing dialog.tsx (Radix Dialog)
 *       - data-testid attributes on key elements for DOM-level tests
 *
 * NOT:  Does not contain Hard Focus business logic (see HardFocusService).
 *       Does not render a header badge or ambient border (ADHD-15 per CONTEXT.md).
 *       Does NOT use framer-motion (HF2 — no animation on this button).
 *
 * SAFETY-02: Copy is neutral. "Hard Focus" / "End Hard Focus?" /
 *   "All URLs will become reachable again." / "Cancel" / "Stop" — no forbidden words.
 */

import { useState, useEffect, useCallback } from 'react';
import { Shield } from 'lucide-react';
import { HardFocusService } from '@/services/hard-focus-service';
import { ADHDService } from '@/services/adhd-service';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import type { HardFocusState } from '@/types/productivity';
import { HARD_FOCUS_STATE_KEY } from '@/services/hard-focus-service';
import { useTranslation } from 'react-i18next';

export function HardFocusButton() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [hardFocusState, setHardFocusState] = useState<HardFocusState>({
    isActive: false,
    activatedAt: 0,
    domainMode: false,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Load initial state
  useEffect(() => {
    let cancelled = false;
    ADHDService.getSettings().then((adhd) => {
      if (!cancelled) setEnabled(adhd.masterEnabled && adhd.hardFocus.enabled);
    });
    HardFocusService.getState().then((state) => {
      if (!cancelled) setHardFocusState(state);
    });
    return () => { cancelled = true; };
  }, []);

  // Subscribe to ADHD settings changes
  useEffect(() => {
    const unsubscribe = ADHDService.subscribe((adhd) => {
      setEnabled(adhd.masterEnabled && adhd.hardFocus.enabled);
    });
    return unsubscribe;
  }, []);

  // Subscribe to Hard Focus state changes via storage.onChanged
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes[HARD_FOCUS_STATE_KEY]) {
        const next = changes[HARD_FOCUS_STATE_KEY].newValue as HardFocusState | undefined;
        if (next) setHardFocusState(next);
      }
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  const handleClick = useCallback(() => {
    if (hardFocusState.isActive) {
      setConfirmOpen(true);
    } else {
      HardFocusService.start().catch((err) => {
        console.error('[BlueTab][HardFocusButton] start error:', err);
      });
    }
  }, [hardFocusState.isActive]);

  const handleStop = useCallback(async () => {
    setConfirmOpen(false);
    await HardFocusService.stop();
  }, []);

  // Gate: render nothing when hardFocus feature is disabled
  if (!enabled) return null;

  const isActive = hardFocusState.isActive;

  // HF2: NO animation. HF3: calm styling matching Start Pomodoro button.
  // Active: subtle bg-accent/30 fill (same visual family, no orange).
  // Idle: same muted-foreground style as the Pomodoro icon buttons.
  return (
    <>
      {/* G-fix: show "Hard Focus" text label (not icon-only). Text must be fully
           visible at ~150px half-width. text-sm + shrink-0 icon prevents truncation. */}
      <button
        type="button"
        onClick={handleClick}
        className={[
          'flex items-center justify-center gap-1.5 px-2.5 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-accent/30 text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
        ].join(' ')}
        aria-label={isActive ? t('sidepanel.hardFocus.stopAria') : t('sidepanel.hardFocus.startAria')}
        title={isActive ? t('sidepanel.hardFocus.activeTitle') : t('sidepanel.hardFocus.idleTitle')}
        data-testid="hard-focus-button"
        data-active={isActive ? 'true' : 'false'}
      >
        {/* M1-fix: shield is filled (fill-current) when active, outline only when idle */}
        <Shield className={['w-4 h-4 shrink-0', isActive ? 'fill-current' : ''].join(' ').trim()} />
        <span>{t('sidepanel.hardFocus.label')}</span>
      </button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm" data-testid="hard-focus-confirm-dialog">
          <DialogHeader>
            <DialogTitle>{t('sidepanel.hardFocus.confirmTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            {t('sidepanel.hardFocus.confirmDescription')}
          </p>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                {t('common.cancel')}
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={handleStop}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              data-testid="confirm-stop-btn"
            >
              {t('sidepanel.hardFocus.stopButton')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
