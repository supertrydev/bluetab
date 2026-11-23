import { detectBrowser, getDiagnostics } from './about-diagnostics';

describe('About diagnostics', () => {
  it.each([
    ['Mozilla Chrome/130.0.0.0 Safari/537.36', 'Chrome 130.0.0.0'],
    ['Mozilla Chrome/130.0.0.0 Edg/131.0.1.2', 'Edge 131.0.1.2'],
    ['Mozilla Chrome/130.0.0.0 OPR/115.0.1.2', 'Opera 115.0.1.2'],
    ['Mozilla Firefox/132.0', 'Firefox 132.0'],
  ])('identifies %s', (userAgent, expected) => {
    expect(detectBrowser({ userAgent })).toBe(expected);
  });

  it('prefers specific client hints over the Chromium brand', () => {
    expect(detectBrowser({ userAgentData: { brands: [
      { brand: 'Chromium', version: '130' },
      { brand: 'Microsoft Edge', version: '131' },
    ] } })).toBe('Edge 131');
  });

  it('recognizes Brave without claiming the Chromium version is the Brave version', () => {
    expect(detectBrowser({ brave: {}, userAgent: 'Chrome/130.0.0.0' })).toBe('Brave (Chromium 130.0.0.0)');
    expect(detectBrowser({ brave: {}, userAgentData: { brands: [{ brand: 'Brave', version: '137' }] } })).toBe('Brave (Chromium 137)');
  });

  it('falls back safely when browser information is missing', () => {
    expect(detectBrowser({})).toBe('');
    expect(getDiagnostics({ version: '1.0.7', extensionId: 'extension-id', language: 'ar', navigator: {} }).platform).toBe('');
  });

  it('returns only the requested diagnostic fields, preferring the client-hint platform', () => {
    expect(getDiagnostics({ version: '1.0.7', extensionId: 'extension-id', language: 'tr', navigator: {
      userAgent: 'Firefox/132.0', platform: 'Linux x86_64', userAgentData: { platform: 'Linux' },
    } })).toEqual({ version: '1.0.7', browser: 'Firefox 132.0', platform: 'Linux', language: 'tr', extensionId: 'extension-id' });
  });
});
