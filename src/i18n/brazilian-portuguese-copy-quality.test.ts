import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type FlatResource = Record<string, string>;

const localePath = resolve(process.cwd(), 'src/i18n/locales/pt-BR.json');

function loadResource(fileName: 'en.json' | 'tr.json' | 'pt-BR.json'): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'src/i18n/locales', fileName), 'utf8'),
  ) as Record<string, unknown>;
}

function flattenResource(
  value: Record<string, unknown>,
  prefix = '',
  target: FlatResource = {},
): FlatResource {
  for (const [key, nested] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      flattenResource(nested as Record<string, unknown>, nextKey, target);
    } else if (typeof nested === 'string') {
      target[nextKey] = nested;
    }
  }
  return target;
}

function protectedTokens(value: string): string[] {
  const patterns = [
    /\{\{[^{}]+\}\}/g,
    /<\/?[a-zA-Z][^>]*>/g,
    /https?:\/\/[^\s)]+/g,
    /chrome:\/\/[^\s)]+/g,
    /\b(?:Ctrl|Cmd|Alt|Shift)(?:(?:\/|\+)(?:Ctrl|Cmd|Alt|Shift|Enter|Escape|Tab|[A-Z]))+\b/g,
  ];

  return patterns.flatMap((pattern) => value.match(pattern) ?? []).sort();
}

