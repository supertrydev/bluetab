import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUPPORTED_LANGUAGES } from '@/i18n';

interface ManifestMessage {
  message: string;
}

type ManifestMessages = Record<string, ManifestMessage>;

/** Chrome folder names use an underscore for regions (pt-BR -> pt_BR). */
function toChromeLocale(language: string): string {
  return language.replace('-', '_');
}

function loadMessages(locale: string): ManifestMessages {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), '_locales', locale, 'messages.json'), 'utf8'),
  ) as ManifestMessages;
}

describe('localized extension manifest copy', () => {
  const englishKeys = Object.keys(loadMessages('en')).sort();

  it.each(SUPPORTED_LANGUAGES.map(toChromeLocale))(
    'ships %s manifest messages with the same keys as English and the untranslated brand',
    (locale) => {
      expect(existsSync(resolve(process.cwd(), '_locales', locale, 'messages.json'))).toBe(true);
      const messages = loadMessages(locale);
      expect(Object.keys(messages).sort()).toEqual(englishKeys);
      expect(messages.appName.message).toMatch(/^Bluetab(?:: \S.*)?$/);
      for (const key of englishKeys) {
        expect(messages[key].message.trim()).not.toBe('');
      }
    },
  );

  it('keeps Arabic manifest message keys aligned with English', () => {
    expect(Object.keys(loadMessages('ar')).sort()).toEqual(
      Object.keys(loadMessages('en')).sort(),
    );
  });

  it('provides reviewed Arabic app and command copy without translating the brand', () => {
    expect(loadMessages('ar')).toEqual({
      appName: { message: 'Bluetab: مدير علامات التبويب' },
      appDescription: {
        message:
          'احفظ علامات التبويب بنقرة واحدة، واعثر على صفحاتك المحفوظة بسرعة، وأبق عددًا أقل منها أمامك. مدير علامات تبويب مجاني يحترم خصوصيتك.',
      },
      commandActivate: { message: 'تفعيل الإضافة' },
      commandSaveAllTabs: { message: 'حفظ جميع علامات التبويب' },
      commandSaveCurrentTab: { message: 'حفظ الصفحة الحالية' },
      commandRestoreLastGroup: { message: 'استعادة آخر مجموعة' },
      commandOpenManager: { message: 'فتح مدير Bluetab' },
      commandBrainDump: { message: 'احفظ فكرة في صندوق وارد Brain Dump' },
    });
  });
});
