import {
  getLanguageDirection,
  getLocaleTag,
  getResolvedLanguage,
  initI18n,
  resolveLanguagePreference,
  t,
} from './index';

describe('i18n worker safety', () => {
  it('initializes when a service-worker document shim has no documentElement', async () => {
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {},
    });

    try {
      await expect(initI18n({ language: 'en' })).resolves.toBe('en');
    } finally {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument,
        });
      }
    }
  });
});

describe('document locale metadata', () => {
  it.each([
    ['ar', 'rtl'],
    ['ar-SA', 'rtl'],
    ['ar_EG', 'rtl'],
    ['arn-CL', 'ltr'],
    ['arbitrary', 'ltr'],
  ] as const)('maps %s to %s direction by exact primary language', (language, direction) => {
    expect(getLanguageDirection(language)).toBe(direction);
  });

  it('explicitly resets left-to-right document direction for non-Arabic locales', async () => {
    const originalDocument = globalThis.document;
    const documentElement = { lang: 'ar', dir: 'rtl' };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement },
    });

    try {
      await initI18n({ language: 'tr' });

      expect(documentElement).toEqual({ lang: 'tr', dir: 'ltr' });
    } finally {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument,
        });
      }
    }
  });

  it('does not mutate host document metadata when document management is disabled', async () => {
    const originalDocument = globalThis.document;
    const documentElement = { lang: 'fr', dir: 'ltr' };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement },
    });

    try {
      await initI18n({
        language: 'en',
        manageDocumentMetadata: false,
      });

      expect(documentElement).toEqual({ lang: 'fr', dir: 'ltr' });
    } finally {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument,
        });
      }
    }
  });
});

