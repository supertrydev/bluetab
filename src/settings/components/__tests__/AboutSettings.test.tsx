/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initI18n, SUPPORTED_LANGUAGES } from '@/i18n';
import { dependencies } from '../../../../package.json';
import { AboutSettings } from '../AboutSettings';

jest.mock('@/components/Logo', () => ({ __esModule: true, default: ({ size }: { size: string }) => <div data-logo-size={size} /> }));
jest.mock('@/platform/browser-target', () => ({ IS_FIREFOX: false }));

const links = {
  Website: 'https://bluetab.in',
  'Release notes': 'https://github.com/supertrydev/bluetab/releases',
  'Source code': 'https://github.com/supertrydev/bluetab',
  'Report a bug': 'https://github.com/supertrydev/bluetab/issues/new?template=bug.yml',
  Support: 'mailto:support@supertry.net',
  'Privacy policy': 'https://supertry.net/privacy',
  'Terms of use': 'https://supertry.net/terms',
  'Rate Bluetab': 'https://chromewebstore.google.com/detail/hddffdgifegmcilhcnamabcamdbpogdb/reviews',
  'Bluetab is free software under the GNU AGPL-3.0': 'https://github.com/supertrydev/bluetab/blob/main/LICENSE',
  '© 2026 Supertry': 'https://supertry.net',
};

describe('AboutSettings', () => {
  let container: HTMLDivElement;
  let root: Root;
  const writeText = jest.fn();
  const target = jest.requireMock('@/platform/browser-target') as { IS_FIREFOX: boolean };

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  beforeEach(async () => {
    target.IS_FIREFOX = false;
    chrome.runtime.getManifest = jest.fn(() => ({ version: '1.0.7' } as chrome.runtime.Manifest));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla Firefox/132.0' });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' });
    writeText.mockReset().mockResolvedValue(undefined);
    await initI18n({ language: 'en' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    jest.useRealTimers();
  });
  const render = async () => { await act(async () => root.render(<AboutSettings />)); };
  const copy = async () => { await act(async () => container.querySelector('button')?.click()); };

  it('renders the splash logo, version, description, and all external links', async () => {
    await render();
    expect(container.querySelector('[data-logo-size="splash"]')).not.toBeNull();
    expect(container.textContent).toContain('1.0.7');
    expect(container.textContent).toContain('A calm, private tab manager for Chrome and Firefox.');
    const anchors = [...container.querySelectorAll('a')];
    expect(anchors).toHaveLength(Object.keys(links).length);
    for (const [label, url] of Object.entries(links)) {
      const anchor = anchors.find((element) => element.textContent === label);
      expect(anchor?.getAttribute('href')).toBe(url);
      expect(anchor?.target).toBe('_blank');
      expect(anchor?.rel).toBe('noopener noreferrer');
    }
    expect(container.textContent).toContain('Reviews help other people find Bluetab.');
  });

  it('uses the Firefox review URL for Firefox builds', async () => {
    target.IS_FIREFOX = true;
    await render();
    expect(container.querySelector('a[href="https://addons.mozilla.org/firefox/addon/bluetab/reviews/"]')).not.toBeNull();
    expect(container.querySelector('a[href*="chromewebstore"]')).toBeNull();
  });

  it('copies only the displayed diagnostics and briefly confirms success', async () => {
    jest.useFakeTimers();
    await render();
    await copy();
    expect(writeText).toHaveBeenCalledWith([
      'Version: 1.0.7', 'Browser: Firefox 132.0', 'Operating system: Linux x86_64',
      'Interface language: en', 'Extension ID: test-extension-id',
    ].join('\n'));
    expect(writeText.mock.calls[0][0]).not.toMatch(/account|email|https?:|token|password/i);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Copied');
    await act(async () => { jest.advanceTimersByTime(2500); });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('does not create a confirmation timer after unmounting during a copy', async () => {
    jest.useFakeTimers();
    let finishCopy!: () => void;
    writeText.mockImplementation(() => new Promise<void>((resolve) => { finishCopy = resolve; }));
    await render();
    await copy();
    await act(async () => root.unmount());
    await act(async () => finishCopy());
    expect(jest.getTimerCount()).toBe(0);
  });

  it('ignores stale copy results when requests finish out of order', async () => {
    let rejectFirst!: (error: Error) => void;
    writeText.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }));
    await render();
    await copy();
    await copy();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Copied');
    await act(async () => rejectFirst(new Error('stale failure')));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Copied');
  });

  it('shows a localized failure without claiming to have copied', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    await render();
    await copy();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Could not copy details. Please try again.');
  });

  it('handles an unavailable clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    await render();
    await copy();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Could not copy');
  });

  it('shows all production dependencies in a collapsed list', async () => {
    await render();
    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe(`Open-source libraries (${Object.keys(dependencies).length})`);
    expect(details?.querySelectorAll('li')).toHaveLength(Object.keys(dependencies).length);
    for (const name of Object.keys(dependencies)) expect(details?.textContent).toContain(name);
  });

  it.each(SUPPORTED_LANGUAGES)('renders translated copy and the correct direction in %s', async (language) => {
    await initI18n({ language });
    await render();
    const locale = await import(`../../../i18n/locales/${language}.json`);
    expect(container.textContent).toContain(locale.settings.about.copyDetails);
    expect(container.firstElementChild?.getAttribute('dir')).toBe(language === 'ar' ? 'rtl' : 'ltr');
    await copy();
    expect(writeText.mock.calls[0][0]).toContain(`${locale.settings.about.interfaceLanguage}: ${language}`);
  });
});
