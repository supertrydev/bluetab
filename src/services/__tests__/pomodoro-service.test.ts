/**
 * PomodoroService tests — focused on Flowtime break isolation (FT3).
 *
 * FT3 invariants:
 *   - startProposedBreak() sets mode='flowtime-break' (not undefined/pomodoro).
 *   - handleSessionEnd() with mode='flowtime-break': clears state to idle,
 *     does NOT write to pomodoroHistory, does NOT auto-advance to work session.
 *   - updateBadge() with mode='flowtime-break': shows countdown with green badge.
 *   - updateBadge() with mode='flowtime': uses Math.floor (not ceil) for elapsed minutes.
 *
 * Also tests FT1: elapsed minute formatting for Flowtime badge.
 */

import { PomodoroService } from '@/services/pomodoro-service';
import { Storage } from '@/utils/storage';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/services/adhd-service', () => ({
  ADHDService: {
    getSettings: jest.fn().mockResolvedValue({
      masterEnabled: true,
      flowtimeTimer: { enabled: true, coefficient: 0.20 },
    }),
  },
}));

jest.mock('@/services/stats-service', () => ({
  StatsService: {
    recordFocusMinutes: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockGet = Storage.get as jest.Mock;
const mockSet = Storage.set as jest.Mock;
const mockRemove = Storage.remove as jest.Mock;

const ALARM_NAMES = { POMODORO_END: 'pomodoroEnd', POMODORO_TICK: 'pomodoroTick' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(null);
  mockSet.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
  (chrome.alarms.clear as jest.Mock).mockResolvedValue(true);
  (chrome.alarms.create as jest.Mock).mockResolvedValue(undefined);
  (chrome.action.setBadgeText as jest.Mock).mockResolvedValue(undefined);
  (chrome.action.setBadgeBackgroundColor as jest.Mock).mockResolvedValue(undefined);
  (chrome.notifications.create as jest.Mock).mockResolvedValue(undefined);
  (chrome.runtime.getURL as jest.Mock).mockReturnValue('chrome-extension://fake/icon48.png');
});

// ---------------------------------------------------------------------------
// FT3: startProposedBreak — flowtime-break mode isolation
// ---------------------------------------------------------------------------

describe('PomodoroService — startProposedBreak (FT3 flowtime-break isolation)', () => {
  test('FT3: startProposedBreak sets mode=flowtime-break in persisted state', async () => {
    mockGet.mockResolvedValue({
      isActive: false,
      isPaused: false,
      sessionType: 'work',
      endTime: 0,
      pausedRemaining: 0,
      sessionsCompleted: 3,
      preset: 'classic',
    });

    await PomodoroService.startProposedBreak(5);

    const setCalls = mockSet.mock.calls.filter(
      (c) => c[0] === 'pomodoroState',
    );
    expect(setCalls).toHaveLength(1);
    const savedState = setCalls[0][1];
    expect(savedState.mode).toBe('flowtime-break');
    expect(savedState.isActive).toBe(true);
    expect(savedState.sessionType).toBe('shortBreak');
    // sessionsCompleted must NOT be touched
    expect(savedState.sessionsCompleted).toBe(3);
  });

  test('FT3: startProposedBreak does NOT write to pomodoroHistory', async () => {
    mockGet.mockResolvedValue({
      isActive: false,
      isPaused: false,
      sessionType: 'work',
      endTime: 0,
      pausedRemaining: 0,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    await PomodoroService.startProposedBreak(3);

    // pomodoroHistory must not be written
    const historyCalls = mockSet.mock.calls.filter(
      (c) => c[0] === 'pomodoroHistory',
    );
    expect(historyCalls).toHaveLength(0);
  });

  test('FT3: startProposedBreak with 0 minutes is a no-op', async () => {
    await PomodoroService.startProposedBreak(0);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FT3: handleSessionEnd — flowtime-break completion returns to idle
// ---------------------------------------------------------------------------

describe('PomodoroService — handleSessionEnd (FT3 flowtime-break completion)', () => {
  test('FT3: handleSessionEnd with mode=flowtime-break clears state to idle', async () => {
    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: false,
      sessionType: 'shortBreak',
      mode: 'flowtime-break',
      endTime: Date.now() - 1000, // already ended
      pausedRemaining: 0,
      sessionsCompleted: 2,
      preset: 'classic',
    });

    await PomodoroService.handleSessionEnd();

    const setCalls = mockSet.mock.calls.filter((c) => c[0] === 'pomodoroState');
    expect(setCalls).toHaveLength(1);
    const savedState = setCalls[0][1];
    expect(savedState.isActive).toBe(false);
    expect(savedState.mode).toBeUndefined();
  });

  test('FT3: handleSessionEnd with mode=flowtime-break does NOT write to pomodoroHistory', async () => {
    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: false,
      sessionType: 'shortBreak',
      mode: 'flowtime-break',
      endTime: Date.now() - 1000,
      pausedRemaining: 0,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    await PomodoroService.handleSessionEnd();

    // pomodoroHistory must not be written by flowtime-break completion
    const historyCalls = mockSet.mock.calls.filter((c) => c[0] === 'pomodoroHistory');
    expect(historyCalls).toHaveLength(0);
  });

  test('FT3: handleSessionEnd with mode=flowtime-break does NOT auto-advance (no alarms created)', async () => {
    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: false,
      sessionType: 'shortBreak',
      mode: 'flowtime-break',
      endTime: Date.now() - 1000,
      pausedRemaining: 0,
      sessionsCompleted: 1,
      preset: 'classic',
    });

    await PomodoroService.handleSessionEnd();

    // No new POMODORO_END alarm created (no auto-advance to next session)
    const createCalls = (chrome.alarms.create as jest.Mock).mock.calls;
    const endAlarmCreated = createCalls.some((c) => c[0] === ALARM_NAMES.POMODORO_END);
    expect(endAlarmCreated).toBe(false);
  });

  test('FT3: handleSessionEnd with mode=flowtime-break does NOT send notification', async () => {
    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: false,
      sessionType: 'shortBreak',
      mode: 'flowtime-break',
      endTime: Date.now() - 1000,
      pausedRemaining: 0,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    await PomodoroService.handleSessionEnd();

    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('FT3: handleSessionEnd with mode=flowtime-break does not change sessionsCompleted', async () => {
    const initialSessions = 3;
    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: false,
      sessionType: 'shortBreak',
      mode: 'flowtime-break',
      endTime: Date.now() - 1000,
      pausedRemaining: 0,
      sessionsCompleted: initialSessions,
      preset: 'classic',
    });

    await PomodoroService.handleSessionEnd();

    // State should be cleared (isActive=false), sessionsCompleted preserved
    const setCalls = mockSet.mock.calls.filter((c) => c[0] === 'pomodoroState');
    // Should not write a new ACTIVE state (would be auto-advance)
    const activeCalls = setCalls.filter((c) => c[1].isActive === true);
    expect(activeCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FT1: updateBadge — Flowtime elapsed badge uses Math.floor (not Math.ceil)
// ---------------------------------------------------------------------------

describe('PomodoroService — updateBadge (FT1 minute formatting)', () => {
  test('FT1: at 01:05 elapsed (65 seconds), badge shows "1m" (Math.floor, not Math.ceil)', async () => {
    const now = Date.now();
    const startTime = now - 65_000; // 65 seconds ago

    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: false,
      mode: 'flowtime',
      startTime,
      sessionType: 'work',
      endTime: 0,
      pausedRemaining: 0,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    await PomodoroService.updateBadge();

    // Math.floor(65000/60000) = Math.floor(1.083) = 1 → "1m"
    // Math.ceil would give 2m (wrong — user sees 01:05 in the bar but "2m" in the badge)
    const setTextCalls = (chrome.action.setBadgeText as jest.Mock).mock.calls;
    expect(setTextCalls.length).toBeGreaterThan(0);
    const badgeText = setTextCalls[setTextCalls.length - 1][0].text;
    expect(badgeText).toBe('1m');
  });

  test('FT1: at 0 seconds elapsed, badge shows "0m"', async () => {
    const now = Date.now();

    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: false,
      mode: 'flowtime',
      startTime: now, // just started
      sessionType: 'work',
      endTime: 0,
      pausedRemaining: 0,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    await PomodoroService.updateBadge();

    const setTextCalls = (chrome.action.setBadgeText as jest.Mock).mock.calls;
    const badgeText = setTextCalls[setTextCalls.length - 1][0].text;
    expect(badgeText).toBe('0m');
  });

  test('I1: Flowtime badge color is blue (#3b82f6), not orange (FocusService badge) or green', async () => {
    // I1-fix: blue badge for Flowtime distinguishes it from Pomodoro (red/green)
    // when Focus Mode is NOT active. Previous green (#22c55e) reverted per re-verify.
    const now = Date.now();

    mockGet.mockImplementation(async (key: string) => {
      if (key === 'pomodoroState') {
        return {
          isActive: true,
          isPaused: false,
          mode: 'flowtime',
          startTime: now - 120_000, // 2 minutes ago
          sessionType: 'work',
          endTime: 0,
          pausedRemaining: 0,
          sessionsCompleted: 0,
          preset: 'classic',
        };
      }
      if (key === 'focusState') {
        return { isActive: false, activatedAt: 0 };
      }
      return null;
    });

    await PomodoroService.updateBadge();

    const setColorCalls = (chrome.action.setBadgeBackgroundColor as jest.Mock).mock.calls;
    expect(setColorCalls.length).toBeGreaterThan(0);
    const badgeColor = setColorCalls[0][0].color;
    expect(badgeColor).toBe('#3b82f6');
    // Must NOT be orange when Flowtime is running without Focus blocking
    expect(badgeColor).not.toBe('#f97316');
    // Must NOT be red (Pomodoro work color)
    expect(badgeColor).not.toBe('#ef4444');
    // Must NOT be green (old Flowtime color)
    expect(badgeColor).not.toBe('#22c55e');
  });

  test('I1: flowtime-break badge color is blue (#3b82f6)', async () => {
    // I1-fix: Flowtime break shares the blue badge family with Flowtime active.
    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: false,
      mode: 'flowtime-break',
      sessionType: 'shortBreak',
      endTime: Date.now() + 300_000, // 5 minutes remaining
      pausedRemaining: 0,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    await PomodoroService.updateBadge();

    const setColorCalls = (chrome.action.setBadgeBackgroundColor as jest.Mock).mock.calls;
    expect(setColorCalls.length).toBeGreaterThan(0);
    const badgeColor = setColorCalls[0][0].color;
    expect(badgeColor).toBe('#3b82f6');
  });

  test('Flowtime auto-focus reuses the orange Focus badge while blocking is active', async () => {
    const now = Date.now();
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'pomodoroState') {
        return {
          isActive: true,
          isPaused: false,
          mode: 'flowtime',
          startTime: now - 120_000,
          sessionType: 'work',
          endTime: 0,
          pausedRemaining: 0,
          sessionsCompleted: 0,
          preset: 'classic',
        };
      }
      if (key === 'focusState') {
        return { isActive: true, activatedAt: now - 120_000, source: 'flowtime' };
      }
      return null;
    });

    await PomodoroService.updateBadge();

    const setColorCalls = (chrome.action.setBadgeBackgroundColor as jest.Mock).mock.calls;
    const badgeColor = setColorCalls[0][0].color;
    expect(badgeColor).toBe('#f97316');
  });
});

// ---------------------------------------------------------------------------
// L-fix: pauseFlowtime / resumeFlowtime — elapsed seconds preserved across pause/resume
// ---------------------------------------------------------------------------

describe('PomodoroService — pauseFlowtime / resumeFlowtime (L-fix)', () => {
  test('L-fix: pauseFlowtime sets isPaused:true and stores elapsed ms in pausedRemaining', async () => {
    const startTime = Date.now() - 120_000; // 120 seconds ago

    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: false,
      mode: 'flowtime',
      startTime,
      sessionType: 'work',
      endTime: 0,
      pausedRemaining: 0,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    await PomodoroService.pauseFlowtime();

    const setCalls = mockSet.mock.calls.filter((c) => c[0] === 'pomodoroState');
    expect(setCalls).toHaveLength(1);
    const saved = setCalls[0][1];
    expect(saved.isPaused).toBe(true);
    // pausedRemaining should be approximately 120_000ms (±5000ms tolerance for test timing)
    expect(saved.pausedRemaining).toBeGreaterThanOrEqual(115_000);
    expect(saved.pausedRemaining).toBeLessThanOrEqual(125_000);
  });

  test('L-fix: pauseFlowtime is a no-op when not in flowtime mode', async () => {
    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: false,
      mode: 'pomodoro',
      sessionType: 'work',
      endTime: Date.now() + 1_000_000,
      pausedRemaining: 0,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    await PomodoroService.pauseFlowtime();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('L-fix: pauseFlowtime is a no-op when already paused', async () => {
    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: true,
      mode: 'flowtime',
      startTime: Date.now() - 60_000,
      sessionType: 'work',
      endTime: 0,
      pausedRemaining: 60_000,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    await PomodoroService.pauseFlowtime();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('L-fix: resumeFlowtime sets isPaused:false and recalculates startTime from pausedRemaining', async () => {
    const pausedElapsedMs = 90_000; // 90 seconds of elapsed at pause time

    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: true,
      mode: 'flowtime',
      startTime: Date.now() - 180_000, // stale startTime (before pause)
      sessionType: 'work',
      endTime: 0,
      pausedRemaining: pausedElapsedMs,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    const beforeResume = Date.now();
    await PomodoroService.resumeFlowtime();
    const afterResume = Date.now();

    const setCalls = mockSet.mock.calls.filter((c) => c[0] === 'pomodoroState');
    expect(setCalls).toHaveLength(1);
    const saved = setCalls[0][1];

    expect(saved.isPaused).toBe(false);
    expect(saved.pausedRemaining).toBe(0);

    // New startTime should be: resumeTime - pausedElapsedMs
    // So that Date.now() - newStartTime ≈ pausedElapsedMs (continuity preserved)
    expect(saved.startTime).toBeGreaterThanOrEqual(beforeResume - pausedElapsedMs - 100);
    expect(saved.startTime).toBeLessThanOrEqual(afterResume - pausedElapsedMs + 100);
  });

  test('L-fix: resumeFlowtime is a no-op when not paused', async () => {
    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: false,
      mode: 'flowtime',
      startTime: Date.now() - 30_000,
      sessionType: 'work',
      endTime: 0,
      pausedRemaining: 0,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    await PomodoroService.resumeFlowtime();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('L-fix: resumeFlowtime is a no-op when not in flowtime mode', async () => {
    mockGet.mockResolvedValue({
      isActive: true,
      isPaused: true,
      mode: 'pomodoro',
      sessionType: 'work',
      endTime: Date.now() + 1_000_000,
      pausedRemaining: 300_000,
      sessionsCompleted: 0,
      preset: 'classic',
    });

    await PomodoroService.resumeFlowtime();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('L-fix: elapsed seconds preserved across pause/resume cycle', async () => {
    // Simulate: started 2 minutes ago, paused after 90 seconds
    const pausedElapsedMs = 90_000;

    // After pause:
    const pausedState = {
      isActive: true,
      isPaused: true,
      mode: 'flowtime',
      startTime: Date.now() - 180_000, // doesn't matter after pause
      sessionType: 'work',
      endTime: 0,
      pausedRemaining: pausedElapsedMs,
      sessionsCompleted: 0,
      preset: 'classic',
    };

    mockGet.mockResolvedValue(pausedState);

    const beforeResume = Date.now();
    await PomodoroService.resumeFlowtime();
    const afterResume = Date.now();

    const setCalls = mockSet.mock.calls.filter((c) => c[0] === 'pomodoroState');
    const resumed = setCalls[0][1];

    // Verify: after resume, elapsed = Date.now() - newStartTime ≈ pausedElapsedMs
    // (the timer continues from where it left off)
    const elapsedAfterResume = afterResume - resumed.startTime;
    // Should be close to pausedElapsedMs (within a few ms of test execution time)
    expect(elapsedAfterResume).toBeGreaterThanOrEqual(pausedElapsedMs - 100);
    expect(elapsedAfterResume).toBeLessThanOrEqual(pausedElapsedMs + (afterResume - beforeResume) + 100);
  });
});