describe('Brazilian Portuguese copy quality', () => {
  const intentionallyIdenticalKeys = [
    'auth.account.proPlan',
    'auth.login.emailPlaceholder',
    'brainDumpModal.duration15m',
    'brainDumpModal.duration30m',
    'brainDumpModal.duration45m',
    'brainDumpModal.title',
    'common.arabic',
    'common.brazilianPortuguese',
    'common.extensionName',
    'common.indonesian',
    'common.minuteShort',
    'common.sounds.blip',
    'common.sounds.ping',
    'common.turkish',
    'components.backupStatus.title',
    'components.bluetConnection.links_one',
    'components.bluetConnection.links_other',
    'components.navigation.wrapped',
    'components.syncStatus.offline',
    'components.teams.offline',
    'components.teams.online',
    'contextMenu.root',
    'document.flowTitle',
    'document.newTabTitle',
    'document.popupTitle',
    'flow.page.title',
    'navigation.menu',
    'notifications.appTitle',
    'notifications.pomodoroTitle',
    'onboarding.extended.sync.badge',
    'options.addFeedDialog.urlPlaceholder',
    'options.feedList.feeds',
    'options.feedsPage.fallbackTitle',
    'options.feedsPage.title',
    'options.helpPage.tabs.feedback',
    'options.stats.focusHours',
    'options.stats.noData',
    'options.stats.sessionCount.flowtime_one',
    'options.stats.sessionCount.flowtime_other',
    'options.stats.sessionCount.pomodoro_one',
    'options.stats.sessionCount.pomodoro_other',
    'settings.adhd.breakPreview',
    'settings.adhd.whitelistPlaceholder',
    'settings.about.copyright', // Copyright symbol, year, and company name are language-neutral.
    'settings.brainDump.title',
    'settings.focus.blockedPhrasesPlaceholder',
    'settings.focus.domainPlaceholder',
    'settings.focus.presets.entertainment.examples',
    'settings.focus.presets.newsMedia.examples',
    'settings.focus.presets.shopping.examples',
    'settings.focus.presets.socialMedia.examples',
    'settings.groupMenu.submenuFallback',
    'settings.mcp.connectedClient.toolsets.brainDump',
    'settings.pomodoro.presets.classic.description',
    'settings.pomodoro.presets.deepWork.description',
    'settings.pomodoro.presets.short.description',
    'settingsTabs.adhd',
    'settingsTabs.brainDump',
    'settingsTabs.mcp',
    'settingsTabs.pomodoro',
    'sidepanel.aiPanel.chat',
    'sidepanel.aiPanel.messages_one',
    'sidepanel.aiPanel.messages_other',
    'sidepanel.aiUpgradePrompt.assistantName',
    'sidepanel.brainDump',
    'sidepanel.teams',
    'sidepanel.teamsChat.label',
    'sidepanel.teamsPreSession.codePlaceholder',
    'sidepanel.teamsSession.offline',
  ].sort();

  it('provides a checked-in Brazilian Portuguese locale', () => {
    expect(existsSync(localePath)).toBe(true);
  });

  it('matches every English key and preserves protected tokens', () => {
    const english = flattenResource(loadResource('en.json'));
    const portuguese = flattenResource(loadResource('pt-BR.json'));

    expect(Object.keys(portuguese).sort()).toEqual(Object.keys(english).sort());
    for (const [key, englishValue] of Object.entries(english)) {
      expect({ key, tokens: protectedTokens(portuguese[key] ?? '') }).toEqual({
        key,
        tokens: protectedTokens(englishValue),
      });
    }
    expect(Object.entries(portuguese).filter(([, value]) => value.trim() === '')).toEqual([]);
  });

  it('uses neutral Brazilian Portuguese for representative product copy', () => {
    const portuguese = flattenResource(loadResource('pt-BR.json'));

    expect(portuguese['common.brazilianPortuguese']).toBe('Português (Brasil)');
    expect(portuguese['common.cancel']).toBe('Cancelar');
    expect(portuguese['common.save']).toBe('Salvar');
    expect(portuguese['settingsTabs.integrations']).toBe('Integrações');
    expect(portuguese['sidepanel.teamsPreSession.hostTitle']).toBe('Organizar uma sessão');
    expect(portuguese['sidepanel.groupsPanel.noGroups']).toBe('Ainda não há grupos salvos');
    expect(portuguese['blocked.siteFallback']).toBe('este site');
    expect(portuguese['components.floatingButton.saveThisTab']).toBe(
      'Salvar esta aba (mantenha pressionado para salvar todas as abas)',
    );
  });

  it('preserves migrated English literals byte-for-byte and supplies reviewed Turkish copy', () => {
    const english = flattenResource(loadResource('en.json'));
    const turkish = flattenResource(loadResource('tr.json'));
    const expectedCopy = {
      'notifications.brainDumpRestricted': {
        en: "Can't capture here — open any regular tab and try again.",
        tr: 'Burada yakalama yapılamıyor — normal bir sekme açıp tekrar deneyin.',
      },
      'blocked.siteFallback': {
        en: 'this site',
        tr: 'bu site',
      },
      'components.floatingButton.saveThisTab': {
        en: 'Save this tab (hold for all tabs)',
        tr: 'Bu sekmeyi kaydet (tüm sekmeler için basılı tutun)',
      },
      'components.floatingButton.matchingDump': {
        en: 'Save this tab (matching Dump found for this site)',
        tr: 'Bu sekmeyi kaydet (bu site için eşleşen Dump bulundu)',
      },
      'components.floatingButton.saveTabsLeft': {
        en: 'Save tabs to the left',
        tr: 'Sekmeleri sola kaydet',
      },
      'components.floatingButton.summarizePage': {
        en: 'Summarize page to Dump',
        tr: "Sayfayı Dump'a özetle",
      },
      'components.floatingButton.saveAllOtherTabs': {
        en: 'Save all other tabs',
        tr: 'Diğer tüm sekmeleri kaydet',
      },
      'components.floatingButton.saveTabsRight': {
        en: 'Save tabs to the right',
        tr: 'Sekmeleri sağa kaydet',
      },
      'components.floatingButton.hide': {
        en: 'Hide floating button (reappears on page reload)',
        tr: 'Yüzen düğmeyi gizle (sayfa yeniden yüklendiğinde tekrar görünür)',
      },
    } as const;

    for (const [key, copy] of Object.entries(expectedCopy)) {
      expect({ key, en: english[key], tr: turkish[key] }).toEqual({ key, ...copy });
    }
    expect({
      en: english['common.brazilianPortuguese'],
      tr: turkish['common.brazilianPortuguese'],
    }).toEqual({ en: 'Português (Brasil)', tr: 'Português (Brasil)' });
  });

  it('keeps identical English copy only for reviewed brands and technical terms', () => {
    const english = flattenResource(loadResource('en.json'));
    const portuguese = flattenResource(loadResource('pt-BR.json'));
    const identicalKeys = Object.keys(english)
      .filter((key) => english[key] === portuguese[key])
      .sort();

    expect(identicalKeys).toEqual(intentionallyIdenticalKeys);
  });

  it('routes the remaining restricted-page Brain Dump literal through i18n', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/background/service-worker.ts'),
      'utf8',
    );

    expect(source).toContain("translate('notifications.brainDumpRestricted')");
    expect(source).not.toContain("const message = \"Can't capture here");
  });

  it('routes blocked-page and floating-button copy through locale resources', () => {
    const blockedSource = readFileSync(
      resolve(process.cwd(), 'src/blocked/BlockedPage.tsx'),
      'utf8',
    );
    const focusSource = readFileSync(
      resolve(process.cwd(), 'src/services/focus-service.ts'),
      'utf8',
    );
    const floatingButtonSource = readFileSync(
      resolve(process.cwd(), 'src/content/floating-button.ts'),
      'utf8',
    );

    expect(blockedSource).toContain("t('blocked.siteFallback')");
    expect(blockedSource).not.toContain("domain || 'this site'");
    expect(focusSource).not.toContain("hostname ?? 'this site'");
    expect(floatingButtonSource).toContain('response.floatingButtonTitles');
  });

  it('does not change representative English output', () => {
    const english = flattenResource(loadResource('en.json'));

    expect(english['common.cancel']).toBe('Cancel');
    expect(english['common.save']).toBe('Save');
    expect(english['settings.brainDump.title']).toBe('Brain Dump');
    expect(english['components.floatingButton.saveThisTab']).toBe(
      'Save this tab (hold for all tabs)',
    );
  });
});
