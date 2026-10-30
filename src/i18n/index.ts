import { createInstance, type TOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  AR_RESOURCES,
  EN_RESOURCES,
  ES_RESOURCES,
  ID_RESOURCES,
  PT_BR_RESOURCES,
  TR_RESOURCES,
} from './runtime-resources';
import type { Settings } from '@/types/models';

export const SUPPORTED_LANGUAGES = ['en', 'tr', 'es', 'pt-BR', 'id', 'ar'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];
export type LanguagePreference = 'system' | SupportedLanguage;

const DEFAULT_LANGUAGE: SupportedLanguage = 'en';
const DEFAULT_NAMESPACE = 'translation';
const i18n = createInstance();
const resources = {
  ar: { translation: AR_RESOURCES },
  en: { translation: EN_RESOURCES },
  es: { translation: ES_RESOURCES },
  id: { translation: ID_RESOURCES },
  'pt-BR': { translation: PT_BR_RESOURCES },
  tr: { translation: TR_RESOURCES },
} as const;

let initPromise: Promise<SupportedLanguage> | null = null;

export type TextDirection = 'ltr' | 'rtl';

function getChromeUiLanguage(): string | null {
  try {
    return chrome?.i18n?.getUILanguage?.() ?? null;
  } catch {
    return null;
  }
}

function getNavigatorLanguage(): string | null {
  try {
    return typeof navigator !== 'undefined' ? navigator.language : null;
  } catch {
    return null;
  }
}

export function getLanguageDirection(language: string): TextDirection {
  const [primaryLanguage] = language.trim().toLowerCase().split(/[-_]/);
  return primaryLanguage === 'ar' ? 'rtl' : 'ltr';
}

function setDocumentLocaleMetadata(language: SupportedLanguage): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  document.documentElement.lang = language;
  document.documentElement.dir = getLanguageDirection(language);
}

export type TimeFormatPreference = 'system' | '12h' | '24h';
let timeFormatPreference: TimeFormatPreference = 'system';
let timeFormatListenerAttached = false;

function normalizeTimeFormat(value: unknown): TimeFormatPreference {
  return value === '12h' || value === '24h' ? value : 'system';
}

/** 12/24-hour choice from Settings > General; 'system' follows the locale. */
export function getTimeFormatPreference(): TimeFormatPreference {
  return timeFormatPreference;
}

export function setTimeFormatPreference(value: unknown): void {
  timeFormatPreference = normalizeTimeFormat(value);
}

let timeFormatLoaded = false;

/** Read the stored 12/24-hour choice once per context and follow later changes. */
async function loadTimeFormatPreference(): Promise<void> {
  if (timeFormatLoaded) return;
  timeFormatLoaded = true;
  try {
    const result = await chrome.storage.local.get('settings');
    setTimeFormatPreference((result.settings as Partial<Settings> | undefined)?.timeFormat);
  } catch {
    // Keep 'system'.
  }
  attachTimeFormatListener();
}

/** Keep the preference in sync when Settings changes it in another page. */
function attachTimeFormatListener(): void {
  if (timeFormatListenerAttached) return;
  try {
    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes.settings) return;
      const next = changes.settings.newValue as Partial<Settings> | undefined;
      setTimeFormatPreference(next?.timeFormat);
    });
    timeFormatListenerAttached = true;
  } catch {
    // No chrome.storage (tests or plain pages): keep the default.
  }
}

async function readStoredLanguagePreference(): Promise<LanguagePreference | null> {
  try {
    const result = await chrome.storage.local.get('settings');
    const settings = result.settings as Partial<Settings> | undefined;
    const language = settings?.language;
    return language === 'en' || language === 'tr' || language === 'es' || language === 'pt-BR' || language === 'id' || language === 'ar' || language === 'system'
      ? language
      : null;
  } catch {
    return null;
  }
}

export function normalizeLanguage(value: string | null | undefined): SupportedLanguage {
  const [primaryLanguage] = value?.trim().toLowerCase().split(/[-_]/) ?? [];
  if (primaryLanguage === 'tr') return 'tr';
  if (primaryLanguage === 'es') return 'es';
  if (primaryLanguage === 'pt') return 'pt-BR';
  if (primaryLanguage === 'id') return 'id';
  if (primaryLanguage === 'ar') return 'ar';
  return 'en';
}

