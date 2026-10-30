/**
 * Tests for VisualTimeDisc (Phase 9 Plan 09-05).
 *
 * Covers ADHD-28 (shrinking-disc SVG renders for an active timer), ADHD-29
 * (no audible cue, no fullscreen takeover — static assertion on the rendered
 * markup), and ADHD-30 (numeric fallback ALWAYS present, Okabe-Ito palette
 * applied when colorBlindSafe=true).
 *
 * Validation approach: Option B (locked per 09-VALIDATION.md) — pure render
 * via `react-dom/server.renderToStaticMarkup`. No jsdom environment, no
 * `@testing-library/react` devDep. The disc is a stateless pure-render
 * component so static-markup assertions are sufficient.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { VisualTimeDisc } from './VisualTimeDisc';

describe('VisualTimeDisc (ADHD-28/29/30)', () => {
  it('renders with default palette at full remaining (25min / 25min)', () => {
    const html = renderToStaticMarkup(
      <VisualTimeDisc
        remainingMs={25 * 60_000}
        totalMs={25 * 60_000}
        colorBlindSafe={false}
      />,
    );
    expect(html).toMatchSnapshot();
  });

  it('renders with default palette at half remaining (12.5min / 25min)', () => {
    const html = renderToStaticMarkup(
      <VisualTimeDisc
        remainingMs={12.5 * 60_000}
        totalMs={25 * 60_000}
        colorBlindSafe={false}
      />,
    );
    expect(html).toMatchSnapshot();
  });

  it('renders with default palette at zero remaining (0 / 25min)', () => {
    const html = renderToStaticMarkup(
      <VisualTimeDisc
        remainingMs={0}
        totalMs={25 * 60_000}
        colorBlindSafe={false}
      />,
    );
    expect(html).toMatchSnapshot();
  });

  it('renders Okabe-Ito palette when colorBlindSafe=true (25min / 25min)', () => {
    const html = renderToStaticMarkup(
      <VisualTimeDisc
        remainingMs={25 * 60_000}
        totalMs={25 * 60_000}
        colorBlindSafe={true}
      />,
    );
    expect(html).toMatchSnapshot();
    // ADHD-30: Okabe-Ito hex pair must be present when colorBlindSafe=true
    expect(html).toContain('#E69F00');
    expect(html).toContain('#0072B2');
  });

  it('does NOT contain Okabe-Ito hexes when colorBlindSafe=false', () => {
    const html = renderToStaticMarkup(
      <VisualTimeDisc
        remainingMs={25 * 60_000}
        totalMs={25 * 60_000}
        colorBlindSafe={false}
      />,
    );
    expect(html).not.toContain('#E69F00');
    expect(html).not.toContain('#0072B2');
  });

  it('ADHD-29 contract: no audio, no requestFullscreen, no fullscreenElement in rendered markup', () => {
    const scenarios = [
      { remainingMs: 25 * 60_000, totalMs: 25 * 60_000, colorBlindSafe: false },
      { remainingMs: 0, totalMs: 25 * 60_000, colorBlindSafe: false },
      { remainingMs: 25 * 60_000, totalMs: 25 * 60_000, colorBlindSafe: true },
    ];
    for (const props of scenarios) {
      const html = renderToStaticMarkup(<VisualTimeDisc {...props} />);
      expect(html).not.toContain('<audio');
      expect(html).not.toContain('requestFullscreen');
      expect(html).not.toContain('fullscreenElement');
    }
  });

  it('ADHD-30: numeric fallback is ALWAYS rendered centered inside the disc (10min / 25min)', () => {
    const html = renderToStaticMarkup(
      <VisualTimeDisc
        remainingMs={10 * 60_000}
        totalMs={25 * 60_000}
        colorBlindSafe={false}
      />,
    );
    // "10" must appear inside an element (bounded by > and <) so we know
    // it's the centered numeric label, not an attribute value or stroke.
    expect(html).toMatch(/>10</);
  });

  it('ADHD-30: numeric fallback shows "0" when remainingMs === 0', () => {
    const html = renderToStaticMarkup(
      <VisualTimeDisc
        remainingMs={0}
        totalMs={25 * 60_000}
        colorBlindSafe={false}
      />,
    );
    expect(html).toMatch(/>0</);
  });

  it('renders role="timer" and aria-label with minutes remaining', () => {
    const html = renderToStaticMarkup(
      <VisualTimeDisc
        remainingMs={1 * 60_000}
        totalMs={25 * 60_000}
        colorBlindSafe={false}
      />,
    );
    expect(html).toContain('role="timer"');
    // Minute-one uses singular "minute" (not "minutes")
    expect(html).toContain('aria-label="1 minute remaining"');
  });

  it('renders aria-label with plural "minutes" for values > 1', () => {
    const html = renderToStaticMarkup(
      <VisualTimeDisc
        remainingMs={5 * 60_000}
        totalMs={25 * 60_000}
        colorBlindSafe={false}
      />,
    );
    expect(html).toContain('aria-label="5 minutes remaining"');
  });

  it('clamps progress safely when totalMs is 0 (no NaN / Infinity in markup)', () => {
    const html = renderToStaticMarkup(
      <VisualTimeDisc remainingMs={0} totalMs={0} colorBlindSafe={false} />,
    );
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });
});
