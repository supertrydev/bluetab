import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let api: typeof import('./index');
const originalFetch = global.fetch;
const resource = (language: string) => JSON.parse(readFileSync(resolve(__dirname, 'locales', `${language}.json`), 'utf8'));
beforeEach(() => {
  jest.resetModules();
  api = require('./index');
  global.fetch = jest.fn(async (url) => {
    const language = String(url).match(/\/([^/]+)\.json$/)?.[1];
    return { ok: true, json: async () => resource(language!) } as Response;
  });
});
afterEach(() => { global.fetch = originalFetch; });

it('bundles English without fetching and loads only the selected packaged language', async () => {
  await api.initI18n({ language: 'en' });
  expect(fetch).not.toHaveBeenCalled();
  await api.initI18n({ language: 'tr' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('chrome-extension://test-extension-id/locales/tr.json');
  expect(api.t('brainDumpModal.title')).toBe(resource('tr').brainDumpModal.title);
  await api.applyLanguagePreference('en');
  await api.applyLanguagePreference('tr');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not resolve initialization or update metadata until translations arrive', async () => {
  let deliver!: (response: Response) => void;
  jest.mocked(fetch).mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));
  const done = jest.fn();
  const init = api.initI18n({ language: 'ar' }).then(done);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  deliver({ ok: true, json: async () => resource('ar') } as Response);
  await init;
  expect(api.getCurrentLanguage()).toBe('ar');
  expect(api.getLanguageDirection(api.getCurrentLanguage())).toBe('rtl');
  expect(api.t('brainDumpModal.title')).toBe(resource('ar').brainDumpModal.title);
});

it('falls back to English on fetch failure and retries on the next switch', async () => {
  jest.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);
  await expect(api.initI18n({ language: 'es' })).resolves.toBe('en');
  expect(api.t('brainDumpModal.title')).toBe(resource('en').brainDumpModal.title);
  await expect(api.applyLanguagePreference('es')).resolves.toBe('es');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('serializes concurrent initialization and switches to the last requested language', async () => {
  await Promise.all([
    api.initI18n({ language: 'ar' }),
    api.applyLanguagePreference('tr'),
    api.initI18n({ language: 'es' }),
  ]);
  expect(api.getCurrentLanguage()).toBe('es');
  expect(api.t('brainDumpModal.title')).toBe(resource('es').brainDumpModal.title);
});
