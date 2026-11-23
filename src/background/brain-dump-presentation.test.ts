import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getBrainDumpPresentation } from './brain-dump-presentation';
import { BRAIN_DUMP_STRINGS } from '../i18n/brain-dump-strings';
import { initI18n } from '../i18n';

it('provides every translation key referenced by the injected modal', async () => {
  const source = readFileSync(resolve(__dirname, '../content/brain-dump-modal.ts'), 'utf8');
  const keys = [...source.matchAll(/translate\('([^']+)'\)/g)].map((match) => match[1]);
  expect(keys.length).toBeGreaterThan(20);
  const presentation = await getBrainDumpPresentation();
  for (const key of keys) expect(presentation.strings[key as keyof typeof BRAIN_DUMP_STRINGS]).toEqual(expect.any(String));
});

it.each(['en', 'tr', 'es', 'pt-BR', 'id', 'ar'] as const)('sends localized modal strings and direction for %s', async (language) => {
  (chrome.storage.local.get as jest.Mock).mockResolvedValue({ settings: { language } });
  await initI18n({ language });
  const result = await getBrainDumpPresentation();
  const locale = JSON.parse(readFileSync(resolve(__dirname, '../i18n/locales', `${language}.json`), 'utf8'));
  expect(result.language).toBe(language);
  expect(result.direction).toBe(language === 'ar' ? 'rtl' : 'ltr');
  for (const key of Object.keys(BRAIN_DUMP_STRINGS)) {
    expect(result.strings[key as keyof typeof BRAIN_DUMP_STRINGS]).toBe(locale.brainDumpModal[key.split('.')[1]]);
  }
});
