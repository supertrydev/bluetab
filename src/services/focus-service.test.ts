/**
 * Unit tests for FocusService
 *
 * Tests: enable, disable, resolveBlockedDomains, buildRules,
 *        updateBadge, cleanupStaleRules, getState.
 *
 * All tests mock Storage and use chrome mocks from jest-setup.ts.
 */

import { FocusService } from './focus-service';
import { Storage } from '@/utils/storage';
import { StatsService } from '@/services/stats-service';
import { FOCUS_RULE_ID_START, BLOCK_PAGE_PATH } from '@/config/focus-presets';
import type { FocusSettings, FocusState, PomodoroState } from '@/types/productivity';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

jest.mock('@/services/stats-service', () => ({
  StatsService: {
    recordFocusMinutes: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;
const mockedStats = StatsService as jest.Mocked<typeof StatsService>;

function makeSettings(overrides: Partial<FocusSettings> = {}): FocusSettings {
  return {
    enabled: true,
    blockDuringBreaks: false,
    autoEnableWithPomodoro: true,
    presets: {
      socialMedia: false,
      newsMedia: false,
      entertainment: false,
      shopping: false,
    },
    customDomains: [],
    blockedPhrases: [],
    ...overrides,
  };
}

function makeState(overrides: Partial<FocusState> = {}): FocusState {
  return {
    isActive: false,
    activatedAt: 0,
    source: 'manual',
    ...overrides,
  };
}

function makePomodoroState(overrides: Partial<PomodoroState> = {}): PomodoroState {
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(1000000);
  mockedStorage.set.mockResolvedValue(undefined);
  mockedStats.recordFocusMinutes.mockResolvedValue(undefined);
  (chrome.tabs.query as jest.Mock).mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('FocusService', () => {
  describe('enable', () => {
    it('calls updateDynamicRules with addRules built from enabled presets and custom domains', async () => {
      const settings = makeSettings({
        presets: { socialMedia: true, newsMedia: false, entertainment: false, shopping: false },
        customDomains: ['example.com'],
      });
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusSettings') return settings;
        return null;
      });

      await FocusService.enable();

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith(
        expect.objectContaining({
          addRules: expect.arrayContaining([
            expect.objectContaining({
              condition: expect.objectContaining({
                regexFilter: expect.stringContaining('twitter\\.com'),
              }),
            }),
          ]),
        })
      );
    });

    it('sets focusState to { isActive: true, activatedAt: <timestamp> }', async () => {
      const settings = makeSettings({
        presets: { socialMedia: true, newsMedia: false, entertainment: false, shopping: false },
      });
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusSettings') return settings;
        return null;
      });

      await FocusService.enable();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'focusState',
        expect.objectContaining({
          isActive: true,
          activatedAt: 1000000,
        })
      );
    });

    it('does nothing if focusSettings.enabled is false', async () => {
      const settings = makeSettings({ enabled: false });
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusSettings') return settings;
        return null;
      });

      await FocusService.enable();

      expect(chrome.declarativeNetRequest.updateDynamicRules).not.toHaveBeenCalled();
      expect(mockedStorage.set).not.toHaveBeenCalled();
    });

    it('stores pomodoro source metadata when auto-focus enables focus during work', async () => {
      const settings = makeSettings({
        presets: { socialMedia: true, newsMedia: false, entertainment: false, shopping: false },
      });
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusSettings') return settings;
        if (key === 'focusState') return makeState({ isActive: false, source: undefined });
        return null;
      });

      await FocusService.enable({ force: true, source: 'pomodoro', resetCounting: true });

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'focusState',
        expect.objectContaining({
          isActive: true,
          source: 'pomodoro',
          countingStartedAt: 1000000,
        })
      );
    });

    it('redirects existing tabs when the title contains a blocked phrase', async () => {
      const settings = makeSettings({
        blockedPhrases: ['youtube'],
      });
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusSettings') return settings;
        if (key === 'focusState') return makeState({ isActive: false, source: undefined });
        return null;
      });
      (chrome.tabs.query as jest.Mock).mockResolvedValue([
        {
          id: 42,
          url: 'https://www.google.com/search?q=test',
          title: 'YouTube video result',
        },
      ]);

      await FocusService.enable();

      expect(chrome.tabs.update).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          url: expect.stringContaining('/src/blocked/index.html'),
        }),
      );
    });
  });

  describe('disable', () => {
    it('calls updateDynamicRules with removeRuleIds for all focus-range rules', async () => {
      const existingRules = [
        { id: 10000, priority: 1, action: {}, condition: {} },
        { id: 10001, priority: 1, action: {}, condition: {} },
        { id: 5, priority: 1, action: {}, condition: {} }, // non-focus rule
      ];
      (chrome.declarativeNetRequest.getDynamicRules as jest.Mock).mockResolvedValue(existingRules);

      await FocusService.disable();

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        removeRuleIds: [10000, 10001],
      });
    });

    it('sets focusState to { isActive: false, activatedAt: 0 }', async () => {
      (chrome.declarativeNetRequest.getDynamicRules as jest.Mock).mockResolvedValue([]);

      await FocusService.disable();

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'focusState',
        { isActive: false, activatedAt: 0, source: undefined, countingStartedAt: undefined }
      );
    });

    it('handles case where no focus rules exist (no-op for removeRuleIds)', async () => {
      (chrome.declarativeNetRequest.getDynamicRules as jest.Mock).mockResolvedValue([
        { id: 5, priority: 1, action: {}, condition: {} }, // non-focus rule only
      ]);

      await FocusService.disable();

      // updateDynamicRules should NOT be called when no focus rules to remove
      expect(chrome.declarativeNetRequest.updateDynamicRules).not.toHaveBeenCalled();
      // But focusState should still be set
      expect(mockedStorage.set).toHaveBeenCalledWith(
        'focusState',
        { isActive: false, activatedAt: 0, source: undefined, countingStartedAt: undefined }
      );
    });

    it('records only the active counted window for manual focus', async () => {
      (chrome.declarativeNetRequest.getDynamicRules as jest.Mock).mockResolvedValue([]);
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusState') {
          return makeState({
            isActive: true,
            activatedAt: 500000,
            source: 'manual',
            countingStartedAt: 880000,
          });
        }
        if (key === 'focusSettings') return makeSettings({ enabled: true });
        return null;
      });

      await FocusService.disable();

      expect(mockedStats.recordFocusMinutes).toHaveBeenCalledWith(2);
    });

    it('does not flip the manual focus toggle off when disabling pomodoro-managed focus', async () => {
      (chrome.declarativeNetRequest.getDynamicRules as jest.Mock).mockResolvedValue([]);
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusState') {
          return makeState({
            isActive: true,
            activatedAt: 880000,
            source: 'pomodoro',
            countingStartedAt: 880000,
          });
        }
        if (key === 'focusSettings') return makeSettings({ enabled: true });
        return null;
      });

      await FocusService.disable();

      expect(mockedStorage.set).not.toHaveBeenCalledWith(
        'focusSettings',
        expect.objectContaining({ enabled: false })
      );
    });

    it('does not double-count stats when disabling flowtime-managed focus', async () => {
      (chrome.declarativeNetRequest.getDynamicRules as jest.Mock).mockResolvedValue([]);
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusState') {
          return makeState({
            isActive: true,
            activatedAt: 880000,
            source: 'flowtime',
            countingStartedAt: 880000,
          });
        }
        if (key === 'focusSettings') return makeSettings({ enabled: true });
        return null;
      });

      await FocusService.disable();

      expect(mockedStats.recordFocusMinutes).not.toHaveBeenCalled();
    });

    it('can clear runtime rules without flipping the manual focus toggle off', async () => {
      (chrome.declarativeNetRequest.getDynamicRules as jest.Mock).mockResolvedValue([]);
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusState') {
          return makeState({
            isActive: true,
            activatedAt: 880000,
            source: 'manual',
            countingStartedAt: 880000,
          });
        }
        if (key === 'focusSettings') return makeSettings({ enabled: true });
        return null;
      });

      await FocusService.clearRuntimeRulesPreservingIntent();

      expect(mockedStorage.set).not.toHaveBeenCalledWith(
        'focusSettings',
        expect.objectContaining({ enabled: false }),
      );
    });
  });

  describe('resolveBlockedDomains', () => {
    it('returns deduplicated domains from enabled presets + custom domains', () => {
      const settings = makeSettings({
        presets: { socialMedia: true, newsMedia: false, entertainment: false, shopping: false },
        customDomains: ['reddit.com', 'example.com'], // reddit.com overlaps with socialMedia
      });

      const domains = FocusService.resolveBlockedDomains(settings);

      // reddit.com appears in both socialMedia preset and customDomains -- should be deduplicated
      const redditCount = domains.filter(d => d === 'reddit.com').length;
      expect(redditCount).toBe(1);
      expect(domains).toContain('example.com');
      expect(domains).toContain('twitter.com');
    });

    it('returns empty array when no presets enabled and no custom domains', () => {
      const settings = makeSettings();

      const domains = FocusService.resolveBlockedDomains(settings);

      expect(domains).toEqual([]);
    });
  });

  describe('resolveBlockedPhrases', () => {
    it('returns deduplicated trimmed phrases from settings', () => {
      const settings = makeSettings({
        blockedPhrases: [' YouTube ', 'youtube', ' reddit ', '', '   '],
      });

      const phrases = FocusService.resolveBlockedPhrases(settings);

      expect(phrases).toEqual(['reddit', 'youtube']);
    });
  });

  describe('buildRules', () => {
    it('creates one rule per domain with REDIRECT action and regexFilter condition', () => {
      const domains = ['twitter.com', 'reddit.com'];

      const rules = FocusService.buildRules(domains);

      expect(rules).toHaveLength(2);
      expect(rules[0]).toEqual(
        expect.objectContaining({
          action: expect.objectContaining({
            type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
          }),
          condition: expect.objectContaining({
            regexFilter: expect.stringContaining('twitter\\.com'),
            resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
          }),
        })
      );
    });

    it('uses rule IDs starting from FOCUS_RULE_ID_START', () => {
      const domains = ['a.com', 'b.com', 'c.com'];

      const rules = FocusService.buildRules(domains);

      expect(rules[0].id).toBe(FOCUS_RULE_ID_START);
      expect(rules[1].id).toBe(FOCUS_RULE_ID_START + 1);
      expect(rules[2].id).toBe(FOCUS_RULE_ID_START + 2);
    });

    it('redirect carries blocked domain plus original URL transport', () => {
      const domains = ['reddit.com'];

      const rules = FocusService.buildRules(domains);

      expect(rules[0].action.redirect!.regexSubstitution).toBe(
        `${chrome.runtime.getURL(
          `${BLOCK_PAGE_PATH}?domain=${encodeURIComponent('reddit.com')}`,
        )}#url=\\0`
      );
    });

    it('matches the exact domain and subdomains while preserving the original path in redirect transport', () => {
      const [rule] = FocusService.buildRules(['google.com']);
      const filter = rule.condition.regexFilter!;

      const regex = new RegExp(filter, 'i');
      expect(regex.test('https://google.com')).toBe(true);
      expect(regex.test('https://docs.google.com/spreadsheets/d/123/edit')).toBe(true);
      expect(regex.test('https://google.com/maps?q=test')).toBe(true);
      expect(regex.test('https://notgoogle.com')).toBe(false);
      expect(regex.test('https://google.com.evil.example')).toBe(false);
    });
  });

  describe('updateBadge', () => {
    it('sets orange (#f97316) background when focus is active', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusState') return makeState({ isActive: true, activatedAt: 999000 });
        return null;
      });

      await FocusService.updateBadge();

      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
        color: '#f97316',
      });
    });

    it('does not change badge color when focus is not active', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusState') return makeState({ isActive: false });
        return null;
      });

      await FocusService.updateBadge();

      expect(chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalled();
    });
  });

  describe('cleanupStaleRules', () => {
    it('removes focus rules when focusState is not active (for service worker restart)', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusState') return makeState({ isActive: false });
        return null;
      });
      const existingRules = [
        { id: 10000, priority: 1, action: {}, condition: {} },
      ];
      (chrome.declarativeNetRequest.getDynamicRules as jest.Mock).mockResolvedValue(existingRules);

      await FocusService.cleanupStaleRules();

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        removeRuleIds: [10000],
      });
    });

    it('clears stale pomodoro-managed focus without backfilling huge time when pomodoro is inactive', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusState') {
          return makeState({
            isActive: true,
            activatedAt: 1000,
            source: 'pomodoro',
            countingStartedAt: 1000,
          });
        }
        if (key === 'pomodoroState') return makePomodoroState({ isActive: false });
        if (key === 'focusSettings') return makeSettings({ autoEnableWithPomodoro: true });
        return null;
      });
      (chrome.declarativeNetRequest.getDynamicRules as jest.Mock).mockResolvedValue([
        { id: 10000, priority: 1, action: {}, condition: {} },
      ]);

      await FocusService.cleanupStaleRules();

      expect(mockedStats.recordFocusMinutes).not.toHaveBeenCalled();
      expect(mockedStorage.set).toHaveBeenCalledWith(
        'focusState',
        { isActive: false, activatedAt: 0, source: undefined, countingStartedAt: undefined }
      );
    });

    it('flushes work minutes and pauses counting during breaks when break blocking stays on', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusState') {
          return makeState({
            isActive: true,
            activatedAt: 700000,
            source: 'pomodoro',
            countingStartedAt: 880000,
          });
        }
        if (key === 'pomodoroState') return makePomodoroState({ isActive: true, sessionType: 'shortBreak' });
        if (key === 'focusSettings') return makeSettings({ autoEnableWithPomodoro: true, blockDuringBreaks: true });
        return null;
      });

      await FocusService.cleanupStaleRules();

      expect(mockedStats.recordFocusMinutes).toHaveBeenCalledWith(2);
      expect(mockedStorage.set).toHaveBeenCalledWith(
        'focusState',
        expect.objectContaining({
          isActive: true,
          source: 'pomodoro',
          countingStartedAt: undefined,
        })
      );
    });

    it('clears stale flowtime-managed focus when Flowtime is no longer active', async () => {
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusState') {
          return makeState({
            isActive: true,
            activatedAt: 1000,
            source: 'flowtime',
            countingStartedAt: 1000,
          });
        }
        if (key === 'pomodoroState') return makePomodoroState({ isActive: false, mode: undefined });
        return null;
      });
      (chrome.declarativeNetRequest.getDynamicRules as jest.Mock).mockResolvedValue([
        { id: 10000, priority: 1, action: {}, condition: {} },
      ]);

      await FocusService.cleanupStaleRules();

      expect(mockedStats.recordFocusMinutes).not.toHaveBeenCalled();
      expect(mockedStorage.set).toHaveBeenCalledWith(
        'focusState',
        { isActive: false, activatedAt: 0, source: undefined, countingStartedAt: undefined }
      );
    });
  });

  describe('syncActiveRulesForSettingsChange', () => {
    it('re-applies rules when blocked domains change during an active focus session', async () => {
      const enableSpy = jest.spyOn(FocusService, 'enable').mockResolvedValue(undefined);
      const disableSpy = jest.spyOn(FocusService, 'disable').mockResolvedValue(undefined);
      jest.spyOn(FocusService, 'getState').mockResolvedValue(
        makeState({ isActive: true, source: 'manual', countingStartedAt: 900000 })
      );

      await FocusService.syncActiveRulesForSettingsChange(
        makeSettings(),
        makeSettings({
          presets: { socialMedia: true, newsMedia: false, entertainment: false, shopping: false },
        }),
      );

      expect(enableSpy).toHaveBeenCalledWith({
        force: true,
        source: 'manual',
        resetCounting: false,
      });
      expect(disableSpy).not.toHaveBeenCalled();
    });

    it('re-applies enforcement when blocked phrases change during an active focus session', async () => {
      const enableSpy = jest.spyOn(FocusService, 'enable').mockResolvedValue(undefined);
      jest.spyOn(FocusService, 'disable').mockResolvedValue(undefined);
      jest.spyOn(FocusService, 'getState').mockResolvedValue(
        makeState({ isActive: true, source: 'manual', countingStartedAt: 900000 })
      );

      await FocusService.syncActiveRulesForSettingsChange(
        makeSettings({ blockedPhrases: ['youtube'] }),
        makeSettings({ blockedPhrases: ['reddit'] }),
      );

      expect(enableSpy).toHaveBeenCalledWith({
        force: true,
        source: 'manual',
        resetCounting: false,
      });
    });

    it('clears runtime focus but keeps manual intent when the active blocklist becomes empty', async () => {
      const enableSpy = jest.spyOn(FocusService, 'enable').mockResolvedValue(undefined);
      const clearRuntimeSpy = jest.spyOn(FocusService, 'clearRuntimeRulesPreservingIntent').mockResolvedValue(undefined);
      jest.spyOn(FocusService, 'getState').mockResolvedValue(
        makeState({ isActive: true, source: 'manual' })
      );

      await FocusService.syncActiveRulesForSettingsChange(
        makeSettings({
          presets: { socialMedia: true, newsMedia: false, entertainment: false, shopping: false },
        }),
        makeSettings(),
      );

      expect(clearRuntimeSpy).toHaveBeenCalled();
      expect(enableSpy).not.toHaveBeenCalled();
    });

    it('does nothing when focus is inactive', async () => {
      const enableSpy = jest.spyOn(FocusService, 'enable').mockResolvedValue(undefined);
      const disableSpy = jest.spyOn(FocusService, 'disable').mockResolvedValue(undefined);
      jest.spyOn(FocusService, 'getState').mockResolvedValue(makeState({ isActive: false }));
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') return makePomodoroState({ isActive: false });
        return null;
      });

      await FocusService.syncActiveRulesForSettingsChange(
        makeSettings({ enabled: false }),
        makeSettings({
          enabled: false,
          presets: { socialMedia: true, newsMedia: false, entertainment: false, shopping: false },
        }),
      );

      expect(enableSpy).not.toHaveBeenCalled();
      expect(disableSpy).not.toHaveBeenCalled();
    });

    it('applies rules when manual focus is enabled but no rules existed at toggle time', async () => {
      const enableSpy = jest.spyOn(FocusService, 'enable').mockResolvedValue(undefined);
      jest.spyOn(FocusService, 'getState').mockResolvedValue(makeState({ isActive: false }));
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') return makePomodoroState({ isActive: false });
        return null;
      });

      await FocusService.syncActiveRulesForSettingsChange(
        makeSettings({ enabled: true }),
        makeSettings({
          enabled: true,
          customDomains: ['kick.com'],
        }),
      );

      expect(enableSpy).toHaveBeenCalledWith({
        force: true,
        source: 'manual',
        resetCounting: false,
      });
    });

    it('applies rules when pomodoro is active and the first blocked category is added mid-session', async () => {
      const enableSpy = jest.spyOn(FocusService, 'enable').mockResolvedValue(undefined);
      jest.spyOn(FocusService, 'getState').mockResolvedValue(makeState({ isActive: false, source: undefined }));
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'pomodoroState') {
          return makePomodoroState({ isActive: true, isPaused: false, sessionType: 'work' });
        }
        return null;
      });

      await FocusService.syncActiveRulesForSettingsChange(
        makeSettings({ enabled: false }),
        makeSettings({
          enabled: false,
          autoEnableWithPomodoro: true,
          presets: { socialMedia: true, newsMedia: false, entertainment: false, shopping: false },
        }),
      );

      expect(enableSpy).toHaveBeenCalledWith({
        force: true,
        source: 'pomodoro',
        resetCounting: false,
      });
    });
  });

  describe('getState', () => {
    it('returns current FocusState from storage', async () => {
      const state = makeState({ isActive: true, activatedAt: 999000 });
      mockedStorage.get.mockImplementation(async (key: string) => {
        if (key === 'focusState') return state;
        return null;
      });

      const result = await FocusService.getState();

      expect(result).toEqual(state);
    });

    it('returns default state when nothing stored', async () => {
      mockedStorage.get.mockImplementation(async () => null);

      const result = await FocusService.getState();

      expect(result).toEqual({ isActive: false, activatedAt: 0 });
    });
  });
});
