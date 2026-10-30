/**
 * Tests for adhd-service.ts
 *
 * Covers ADHD-01 (master toggle gating), ADHD-02 (isFeatureActive returns
 * FALSE when master is OFF even if sub is enabled), ADHD-03 (sync-key
 * registration is verified in delta-tracker.test.ts, not here).
 *
 * Storage IO is mocked via @/utils/storage.
 */

import { ADHDService } from './adhd-service';
import { Storage } from '@/utils/storage';
import {
  ADHD_SETTINGS_STORAGE_KEY,
  DEFAULT_ADHD_SETTINGS,
  type ADHDSettings,
} from '@/types/adhd';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

const mockStorageGet = Storage.get as jest.Mock;
const mockStorageSet = Storage.set as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockStorageSet.mockResolvedValue(undefined);
});

// ============================================================================
// getSettings — defaults + deep merge
// ============================================================================

describe('ADHDService.getSettings', () => {
  it('returns DEFAULT_ADHD_SETTINGS when storage key is unset', async () => {
    mockStorageGet.mockResolvedValueOnce(null);

    const result = await ADHDService.getSettings();

    expect(result).toEqual(DEFAULT_ADHD_SETTINGS);
    expect(mockStorageGet).toHaveBeenCalledWith(ADHD_SETTINGS_STORAGE_KEY);
  });

  it('deep-merges stored partial with defaults so missing sub-fields fall back', async () => {
    // Stored value has ONLY masterEnabled set; sub-objects are missing entirely.
    mockStorageGet.mockResolvedValueOnce({ masterEnabled: true } as unknown as ADHDSettings);

    const result = await ADHDService.getSettings();

    expect(result.masterEnabled).toBe(true);
    // Sub-objects must be populated from defaults.
    expect(result.autoSuspend).toEqual(DEFAULT_ADHD_SETTINGS.autoSuspend);
    expect(result.simplify).toEqual(DEFAULT_ADHD_SETTINGS.simplify);
    expect(result.visualTime).toEqual(DEFAULT_ADHD_SETTINGS.visualTime);
    expect(result.brainDump).toEqual(DEFAULT_ADHD_SETTINGS.brainDump);
  });

  it('preserves partial sub-object fields by merging with their defaults', async () => {
    // Stored value supplies autoSuspend.enabled but omits thresholdMin and whitelistDomains.
    mockStorageGet.mockResolvedValueOnce({
      masterEnabled: true,
      autoSuspend: { enabled: true },
    } as unknown as ADHDSettings);

    const result = await ADHDService.getSettings();

    expect(result.autoSuspend.enabled).toBe(true);
    expect(result.autoSuspend.thresholdMin).toBe(30);
    expect(result.autoSuspend.whitelistDomains).toEqual([]);
  });

  it('fills missing Flowtime auto-focus flag from defaults', async () => {
    mockStorageGet.mockResolvedValueOnce({
      masterEnabled: true,
      flowtimeTimer: { enabled: true, coefficient: 0.25 },
    } as unknown as ADHDSettings);

    const result = await ADHDService.getSettings();

    expect(result.flowtimeTimer.enabled).toBe(true);
    expect(result.flowtimeTimer.coefficient).toBe(0.25);
    expect(result.flowtimeTimer.autoFocusEnabled).toBe(false);
  });
});

// ============================================================================
// updateSettings — deep merge write semantics
// ============================================================================

