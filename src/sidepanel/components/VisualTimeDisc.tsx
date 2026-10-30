/**
 * @module sidepanel/components/VisualTimeDisc
 *
 * WHY:  ADHD users often own physical Time Timers — the shrinking red disc
 *       is a mental model they already trust. Digitizing that pattern keeps
 *       passage-of-time visible WITHOUT demanding attention (no alarm, no
 *       buzz, no fullscreen takeover) which is the core ADHD-29 contract.
 *       Pure visual + numeric fallback means the feature works for every
 *       sensory profile (CRIT-06) and every CVD type (ADHD-30).
 *
 * WHAT: Pure-render React component. Takes remaining ms + total ms +
 *       colorBlindSafe flag, renders:
 *         - background track circle
 *         - foreground progress circle that shrinks via CSS stroke-dashoffset
 *         - centered numeric minutes label (ALWAYS rendered — ADHD-30)
 *         - role="timer" + aria-label with minutes remaining
 *
 * HOW:  - Pure SVG; progress = `remainingMs / totalMs` clamped to [0, 1]
 *       - `strokeDasharray = CIRCUMFERENCE`; `strokeDashoffset = C * (1-p)`
 *       - CSS `transition: stroke-dashoffset 1s linear` gives the ambient
 *         tick animation WITHOUT a JS animation loop (so the component
 *         re-renders only when PomodoroBar's 1s interval updates props)
 *       - `-rotate-90` places the 12-o'clock origin at the top
 *       - Palette: default = Phase 8.1 tokens (var(--primary) / var(--bg-2));
 *         colorBlindSafe = Okabe-Ito pair (#E69F00 warm orange / #0072B2 blue)
 *       - If totalMs <= 0, progress clamps to 0 (safe render; no NaN)
 *
 * NOT:  - NO framer-motion import (CONTEXT.md lock; ADHD-29 static guarantee)
 *       - NO audio APIs, NO requestFullscreen, NO document.fullscreenElement
 *         (ADHD-29 — verified by the test's static-grep assertion)
 *       - NO subscription logic — the caller (PomodoroBar) owns state +
 *         interval; this is a stateless render of props
 */

interface Props {
  /** Milliseconds remaining in the current Pomodoro session. */
  remainingMs: number;
  /** Total milliseconds for the current Pomodoro session (used to compute progress). */
  totalMs: number;
  /** When true, swap the default palette for the Okabe-Ito CVD-safe pair. */
  colorBlindSafe: boolean;
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Okabe-Ito CVD-safe pair (Wong 2011). Distinguishable under protanopia,
// deuteranopia, and tritanopia. Fill = warm orange; track = blue.
const OKABE_ITO_FILL = '#E69F00';
const OKABE_ITO_TRACK = '#0072B2';

export function VisualTimeDisc({ remainingMs, totalMs, colorBlindSafe }: Props) {
  // Clamp progress to [0, 1]. If totalMs <= 0 the ratio is NaN/Infinity,
  // so guard it explicitly — ADHD-29 requires a safe render at all times.
  const progress =
    totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const dashoffset = CIRCUMFERENCE * (1 - progress);
  const minutes = Math.max(0, Math.ceil(remainingMs / 60_000));

  const fill = colorBlindSafe ? OKABE_ITO_FILL : 'var(--primary)';
  const track = colorBlindSafe ? OKABE_ITO_TRACK : 'var(--bg-2)';

  const label = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} remaining`;

  return (
    <div
      role="timer"
      aria-label={label}
      className="relative flex items-center justify-center w-24 h-24"
    >
      <svg viewBox="0 0 100 100" className="-rotate-90 w-full h-full">
        {/* Background track. */}
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke={track}
          strokeWidth="14"
        />
        {/* Progress disc — shrinks via stroke-dashoffset. */}
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke={fill}
          strokeWidth="14"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashoffset}
          strokeLinecap="butt"
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      {/* ADHD-30: centered numeric fallback — ALWAYS rendered, never optional. */}
      <span className="absolute text-xl font-medium text-foreground tabular-nums">
        {minutes}
      </span>
    </div>
  );
}
