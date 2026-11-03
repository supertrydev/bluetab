/**
 * @module background/offscreen
 *
 * WHY:  Chrome service workers cannot use Audio elements or DOMParser, so
 *       Chrome loads this page as the extension's offscreen document.
 *
 * WHAT: Message listener only. The work itself lives in
 *       ./offscreen-handlers so Firefox (no offscreen API; its background
 *       event page has DOM access) can run the same handlers directly.
 */

import { handleOffscreenMessage } from './offscreen-handlers';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const pending = handleOffscreenMessage(message);
  if (!pending) return;
  if (message?.type === 'PLAY_NOTIFICATION_DING') return;
  void pending.then(sendResponse);
  return true; // keep the async channel open
});