describe('resolveLanguagePreference', () => {
  it('restores a persisted Arabic preference', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      settings: { language: 'ar' },
    });

    await expect(getResolvedLanguage()).resolves.toBe('ar');
  });

  it('restores a persisted Indonesian preference', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      settings: { language: 'id' },
    });

    await expect(getResolvedLanguage()).resolves.toBe('id');
  });

  it('restores a persisted Brazilian Portuguese preference', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      settings: { language: 'pt-BR' },
    });

    await expect(getResolvedLanguage()).resolves.toBe('pt-BR');
  });

  it('restores a persisted Spanish preference', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      settings: { language: 'es' },
    });

    await expect(getResolvedLanguage()).resolves.toBe('es');
  });

  it('prefers explicit language over browser language', () => {
    expect(
      resolveLanguagePreference('tr', {
        chromeUiLanguage: 'en-US',
        navigatorLanguage: 'en-US',
      }),
    ).toBe('tr');
  });

  it('prefers an explicit Spanish preference over browser language', () => {
    expect(
      resolveLanguagePreference('es', {
        chromeUiLanguage: 'tr-TR',
        navigatorLanguage: 'en-US',
      }),
    ).toBe('es');
  });

  it('prefers an explicit Brazilian Portuguese preference over browser language', () => {
    expect(
      resolveLanguagePreference('pt-BR', {
        chromeUiLanguage: 'es-MX',
        navigatorLanguage: 'tr-TR',
      }),
    ).toBe('pt-BR');
  });

  it('prefers an explicit Indonesian preference over browser language', () => {
    expect(
      resolveLanguagePreference('id', {
        chromeUiLanguage: 'pt-BR',
        navigatorLanguage: 'es-MX',
      }),
    ).toBe('id');
  });

  it('maps system Turkish variants to tr', () => {
    expect(
      resolveLanguagePreference('system', {
        chromeUiLanguage: 'tr-TR',
        navigatorLanguage: 'en-US',
      }),
    ).toBe('tr');
  });

  it('falls back to navigator language when chrome.i18n is unavailable', () => {
    expect(
      resolveLanguagePreference('system', {
        chromeUiLanguage: null,
        navigatorLanguage: 'tr-CY',
      }),
    ).toBe('tr');
  });

  it.each(['es', 'es-ES', 'es-MX'])(
    'maps system Spanish browser language %s to es',
    (browserLanguage) => {
      expect(
        resolveLanguagePreference('system', {
          chromeUiLanguage: browserLanguage,
          navigatorLanguage: 'en-US',
        }),
      ).toBe('es');
    },
  );

  it.each(['pt', 'pt-BR', 'pt_BR'])(
    'maps system Brazilian Portuguese browser language %s to pt-BR',
    (browserLanguage) => {
      expect(
        resolveLanguagePreference('system', {
          chromeUiLanguage: browserLanguage,
          navigatorLanguage: 'en-US',
        }),
      ).toBe('pt-BR');
    },
  );

  it.each(['id', 'id-ID', 'id_ID'])(
    'maps system Indonesian browser language %s to id',
    (browserLanguage) => {
      expect(
        resolveLanguagePreference('system', {
          chromeUiLanguage: browserLanguage,
          navigatorLanguage: 'en-US',
        }),
      ).toBe('id');
    },
  );

  it.each(['ar', 'ar-SA', 'ar-EG', 'ar_EG'])(
    'maps system Arabic browser language %s to ar',
    (browserLanguage) => {
      expect(
        resolveLanguagePreference('system', {
          chromeUiLanguage: browserLanguage,
          navigatorLanguage: 'en-US',
        }),
      ).toBe('ar');
    },
  );

  it('prefers an explicit Arabic preference over browser language', () => {
    expect(
      resolveLanguagePreference('ar', {
        chromeUiLanguage: 'en-US',
        navigatorLanguage: 'en-US',
      }),
    ).toBe('ar');
  });

  it('falls back to English for unsupported languages', () => {
    expect(
      resolveLanguagePreference('system', {
        chromeUiLanguage: 'de-DE',
        navigatorLanguage: 'de-DE',
      }),
    ).toBe('en');
  });

  it('keeps existing English copy unchanged and renders its Spanish counterpart', async () => {
    await initI18n({ language: 'en' });
    expect(t('contextMenu.generatedGroups.singleTab', { title: 'Example' })).toBe(
      'Single Tab: Example',
    );
    expect(t('components.omnibox.groupDescription', { name: 'Docs', count: 2 })).toBe(
      '<dim>Group:</dim> <match>Docs</match> <dim>(2 tabs)</dim>',
    );
    expect(t('components.omnibox.tabDescription', { title: 'Guide', url: 'https://example.com' })).toBe(
      '<dim>Tab:</dim> <match>Guide</match> <dim>- https://example.com</dim>',
    );

    await initI18n({ language: 'es' });
    expect(t('contextMenu.generatedGroups.singleTab', { title: 'Example' })).toBe(
      'Pestaña individual: Example',
    );
    expect(t('components.omnibox.groupDescription', { name: 'Docs', count: 2 })).toBe(
      '<dim>Grupo:</dim> <match>Docs</match> <dim>(2 pestañas)</dim>',
    );
    expect(t('components.omnibox.tabDescription', { title: 'Guide', url: 'https://example.com' })).toBe(
      '<dim>Pestaña:</dim> <match>Guide</match> <dim>- https://example.com</dim>',
    );
  });

  it('renders Brazilian Portuguese while preserving existing English output', async () => {
    await initI18n({ language: 'en' });
    expect(t('common.cancel')).toBe('Cancel');
    expect(t('sidepanel.groupsPanel.noGroups')).toBe('No saved groups yet');

    await initI18n({ language: 'pt-BR' });
    expect(t('common.cancel')).toBe('Cancelar');
    expect(t('sidepanel.groupsPanel.noGroups')).toBe('Ainda não há grupos salvos');
  });

  it('renders Indonesian while preserving existing English output', async () => {
    await initI18n({ language: 'en' });
    expect(t('common.cancel')).toBe('Cancel');
    expect(t('sidepanel.groupsPanel.noGroups')).toBe('No saved groups yet');

    await initI18n({ language: 'id' });
    expect(t('common.cancel')).toBe('Batal');
    expect(t('sidepanel.groupsPanel.noGroups')).toBe('Belum ada grup tersimpan');
  });

  it('renders Arabic with RTL document metadata and Latin-number plural output', async () => {
    const originalDocument = globalThis.document;
    const documentElement = { lang: 'en', dir: 'ltr' };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement },
    });

    try {
      await initI18n({ language: 'ar' });

      expect(documentElement).toEqual({ lang: 'ar', dir: 'rtl' });
      expect(getLocaleTag('ar')).toBe('ar-u-nu-latn');
      expect(t('common.cancel')).toBe('إلغاء');
      expect(t('components.teams.tab', { count: 0 })).toBe('لا توجد علامات تبويب (0)');
      expect(t('components.teams.tab', { count: 1 })).toBe('علامة تبويب واحدة (1)');
      expect(t('components.teams.tab', { count: 2 })).toBe('علامتا تبويب (2)');
      expect(t('components.teams.tab', { count: 3 })).toBe('3 علامات تبويب');
      expect(t('components.teams.tab', { count: 11 })).toBe('11 علامة تبويب');
      expect(t('components.teams.tab', { count: 102 })).toBe('102 علامة تبويب');
    } finally {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument,
        });
      }
    }
  });
});
