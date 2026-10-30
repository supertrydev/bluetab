/**
 * Unit tests for computeBreakMinutes (ADHD-25)
 *
 * Requirements covered:
 *   ADHD-25: On Flowtime stop, Bluetab proposes a proportional break.
 *             Formula: break_min = round(work_min x coefficient).
 *             Default coefficient: 0.20.
 *             Sessions < 5 min end silently (no break card).
 *             No upper cap on break duration.
 *
 * Note: Bluetab uses a linear coefficient rather than Zoe Read-Bivens'
 * original stepped table — this is intentional (see 12-RESEARCH.md §Finding 1).
 */

import {
  computeBreakMinutes,
  FLOWTIME_COEFFICIENT_DEFAULT,
  FLOWTIME_COEFFICIENT_MIN,
  FLOWTIME_COEFFICIENT_MAX,
  FLOWTIME_MIN_WORK_MINUTES,
} from '../flowtime-helpers';

describe('computeBreakMinutes (ADHD-25)', () => {
  it('ADHD-25: computeBreakMinutes(4, 0.20) returns null (silent — below 5 min)', () => {
    expect(computeBreakMinutes(4, 0.20)).toBeNull();
  });

  it('ADHD-25: computeBreakMinutes(5, 0.20) returns 1 (5x0.20=1, exactly at threshold)', () => {
    expect(computeBreakMinutes(5, 0.20)).toBe(1);
  });

  it('ADHD-25: computeBreakMinutes(6, 0.10) returns 1 (min-1 clamp: round(0.6)=1)', () => {
    expect(computeBreakMinutes(6, 0.10)).toBe(1);
  });

  it('ADHD-25: computeBreakMinutes(30, 0.20) returns 6 (30x0.20=6)', () => {
    expect(computeBreakMinutes(30, 0.20)).toBe(6);
  });

  it('ADHD-25: computeBreakMinutes(60, 0.20) returns 12', () => {
    expect(computeBreakMinutes(60, 0.20)).toBe(12);
  });

  it('ADHD-25: computeBreakMinutes(100, 0.30) returns 30', () => {
    expect(computeBreakMinutes(100, 0.30)).toBe(30);
  });

  it('ADHD-25: computeBreakMinutes(180, 0.20) returns 36 (no upper cap; 3h session proposes 36-min break)', () => {
    expect(computeBreakMinutes(180, 0.20)).toBe(36);
  });

  it('ADHD-25: computeBreakMinutes(500, 0.30) returns 150 (demonstrates unbounded growth)', () => {
    expect(computeBreakMinutes(500, 0.30)).toBe(150);
  });

  it('ADHD-25: constants have correct values', () => {
    expect(FLOWTIME_COEFFICIENT_DEFAULT).toBe(0.20);
    expect(FLOWTIME_COEFFICIENT_MIN).toBe(0.10);
    expect(FLOWTIME_COEFFICIENT_MAX).toBe(0.30);
    expect(FLOWTIME_MIN_WORK_MINUTES).toBe(5);
  });
});
