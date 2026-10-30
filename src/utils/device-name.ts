/**
 * @module utils/device-name
 *
 * WHY:  Sync shows every connected browser by name. "Chrome - Linux" for both
 *       Brave and Chrome on the same machine makes devices hard to tell apart.
 *
 * WHAT: getDefaultDeviceName() → "<Browser> - <OS>", e.g. "Brave - Linux".
 *       Used to prefill the device name field; the user can change it.
 *
 * HOW:  Reads navigator.userAgent. Chromium-based browsers all contain
 *       "Chrome", so their own tokens (Edg/, OPR/, Vivaldi/) are checked first;
 *       Brave hides its token and is detected via navigator.brave.
 *       Android UAs also contain "Linux" and iOS UAs contain "Mac OS X",
 *       so mobile platforms are checked before desktop ones.
 */

export function getDefaultDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Unknown Device';

  const ua = navigator.userAgent ?? '';
  return `${detectBrowser(ua)} - ${detectOS(ua)}`;
}

function detectBrowser(ua: string): string {
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera';
  if (ua.includes('Vivaldi/')) return 'Vivaldi';
  if ('brave' in navigator) return 'Brave';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Chrome/') || ua.includes('Chromium/')) return 'Chrome';
  if (ua.includes('Safari/')) return 'Safari';
  return 'Browser';
}

function detectOS(ua: string): string {
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('CrOS')) return 'ChromeOS';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac')) return 'Mac';
  if (ua.includes('Linux')) return 'Linux';
  return 'Unknown';
}
