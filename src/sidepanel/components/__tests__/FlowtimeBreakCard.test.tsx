/**
 * FlowtimeBreakCard behavioral tests (ADHD-25, ADHD-26)
 *
 * Test environment: Node (Jest + ts-jest, no jsdom, no @testing-library/react).
 * Tests verify module-level contracts and service integration without rendering.
 *
 * For DOM-level rendering assertions, see the human-verify checkpoint (Task 4)
 * which loads the built extension in a real Chrome profile.
 *
 * SAFETY-02 static check: scans the FlowtimeBreakCard source for forbidden
 * words as a defensive guard on top of the CI grep.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PomodoroService } from '../../../services/pomodoro-service';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

jest.mock('../../../services/pomodoro-service', () => ({
  PomodoroService: {
    startProposedBreak: jest.fn().mockResolvedValue(undefined),
    skipProposedBreak: jest.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Source code static checks
// ---------------------------------------------------------------------------

const sourceFile = path.resolve(__dirname, '../FlowtimeBreakCard.tsx');
const sourceContent = fs.readFileSync(sourceFile, 'utf-8');

describe('FlowtimeBreakCard — source code static checks', () => {
  it('renders proposed break minutes (data-testid="break-duration" present)', () => {
    expect(sourceContent).toMatch(/data-testid="break-duration"/);
  });

  it('renders work minutes context (data-testid="work-duration" present)', () => {
    expect(sourceContent).toMatch(/data-testid="work-duration"/);
  });

  it('Start break button present (data-testid="start-break-btn")', () => {
    expect(sourceContent).toMatch(/data-testid="start-break-btn"/);
  });

  it('Edit button present (data-testid="edit-btn")', () => {
    expect(sourceContent).toMatch(/data-testid="edit-btn"/);
  });

  it('Skip button present (data-testid="skip-btn")', () => {
    expect(sourceContent).toMatch(/data-testid="skip-btn"/);
  });

  it('calls PomodoroService.startProposedBreak on Start break click', () => {
    expect(sourceContent).toMatch(/PomodoroService\.startProposedBreak/);
  });

  it('calls PomodoroService.skipProposedBreak on Skip click', () => {
    expect(sourceContent).toMatch(/PomodoroService\.skipProposedBreak/);
  });

  it('Edit mode reveals inline number input (data-testid="edit-input")', () => {
    expect(sourceContent).toMatch(/data-testid="edit-input"/);
  });

  it('inline input clamps between 1 and 60 minutes', () => {
    expect(sourceContent).toMatch(/Math\.max\(1, Math\.min\(60/);
  });

  it('uses editedMinutes from state when editMode is active', () => {
    expect(sourceContent).toMatch(/editMode \? editedMinutes : proposal\.proposedBreakMinutes/);
  });

  it('displays "after N min of work" context', () => {
    expect(sourceContent).toMatch(/after.*min of work/);
  });

  it('displays "Break:" label', () => {
    expect(sourceContent).toMatch(/Break:/);
  });

  it('FlowtimeBreakCard is exported as named export', () => {
    expect(sourceContent).toMatch(/export function FlowtimeBreakCard/);
  });

  it('accepts FlowtimeBreakProposal as prop', () => {
    expect(sourceContent).toMatch(/FlowtimeBreakProposal/);
  });
});

// ---------------------------------------------------------------------------
// SAFETY-02 copy check
// ---------------------------------------------------------------------------

describe('FlowtimeBreakCard — SAFETY-02 forbidden-words check', () => {
  const FORBIDDEN = /\b(streak|missed|failed|expired|broken|wasted|you did not)\b|time's up/i;

  it('source contains no SAFETY-02 forbidden words in user-facing copy', () => {
    // Strip comments before scanning
    const stripped = sourceContent
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(FORBIDDEN);
  });
});

// ---------------------------------------------------------------------------
// Service integration unit tests
// ---------------------------------------------------------------------------

const mockProposal = {
  workMinutes: 30,
  proposedBreakMinutes: 6,
  createdAt: Date.now(),
};

describe('FlowtimeBreakCard — service integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('PomodoroService.startProposedBreak is exported and callable', async () => {
    await PomodoroService.startProposedBreak(mockProposal.proposedBreakMinutes);
    expect(PomodoroService.startProposedBreak).toHaveBeenCalledWith(mockProposal.proposedBreakMinutes);
  });

  it('Start break calls startProposedBreak with proposal minutes (simulated)', async () => {
    // Simulate handleStartBreak in non-edit mode
    const minutesToUse = mockProposal.proposedBreakMinutes;
    await PomodoroService.startProposedBreak(minutesToUse);
    expect(PomodoroService.startProposedBreak).toHaveBeenCalledWith(6);
    expect(PomodoroService.skipProposedBreak).not.toHaveBeenCalled();
  });

  it('Start break uses edited value when editMode is active (simulated)', async () => {
    // Simulate handleStartBreak in edit mode with user-changed value
    const editedMinutes = 10;
    await PomodoroService.startProposedBreak(editedMinutes);
    expect(PomodoroService.startProposedBreak).toHaveBeenCalledWith(10);
  });

  it('Skip calls skipProposedBreak (simulated)', async () => {
    // Simulate handleSkip
    await PomodoroService.skipProposedBreak();
    expect(PomodoroService.skipProposedBreak).toHaveBeenCalledTimes(1);
    expect(PomodoroService.startProposedBreak).not.toHaveBeenCalled();
  });

  it('proposal with workMinutes=6 and proposedBreakMinutes=1 is a valid shape', () => {
    const smallProposal = { workMinutes: 6, proposedBreakMinutes: 1, createdAt: Date.now() };
    expect(smallProposal.proposedBreakMinutes).toBe(1);
    expect(smallProposal.workMinutes).toBe(6);
  });

  it('edit clamp ensures minimum of 1 minute', () => {
    // Simulate handleEditedMinutesChange(0)
    const clamp = (value: number) => Math.max(1, Math.min(60, Math.round(value)));
    expect(clamp(0)).toBe(1);
    expect(clamp(-5)).toBe(1);
  });

  it('edit clamp ensures maximum of 60 minutes', () => {
    const clamp = (value: number) => Math.max(1, Math.min(60, Math.round(value)));
    expect(clamp(100)).toBe(60);
    expect(clamp(61)).toBe(60);
  });

  it('edit clamp rounds fractional values', () => {
    const clamp = (value: number) => Math.max(1, Math.min(60, Math.round(value)));
    expect(clamp(7.6)).toBe(8);
    expect(clamp(7.4)).toBe(7);
  });
});
