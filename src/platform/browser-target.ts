/**
 * @module platform/browser-target
 *
 * WHY:  One codebase ships to the Chrome Web Store and to Firefox Add-ons
 *       (AMO). A few browser APIs exist only in one of them (Chrome:
 *       sidePanel, offscreen, _favicon; Firefox: sidebarAction, event-page
 *       background with DOM access).
 *
 * WHAT: Build-time browser target. `npm run build` produces the Chrome
 *       build; `npm run build:firefox` sets BLUETAB_BROWSER=firefox, and
 *       Vite replaces `__BLUETAB_BROWSER__` with the string literal so the
 *       other browser's branch is dropped as dead code.
 *
 * NOT:  No user-agent sniffing. Jest and tsc never define the constant, so
 *       they always see the Chrome target.
 */

declare const __BLUETAB_BROWSER__: string | undefined;

export type BrowserTarget = 'chrome' | 'firefox';

export const BROWSER_TARGET: BrowserTarget =
  typeof __BLUETAB_BROWSER__ !== 'undefined' && __BLUETAB_BROWSER__ === 'firefox'
    ? 'firefox'
    : 'chrome';

export const IS_FIREFOX = BROWSER_TARGET === 'firefox';
