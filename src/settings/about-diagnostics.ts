interface BrowserEnvironment {
  userAgent?: string;
  platform?: string;
  brave?: unknown;
  userAgentData?: {
    brands?: readonly { brand: string; version: string }[];
    platform?: string;
  };
}

/** Prefer branded browsers to the shared Chromium token; ignore GREASE brands. */
export function detectBrowser(environment: BrowserEnvironment): string {
  const brands = environment.userAgentData?.brands ?? [];
  const userAgent = environment.userAgent ?? '';
  const brave = brands.find(({ brand }) => brand === 'Brave');
  if (brave || environment.brave) {
    // Both Brave client hints and its user agent expose Chromium versions.
    // https://github.com/brave/brave-browser/wiki/User-Agents
    const chromium = userAgent.match(/Chrome\/([\d.]+)/)?.[1]
      ?? brands.find(({ brand }) => brand === 'Chromium')?.version
      ?? brave?.version;
    return chromium ? `Brave (Chromium ${chromium})` : 'Brave';
  }

  const browsers = [
    { name: 'Edge', brand: 'Microsoft Edge', pattern: /(?:Edg|Edge|EdgA|EdgiOS)\/([\d.]+)/ },
    { name: 'Opera', brand: 'Opera', pattern: /(?:OPR|Opera|OPiOS)\/([\d.]+)/ },
    { name: 'Firefox', brand: 'Firefox', pattern: /(?:Firefox|FxiOS)\/([\d.]+)/ },
    { name: 'Chrome', brand: 'Google Chrome', pattern: /(?:Chrome|CriOS)\/([\d.]+)/ },
    { name: 'Chromium', brand: 'Chromium', pattern: /Chromium\/([\d.]+)/ },
  ];
  for (const browser of browsers) {
    const version = userAgent.match(browser.pattern)?.[1]
      ?? brands.find(({ brand }) => brand === browser.brand)?.version;
    if (version) return `${browser.name} ${version}`;
  }
  return '';
}

/** Explicit allowlist: never read account, storage, email, or browsing data. */
export function getDiagnostics(input: {
  version: string;
  extensionId: string;
  language: string;
  navigator: BrowserEnvironment;
}) {
  return {
    version: input.version,
    browser: detectBrowser(input.navigator),
    platform: input.navigator.userAgentData?.platform || input.navigator.platform || '',
    language: input.language,
    extensionId: input.extensionId,
  };
}
