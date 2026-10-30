/**
 * @file distraction-pipeline.smoke.test.ts
 *
 * END-TO-END SERVICE-LAYER SMOKE TEST for the AI Distraction Detector pipeline.
 *
 * PURPOSE: Automated fallback for VALIDATION.md manual-only items that require
 *   either a real Supertry backend (DETECT-05 rationale pass-through) or a real
 *   Chrome profile (PRIVACY-01 consent modal, DETECT-01 UI trigger).
 *
 *   When Supertry's classify-distraction-candidates endpoint is unavailable (e.g.
 *   during development, CI, or a Supertry outage), these tests guarantee that the
 *   service-layer composition is correct:
 *     - PRIVACY-01 (service-layer): aggregated-domain payload is sent; no raw URLs
 *     - DETECT-01 (service-layer): scan() runs the full pipeline end-to-end
 *     - DETECT-05 (service-layer): AI rationale is passed through to scanCache
 *     - DETECT-08: suppressed domains are filtered from returned candidates
 *     - DETECT-11: domains in FocusService.resolveBlockedDomains are filtered
 *
 *   The modal/UI-level behaviors (consent modal rendering, Pro badge click routing,
 *   dry-run preview tab list) still require the Plan 11-05 Task 4 human checkpoint.
 *
 * See: .planning/phases/11-ai-distraction-detector-ai-flow-rule-designer/11-VALIDATION.md
 *   for the full manual-only coverage items this test provides fallback for.
 */

import { DistractionDetectorService } from '../distraction-detector-service';
import { KillSwitchService } from '../kill-switch-service';
import { AIAllowanceService } from '../ai-allowance-service';
import { FocusService } from '../focus-service';
import type { ScanCache, DomainAggregate } from '../../types/distraction';

// ─── Module-level mocks ──────────────────────────────────────────────────────

jest.mock('../kill-switch-service');
jest.mock('../ai-allowance-service');
jest.mock('../history-aggregator');
jest.mock('../focus-service');

import { aggregateHistory, hasMinimumHistoryDays } from '../history-aggregator';

const mockAggregateHistory = aggregateHistory as jest.MockedFunction<typeof aggregateHistory>;
const mockHasMinimumHistoryDays = hasMinimumHistoryDays as jest.MockedFunction<typeof hasMinimumHistoryDays>;
const mockKillSwitchIsEnabled = KillSwitchService.isEnabled as jest.MockedFunction<typeof KillSwitchService.isEnabled>;
const mockSyncAllowance = AIAllowanceService.syncFromAIResponse as jest.MockedFunction<typeof AIAllowanceService.syncFromAIResponse>;
const mockAddCustomDomains = FocusService.addCustomDomains as jest.MockedFunction<typeof FocusService.addCustomDomains>;
const mockResolveBlockedDomains = FocusService.resolveBlockedDomains as jest.MockedFunction<typeof FocusService.resolveBlockedDomains>;

// ─── Chrome + fetch mocks ────────────────────────────────────────────────────

const storageStore: Record<string, unknown> = {};

const mockStorageGet = jest.fn((key: string, callback: (items: Record<string, unknown>) => void) => {
  callback({ [key]: storageStore[key] ?? null });
});
const mockStorageSet = jest.fn((items: Record<string, unknown>, callback?: () => void) => {
  Object.assign(storageStore, items);
  if (callback) callback();
});

const mockPermissionsContains = jest.fn();
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
    history: {
      search: jest.fn(),
      getVisits: jest.fn(),
    },
  };
  global.fetch = mockFetch;
});

// ─── Shared fixtures ─────────────────────────────────────────────────────────

/**
 * Synthetic 30-day history fixture — 12 domains covering realistic browsing patterns.
 * youtube.com is deliberately included in the Focus blocklist (DETECT-11 proxy test).
 * reddit.com is used for the primary candidate in Test 1.
 * twitter.com is added to the suppression list for DETECT-08 test.
 */
