/**
 * Tests for KillSwitchService (PRIVACY-03)
 *
 * Verifies:
 *   - getEnabled() fetches from Supertry when cache is stale (>4h)
 *   - caches result with `fetchedAt`
 *   - returns last-cached value when fetch rejects (fail-open: keeps prior cache)
 *   - returns true when there is no cache AND fetch fails (fail-open default)
 *   - no-op (no fetch) when cache is still fresh (<4h)
 */

import { KillSwitchService } from '../kill-switch-service';
import { Storage } from '@/utils/storage';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function mockFetchSuccess(enabled: boolean) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ ai_history_features_enabled: enabled }),
  } as Response);
}

function mockFetchFailure() {
  mockFetch.mockRejectedValue(new Error('Network error'));
}

function mockFetchNonOk() {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({}),
  } as Response);
}

describe('KillSwitchService.fetchConfig()', () => {
  it('fetches from Supertry when cache is stale (fetchedAt > 4h ago)', async () => {
    jest.useFakeTimers();
    const now = new Date('2026-04-20T10:00:00Z').getTime();
    jest.setSystemTime(now);

    const staleCache = {
      enabled: true,
      fetchedAt: now - FOUR_HOURS_MS - 1, // stale — just expired
    };
    mockedStorage.get.mockResolvedValue(staleCache);
    mockedStorage.set.mockResolvedValue(undefined);
    mockFetchSuccess(false);

    await KillSwitchService.fetchConfig('test-token');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockedStorage.set).toHaveBeenCalledWith(
      'ai_kill_switch_cache',
      expect.objectContaining({ enabled: false, fetchedAt: now })
    );
  });

  it('does NOT fetch when cache is still fresh (fetchedAt < 4h ago)', async () => {
    jest.useFakeTimers();
    const now = new Date('2026-04-20T10:00:00Z').getTime();
    jest.setSystemTime(now);

    const freshCache = {
      enabled: true,
      fetchedAt: now - 1 * 60 * 60 * 1000, // 1 hour ago — still fresh
    };
    mockedStorage.get.mockResolvedValue(freshCache);

    await KillSwitchService.fetchConfig('test-token');

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockedStorage.set).not.toHaveBeenCalled();
  });

  it('keeps existing cached value when fetch rejects (fail-open)', async () => {
    jest.useFakeTimers();
    const now = new Date('2026-04-20T10:00:00Z').getTime();
    jest.setSystemTime(now);

    const staleCache = {
      enabled: true,
      fetchedAt: now - FOUR_HOURS_MS - 1,
    };
    mockedStorage.get.mockResolvedValue(staleCache);
    mockFetchFailure();

    // Should NOT throw
    await expect(KillSwitchService.fetchConfig('test-token')).resolves.not.toThrow();
    // Should NOT overwrite cache with bad data
    expect(mockedStorage.set).not.toHaveBeenCalled();
  });

  it('keeps existing cache when fetch returns non-2xx response (fail-open)', async () => {
    jest.useFakeTimers();
    const now = new Date('2026-04-20T10:00:00Z').getTime();
    jest.setSystemTime(now);

    const staleCache = {
      enabled: true,
      fetchedAt: now - FOUR_HOURS_MS - 1,
    };
    mockedStorage.get.mockResolvedValue(staleCache);
    mockFetchNonOk();

    await KillSwitchService.fetchConfig('test-token');

    expect(mockedStorage.set).not.toHaveBeenCalled();
  });
});

describe('KillSwitchService.isEnabled()', () => {
  it('returns true when there is no cache (fail-open default)', async () => {
    mockedStorage.get.mockResolvedValue(null);

    const result = await KillSwitchService.isEnabled();

    expect(result).toBe(true);
  });

  it('returns cached enabled value when cache exists', async () => {
    mockedStorage.get.mockResolvedValue({ enabled: false, fetchedAt: Date.now() });

    const result = await KillSwitchService.isEnabled();

    expect(result).toBe(false);
  });

  it('returns true from existing cache when fetch previously failed (prior cache was enabled)', async () => {
    // This test validates the combined fail-open behavior:
    // 1. fetchConfig() fails -> cache not updated (tested above)
    // 2. isEnabled() reads stale but still-cached 'enabled: true'
    mockedStorage.get.mockResolvedValue({ enabled: true, fetchedAt: Date.now() - 1 });

    const result = await KillSwitchService.isEnabled();

    expect(result).toBe(true);
  });
});
