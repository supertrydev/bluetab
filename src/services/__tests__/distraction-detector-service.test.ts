/**
 * Tests for DistractionDetectorService (DETECT-01..11)
 *
 * Bodies filled by Plan 11-03 Task 1 (was stub in Plan 11-01 Task 1).
 *
 * Covers:
 *   - scan() returns each block reason (kill_switch, no_permission, insufficient_history, budget, rate_limit)
 *   - scan() filters suppressed domains (DETECT-08)
 *   - scan() filters domains in FocusService.resolveBlockedDomains (DETECT-11)
 *   - approve() writes via FocusService.addCustomDomains with { source: 'ai' }
 *   - decline() writes 30-day TTL entries
 */

import { DistractionDetectorService } from '../distraction-detector-service';
import { KillSwitchService } from '../kill-switch-service';
import { AIAllowanceService } from '../ai-allowance-service';
import { FocusService } from '../focus-service';
import type { ScanCache, SuppressionList, DomainAggregate, DistractionCandidate } from '../../types/distraction';

// ─── Module-level mocks ──────────────────────────────────────────────────────

jest.mock('../kill-switch-service');
jest.mock('../ai-allowance-service');
jest.mock('../history-aggregator');
jest.mock('../focus-service');

// Import mocked modules
import { aggregateHistory, hasMinimumHistoryDays } from '../history-aggregator';

const mockAggregateHistory = aggregateHistory as jest.MockedFunction<typeof aggregateHistory>;
const mockHasMinimumHistoryDays = hasMinimumHistoryDays as jest.MockedFunction<typeof hasMinimumHistoryDays>;
const mockKillSwitchIsEnabled = KillSwitchService.isEnabled as jest.MockedFunction<typeof KillSwitchService.isEnabled>;
const mockSyncAllowance = AIAllowanceService.syncFromAIResponse as jest.MockedFunction<typeof AIAllowanceService.syncFromAIResponse>;
const mockAddCustomDomains = FocusService.addCustomDomains as jest.MockedFunction<typeof FocusService.addCustomDomains>;
const mockResolveBlockedDomains = FocusService.resolveBlockedDomains as jest.MockedFunction<typeof FocusService.resolveBlockedDomains>;

// Storage mock
const storageStore: Record<string, unknown> = {};

// chrome.storage.local mock
const mockStorageGet = jest.fn((key: string, callback: (items: Record<string, unknown>) => void) => {
  callback({ [key]: storageStore[key] ?? null });
});
const mockStorageSet = jest.fn((items: Record<string, unknown>, callback?: () => void) => {
  Object.assign(storageStore, items);
  if (callback) callback();
});

// chrome.permissions mock
const mockPermissionsContains = jest.fn();

// fetch mock
const mockFetch = jest.fn();

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).chrome = {
    storage: {
      local: {
        get: mockStorageGet,
        set: mockStorageSet,
      },
    },
    permissions: {
      contains: mockPermissionsContains,
    },
  };
  global.fetch = mockFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  // Clear storage
  Object.keys(storageStore).forEach(k => delete storageStore[k]);

  // Default happy-path mocks
  mockKillSwitchIsEnabled.mockResolvedValue(true);
  mockPermissionsContains.mockResolvedValue(true);
  mockHasMinimumHistoryDays.mockResolvedValue(true);
  mockSyncAllowance.mockResolvedValue(undefined);
  mockAddCustomDomains.mockResolvedValue(undefined);
  mockResolveBlockedDomains.mockReturnValue([]);
  mockAggregateHistory.mockResolvedValue([]);
});

// ─── Sample data ─────────────────────────────────────────────────────────────

const sampleAggregate: DomainAggregate = {
  domain: 'reddit.com',
  visitCount: 48,
  sessionCount: 12,
  timeOfDay: new Array(24).fill(2),
};

const sampleCandidate: DistractionCandidate = {
  domain: 'reddit.com',
  rationale: '48 visits over 12 sessions',
  confidence: 0.85,
  aggregate: sampleAggregate,
};

