/**
 * @module platform/extension-platform
 *
 * WHY:  Chrome-only APIs (sidePanel, offscreen, _favicon, Web Store links,
 *       chrome:// pages) are undefined in Firefox. Calling them at the top
 *       level of the background script throws and stops the whole event
 *       page, so every such call goes through a helper here.
 *
 * WHAT: Small browser-specific helpers. Each one keeps the Chrome behaviour
 *       unchanged and adds the Firefox equivalent (or a safe fallback).
 *
 * NOT:  Does not polyfill the `browser` namespace. Firefox supports the
 *       `chrome` namespace with promises in Manifest V3.
 */

import { IS_FIREFOX } from './browser-target';
import { FIREFOX_OPTIONAL_DATA_COLLECTION } from './firefox-manifest';

/** Firefox-only APIs that @types/chrome does not describe. */
type FirefoxSidebarAction = {
  open: () => Promise<void>;
  toggle: () => Promise<void>;
};

type FirefoxExtras = {
  sidebarAction?: FirefoxSidebarAction;
  commands?: { openShortcutSettings?: () => Promise<void> };
  permissions?: {
    request: (permissions: { data_collection?: string[] }) => Promise<boolean>;
    contains: (permissions: { data_collection?: string[] }) => Promise<boolean>;
  };
};

function firefoxApi(): FirefoxExtras {
  const g = globalThis as unknown as { browser?: FirefoxExtras; chrome?: FirefoxExtras };
  return g.browser ?? g.chrome ?? {};
}

// ---------------------------------------------------------------------------
// Store listing
// ---------------------------------------------------------------------------

/**
 * Firefox Add-ons listing slug. AMO picks the slug at first submission;
 * keep this in sync with the live listing URL.
 */
export const AMO_LISTING_SLUG = 'bluetab';

export const AMO_LISTING_URL = `https://addons.mozilla.org/firefox/addon/${AMO_LISTING_SLUG}/`;

export function storeReviewUrl(chromeExtensionId: string): string {
  if (IS_FIREFOX) return `${AMO_LISTING_URL}reviews/`;
  return `https://chromewebstore.google.com/detail/${chromeExtensionId}/reviews`;
}

// ---------------------------------------------------------------------------
// Side panel (Chrome) / sidebar (Firefox)
// ---------------------------------------------------------------------------

/**
 * Toolbar icon opens the side panel. Chrome does it declaratively; Firefox
 * needs an action click listener that toggles the sidebar. Must be called
 * synchronously at the top level of the background script.
 */
export function configureToolbarOpensSidePanel(): void {
  if (IS_FIREFOX) {
    chrome.action.onClicked.addListener(() => {
      // toggle() must run synchronously inside the click (user input).
      void firefoxApi().sidebarAction?.toggle().catch((error: unknown) => {
        console.error('[BlueTab] Failed to toggle sidebar:', error);
      });
    });
    return;
  }
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('[BlueTab] Failed to set panel behavior:', error));
}

/**
 * Open the side panel for a tab or window. Firefox only opens the sidebar
 * from a user action in an extension page or the toolbar; when the request
 * comes from a content script it may be refused, so the panel page opens
 * in a tab instead.
 */
