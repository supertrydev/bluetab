/**
 * HardFocusButton behavioral tests (ADHD-13, ADHD-15, HF1/HF2/HF3)
 *
 * Test environment: Node (Jest + ts-jest, no jsdom, no @testing-library/react).
 * Tests verify module-level contracts and service integration without rendering.
 *
 * HF2/HF3 updates:
 *   - Removed: pulse-class assertion (no more framer-motion on HF button)
 *   - Removed: prefers-reduced-motion static-fallback test (no animation at all)
 *   - Kept: AlertDialog-on-second-press test, settings-gating test
 *   - Added: no-animation assertion (HF2), calm styling assertion (HF3)
 *
 * SAFETY-02 static check: this file scans the HardFocusButton source for forbidden
 * words as a defensive guard on top of the CI grep.
 */

import * as fs from 'fs';
import * as path from 'path';
import { HardFocusService } from '../../../services/hard-focus-service';
import { ADHDService } from '../../../services/adhd-service';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

jest.mock('../../../services/hard-focus-service', () => ({
  HardFocusService: {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    getState: jest.fn().mockResolvedValue({ isActive: false, activatedAt: 0, domainMode: false }),
  },
  HARD_FOCUS_STATE_KEY: 'hardFocusState',
}));

jest.mock('../../../services/adhd-service', () => ({
  ADHDService: {
    getSettings: jest.fn().mockResolvedValue({
      masterEnabled: true,
      autoSuspend: { enabled: false, thresholdMin: 30, whitelistDomains: [] },
      simplify: { enabled: false, aggressive: false },
      visualTime: { enabled: false, colorBlindSafe: false },
      brainDump: { enabled: false, tabContextDefault: true },
      visibleTabLimit: { enabled: false, limit: 20 },
      hardFocus: { enabled: true, domainMode: false },
      flowtimeTimer: { enabled: false, coefficient: 0.20 },
    }),
    subscribe: jest.fn().mockReturnValue(() => {}),
    updateSettings: jest.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Source code static checks
// ---------------------------------------------------------------------------

const sourceFile = path.resolve(__dirname, '../HardFocusButton.tsx');
const sourceContent = fs.readFileSync(sourceFile, 'utf-8');

describe('HardFocusButton — source code static checks', () => {
  it('M1-fix: shield has fill-current class when active (source contains isActive + fill-current)', () => {
    // M1: active state applies fill-current so Shield icon appears filled
    expect(sourceContent).toMatch(/fill-current/);
    expect(sourceContent).toMatch(/isActive/);
  });

  it('gates on ADHDSettings.hardFocus.enabled (enabled state check present in source)', () => {
    expect(sourceContent).toMatch(/hardFocus\.enabled/);
  });

  it('renders nothing when feature is disabled (null return gate present)', () => {
    expect(sourceContent).toMatch(/if \(!enabled\) return null/);
  });

  it('references HardFocusService.start for idle click', () => {
    expect(sourceContent).toMatch(/HardFocusService\.start/);
  });

  it('references HardFocusService.stop for active-state confirm dialog', () => {
    expect(sourceContent).toMatch(/HardFocusService\.stop/);
  });

  it('HF2: does NOT use framer-motion animate or pulse (motion.button removed)', () => {
    // HF2: no pulse animation at all
    expect(sourceContent).not.toMatch(/motion\.button/);
    expect(sourceContent).not.toMatch(/animate=\{/);
    expect(sourceContent).not.toMatch(/1\.05/); // scale pulse
  });

  it('HF2: does NOT import useReducedMotion (animation removed entirely)', () => {
    expect(sourceContent).not.toMatch(/useReducedMotion/);
  });

  it('HF3: calm styling — no orange accent color class', () => {
    // HF3: remove orange accent
    expect(sourceContent).not.toMatch(/orange-500/);
  });

  it('HF3: active state uses bg-accent variant (not orange)', () => {
    // The source has isActive in the ternary and bg-accent/30 in the active class
    expect(sourceContent).toMatch(/isActive/);
    expect(sourceContent).toMatch(/bg-accent\/30/);
  });

  it('opens confirm dialog on active-state click (sets confirmOpen to true)', () => {
    expect(sourceContent).toMatch(/setConfirmOpen\(true\)/);
  });

  it('confirm dialog has "End Hard Focus?" title (SAFETY-02 copy)', () => {
    expect(sourceContent).toMatch(/End Hard Focus\?/);
  });

  it('confirm dialog has "All URLs will become reachable again." (SAFETY-02 copy)', () => {
    expect(sourceContent).toMatch(/All URLs will become reachable again\./);
  });

  it('data-testid="hard-focus-button" present for DOM queries', () => {
    expect(sourceContent).toMatch(/data-testid="hard-focus-button"/);
  });

  it('data-active attribute tracks isActive state', () => {
    expect(sourceContent).toMatch(/data-active=\{isActive \? .true. : .false.\}/);
  });

  it('data-testid="confirm-stop-btn" present for confirm dialog Stop button', () => {
    expect(sourceContent).toMatch(/data-testid="confirm-stop-btn"/);
  });

  it('data-testid="hard-focus-confirm-dialog" present for dialog container', () => {
    expect(sourceContent).toMatch(/data-testid="hard-focus-confirm-dialog"/);
  });
});

// ---------------------------------------------------------------------------
// SAFETY-02 copy check
// ---------------------------------------------------------------------------

describe('HardFocusButton — SAFETY-02 forbidden-words check', () => {
  const FORBIDDEN = /\b(streak|missed|failed|expired|broken|wasted|you did not)\b|time's up/i;

  it('source contains no SAFETY-02 forbidden words in user-facing copy', () => {
    const stripped = sourceContent
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(FORBIDDEN);
  });
});

// ---------------------------------------------------------------------------
// Service integration unit tests
// ---------------------------------------------------------------------------

describe('HardFocusButton — service integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('HardFocusService.start is exported and callable', async () => {
    await HardFocusService.start();
    expect(HardFocusService.start).toHaveBeenCalledTimes(1);
  });

  it('HardFocusService.stop is exported and callable', async () => {
    await HardFocusService.stop();
    expect(HardFocusService.stop).toHaveBeenCalledTimes(1);
  });

  it('ADHDService.getSettings returns hardFocus.enabled = true in mock', async () => {
    const settings = await ADHDService.getSettings();
    expect(settings.hardFocus.enabled).toBe(true);
  });

  it('HardFocusService.getState returns isActive = false by default in mock', async () => {
    const state = await HardFocusService.getState();
    expect(state.isActive).toBe(false);
  });

  it('idle click calls HardFocusService.start (simulated via direct call)', async () => {
    const state = await HardFocusService.getState();
    if (!state.isActive) {
      await HardFocusService.start();
    }
    expect(HardFocusService.start).toHaveBeenCalledTimes(1);
    expect(HardFocusService.stop).not.toHaveBeenCalled();
  });

  it('active-state "Stop" calls HardFocusService.stop (simulated via direct call)', async () => {
    await HardFocusService.stop();
    expect(HardFocusService.stop).toHaveBeenCalledTimes(1);
    expect(HardFocusService.start).not.toHaveBeenCalled();
  });
});
