import type { Settings } from '@/types/models';

export type NewTabLanguage = 'en' | 'tr' | 'es' | 'pt-BR' | 'id' | 'ar';
type NewTabLanguagePreference = Settings['language'] | null | undefined;

interface NewTabStrings {
  searchPlaceholder: string;
  groupLabel: string;
  tabLabel: string;
  tabsCount: (count: number) => string;
}

const STRINGS: Record<NewTabLanguage, NewTabStrings> = {
  ar: {
    searchPlaceholder: 'ابحث في المجموعات أو علامات التبويب أو الويب...',
    groupLabel: 'مجموعة',
    tabLabel: 'علامة تبويب',
    tabsCount: (count) => {
      switch (new Intl.PluralRules('ar').select(count)) {
        case 'zero':
          return `${count} علامة تبويب`;
        case 'one':
          return `${count} علامة تبويب`;
        case 'two':
          return `${count} علامتا تبويب`;
        case 'few':
          return `${count} علامات تبويب`;
        default:
          return `${count} علامة تبويب`;
      }
    },
  },
  en: {
    searchPlaceholder: 'Search groups, tabs, or the web...',
    groupLabel: 'Group',
    tabLabel: 'Tab',
    tabsCount: (count) => `${count} tabs`,
  },
  tr: {
    searchPlaceholder: 'Gruplarda, sekmelerde veya webde ara...',
    groupLabel: 'Grup',
    tabLabel: 'Sekme',
    tabsCount: (count) => `${count} sekme`,
  },
  es: {
    searchPlaceholder: 'Buscar grupos, pestañas o en la web...',
    groupLabel: 'Grupo',
    tabLabel: 'Pestaña',
    tabsCount: (count) => `${count} pestañas`,
  },
  'pt-BR': {
    searchPlaceholder: 'Pesquisar grupos, abas ou na web...',
    groupLabel: 'Grupo',
    tabLabel: 'Aba',
    tabsCount: (count) => `${count} abas`,
  },
  id: {
    searchPlaceholder: 'Cari grup, tab, atau web...',
    groupLabel: 'Grup',
    tabLabel: 'Tab',
    tabsCount: (count) => `${count} tab`,
  },
};

function getBrowserLanguage(): string | null {
  try {
    return chrome?.i18n?.getUILanguage?.() ?? navigator.language ?? null;
  } catch {
    return typeof navigator !== 'undefined' ? navigator.language : null;
  }
}

export function normalizeNewTabLanguage(value: string | null | undefined): NewTabLanguage {
  const [primaryLanguage] = value?.trim().toLowerCase().split(/[-_]/) ?? [];
  if (primaryLanguage === 'tr') return 'tr';
  if (primaryLanguage === 'es') return 'es';
  if (primaryLanguage === 'pt') return 'pt-BR';
  if (primaryLanguage === 'id') return 'id';
  if (primaryLanguage === 'ar') return 'ar';
  return 'en';
}

export function resolveNewTabLanguage(preference: NewTabLanguagePreference): NewTabLanguage {
  if (preference === 'en' || preference === 'tr' || preference === 'es' || preference === 'pt-BR' || preference === 'id' || preference === 'ar') {
    return preference;
  }

  return normalizeNewTabLanguage(getBrowserLanguage());
}

export function getNewTabStrings(language: NewTabLanguage): NewTabStrings {
  return STRINGS[language];
}

/** Browser locale with region (e.g. "en-GB") when it matches the language, so the clock and date follow the region. */
function getRegionalNewTabLocale(language: NewTabLanguage): string | null {
  let candidate: string | null = null;
  try {
    candidate = chrome?.i18n?.getUILanguage?.() ?? (typeof navigator !== 'undefined' ? navigator.language : null);
  } catch {
    candidate = typeof navigator !== 'undefined' ? navigator.language : null;
  }
  if (!candidate || !/[-_]/.test(candidate)) return null;
  const primary = candidate.toLowerCase().split(/[-_]/)[0];
  const expected = language === 'pt-BR' ? 'pt' : language;
  if (primary !== expected) return null;
  try {
    return Intl.getCanonicalLocales(candidate.replace(/_/g, '-'))[0] ?? null;
  } catch {
    return null;
  }
}

export function getNewTabLocaleTag(language: NewTabLanguage): string {
  const base = getRegionalNewTabLocale(language) ?? language;
  return language === 'ar' ? `${base}-u-nu-latn` : base;
}

export function applyNewTabDocumentMetadata(language: NewTabLanguage): void {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
}

export type NewTabTimeFormat = 'system' | '12h' | '24h';

/**
 * Same rules as formatTime in src/i18n/format.ts: Settings > Time format wins,
 * 'system' follows the locale, and 12-hour clocks drop the leading zero.
 */
export function formatNewTabTime(
  value: number | Date,
  language: NewTabLanguage,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
  timeFormat: NewTabTimeFormat = 'system',
): string {
  const locale = getNewTabLocaleTag(language);
  let effective = options;
  if (options.hour && options.hour12 === undefined && options.hourCycle === undefined) {
    if (timeFormat === '12h') effective = { ...options, hour12: true };
    if (timeFormat === '24h') effective = { ...options, hourCycle: 'h23' };
  }
  let formatter = new Intl.DateTimeFormat(locale, effective);
  if (effective.hour === '2-digit' && formatter.resolvedOptions().hour12) {
    formatter = new Intl.DateTimeFormat(locale, { ...effective, hour: 'numeric' });
  }
  return formatter.format(value instanceof Date ? value : new Date(value));
}

export function formatNewTabDate(
  value: number | Date,
  language: NewTabLanguage,
  options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' },
): string {
  return new Intl.DateTimeFormat(getNewTabLocaleTag(language), options).format(value instanceof Date ? value : new Date(value));
}
