/**
 * Unit tests for PomodoroService
 *
 * Tests: start, pause, resume, stop, handleSessionEnd (auto-cycling),
 *        updateBadge, getTodaySummary, preset switching.
 *
 * All tests mock Storage and use chrome mocks from jest-setup.ts.
 */

import { PomodoroService } from './pomodoro-service';
import { Storage } from '@/utils/storage';
import { ALARM_NAMES } from '@/config/alarms';
import type { PomodoroState, PomodoroSettings, PomodoroSession } from '@/types/productivity';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;

// Helper to build a state object with defaults
function makeState(overrides: Partial<PomodoroState> = {}): PomodoroState {
  return {
    isActive: false,
    isPaused: false,
    sessionType: 'work',
    endTime: 0,
    pausedRemaining: 0,
    sessionsCompleted: 0,
    preset: 'classic',
    ...overrides,
  };
}

function makeSettings(overrides: Partial<PomodoroSettings> = {}): PomodoroSettings {
  return {
    preset: 'classic',
    customWork: 25,
    customShortBreak: 5,
    customLongBreak: 15,
    longBreakInterval: 4,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(1000000);
  // Default: Storage.set resolves
  mockedStorage.set.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PomodoroService', () => {
  describe('start', () => {
    it('creates POMODORO_END alarm with correct when timestamp', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroSettings') return makeSettings();
        if (key === 'pomodoroState') return null;
        return null;
      });

      await PomodoroService.start();

      expect(chrome.alarms.create).toHaveBeenCalledWith(
        ALARM_NAMES.POMODORO_END,
        expect.objectContaining({ when: 1000000 + 25 * 60 * 1000 })
      );
    });

    it('creates POMODORO_TICK repeating alarm with 0.5 min period', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroSettings') return makeSettings();
        if (key === 'pomodoroState') return null;
        return null;
      });

      await PomodoroService.start();

      expect(chrome.alarms.create).toHaveBeenCalledWith(
        ALARM_NAMES.POMODORO_TICK,
        expect.objectContaining({ periodInMinutes: 0.5 })
      );
    });

    it('stores state with isActive=true and correct endTime', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroSettings') return makeSettings();
        if (key === 'pomodoroState') return null;
        return null;
      });

      await PomodoroService.start();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroState',
        expect.objectContaining({
          isActive: true,
          isPaused: false,
          endTime: 1000000 + 25 * 60 * 1000,
          sessionType: 'work',
        })
      );
    });

    it('clears existing alarms before creating new ones (race condition safety)', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroSettings') return makeSettings();
        if (key === 'pomodoroState') return null;
        return null;
      });

      await PomodoroService.start();

      // clear should be called before create
      const clearCalls = (chrome.alarms.clear as jest.Mock).mock.invocationCallOrder;
      const createCalls = (chrome.alarms.create as jest.Mock).mock.invocationCallOrder;
      expect(clearCalls.length).toBeGreaterThanOrEqual(2);
      expect(Math.max(...clearCalls)).toBeLessThan(Math.min(...createCalls));
    });
  });

  describe('pause', () => {
    it('clears both alarms', async () => {
      const now = 1000000;
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            endTime: now + 10 * 60 * 1000, // 10 min remaining
          });
        }
        return null;
      });

      await PomodoroService.pause();

      expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAMES.POMODORO_END);
      expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAMES.POMODORO_TICK);
    });

    it('stores isPaused=true and pausedRemaining > 0', async () => {
      const now = 1000000;
      const remaining = 10 * 60 * 1000;
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            endTime: now + remaining,
          });
        }
        return null;
      });

      await PomodoroService.pause();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroState',
        expect.objectContaining({
          isPaused: true,
          pausedRemaining: remaining,
        })
      );
    });
  });

  describe('resume', () => {
    it('creates POMODORO_END alarm with when=now+pausedRemaining', async () => {
      const pausedRemaining = 5 * 60 * 1000;
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            isPaused: true,
            pausedRemaining,
          });
        }
        return null;
      });

      await PomodoroService.resume();

      expect(chrome.alarms.create).toHaveBeenCalledWith(
        ALARM_NAMES.POMODORO_END,
        expect.objectContaining({ when: 1000000 + pausedRemaining })
      );
    });

    it('re-creates POMODORO_TICK repeating alarm', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            isPaused: true,
            pausedRemaining: 5 * 60 * 1000,
          });
        }
        return null;
      });

      await PomodoroService.resume();

      expect(chrome.alarms.create).toHaveBeenCalledWith(
        ALARM_NAMES.POMODORO_TICK,
        expect.objectContaining({ periodInMinutes: 0.5 })
      );
    });

    it('updates state with isPaused=false and new endTime', async () => {
      const pausedRemaining = 5 * 60 * 1000;
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            isPaused: true,
            pausedRemaining,
          });
        }
        return null;
      });

      await PomodoroService.resume();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroState',
        expect.objectContaining({
          isPaused: false,
          pausedRemaining: 0,
          endTime: 1000000 + pausedRemaining,
        })
      );
    });
  });

  describe('stop', () => {
    it('clears both alarms', async () => {
      mockedStorage.get.mockImplementation(async () => makeState({ isActive: true }));

      await PomodoroService.stop();

      expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAMES.POMODORO_END);
      expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAMES.POMODORO_TICK);
    });

    it('resets state to inactive', async () => {
      mockedStorage.get.mockImplementation(async () => makeState({ isActive: true }));

      await PomodoroService.stop();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroState',
        expect.objectContaining({
          isActive: false,
          isPaused: false,
          endTime: 0,
          pausedRemaining: 0,
        })
      );
    });

    it('clears badge text', async () => {
      mockedStorage.get.mockImplementation(async () => makeState({ isActive: true }));

      await PomodoroService.stop();

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    });
  });

  describe('handleSessionEnd', () => {
    it('creates a Chrome notification on session end', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            sessionType: 'work',
            sessionsCompleted: 0,
            preset: 'classic',
          });
        }
        if (key === 'pomodoroSettings') return makeSettings();
        if (key === 'pomodoroHistory') return [];
        return null;
      });

      await PomodoroService.handleSessionEnd();

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        expect.stringContaining('pomodoro-'),
        expect.objectContaining({
          type: 'basic',
          title: 'Bluetab Pomodoro',
        })
      );
    });

    it('records the completed session in history', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            sessionType: 'work',
            sessionsCompleted: 0,
            preset: 'classic',
          });
        }
        if (key === 'pomodoroSettings') return makeSettings();
        if (key === 'pomodoroHistory') return [];
        return null;
      });

      await PomodoroService.handleSessionEnd();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroHistory',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'work',
          }),
        ])
      );
    });

    it('advances work -> shortBreak (normal cycle)', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            sessionType: 'work',
            sessionsCompleted: 0, // first work session, will become 1 after increment
            preset: 'classic',
          });
        }
        if (key === 'pomodoroSettings') return makeSettings();
        if (key === 'pomodoroHistory') return [];
        return null;
      });

      await PomodoroService.handleSessionEnd();

      // After a work session, should start shortBreak
      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroState',
        expect.objectContaining({
          sessionType: 'shortBreak',
          isActive: true,
        })
      );
    });

    it('advances shortBreak -> work', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            sessionType: 'shortBreak',
            sessionsCompleted: 1,
            preset: 'classic',
          });
        }
        if (key === 'pomodoroSettings') return makeSettings();
        if (key === 'pomodoroHistory') return [];
        return null;
      });

      await PomodoroService.handleSessionEnd();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroState',
        expect.objectContaining({
          sessionType: 'work',
          isActive: true,
        })
      );
    });

    it('advances to longBreak after 4 work sessions', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            sessionType: 'work',
            sessionsCompleted: 3, // will become 4 after increment => longBreak
            preset: 'classic',
          });
        }
        if (key === 'pomodoroSettings') return makeSettings();
        if (key === 'pomodoroHistory') return [];
        return null;
      });

      await PomodoroService.handleSessionEnd();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroState',
        expect.objectContaining({
          sessionType: 'longBreak',
          isActive: true,
        })
      );
    });

    it('resets sessionsCompleted to 0 after longBreak and starts work', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            sessionType: 'longBreak',
            sessionsCompleted: 4,
            preset: 'classic',
          });
        }
        if (key === 'pomodoroSettings') return makeSettings();
        if (key === 'pomodoroHistory') return [];
        return null;
      });

      await PomodoroService.handleSessionEnd();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroState',
        expect.objectContaining({
          sessionType: 'work',
          sessionsCompleted: 0,
          isActive: true,
        })
      );
    });
  });

  describe('updateBadge', () => {
    it('shows remaining minutes with "m" suffix for active work session', async () => {
      const now = 1000000;
      const remaining = 23 * 60 * 1000 + 30 * 1000; // 23.5 min => ceil to 24m
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            sessionType: 'work',
            endTime: now + remaining,
          });
        }
        return null;
      });

      await PomodoroService.updateBadge();

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '24m' });
    });

    it('sets badge color red for work session', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            sessionType: 'work',
            endTime: 1000000 + 10 * 60 * 1000,
          });
        }
        return null;
      });

      await PomodoroService.updateBadge();

      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
        color: '#ef4444',
      });
    });

    it('sets badge color green for break session', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({
            isActive: true,
            sessionType: 'shortBreak',
            endTime: 1000000 + 5 * 60 * 1000,
          });
        }
        return null;
      });

      await PomodoroService.updateBadge();

      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
        color: '#22c55e',
      });
    });

    it('clears badge when not active', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({ isActive: false });
        }
        return null;
      });

      await PomodoroService.updateBadge();

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    });

    it('clears badge when paused', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({ isActive: true, isPaused: true });
        }
        return null;
      });

      await PomodoroService.updateBadge();

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    });
  });

  describe('getTodaySummary', () => {
    it('returns correct count and total minutes for today sessions', async () => {
      const now = 1000000;
      // Set Date.now to a recognizable time
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();

      const sessions: PomodoroSession[] = [
        {
          id: '1',
          type: 'work',
          duration: 25,
          startedAt: todayMs + 1000,
          completedAt: todayMs + 25 * 60 * 1000,
        },
        {
          id: '2',
          type: 'work',
          duration: 25,
          startedAt: todayMs + 30 * 60 * 1000,
          completedAt: todayMs + 55 * 60 * 1000,
        },
        {
          id: '3',
          type: 'shortBreak',
          duration: 5,
          startedAt: todayMs + 56 * 60 * 1000,
          completedAt: todayMs + 61 * 60 * 1000,
        },
        // Yesterday's session - should not count
        {
          id: '4',
          type: 'work',
          duration: 25,
          startedAt: todayMs - 24 * 60 * 60 * 1000,
          completedAt: todayMs - 24 * 60 * 60 * 1000 + 25 * 60 * 1000,
        },
      ];

      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroHistory') return sessions;
        return null;
      });

      const summary = await PomodoroService.getTodaySummary();

      // Only work sessions count for focus time
      expect(summary.sessionsCompleted).toBe(2);
      expect(summary.totalFocusMinutes).toBe(50);
    });

    it('returns zeros when no sessions exist', async () => {
      mockedStorage.get.mockImplementation(async () => null);

      const summary = await PomodoroService.getTodaySummary();

      expect(summary.sessionsCompleted).toBe(0);
      expect(summary.totalFocusMinutes).toBe(0);
    });
  });

  describe('getState', () => {
    it('returns current state from storage', async () => {
      const state = makeState({ isActive: true, sessionType: 'work' });
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') return state;
        return null;
      });

      const result = await PomodoroService.getState();

      expect(result).toEqual(state);
    });

    it('returns default state when nothing stored', async () => {
      mockedStorage.get.mockImplementation(async () => null);

      const result = await PomodoroService.getState();

      expect(result).toEqual(expect.objectContaining({
        isActive: false,
        isPaused: false,
        sessionType: 'work',
      }));
    });
  });

  describe('getHistory', () => {
    it('returns all sessions when no days filter', async () => {
      const sessions: PomodoroSession[] = [
        { id: '1', type: 'work', duration: 25, startedAt: 100, completedAt: 200 },
        { id: '2', type: 'work', duration: 25, startedAt: 300, completedAt: 400 },
      ];
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroHistory') return sessions;
        return null;
      });

      const result = await PomodoroService.getHistory();

      expect(result).toHaveLength(2);
    });

    it('filters sessions to last N days when specified', async () => {
      const now = 1000000;
      const oneDay = 24 * 60 * 60 * 1000;
      const sessions: PomodoroSession[] = [
        { id: '1', type: 'work', duration: 25, startedAt: now - 0.5 * oneDay, completedAt: now },
        { id: '2', type: 'work', duration: 25, startedAt: now - 3 * oneDay, completedAt: now - 3 * oneDay + 1000 },
      ];
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroHistory') return sessions;
        return null;
      });

      const result = await PomodoroService.getHistory(1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });
  });
});

