/** @jest-environment jsdom */

import {
  formatNewTabDate,
  formatNewTabTime,
  getNewTabStrings,
  normalizeNewTabLanguage,
  resolveNewTabLanguage,
} from './localization';
import * as localization from './localization';

describe('New Tab localization', () => {
  it.each(['ar', 'ar-SA', 'ar_EG'])(
    'normalizes %s to Arabic',
    (language) => {
      expect(normalizeNewTabLanguage(language)).toBe('ar');
    },
  );

  it.each(['id', 'id-ID', 'id_ID'])(
    'normalizes %s to Indonesian',
    (language) => {
      expect(normalizeNewTabLanguage(language)).toBe('id');
    },
  );

  it.each(['pt', 'pt-BR', 'pt_BR'])(
    'normalizes %s to Brazilian Portuguese',
    (language) => {
      expect(normalizeNewTabLanguage(language)).toBe('pt-BR');
    },
  );

  it.each(['es', 'es-ES', 'es-MX'])(
    'normalizes %s to neutral Spanish',
    (language) => {
      expect(normalizeNewTabLanguage(language)).toBe('es');
    },
  );

  it('keeps an explicit Spanish preference', () => {
    expect(resolveNewTabLanguage('es')).toBe('es');
  });

  it('keeps an explicit Brazilian Portuguese preference', () => {
    expect(resolveNewTabLanguage('pt-BR')).toBe('pt-BR');
  });

  it('keeps an explicit Indonesian preference', () => {
    expect(resolveNewTabLanguage('id')).toBe('id');
  });

  it('keeps an explicit Arabic preference', () => {
    expect(resolveNewTabLanguage('ar')).toBe('ar');
  });

  it('provides Arabic New Tab product copy with Latin digits', () => {
    const strings = getNewTabStrings('ar');

    expect(strings.searchPlaceholder).toBe('ابحث في المجموعات أو علامات التبويب أو الويب...');
    expect(strings.groupLabel).toBe('مجموعة');
    expect(strings.tabLabel).toBe('علامة تبويب');
    expect(strings.tabsCount(3)).toBe('3 علامات تبويب');
  });

  it('formats Arabic New Tab dates and times with Latin numerals', () => {
    const value = new Date(2026, 7, 6, 13, 57);
    const formattedTime = formatNewTabTime(value, 'ar');
    const formattedDate = formatNewTabDate(value, 'ar');

    expect(formattedTime).toMatch(/[0-9]/);
    expect(formattedDate).toMatch(/[0-9]/);
    expect(formattedTime).not.toMatch(/[٠-٩]/);
    expect(formattedDate).not.toMatch(/[٠-٩]/);
  });

  it('applies Arabic metadata to the New Tab document and resets LTR locales', () => {
    const applyNewTabDocumentMetadata = (
      localization as typeof localization & {
        applyNewTabDocumentMetadata: (language: 'ar' | 'en') => void;
      }
    ).applyNewTabDocumentMetadata;

    applyNewTabDocumentMetadata('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');

    applyNewTabDocumentMetadata('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });


  it('provides Indonesian New Tab product copy', () => {
    const strings = getNewTabStrings('id');

    expect(strings.searchPlaceholder).toBe('Cari grup, tab, atau web...');
    expect(strings.groupLabel).toBe('Grup');
    expect(strings.tabLabel).toBe('Tab');
    expect(strings.tabsCount(2)).toBe('2 tab');
  });

  it('provides Brazilian Portuguese New Tab product copy', () => {
    const strings = getNewTabStrings('pt-BR');

    expect(strings.searchPlaceholder).toBe('Pesquisar grupos, abas ou na web...');
    expect(strings.groupLabel).toBe('Grupo');
    expect(strings.tabLabel).toBe('Aba');
    expect(strings.tabsCount(2)).toBe('2 abas');
  });

  it('provides Spanish New Tab product copy', () => {
    const strings = getNewTabStrings('es');

    expect(strings.searchPlaceholder).toBe('Buscar grupos, pestañas o en la web...');
    expect(strings.groupLabel).toBe('Grupo');
    expect(strings.tabLabel).toBe('Pestaña');
    expect(strings.tabsCount(2)).toBe('2 pestañas');
  });

  it('preserves existing English New Tab output', () => {
    const strings = getNewTabStrings('en');

    expect(strings.searchPlaceholder).toBe('Search groups, tabs, or the web...');
    expect(strings.tabsCount(2)).toBe('2 tabs');
  });
});