describe('ADHDService.updateSettings', () => {
  it('flips masterEnabled while preserving every sub-object default', async () => {
    mockStorageGet.mockResolvedValueOnce(null);

    await ADHDService.updateSettings({ masterEnabled: true });

    expect(mockStorageSet).toHaveBeenCalledTimes(1);
    const [key, value] = mockStorageSet.mock.calls[0];
    expect(key).toBe(ADHD_SETTINGS_STORAGE_KEY);
    expect(value.masterEnabled).toBe(true);
    expect(value.autoSuspend).toEqual(DEFAULT_ADHD_SETTINGS.autoSuspend);
    expect(value.simplify).toEqual(DEFAULT_ADHD_SETTINGS.simplify);
    expect(value.visualTime).toEqual(DEFAULT_ADHD_SETTINGS.visualTime);
    expect(value.brainDump).toEqual(DEFAULT_ADHD_SETTINGS.brainDump);
  });

  it('deep-merges sub-object patches with existing sub-fields', async () => {
    mockStorageGet.mockResolvedValueOnce({
      ...DEFAULT_ADHD_SETTINGS,
      masterEnabled: true,
      autoSuspend: { enabled: false, thresholdMin: 30, whitelistDomains: ['example.com'] },
    });

    // Patch only autoSuspend.enabled; thresholdMin (30) and whitelist must survive.
    await ADHDService.updateSettings({ autoSuspend: { enabled: true } });

    const [, value] = mockStorageSet.mock.calls[0];
    expect(value.autoSuspend.enabled).toBe(true);
    expect(value.autoSuspend.thresholdMin).toBe(30);
    expect(value.autoSuspend.whitelistDomains).toEqual(['example.com']);
    // Other sub-objects untouched.
    expect(value.simplify).toEqual(DEFAULT_ADHD_SETTINGS.simplify);
  });

  it('deep-merges Flowtime auto-focus without dropping coefficient', async () => {
    mockStorageGet.mockResolvedValueOnce({
      ...DEFAULT_ADHD_SETTINGS,
      flowtimeTimer: { enabled: true, coefficient: 0.25, autoFocusEnabled: false },
    });

    await ADHDService.updateSettings({ flowtimeTimer: { autoFocusEnabled: true } });

    const [, value] = mockStorageSet.mock.calls[0];
    expect(value.flowtimeTimer).toEqual({
      enabled: true,
      coefficient: 0.25,
      autoFocusEnabled: true,
    });
  });
});

// ============================================================================
// isFeatureActive — ADHD-02 master gating
// ============================================================================

describe('ADHDService.isFeatureActive — master-gate (ADHD-02)', () => {
  it('returns FALSE when master is OFF even if autoSuspend.enabled is TRUE', async () => {
    mockStorageGet.mockResolvedValueOnce({
      ...DEFAULT_ADHD_SETTINGS,
      masterEnabled: false,
      autoSuspend: { enabled: true, thresholdMin: 30, whitelistDomains: [] },
    });

    await expect(ADHDService.isFeatureActive('autoSuspend')).resolves.toBe(false);
  });

  it('returns TRUE only when master AND sub are both enabled (ADHD-01/02)', async () => {
    mockStorageGet.mockResolvedValueOnce({
      ...DEFAULT_ADHD_SETTINGS,
      masterEnabled: true,
      autoSuspend: { enabled: true, thresholdMin: 30, whitelistDomains: [] },
    });

    await expect(ADHDService.isFeatureActive('autoSuspend')).resolves.toBe(true);
  });
});

// ============================================================================
// subscribe — forwards only adhd_settings onChanged events
// ============================================================================

describe('ADHDService.subscribe', () => {
  it('forwards adhd_settings changes and ignores unrelated keys', () => {
    const listener = jest.fn();
    const addListener = chrome.storage.onChanged.addListener as jest.Mock;
    const removeListener = chrome.storage.onChanged.removeListener as jest.Mock;

    const unsubscribe = ADHDService.subscribe(listener);

    // Capture the wrapper registered with chrome.storage.onChanged.
    expect(addListener).toHaveBeenCalledTimes(1);
    const wrapper = addListener.mock.calls[addListener.mock.calls.length - 1][0] as (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => void;

    // Fire an unrelated change — listener must NOT be called.
    wrapper({ someOtherKey: { oldValue: 1, newValue: 2 } }, 'local');
    expect(listener).not.toHaveBeenCalled();

    // Fire an adhd_settings change — listener must receive the new value.
    const newValue = { ...DEFAULT_ADHD_SETTINGS, masterEnabled: true };
    wrapper({ [ADHD_SETTINGS_STORAGE_KEY]: { oldValue: DEFAULT_ADHD_SETTINGS, newValue } }, 'local');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(newValue);

    // Unsubscribe removes the wrapper.
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(wrapper);
  });
});
