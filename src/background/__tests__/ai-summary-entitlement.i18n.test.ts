import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initI18n, t as translate, type SupportedLanguage } from '@/i18n';

const KEY = 'notifications.aiSummary.requiresPro';
const TRANSLATED_LANGUAGES = ['tr', 'es', 'pt-BR', 'id', 'ar'] as const;

function loadMessage(language: SupportedLanguage): string | undefined {
  const resource = JSON.parse(
    readFileSync(resolve(__dirname, '../../i18n/locales', `${language}.json`), 'utf8'),
  ) as { notifications: { aiSummary: Record<string, string> } };
  return resource.notifications.aiSummary.requiresPro;
}

describe('AI page summary entitlement message', () => {
  afterEach(() => {
    (chrome.storage.local.get as jest.Mock).mockReset();
  });

  it('makes the summarize-page guard use the translated key, not a literal', () => {
    const source = readFileSync(resolve(__dirname, '../service-worker.ts'), 'utf8');
    expect(source).not.toContain('AI page summary requires');
    expect(source).toContain(`error: translate('${KEY}')`);
  });

  it('provides the English source copy', () => {
    expect(loadMessage('en')).toBe(
      'AI page summaries need Brain Dump turned on and Bluetab Pro.',
    );
  });

  it.each(TRANSLATED_LANGUAGES)('provides non-empty localized copy for %s', (language) => {
    const message = loadMessage(language);

    expect(typeof message).toBe('string');
    expect(message?.trim()).toBeTruthy();
    expect(message).not.toBe(loadMessage('en'));
  });

  it.each(['en', ...TRANSLATED_LANGUAGES] as const)(
    'resolves the guard translation key using the stored %s UI language',
    async (language) => {
      await initI18n({ language: 'en' });
      (chrome.storage.local.get as jest.Mock).mockResolvedValue({ settings: { language } });

      await initI18n();

      const message = translate(KEY);
      expect(message).toBe(loadMessage(language));
      expect(message).not.toBe(KEY);
    },
  );
});