export function resolveLanguagePreference(
  preference: LanguagePreference | null | undefined,
  candidates?: {
    chromeUiLanguage?: string | null;
    navigatorLanguage?: string | null;
  },
): SupportedLanguage {
  if (preference === 'en' || preference === 'tr' || preference === 'es' || preference === 'pt-BR' || preference === 'id' || preference === 'ar') {
    return preference;
  }

  const chromeUiLanguage = candidates && 'chromeUiLanguage' in candidates
    ? candidates.chromeUiLanguage
    : getChromeUiLanguage();
  if (chromeUiLanguage) {
    return normalizeLanguage(chromeUiLanguage);
  }

  const navigatorLanguage = candidates && 'navigatorLanguage' in candidates
    ? candidates.navigatorLanguage
    : getNavigatorLanguage();
  if (navigatorLanguage) {
    return normalizeLanguage(navigatorLanguage);
  }

  return DEFAULT_LANGUAGE;
}

export async function getResolvedLanguage(
  preference?: LanguagePreference | null,
): Promise<SupportedLanguage> {
  const effectivePreference = preference ?? await readStoredLanguagePreference();
  return resolveLanguagePreference(effectivePreference);
}

async function ensureI18n(
  language: SupportedLanguage,
  manageDocumentMetadata = true,
): Promise<SupportedLanguage> {
  if (i18n.isInitialized) {
    if (i18n.resolvedLanguage !== language) {
      await i18n.changeLanguage(language);
    }
    if (manageDocumentMetadata) {
      setDocumentLocaleMetadata(language);
    }
    return language;
  }

  await i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: language,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: [...SUPPORTED_LANGUAGES],
      defaultNS: DEFAULT_NAMESPACE,
      ns: [DEFAULT_NAMESPACE],
      interpolation: { escapeValue: false },
      returnNull: false,
    });

  if (manageDocumentMetadata) {
    setDocumentLocaleMetadata(language);
  }
  return language;
}

export async function initI18n(options?: {
  language?: SupportedLanguage | null;
  preference?: LanguagePreference | null;
  manageDocumentMetadata?: boolean;
}): Promise<SupportedLanguage> {
  const [resolved] = await Promise.all([
    options?.language ?? getResolvedLanguage(options?.preference),
    loadTimeFormatPreference(),
  ]);
  const manageDocumentMetadata = options?.manageDocumentMetadata ?? true;

  if (!initPromise) {
    initPromise = ensureI18n(resolved, manageDocumentMetadata).finally(() => {
      initPromise = null;
    });
    return initPromise;
  }

  await initPromise;
  return ensureI18n(resolved, manageDocumentMetadata);
}

export async function applyLanguagePreference(
  preference: LanguagePreference,
): Promise<SupportedLanguage> {
  const resolved = resolveLanguagePreference(preference);
  await ensureI18n(resolved);
  return resolved;
}

export function getCurrentLanguage(): SupportedLanguage {
  return normalizeLanguage(i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LANGUAGE);
}

/**
 * The browser's full locale (e.g. "en-GB", "es-MX", "pt-PT") when it belongs
 * to the app language, so dates, times and week rules follow the user's
 * region while translations stay per language.
 */
function getRegionalLocale(language: SupportedLanguage): string | null {
  for (const candidate of [getChromeUiLanguage(), getNavigatorLanguage()]) {
    if (!candidate || !/[-_]/.test(candidate)) continue;
    if (normalizeLanguage(candidate) !== language) continue;
    try {
      const [canonical] = Intl.getCanonicalLocales(candidate.replace(/_/g, '-'));
      if (canonical) return canonical;
    } catch {
      // Invalid tag from the browser; try the next candidate.
    }
  }
  return null;
}

export function getLocaleTag(language = getCurrentLanguage()): string {
  const base = getRegionalLocale(language) ?? language;
  // Arabic keeps Latin digits on purpose.
  return language === 'ar' ? `${base}-u-nu-latn` : base;
}

export function setDocumentTitle(key: string, options?: TOptions): void {
  if (typeof document === 'undefined') return;
  document.title = t(key, options);
}

export function t(key: string, options?: TOptions): string {
  return i18n.t(key as never, options as never) as unknown as string;
}

export { i18n };