/** Helper to set up a successful Supertry fetch response. */
function mockSuccessfulFetch(candidates = [{ domain: 'reddit.com', rationale: '48 visits', confidence: 0.85 }], tokensUsed = 100) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ candidates, tokensUsed }),
  } as Response);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DistractionDetectorService (DETECT-01..11)', () => {
  describe('scan() block reasons', () => {
    it('returns { status: "blocked", reason: "kill_switch" } when KillSwitchService.isEnabled() is false', async () => {
      mockKillSwitchIsEnabled.mockResolvedValue(false);
      const result = await DistractionDetectorService.scan('test-token');
      expect(result).toEqual({ status: 'blocked', reason: 'kill_switch' });
    });

    it('returns { status: "blocked", reason: "no_permission" } when chrome.permissions.contains returns false', async () => {
      mockPermissionsContains.mockResolvedValue(false);
      const result = await DistractionDetectorService.scan('test-token');
      expect(result).toEqual({ status: 'blocked', reason: 'no_permission' });
    });

    it('returns { status: "blocked", reason: "insufficient_history" } when hasMinimumHistoryDays(7) is false', async () => {
      mockHasMinimumHistoryDays.mockResolvedValue(false);
      const result = await DistractionDetectorService.scan('test-token');
      expect(result).toEqual({ status: 'blocked', reason: 'insufficient_history' });
    });

    it('returns { status: "blocked", reason: "budget" } when the backend returns token_cap_exceeded', async () => {
      mockAggregateHistory.mockResolvedValue([sampleAggregate]);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        clone: () => ({
          json: async () => ({ error: 'token_cap_exceeded' }),
        }),
      } as unknown as Response);
      const result = await DistractionDetectorService.scan('test-token');
      expect(result).toEqual({ status: 'blocked', reason: 'budget' });
    });

    it('returns { status: "blocked", reason: "rate_limit" } when the backend returns a non-allowance 429', async () => {
      mockAggregateHistory.mockResolvedValue([sampleAggregate]);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        clone: () => ({
          json: async () => ({ error: 'rate_limit_exceeded' }),
        }),
      } as unknown as Response);
      const result = await DistractionDetectorService.scan('test-token');
      expect(result).toEqual({ status: 'blocked', reason: 'rate_limit' });
    });
  });

  describe('scan() candidate filtering', () => {
    it('filters out domains that appear in distraction_suppression_list within TTL (DETECT-08)', async () => {
      // Set up a suppressed domain (reddit.com) with future TTL
      const suppressUntil = Date.now() + 24 * 60 * 60 * 1000; // 24h from now
      storageStore['distraction_suppression_list'] = { 'reddit.com': suppressUntil } as SuppressionList;

      // aggregateHistory returns both reddit.com and twitter.com
      const twitterAggregate: DomainAggregate = {
        domain: 'twitter.com',
        visitCount: 20,
        sessionCount: 5,
        timeOfDay: new Array(24).fill(1),
      };
      mockAggregateHistory.mockResolvedValue([sampleAggregate, twitterAggregate]);

      mockSuccessfulFetch([{ domain: 'twitter.com', rationale: '20 visits', confidence: 0.75 }], 80);

      const result = await DistractionDetectorService.scan('test-token');
      expect(result.status).toBe('ok');

      // Verify fetch was called without reddit.com in the aggregates payload
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const sentDomains = body.aggregates.map((a: DomainAggregate) => a.domain);
      expect(sentDomains).not.toContain('reddit.com');
      expect(sentDomains).toContain('twitter.com');
    });

    it('filters out domains returned by FocusService.resolveBlockedDomains (DETECT-11 proxy)', async () => {
      // Focus blocklist includes reddit.com
      mockResolveBlockedDomains.mockReturnValue(['reddit.com', 'facebook.com']);

      const twitterAggregate: DomainAggregate = {
        domain: 'twitter.com',
        visitCount: 20,
        sessionCount: 5,
        timeOfDay: new Array(24).fill(1),
      };
      mockAggregateHistory.mockResolvedValue([sampleAggregate, twitterAggregate]);

      // focusSettings must be present for resolve to be called
      storageStore['focusSettings'] = {
        enabled: true,
        presets: { socialMedia: true, newsMedia: false, entertainment: false, shopping: false },
        customDomains: [],
        autoEnableWithPomodoro: false,
        blockDuringBreaks: false,
      };

      mockSuccessfulFetch([{ domain: 'twitter.com', rationale: '20 visits', confidence: 0.75 }], 80);

      const result = await DistractionDetectorService.scan('test-token');
      expect(result.status).toBe('ok');

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const sentDomains = body.aggregates.map((a: DomainAggregate) => a.domain);
      expect(sentDomains).not.toContain('reddit.com');
      expect(sentDomains).not.toContain('facebook.com');
      expect(sentDomains).toContain('twitter.com');
    });

    it('returns unfiltered candidates when suppression list is empty and no Focus-blocked domains', async () => {
      mockAggregateHistory.mockResolvedValue([sampleAggregate]);
      mockSuccessfulFetch();

      const result = await DistractionDetectorService.scan('test-token');
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.scanCache.candidates).toHaveLength(1);
        expect(result.scanCache.candidates[0].domain).toBe('reddit.com');
      }
    });
  });

  describe('approve()', () => {
    it('calls FocusService.addCustomDomains with selected domains and { source: "ai" } option', async () => {
      // Set up a cache
      const cache: ScanCache = { scannedAt: Date.now(), candidates: [sampleCandidate] };
      storageStore['distraction_scan_cache'] = cache;

      await DistractionDetectorService.approve(['reddit.com']);

      expect(mockAddCustomDomains).toHaveBeenCalledWith(['reddit.com'], { source: 'ai' });
    });

    it('removes approved domains from cached scan results in chrome.storage.local', async () => {
      const anotherCandidate: DistractionCandidate = {
        domain: 'twitter.com',
        rationale: '20 visits',
        confidence: 0.75,
        aggregate: { domain: 'twitter.com', visitCount: 20, sessionCount: 5, timeOfDay: new Array(24).fill(1) },
      };
      const cache: ScanCache = {
        scannedAt: Date.now(),
        candidates: [sampleCandidate, anotherCandidate],
      };
      storageStore['distraction_scan_cache'] = cache;

      await DistractionDetectorService.approve(['reddit.com']);

      // Check that the cache was updated via storage set
      const updatedCache = storageStore['distraction_scan_cache'] as ScanCache;
      expect(updatedCache.candidates.map(c => c.domain)).not.toContain('reddit.com');
      expect(updatedCache.candidates.map(c => c.domain)).toContain('twitter.com');
    });
  });

  describe('decline()', () => {
    it('writes 30-day TTL entries to distraction_suppression_list for each declined domain', async () => {
      const before = Date.now();
      await DistractionDetectorService.decline(['reddit.com']);
      const after = Date.now();

      const suppression = storageStore['distraction_suppression_list'] as SuppressionList;
      expect(suppression['reddit.com']).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000);
      expect(suppression['reddit.com']).toBeLessThanOrEqual(after + 30 * 24 * 60 * 60 * 1000);
    });

    it('removes declined domains from cached scan results in chrome.storage.local', async () => {
      const anotherCandidate: DistractionCandidate = {
        domain: 'twitter.com',
        rationale: '20 visits',
        confidence: 0.75,
        aggregate: { domain: 'twitter.com', visitCount: 20, sessionCount: 5, timeOfDay: new Array(24).fill(1) },
      };
      const cache: ScanCache = {
        scannedAt: Date.now(),
        candidates: [sampleCandidate, anotherCandidate],
      };
      storageStore['distraction_scan_cache'] = cache;

      await DistractionDetectorService.decline(['reddit.com']);

      const updatedCache = storageStore['distraction_scan_cache'] as ScanCache;
      expect(updatedCache.candidates.map(c => c.domain)).not.toContain('reddit.com');
      expect(updatedCache.candidates.map(c => c.domain)).toContain('twitter.com');
    });

    it('prunes expired entries from suppression list before adding new ones', async () => {
      // Set up an expired suppression for another domain
      const expiredTime = Date.now() - 1000; // already expired
      storageStore['distraction_suppression_list'] = {
        'old-suppressed.com': expiredTime,
      } as SuppressionList;

      await DistractionDetectorService.decline(['reddit.com']);

      const suppression = storageStore['distraction_suppression_list'] as SuppressionList;
      // Old expired entry should be pruned
      expect(suppression['old-suppressed.com']).toBeUndefined();
      // New entry should be present
      expect(suppression['reddit.com']).toBeGreaterThan(Date.now());
    });
  });
});
