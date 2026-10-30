import * as fs from 'fs';
import * as path from 'path';

const SERVICE_FILE = path.resolve(__dirname, './TextSizeService.ts');
const COMPONENT_FILE = path.resolve(__dirname, '../components/TextSizeSetting.tsx');
const TEXT_SIZE_CSS_FILE = path.resolve(__dirname, '../styles/text-size.css');
const TYPOGRAPHY_TOKENS_FILE = path.resolve(__dirname, '../styles/tokens/typography.css');
const TAILWIND_CONFIG_FILE = path.resolve(__dirname, '../../tailwind.config.cjs');

const serviceSource = fs.readFileSync(SERVICE_FILE, 'utf-8');
const componentSource = fs.readFileSync(COMPONENT_FILE, 'utf-8');
const textSizeCssSource = fs.readFileSync(TEXT_SIZE_CSS_FILE, 'utf-8');
const typographyTokenSource = fs.readFileSync(TYPOGRAPHY_TOKENS_FILE, 'utf-8');
const tailwindConfigSource = fs.readFileSync(TAILWIND_CONFIG_FILE, 'utf-8');

describe('Text size sync storage contract', () => {
  it('stores text-size preferences through chrome.storage.local via the Storage wrapper', () => {
    expect(serviceSource).toContain("import { Storage } from './storage'");
    expect(serviceSource).toContain('Storage.get<TextSizeSettings>');
    expect(serviceSource).toContain('Storage.set(this.config.storageKey');
    expect(serviceSource).toContain('legacyResult');
    expect(serviceSource).toContain('chrome.storage.sync.get(this.config.storageKey)');
    expect(serviceSource).not.toContain('chrome.storage.sync.set');
  });

  it('listens for local storage changes so synced text-size updates apply live', () => {
    expect(serviceSource).toContain("areaName !== 'local'");
    expect(componentSource).toContain("areaName === 'local'");
    expect(componentSource).not.toContain("areaName === 'sync'");
  });

  it('overrides the canonical typography tokens instead of maintaining a parallel text-size token tree', () => {
    expect(textSizeCssSource).toContain('--text-xs:');
    expect(textSizeCssSource).toContain('--text-base:');
    expect(textSizeCssSource).toContain('--text-4xl:');
    expect(textSizeCssSource).toContain('--text-scale-factor:');
    expect(textSizeCssSource).not.toContain('--text-size-xs');
    expect(textSizeCssSource).not.toContain('--text-size-lg');
    expect(typographyTokenSource).toContain('--text-xs:');
    expect(typographyTokenSource).toContain('--text-xl:');
  });

  it('exposes token-backed tailwind font sizes for larger headings and small UI meta text', () => {
    expect(tailwindConfigSource).toContain('2xl');
    expect(tailwindConfigSource).toContain('3xl');
    expect(tailwindConfigSource).toContain('4xl');
    expect(tailwindConfigSource).toContain('micro');
    expect(tailwindConfigSource).toContain('caption');
    expect(tailwindConfigSource).toContain('label');
  });
});

describe('Text size bootstrap coverage', () => {
  const entrypoints: Array<[string, string]> = [
    [path.resolve(__dirname, '../popup/main.tsx'), 'textSizeService.initialize'],
    [path.resolve(__dirname, '../options/main.tsx'), 'textSizeService.initialize'],
    [path.resolve(__dirname, '../settings/main.tsx'), 'textSizeService.initialize'],
    [path.resolve(__dirname, '../sidepanel/main.tsx'), 'textSizeService.initialize'],
    [path.resolve(__dirname, '../flow/main.tsx'), 'textSizeService.initialize'],
    [path.resolve(__dirname, '../account/main.tsx'), 'textSizeService.initialize'],
    [path.resolve(__dirname, '../newtab/main.tsx'), 'initializeNewTabTextSize'],
    [path.resolve(__dirname, '../blocked/main.tsx'), 'textSizeService.initialize'],
    [path.resolve(__dirname, '../onboarding/main.tsx'), 'textSizeService.initialize'],
  ];

  it.each(entrypoints)('%s initializes its text size bootstrap', (entrypoint, initializer) => {
    const source = fs.readFileSync(entrypoint, 'utf-8');
    expect(source).toContain(`${initializer}()`);
  });
});
