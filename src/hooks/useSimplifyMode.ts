/**
 * @module hooks/useSimplifyMode
 *
 * WHY:  Phase 9 Plan 09-04 ships Simplify Mode — a CSS-driven reduction of
 *       decorative UI chrome across all five Bluetab surfaces (sidepanel,
 *       newtab, popup, options, settings). The master ADHD toggle + the
 *       `simplify` sub-toggle flip a `data-simplify="true"` attribute on
 *       <html>; the opt-in `simplify.aggressive` sub-flag additionally
 *       flips `data-simplify-aggressive="true"` for the Options-shell
 *       hover-reveal pattern. CSS in `src/styles/simplify.css` (imported
 *       via `tailwind.css`) cascades off those two attributes.
 *
 * WHAT: - `applySimplifyAttributes(settings)` — pure helper that writes the
 *         two attributes on `document.documentElement` based on the master
 *         gate plus the sub-flags. Exported for direct unit testing without
 *         rendering a React tree (Option B DOM stub per 09-VALIDATION).
 *       - `useSimplifyMode()` — React hook that loads the current settings
 *         on mount, applies the attributes once, and subscribes to
 *         cross-tab / cross-device settings changes via
 *         `ADHDService.subscribe`. On unmount the subscription is cleared.
 *
 * HOW:  `setAttribute(name, 'true')` + `removeAttribute(name)` is used to
 *       flip the two attributes. This pairs with the CSS selector
 *       `html[data-simplify="true"]` in simplify.css which requires the
 *       literal string value "true". Using the browser's `toggleAttribute`
 *       instead would set an empty-string value (`data-simplify=""`),
 *       which fails the CSS selector match and silently breaks the
 *       feature — that was the post-ship iteration round 2 finding on
 *       2026-04-18. The CSS could also be loosened to `[data-simplify]`,
 *       but keeping the explicit `"true"` value makes the DOM readable
 *       in DevTools ("yes, simplify is on") rather than showing a bare
 *       attribute name. `ADHDService.subscribe` already filters
 *       `chrome.storage.onChanged` for the `adhd_settings` key, so this
 *       hook never sees unrelated storage traffic.
 *
 * NOT:  - Does not own the CSS rules — see `src/styles/simplify.css`.
 *       - Does not apply decorative `bt-decor` classes to any component —
 *         that is done per-component in Task 9-04-02 via Edit.
 *       - Does not handle `prefers-reduced-motion`. That is an unconditional
 *         CSS media query in `simplify.css` (ADHD-18) — it must fire even
 *         when the master toggle is OFF, so it lives outside this hook.
 */

import { useEffect } from 'react';
import { ADHDService } from '@/services/adhd-service';
import type { ADHDSettings } from '@/types/adhd';

/**
 * Compute the effective Simplify attribute values from the full settings
 * object. Master toggle is the outer gate (ADHD-02 invariant).
 */
export function computeSimplifyFlags(settings: ADHDSettings): {
  simplify: boolean;
  aggressive: boolean;
} {
  const simplify = Boolean(settings.masterEnabled && settings.simplify.enabled);
  const aggressive = Boolean(simplify && settings.simplify.aggressive);
  return { simplify, aggressive };
}

/**
 * Write the two Simplify-Mode data attributes onto <html> based on the
 * current settings. Exported for unit tests — calling this directly with a
 * stub `document` is the Option B validation path from 09-VALIDATION.
 *
 * Idempotent: calling twice with the same settings produces identical DOM.
 */
export function applySimplifyAttributes(settings: ADHDSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  const { simplify, aggressive } = computeSimplifyFlags(settings);
  // IMPORTANT: set the string value "true" rather than using toggleAttribute.
  // The CSS in simplify.css matches on `html[data-simplify="true"]` — an
  // attribute with an empty-string value (what toggleAttribute writes) does
  // NOT match that selector. See the HOW block above for the full story.
  if (simplify) {
    root.setAttribute('data-simplify', 'true');
  } else {
    root.removeAttribute('data-simplify');
  }
  if (aggressive) {
    root.setAttribute('data-simplify-aggressive', 'true');
  } else {
    root.removeAttribute('data-simplify-aggressive');
  }
}

/**
 * React hook that wires ADHDSettings → Simplify data attributes.
 *
 * Every Bluetab entry point (sidepanel, newtab, popup, options, settings)
 * calls this once inside its root component. Because the attributes live
 * on <html>, downstream CSS rules in simplify.css cascade without per-
 * component wiring.
 */
export function useSimplifyMode(): void {
  useEffect(() => {
    let cancelled = false;

    // Initial load — read the current settings and apply once.
    ADHDService.getSettings()
      .then((settings) => {
        if (cancelled) return;
        applySimplifyAttributes(settings);
      })
      .catch((err) => {
        console.error('[BlueTab][useSimplifyMode] initial load error:', err);
      });

    // Reactive updates — fire on any adhd_settings change (local toggle,
    // cross-tab update, cross-device sync via delta-tracker).
    const unsubscribe = ADHDService.subscribe((next) => {
      applySimplifyAttributes(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}
