import { initI18n, SUPPORTED_LANGUAGES, t as translate } from '@/i18n';
import { TOOL_ERROR_CODES, toolLoopNotice } from '../ai-tool-loop';

describe('tool loop notice localization', () => {
  afterAll(async () => {
    await initI18n({ language: 'en', manageDocumentMetadata: false });
  });

  it.each(SUPPORTED_LANGUAGES.filter((language) => language !== 'en'))(
    'explains every tool error code in %s, not in English',
    async (language) => {
      const english: Record<string, string> = {};
      await initI18n({ language: 'en', manageDocumentMetadata: false });
      for (const code of TOOL_ERROR_CODES) {
        const notice = toolLoopNotice({ reason: 'repeated_error', code, params: { app: 'Linear' } });
        english[code] = translate(notice.key, notice.params);
      }

      await initI18n({ language, manageDocumentMetadata: false });
      for (const code of TOOL_ERROR_CODES) {
        const notice = toolLoopNotice({ reason: 'repeated_error', code, params: { app: 'Linear' } });
        const text = translate(notice.key, notice.params);
        expect(text).not.toBe(notice.key);
        expect(text).not.toBe(english[code]);
        expect(text).not.toContain('{{');
        if (english[code].includes('Linear')) expect(text).toContain('Linear');
      }
    },
  );
});