export async function openSidePanel(options: { tabId: number } | { windowId: number }): Promise<void> {
  if (!IS_FIREFOX) {
    await chrome.sidePanel.open(options);
    return;
  }
  const sidebar = firefoxApi().sidebarAction;
  try {
    if (!sidebar) throw new Error('sidebarAction unavailable');
    await sidebar.open();
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/index.html') });
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts page
// ---------------------------------------------------------------------------

export const SHORTCUTS_SETTINGS_LABEL = IS_FIREFOX
  ? 'about:addons → ⚙ → Manage Extension Shortcuts'
  : 'chrome://extensions/shortcuts';

export function openShortcutSettings(): void {
  if (IS_FIREFOX) {
    const open = firefoxApi().commands?.openShortcutSettings;
    if (open) {
      void open().catch(() => {});
    }
    return;
  }
  // chrome:// pages cannot be opened from an <a href>; tabs.create is allowed.
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

// ---------------------------------------------------------------------------
// Favicons
// ---------------------------------------------------------------------------

/**
 * Favicon for a site. Chrome serves cached favicons from `_favicon`.
 * Firefox has no equivalent, so the site's own /favicon.ico is used (no
 * third-party favicon service: the domain never leaves the user's browser
 * for anyone but the site itself).
 */
export function siteFaviconUrl(pageUrl: string, size: 16 | 32): string {
  if (IS_FIREFOX) {
    try {
      return `${new URL(pageUrl).origin}/favicon.ico`;
    } catch {
      return '';
    }
  }
  return chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`);
}

// ---------------------------------------------------------------------------
// Browser-internal pages
// ---------------------------------------------------------------------------

/** URLs that belong to the browser or an extension, never to a website. */
const BROWSER_INTERNAL_URL_RE = /^(chrome|chrome-extension|edge|about|view-source|moz-extension|resource):/i;

export function isBrowserInternalUrl(url: string | undefined): boolean {
  return Boolean(url && BROWSER_INTERNAL_URL_RE.test(url));
}

/** Store pages where browsers never allow content scripts. */
export const RESTRICTED_STORE_HOSTS: ReadonlySet<string> = new Set([
  'chromewebstore.google.com',
  'chrome.google.com',
  'addons.mozilla.org',
]);

/** Address of a freshly opened, empty new tab. */
export function isBrowserNewTabUrl(url: string | undefined): boolean {
  return url === 'chrome://newtab/' || url === 'about:newtab' || url === 'about:home';
}

// ---------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------

/**
 * Play a bundled notification sound in the current document. Firefox's
 * background is an event page with DOM access, so it can play audio
 * directly; Chrome's service worker has to use the offscreen document.
 */
export function playBundledSound(name: string): void {
  const audio = new Audio(chrome.runtime.getURL(`src/assets/sounds/${name}.mp3`));
  audio.volume = 0.5;
  audio.play().catch((err) => {
    console.error('[BlueTab][Sound] Failed to play sound:', err);
  });
}

/**
 * Preview a notification sound from a settings page (a normal document in
 * both browsers). Chrome keeps the existing offscreen path so the sound
 * survives the page closing.
 */
export async function previewNotificationSound(sound: string, justification: string): Promise<void> {
  if (IS_FIREFOX) {
    playBundledSound(sound);
    return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('src/background/offscreen.html'),
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification,
    }).catch(() => {});
    await chrome.runtime.sendMessage({ type: 'PLAY_NOTIFICATION_DING', sound });
  } catch {
    // Offscreen API not available in this context
  }
}

// ---------------------------------------------------------------------------
// Firefox data collection consent
// ---------------------------------------------------------------------------

/**
 * Data types declared as optional `data_collection_permissions` in the
 * Firefox manifest. Signing in turns on features that send them to
 * supertry.net: account email and password (sign-in), saved tab URLs and
 * titles (sync, Share, Distraction Scan), page text (AI page summary).
 */
export const FIREFOX_ACCOUNT_DATA_COLLECTION: readonly string[] = FIREFOX_OPTIONAL_DATA_COLLECTION;

/**
 * Ask Firefox's built-in consent prompt before signing in. Resolves true in
 * Chrome. MUST be called synchronously from the click/submit handler (no
 * await before it): Firefox only shows permission prompts during user input.
 */
export function requestAccountDataConsent(): Promise<boolean> {
  if (!IS_FIREFOX) return Promise.resolve(true);
  const permissions = firefoxApi().permissions;
  if (!permissions) return Promise.resolve(false);
  return permissions
    .request({ data_collection: [...FIREFOX_ACCOUNT_DATA_COLLECTION] })
    .catch((error: unknown) => {
      console.warn('[BlueTab] Data collection consent request failed:', error);
      return false;
    });
}

/** True when the user still allows account data collection (always true in Chrome). */
export async function hasAccountDataConsent(): Promise<boolean> {
  if (!IS_FIREFOX) return true;
  const permissions = firefoxApi().permissions;
  if (!permissions) return false;
  try {
    return await permissions.contains({ data_collection: [...FIREFOX_ACCOUNT_DATA_COLLECTION] });
  } catch {
    return false;
  }
}
