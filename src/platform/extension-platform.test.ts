/**
 * Jest never defines __BLUETAB_BROWSER__, so these run against the Chrome
 * target and pin that the Chrome behaviour did not change.
 */
import { BROWSER_TARGET, IS_FIREFOX } from './browser-target';
import {
  isBrowserInternalUrl,
  isBrowserNewTabUrl,
  requestAccountDataConsent,
  RESTRICTED_STORE_HOSTS,
  siteFaviconUrl,
  storeReviewUrl,
} from './extension-platform';

describe('extension-platform (Chrome target)', () => {
  beforeAll(() => {
    (globalThis as any).chrome = {
      ...(globalThis as any).chrome,
      runtime: { ...((globalThis as any).chrome?.runtime ?? {}), getURL: (p: string) => `chrome-extension://abc/${p}` },
    };
  });

  it('defaults to the Chrome target when the build constant is missing', () => {
    expect(BROWSER_TARGET).toBe('chrome');
    expect(IS_FIREFOX).toBe(false);
  });

  it('keeps the Chrome Web Store review link', () => {
    expect(storeReviewUrl('hddffdgifegmcilhcnamabcamdbpogdb')).toBe(
      'https://chromewebstore.google.com/detail/hddffdgifegmcilhcnamabcamdbpogdb/reviews',
    );
  });

  it('keeps the Chrome _favicon URL', () => {
    expect(siteFaviconUrl('https://example.com/a', 32)).toBe(
      'chrome-extension://abc/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fa&size=32',
    );
  });

  it('treats Chrome and Firefox internal pages as internal', () => {
    for (const url of ['chrome://newtab/', 'chrome-extension://x/a.html', 'about:addons', 'moz-extension://u/a.html', 'view-source:https://a.b', 'edge://settings']) {
      expect(isBrowserInternalUrl(url)).toBe(true);
    }
    expect(isBrowserInternalUrl('https://example.com')).toBe(false);
    expect(isBrowserInternalUrl(undefined)).toBe(false);
  });

  it('recognises both browsers’ new tab addresses', () => {
    expect(isBrowserNewTabUrl('chrome://newtab/')).toBe(true);
    expect(isBrowserNewTabUrl('about:newtab')).toBe(true);
    expect(isBrowserNewTabUrl('about:home')).toBe(true);
    expect(isBrowserNewTabUrl('about:blank')).toBe(false);
  });

  it('lists both stores as restricted for content scripts', () => {
    expect(RESTRICTED_STORE_HOSTS.has('chromewebstore.google.com')).toBe(true);
    expect(RESTRICTED_STORE_HOSTS.has('addons.mozilla.org')).toBe(true);
  });

  it('never asks for Firefox data consent in Chrome', async () => {
    await expect(requestAccountDataConsent()).resolves.toBe(true);
  });
});