const FIXTURE_AGGREGATES: DomainAggregate[] = [
  { domain: 'reddit.com',    visitCount: 48, sessionCount: 12, timeOfDay: new Array(24).fill(2) },
  { domain: 'hackernews.com',visitCount: 30, sessionCount: 10, timeOfDay: new Array(24).fill(1) },
  { domain: 'lobste.rs',     visitCount: 20, sessionCount: 8,  timeOfDay: new Array(24).fill(1) },
  { domain: 'twitter.com',   visitCount: 35, sessionCount: 9,  timeOfDay: new Array(24).fill(1) },
  { domain: 'tiktok.com',    visitCount: 25, sessionCount: 7,  timeOfDay: new Array(24).fill(1) },
  { domain: 'twitch.tv',     visitCount: 15, sessionCount: 5,  timeOfDay: new Array(24).fill(1) },
  { domain: 'instagram.com', visitCount: 40, sessionCount: 11, timeOfDay: new Array(24).fill(2) },
  { domain: 'facebook.com',  visitCount: 10, sessionCount: 4,  timeOfDay: new Array(24).fill(0) },
  { domain: 'discord.com',   visitCount: 22, sessionCount: 6,  timeOfDay: new Array(24).fill(1) },
  { domain: 'slack.com',     visitCount: 60, sessionCount: 20, timeOfDay: new Array(24).fill(3) },
  { domain: 'notion.so',     visitCount: 45, sessionCount: 15, timeOfDay: new Array(24).fill(2) },
  // youtube.com — in Focus blocklist, should be filtered by DETECT-11 proxy
  { domain: 'youtube.com',   visitCount: 80, sessionCount: 25, timeOfDay: new Array(24).fill(3) },
];

/** Mocked Supertry classify-distraction-candidates response (3 candidates). */
const MOCK_SUPERTRY_RESPONSE = {
  candidates: [
    { domain: 'reddit.com',    rationale: '48 visits over 12 sessions, mostly in evenings.', confidence: 0.82 },
    { domain: 'hackernews.com',rationale: '30 visits over 10 sessions, peak at noon.',         confidence: 0.71 },
    { domain: 'instagram.com', rationale: '40 visits over 11 sessions, evening clusters.',     confidence: 0.78 },
  ],
  tokensUsed: 1240,
};

