/**
 * @module platform/offscreen-bridge
 *
 * WHY:  Chrome runs DOM work (Readability article extraction) in the
 *       offscreen document and reaches it with runtime.sendMessage. Firefox
 *       has no offscreen API, but its background event page and extension
 *       pages have DOM access, so the same handler runs in place.
 *
 * WHAT: sendOffscreenMessage(message): same result shape in both browsers.
 */

import { IS_FIREFOX } from './browser-target';

export async function sendOffscreenMessage<T = unknown>(message: { type: string } & Record<string, unknown>): Promise<T> {
  if (IS_FIREFOX) {
    const { handleOffscreenMessage } = await import('../background/offscreen-handlers');
    return (await handleOffscreenMessage(message)) as T;
  }
  return (await chrome.runtime.sendMessage(message)) as T;
}
