import { CWSReviewPromptService } from './cws-review-prompt-service';
import { Storage } from '@/utils/storage';
import { StatsService } from './stats-service';
import type { DailyStats } from '@/types/stats';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock('./stats-service', () => ({
  StatsService: {
    getDailyStats: jest.fn(),
    getAggregateStats: jest.fn(),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;
const mockedStats = StatsService as jest.Mocked<typeof StatsService>;

const day = 24 * 60 * 60 * 1000;
const now = new Date('2026-06-10T12:00:00Z').getTime();

function daily(date: string, groupsSaved = 1): DailyStats {
  return {
    date,
    tabsCreated: 0,
    tabsRemoved: 0,
    tabsActivated: 0,
    domainCounts: {},
    groupsSaved,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedStorage.set.mockResolvedValue(undefined);
  mockedStorage.get.mockResolvedValue(null);
  mockedStats.getDailyStats.mockResolvedValue([]);
  mockedStats.getAggregateStats.mockResolvedValue({
    totalCreated: 0,
    totalRemoved: 0,
    totalActivated: 0,
    totalGroupsSaved: 0,
    topDomains: [],
  });
});

describe('CWSReviewPromptService', () => {
  it('does not show before the active-day and saved-group threshold', async () => {
    mockedStats.getDailyStats.mockResolvedValue([
      daily('2026-06-09'),
      daily('2026-06-10'),
    ]);
    mockedStats.getAggregateStats.mockResolvedValue({
      totalCreated: 0,
      totalRemoved: 0,
      totalActivated: 0,
      totalGroupsSaved: 2,
      topDomains: [],
    });

    const decision = await CWSReviewPromptService.evaluateAfterValueAction(now);

    expect(decision.shouldShow).toBe(false);
    expect(mockedStorage.set).toHaveBeenCalledWith(
      'cwsReviewPromptState',
      expect.objectContaining({ firstSeenAt: now, promptCount: 0 }),
    );
  });

  it('shows after seven active days and five saved groups, then records a prompt count', async () => {
    mockedStats.getDailyStats.mockResolvedValue([
      daily('2026-06-04'),
      daily('2026-06-05'),
      daily('2026-06-06'),
      daily('2026-06-07'),
      daily('2026-06-08'),
      daily('2026-06-09'),
      daily('2026-06-10'),
    ]);
    mockedStats.getAggregateStats.mockResolvedValue({
      totalCreated: 0,
      totalRemoved: 0,
      totalActivated: 0,
      totalGroupsSaved: 5,
      topDomains: [],
    });

    const decision = await CWSReviewPromptService.evaluateAfterValueAction(now);

    expect(decision).toEqual({
      shouldShow: true,
      reviewUrl: 'https://chromewebstore.google.com/detail/test-extension-id/reviews',
    });
    expect(mockedStorage.set).toHaveBeenCalledWith(
      'cwsReviewPromptState',
      expect.objectContaining({ promptCount: 1, lastPromptedAt: now }),
    );
  });

  it('records a large import as a pending trigger but waits for a later value action', async () => {
    await CWSReviewPromptService.recordImportCompleted(10, now);

    mockedStorage.get.mockResolvedValue({
      firstSeenAt: now,
      promptCount: 0,
      completed: false,
      pendingImportQualifiedAt: now,
    });

    await expect(CWSReviewPromptService.evaluateAfterValueAction(now)).resolves.toMatchObject({
      shouldShow: false,
    });

    await expect(CWSReviewPromptService.evaluateAfterValueAction(now + 1)).resolves.toMatchObject({
      shouldShow: true,
    });
  });

  it('snoozes dismissals for 30 days and suppresses after review completion', async () => {
    await CWSReviewPromptService.dismiss(now);
    expect(mockedStorage.set).toHaveBeenCalledWith(
      'cwsReviewPromptState',
      expect.objectContaining({ dismissedUntil: now + 30 * day }),
    );

    mockedStorage.get.mockResolvedValue({
      firstSeenAt: now - 10 * day,
      promptCount: 1,
      completed: false,
      dismissedUntil: now + day,
    });

    await expect(CWSReviewPromptService.evaluateAfterValueAction(now)).resolves.toMatchObject({
      shouldShow: false,
    });

    await CWSReviewPromptService.completeReview(now);
    expect(mockedStorage.set).toHaveBeenCalledWith(
      'cwsReviewPromptState',
      expect.objectContaining({ completed: true, completedAt: now }),
    );
  });

  it('never shows more than twice', async () => {
    mockedStorage.get.mockResolvedValue({
      firstSeenAt: now - 10 * day,
      promptCount: 2,
      completed: false,
    });

    const decision = await CWSReviewPromptService.evaluateAfterValueAction(now);

    expect(decision.shouldShow).toBe(false);
  });
});
