/**
 * @module services/flowtime-helpers
 *
 * Pure helper functions and constants for the Flowtime Timer (ADHD-25).
 *
 * WHY this module is separate from pomodoro-service.ts:
 *   The break-formula helper must be importable by the ADHD Settings live-slider
 *   preview (Plan 12-05) without pulling in Chrome API mocks or the full
 *   PomodoroService dependency graph. Keeping it pure enables direct unit testing
 *   with zero mocks.
 *
 * FORMULA NOTE:
 *   Bluetab uses a linear coefficient (default 0.20) rather than Zoë Read-Bivens'
 *   original 2015 stepped table (up to 25 min → 5 min; 25–50 → 8 min; 50–90 → 10 min;
 *   90+ → 15 min). This is intentional — the coefficient slider allows personalisation
 *   that the stepped model does not. See 12-RESEARCH.md §Finding 1 for the citation.
 *
 * NO side effects, NO chrome.* calls, NO storage access.
 */

export const FLOWTIME_MIN_WORK_MINUTES = 5;       // sessions below this end silently
export const FLOWTIME_COEFFICIENT_MIN = 0.10;
export const FLOWTIME_COEFFICIENT_MAX = 0.30;
export const FLOWTIME_COEFFICIENT_DEFAULT = 0.20;
export const FLOWTIME_BREAK_PROPOSAL_KEY = 'flowtime_break_proposal' as const;

/**
 * ADHD-25 revised: linear coefficient formula (not the stepped table of
 * Zoe Read-Bivens' original 2015 Flowtime Technique — see RESEARCH finding #1).
 *
 * Returns null for sessions < 5 min (silent-end rule).
 * No upper cap: a 3-hour session at 0.20 proposes 36 min.
 * Clamps minimum to 1 minute so a 6-min session at 0.10 = 1 (not 0 from rounding down).
 */
export function computeBreakMinutes(
  workMinutes: number,
  coefficient: number,
): number | null {
  if (workMinutes < FLOWTIME_MIN_WORK_MINUTES) return null;
  const raw = workMinutes * coefficient;
  return Math.max(1, Math.round(raw));
}

/** The transient state written by stopFlowtime, consumed by the break-card UI. */
export interface FlowtimeBreakProposal {
  workMinutes: number;
  proposedBreakMinutes: number;
  /** epoch ms; UI can show "proposal from N min ago" if it wants */
  createdAt: number;
}