// =============================================================================
// Phase 12: Flowtime mode tests (ADHD-24, ADHD-25, ADHD-26, ADHD-27)
// =============================================================================

jest.mock('./adhd-service', () => ({
  ADHDService: {
    getSettings: jest.fn().mockResolvedValue({
      masterEnabled: true,
      autoSuspend: { enabled: false, thresholdMin: 30, whitelistDomains: [] },
      simplify: { enabled: false, aggressive: false },
      visualTime: { enabled: false, colorBlindSafe: false },
      brainDump: { enabled: false, tabContextDefault: true },
      visibleTabLimit: { enabled: false, limit: 20 },
      hardFocus: { enabled: false, domainMode: false },
      flowtimeTimer: { enabled: true, coefficient: 0.20 },
    }),
  },
}));

jest.mock('./stats-service', () => ({
  StatsService: {
    recordFocusMinutes: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('PomodoroService — Phase 12 Flowtime (ADHD-24, ADHD-25, ADHD-26, ADHD-27)', () => {
  describe('startFlowtime (ADHD-24)', () => {
    it('sets state.mode="flowtime", isActive=true, startTime=now', async () => {
      mockedStorage.get.mockImplementation(async () => null);

      await PomodoroService.startFlowtime();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroState',
        expect.objectContaining({
          isActive: true,
          mode: 'flowtime',
          startTime: 1000000,
        })
      );
    });

    it('does NOT schedule POMODORO_END alarm (Flowtime is user-stopped)', async () => {
      mockedStorage.get.mockImplementation(async () => null);

      await PomodoroService.startFlowtime();

      const createCalls = (chrome.alarms.create as jest.Mock).mock.calls;
      const alarmNames = createCalls.map((c) => c[0]);
      expect(alarmNames).not.toContain('bluetab-pomodoro-end');
    });

    it('schedules POMODORO_TICK alarm for badge updates', async () => {
      mockedStorage.get.mockImplementation(async () => null);

      await PomodoroService.startFlowtime();

      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'bluetab-pomodoro-tick',
        expect.objectContaining({ delayInMinutes: expect.any(Number), periodInMinutes: expect.any(Number) })
      );
    });
  });

  describe('stopFlowtime (ADHD-25, ADHD-27)', () => {
    it('returns null when no Flowtime session is active', async () => {
      mockedStorage.get.mockImplementation(async () =>
        makeState({ isActive: false, mode: undefined })
      );

      const result = await PomodoroService.stopFlowtime();

      expect(result).toBeNull();
    });

    it('returns null for sessions < 5 minutes (silent end per ADHD-25)', async () => {
      const startTime = 1000000 - 4 * 60 * 1000; // 4 min ago
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return { ...makeState({ isActive: true }), mode: 'flowtime', startTime };
        }
        if (key === 'pomodoroHistory') return [];
        return null;
      });

      const result = await PomodoroService.stopFlowtime();

      expect(result).toBeNull();
    });

    it('returns { workMinutes, proposedBreakMinutes } for sessions >= 5 min', async () => {
      const startTime = 1000000 - 30 * 60 * 1000; // 30 min ago
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return { ...makeState({ isActive: true }), mode: 'flowtime', startTime };
        }
        if (key === 'pomodoroHistory') return [];
        return null;
      });

      const result = await PomodoroService.stopFlowtime();

      expect(result).not.toBeNull();
      expect(result!.workMinutes).toBe(30);
      // coefficient=0.20: round(30 * 0.20) = round(6.0) = 6
      expect(result!.proposedBreakMinutes).toBe(6);
    });

    it('appends a PomodoroSession with mode="flowtime" to pomodoroHistory (ADHD-27)', async () => {
      const startTime = 1000000 - 25 * 60 * 1000; // 25 min ago
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return { ...makeState({ isActive: true }), mode: 'flowtime', startTime };
        }
        if (key === 'pomodoroHistory') return [];
        return null;
      });

      await PomodoroService.stopFlowtime();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroHistory',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'work',
            mode: 'flowtime',
            duration: 25,
          }),
        ])
      );
    });
  });

  describe('Mutex: ADHD-26 mutual exclusion', () => {
    it('startFlowtime() stops active Pomodoro first (mutex)', async () => {
      // Active Pomodoro state (mode='pomodoro' or absent)
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makeState({ isActive: true, endTime: 1000000 + 10 * 60 * 1000 });
        }
        return null;
      });

      await PomodoroService.startFlowtime();

      // POMODORO_END should have been cleared before starting Flowtime
      expect(chrome.alarms.clear).toHaveBeenCalledWith('bluetab-pomodoro-end');

      // Final state should be Flowtime
      const lastSet = (mockedStorage.set as jest.Mock).mock.calls
        .filter((c) => c[0] === 'pomodoroState')
        .pop();
      expect(lastSet[1]).toMatchObject({ isActive: true, mode: 'flowtime' });
    });

    it('start() (classic Pomodoro) stops active Flowtime first (mutex)', async () => {
      const startTime = 1000000 - 10 * 60 * 1000; // 10 min ago
      const flowtimeState = { ...makeState({ isActive: true }), mode: 'flowtime' as const, startTime };
      let callCount = 0;
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          // First call: return active Flowtime state (for _abortFlowtime check in start())
          // Subsequent calls: return null (aborted state)
          callCount++;
          return callCount === 1 ? flowtimeState : null;
        }
        if (key === 'pomodoroSettings') return makeSettings();
        return null;
      });

      await PomodoroService.start('work');

      // POMODORO_END should have been cleared (abort flowtime path)
      expect(chrome.alarms.clear).toHaveBeenCalledWith('bluetab-pomodoro-end');

      // Final pomodoroState should be Pomodoro (isActive, sessionType=work)
      const setPomCalls = (mockedStorage.set as jest.Mock).mock.calls
        .filter((c) => c[0] === 'pomodoroState');
      // The abort sets isActive=false, then start sets isActive=true with Pomodoro state
      const lastSet = setPomCalls[setPomCalls.length - 1];
      expect(lastSet[1]).toMatchObject({ isActive: true, sessionType: 'work' });
      // Mode should be undefined (Pomodoro default) or absent, not 'flowtime'
      expect(lastSet[1].mode).not.toBe('flowtime');
    });
  });

  // ===========================================================================
  // Phase 12 (Plan 12-04): Break-card state machine tests
  // ===========================================================================

  describe('Break-card state machine (ADHD-25, Plan 12-04)', () => {
    it('ADHD-25: stopFlowtime() with workMinutes >= 5 writes flowtime_break_proposal to storage', async () => {
      const startTime = 1000000 - 40 * 60 * 1000; // 40 min ago
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return { ...makeState({ isActive: true }), mode: 'flowtime', startTime };
        }
        if (key === 'pomodoroHistory') return [];
        return null;
      });

      await PomodoroService.stopFlowtime();

      // coefficient=0.20: round(40 * 0.20) = 8
      expect(mockedStorage.set).toHaveBeenCalledWith(
        'flowtime_break_proposal',
        expect.objectContaining({
          workMinutes: 40,
          proposedBreakMinutes: 8,
          createdAt: 1000000,
        }),
      );
    });

    it('ADHD-25: stopFlowtime() with workMinutes < 5 does NOT write flowtime_break_proposal', async () => {
      const startTime = 1000000 - 3 * 60 * 1000; // 3 min ago
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return { ...makeState({ isActive: true }), mode: 'flowtime', startTime };
        }
        if (key === 'pomodoroHistory') return [];
        return null;
      });

      const result = await PomodoroService.stopFlowtime();

      expect(result).toBeNull();
      const proposalSetCalls = (mockedStorage.set as jest.Mock).mock.calls.filter(
        (c) => c[0] === 'flowtime_break_proposal',
      );
      expect(proposalSetCalls).toHaveLength(0);
    });

    it('ADHD-25: startProposedBreak(10) clears proposal AND starts a Pomodoro shortBreak of 10 minutes', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') return makeState({ isActive: false, sessionsCompleted: 2 });
        return null;
      });
      mockedStorage.remove.mockResolvedValue(undefined);

      await PomodoroService.startProposedBreak(10);

      // Proposal must be cleared
      expect(mockedStorage.remove).toHaveBeenCalledWith('flowtime_break_proposal');

      // PomodoroState must be updated for shortBreak countdown with user-chosen duration
      expect(mockedStorage.set).toHaveBeenCalledWith(
        'pomodoroState',
        expect.objectContaining({
          isActive: true,
          sessionType: 'shortBreak',
          endTime: 1000000 + 10 * 60 * 1000,
          isPaused: false,
        }),
      );

      // POMODORO_END alarm must be scheduled for 10 minutes from now
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'bluetab-pomodoro-end',
        expect.objectContaining({ when: 1000000 + 10 * 60 * 1000 }),
      );
    });

    it('ADHD-25: skipProposedBreak() clears proposal without starting a break', async () => {
      mockedStorage.remove.mockResolvedValue(undefined);

      await PomodoroService.skipProposedBreak();

      // Proposal must be cleared
      expect(mockedStorage.remove).toHaveBeenCalledWith('flowtime_break_proposal');

      // chrome.alarms.create must NOT have been called (no break session started)
      expect(chrome.alarms.create).not.toHaveBeenCalled();

      // Storage.set must NOT have been called with pomodoroState (state stays inactive)
      const pomStateCalls = (mockedStorage.set as jest.Mock).mock.calls.filter(
        (c) => c[0] === 'pomodoroState',
      );
      expect(pomStateCalls).toHaveLength(0);
    });

    it('ADHD-25: getFlowtimeBreakProposal() returns null when no proposal exists', async () => {
      mockedStorage.get.mockImplementation(async () => null);

      const result = await PomodoroService.getFlowtimeBreakProposal();

      expect(result).toBeNull();
    });

    it('ADHD-25: getFlowtimeBreakProposal() returns the stored proposal when one exists', async () => {
      const proposal = { workMinutes: 30, proposedBreakMinutes: 6, createdAt: 999999 };
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'flowtime_break_proposal') return proposal;
        return null;
      });

      const result = await PomodoroService.getFlowtimeBreakProposal();

      expect(result).toEqual(proposal);
    });
  });
});
