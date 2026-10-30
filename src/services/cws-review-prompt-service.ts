import { Storage } from '@/utils/storage';
import { StatsService } from './stats-service';

export interface CWSReviewPromptState {
  firstSeenAt: number;
  promptCount: number;
  completed?: boolean;
  completedAt?: number;
  dismissedUntil?: number;
  lastPromptedAt?: number;
  pendingImportQualifiedAt?: number;
}

export interface CWSReviewPromptDecision {
  shouldShow: boolean;
  reviewUrl?: string;
}

const STORAGE_KEY = 'cwsReviewPromptState';
const MIN_ACTIVE_DAYS = 7;
const MIN_GROUPS_SAVED = 5;
const MIN_IMPORT_TABS = 10;
const MAX_PROMPTS = 2;
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export class CWSReviewPromptService {
  static buildReviewUrl(extensionId = chrome.runtime.id): string {
    return `https://chromewebstore.google.com/detail/${extensionId}/reviews`;
  }

  static async recordImportCompleted(tabCount: number, now = Date.now()): Promise<void> {
    if (tabCount < MIN_IMPORT_TABS) return;

    const state = await loadState(now);
    await saveState({
      ...state,
      pendingImportQualifiedAt: now,
    });
  }

  static async evaluateAfterValueAction(now = Date.now()): Promise<CWSReviewPromptDecision> {
    const state = await loadState(now);
    if (state.completed || state.promptCount >= MAX_PROMPTS) return { shouldShow: false };
    if (state.dismissedUntil && state.dismissedUntil > now) return { shouldShow: false };

    const eligibleByImport = Boolean(state.pendingImportQualifiedAt && state.pendingImportQualifiedAt < now);
    const eligibleByUsage = await hasUsageThreshold();

    if (!eligibleByImport && !eligibleByUsage) {
      return { shouldShow: false };
    }

    await saveState({
      ...state,
      promptCount: state.promptCount + 1,
      lastPromptedAt: now,
    });

    return {
      shouldShow: true,
      reviewUrl: CWSReviewPromptService.buildReviewUrl(),
    };
  }

  static async dismiss(now = Date.now()): Promise<void> {
    const state = await loadState(now);
    await saveState({
      ...state,
      dismissedUntil: now + SNOOZE_MS,
    });
  }

  static async completeReview(now = Date.now()): Promise<void> {
    const state = await loadState(now);
    await saveState({
      ...state,
      completed: true,
      completedAt: now,
    });
  }
}

async function loadState(now: number): Promise<CWSReviewPromptState> {
  const stored = await Storage.get<CWSReviewPromptState>(STORAGE_KEY);
  if (stored) return stored;

  const initialState: CWSReviewPromptState = {
    firstSeenAt: now,
    promptCount: 0,
    completed: false,
  };
  await saveState(initialState);
  return initialState;
}

async function saveState(state: CWSReviewPromptState): Promise<void> {
  await Storage.set(STORAGE_KEY, state);
}

async function hasUsageThreshold(): Promise<boolean> {
  const [daily, aggregate] = await Promise.all([
    StatsService.getDailyStats(365),
    StatsService.getAggregateStats(365),
  ]);

  const activeDays = daily.filter((entry) => (
    entry.groupsSaved > 0
    || entry.tabsCreated > 0
    || entry.tabsRemoved > 0
    || entry.tabsActivated > 0
    || (entry.focusMinutes ?? 0) > 0
  )).length;

  return activeDays >= MIN_ACTIVE_DAYS && aggregate.totalGroupsSaved >= MIN_GROUPS_SAVED;
}
