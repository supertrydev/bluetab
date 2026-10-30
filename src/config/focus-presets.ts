/**
 * @module config/focus-presets
 *
 * WHY:  Focus Mode needs a curated set of distracting domains organized by
 *       category so users can toggle entire categories on/off rather than
 *       manually adding dozens of domains. Centralizing domain lists and
 *       rule ID ranges here keeps configuration separate from service logic.
 *
 * WHAT: Preset domain lists (4 categories), rule ID range constants, block
 *       page path, and default FocusSettings for first-time users.
 *
 * HOW:  Pure constants — no runtime logic. Imported by FocusService for
 *       domain resolution and rule building, and by Settings UI for
 *       category display.
 *
 * NOT:  Does not contain the blocking logic (see services/focus-service.ts).
 *       Does not manage Chrome API calls.
 *
 * [BlueTab][FocusPresets]
 */

import type { FocusSettings } from '@/types/productivity';

type PartialFocusSettings = Partial<Omit<FocusSettings, 'presets'>> & {
  presets?: Partial<FocusSettings['presets']>;
};

/**
 * Preset domain lists by category.
 * Each domain auto-matches subdomains via declarativeNetRequest requestDomains.
 */
export const FOCUS_PRESETS = {
  socialMedia: [
    'twitter.com',
    'x.com',
    'facebook.com',
    'instagram.com',
    'tiktok.com',
    'reddit.com',
    'linkedin.com',
    'threads.net',
  ],
  newsMedia: [
    'cnn.com',
    'bbc.com',
    'nytimes.com',
    'theguardian.com',
    'news.ycombinator.com',
    'news.google.com',
    'washingtonpost.com',
    'foxnews.com',
    'reuters.com',
  ],
  entertainment: [
    'youtube.com',
    'netflix.com',
    'twitch.tv',
    'spotify.com',
    'disneyplus.com',
    'hulu.com',
    'primevideo.com',
    'steampowered.com',
  ],
  shopping: [
    'amazon.com',
    'ebay.com',
    'aliexpress.com',
    'walmart.com',
    'target.com',
    'etsy.com',
    'bestbuy.com',
  ],
} as const;

/** Start of reserved rule ID range for focus dynamic rules (inclusive). */
export const FOCUS_RULE_ID_START = 10000;

/** End of reserved rule ID range for focus dynamic rules (exclusive). */
export const FOCUS_RULE_ID_END = 19999;

/** Extension-relative path to the block page for redirect rules. */
export const BLOCK_PAGE_PATH = '/src/blocked/index.html';

/** Default FocusSettings for first-time users — everything off. */
export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  enabled: false,
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
};

export function normalizeFocusSettings(
  settings?: PartialFocusSettings | null,
): FocusSettings {
  return {
    ...DEFAULT_FOCUS_SETTINGS,
    ...settings,
    presets: {
      ...DEFAULT_FOCUS_SETTINGS.presets,
      ...(settings?.presets ?? {}),
    },
    customDomains: settings?.customDomains ?? DEFAULT_FOCUS_SETTINGS.customDomains,
    blockedPhrases: settings?.blockedPhrases ?? DEFAULT_FOCUS_SETTINGS.blockedPhrases,
  };
}