/** Set all happy-path mocks so tests only need to override what they care about. */
function setupHappyPath(): void {
  mockKillSwitchIsEnabled.mockResolvedValue(true);
  mockPermissionsContains.mockResolvedValue(true);
  mockHasMinimumHistoryDays.mockResolvedValue(true);
  mockSyncAllowance.mockResolvedValue(undefined);
  mockAddCustomDomains.mockResolvedValue(undefined);
  // youtube.com is in the Focus blocklist (DETECT-11 proxy)
  mockResolveBlockedDomains.mockReturnValue(['youtube.com']);
  mockAggregateHistory.mockResolvedValue(FIXTURE_AGGREGATES);
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => MOCK_SUPERTRY_RESPONSE,
  } as Response);
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(storageStore).forEach(k => delete storageStore[k]);
  setupHappyPath();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Distraction Pipeline Smoke Test — automated fallback for manual-only VALIDATION.md items (PRIVACY-01/DETECT-01/DETECT-05 service-layer invariants)', () => {

  describe('Test 1: Core pipeline (PRIVACY-01 + DETECT-01 + DETECT-05 service-layer)', () => {
    it('scan() returns { status: ok, scanCache } with candidates and passes rationale through (DETECT-05)', async () => {
      storageStore['focusSettings'] = {
        enabled: false,
        presets: { socialMedia: false, newsMedia: false, entertainment: false, shopping: false },
        customDomains: [],
        autoEnableWithPomodoro: false,
        blockDuringBreaks: false,
      };

      const result = await DistractionDetectorService.scan('mock-token');

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;

      // scanCache has scannedAt and candidates
      expect(typeof result.scanCache.scannedAt).toBe('number');
      expect(result.scanCache.candidates.length).toBeGreaterThan(0);

      // DETECT-05: rationale is passed through verbatim from the Supertry response
      const redditCandidate = result.scanCache.candidates.find(c => c.domain === 'reddit.com');
      expect(redditCandidate).toBeDefined();
      expect(redditCandidate?.rationale).toBe('48 visits over 12 sessions, mostly in evenings.');
    });

    it('fetch is called with classify-distraction-candidates URL and no raw URLs in body (PRIVACY-01 aggregated-default)', async () => {
      storageStore['focusSettings'] = {
        enabled: false,
        presets: { socialMedia: false, newsMedia: false, entertainment: false, shopping: false },
        customDomains: [],
        autoEnableWithPomodoro: false,
        blockDuringBreaks: false,
      };

      await DistractionDetectorService.scan('mock-token');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      // PRIVACY-01: URL must contain the classify-distraction-candidates endpoint
      expect(url).toContain('/ai/classify-distraction-candidates');

      // PRIVACY-01: body must NOT contain raw URL strings — only aggregates
      const body = JSON.parse(options.body as string);
      expect(body.sendRawUrls).toBe(false);
      // No rawUrls field should be present in any aggregate
      for (const agg of body.aggregates) {
        expect(agg.rawUrls).toBeUndefined();
        // Each aggregate must have domain, visitCount, sessionCount, timeOfDay
        expect(typeof agg.domain).toBe('string');
        expect(typeof agg.visitCount).toBe('number');
        expect(typeof agg.sessionCount).toBe('number');
        expect(Array.isArray(agg.timeOfDay)).toBe(true);
      }
    });

    it('refreshes allowance summary after a successful Supertry response', async () => {
      storageStore['focusSettings'] = {
        enabled: false,
        presets: { socialMedia: false, newsMedia: false, entertainment: false, shopping: false },
        customDomains: [],
        autoEnableWithPomodoro: false,
        blockDuringBreaks: false,
      };

      await DistractionDetectorService.scan('mock-token');

      expect(mockSyncAllowance).toHaveBeenCalledTimes(1);
    });
  });

  describe('Test 2: Approve flow (DETECT-07 service-layer)', () => {
    it('approve() calls FocusService.addCustomDomains with the selected domains and { source: "ai" }', async () => {
      const cache: ScanCache = {
        scannedAt: Date.now(),
        candidates: [
          {
            domain: 'reddit.com',
            rationale: '48 visits over 12 sessions, mostly in evenings.',
            confidence: 0.82,
            aggregate: FIXTURE_AGGREGATES[0],
          },
          {
            domain: 'hackernews.com',
            rationale: '30 visits over 10 sessions.',
            confidence: 0.71,
            aggregate: FIXTURE_AGGREGATES[1],
          },
        ],
      };
      storageStore['distraction_scan_cache'] = cache;

      await DistractionDetectorService.approve(['reddit.com']);

      expect(mockAddCustomDomains).toHaveBeenCalledWith(['reddit.com'], { source: 'ai' });
    });

    it('approve() removes the approved domain from distraction_scan_cache in storage', async () => {
      const cache: ScanCache = {
        scannedAt: Date.now(),
        candidates: [
          {
            domain: 'reddit.com',
            rationale: '48 visits over 12 sessions.',
            confidence: 0.82,
            aggregate: FIXTURE_AGGREGATES[0],
          },
          {
            domain: 'hackernews.com',
            rationale: '30 visits over 10 sessions.',
            confidence: 0.71,
            aggregate: FIXTURE_AGGREGATES[1],
          },
        ],
      };
      storageStore['distraction_scan_cache'] = cache;

      await DistractionDetectorService.approve(['reddit.com']);

      const updatedCache = storageStore['distraction_scan_cache'] as ScanCache;
      expect(updatedCache.candidates.map(c => c.domain)).not.toContain('reddit.com');
      expect(updatedCache.candidates.map(c => c.domain)).toContain('hackernews.com');
    });
  });

  describe('Test 3: DETECT-11 blocklist-filter proxy — pre-blocklisted domains removed from candidates', () => {
    it('youtube.com (in Focus blocklist) is filtered from the aggregates sent to Supertry', async () => {
      // youtube.com is in resolveBlockedDomains — set up focusSettings so the filter runs
      storageStore['focusSettings'] = {
        enabled: true,
        presets: { socialMedia: false, newsMedia: false, entertainment: false, shopping: false },
        customDomains: ['youtube.com'],
        autoEnableWithPomodoro: false,
        blockDuringBreaks: false,
      };
      // resolveBlockedDomains already mocked to return ['youtube.com'] in setupHappyPath()

      await DistractionDetectorService.scan('mock-token');

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body as string);
      const sentDomains = body.aggregates.map((a: DomainAggregate) => a.domain);

      // DETECT-11: youtube.com is in the Focus blocklist — must NOT appear in the payload
      expect(sentDomains).not.toContain('youtube.com');
      // Other domains not in the blocklist are included
      expect(sentDomains).toContain('reddit.com');
    });
  });

  describe('Test 4: DETECT-08 suppression filter — suppressed domains removed from candidates', () => {
    it('twitter.com (in suppression list) is filtered from aggregates sent to Supertry', async () => {
      // Set twitter.com as suppressed with a future TTL
      const suppressUntil = Date.now() + 30 * 24 * 60 * 60 * 1000;
      storageStore['distraction_suppression_list'] = { 'twitter.com': suppressUntil };

      storageStore['focusSettings'] = {
        enabled: false,
        presets: { socialMedia: false, newsMedia: false, entertainment: false, shopping: false },
        customDomains: [],
        autoEnableWithPomodoro: false,
        blockDuringBreaks: false,
      };

      await DistractionDetectorService.scan('mock-token');

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body as string);
      const sentDomains = body.aggregates.map((a: DomainAggregate) => a.domain);

      // DETECT-08: twitter.com is suppressed — must NOT appear in the payload
      expect(sentDomains).not.toContain('twitter.com');
      // Other non-suppressed domains are included
      expect(sentDomains).toContain('reddit.com');
    });
  });
});
