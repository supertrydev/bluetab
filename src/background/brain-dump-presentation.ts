import { getLanguageDirection, initI18n, t } from '../i18n';
import { BRAIN_DUMP_STRINGS, type BrainDumpStrings } from '../i18n/brain-dump-strings';

export async function getBrainDumpPresentation() {
  const language = await initI18n();
  const strings = Object.fromEntries(Object.keys(BRAIN_DUMP_STRINGS).map((key) => [key, t(key)])) as BrainDumpStrings;
  return { language, direction: getLanguageDirection(language), strings };
}
