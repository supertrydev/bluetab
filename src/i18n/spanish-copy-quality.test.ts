import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type FlatResource = Record<string, string>;

function loadResource(fileName: 'en.json' | 'es.json'): Record<string, unknown> {
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

  return patterns
    .flatMap((pattern) => value.match(pattern) ?? [])
    .sort();
}

describe('Spanish copy quality', () => {
  const english = flattenResource(loadResource('en.json'));
  const spanish = flattenResource(loadResource('es.json'));

  const intentionallyIdenticalKeys = [
    'auth.account.proPlan',
    'auth.login.emailPlaceholder',
    'brainDumpModal.duration15m',
    'brainDumpModal.duration30m',
    'brainDumpModal.duration45m',
    'brainDumpModal.title',
    'common.arabic',
    'common.extensionName',
    'common.indonesian',
    'common.brazilianPortuguese',
    'common.minuteShort',
    'common.sounds.blip',
    'common.sounds.ping',
    'common.turkish',
    'components.groupInfo.no',
    'components.navigation.wrapped',
    'components.newGroupModal.colorLabel',
    'components.syncStatus.error',
    'contextMenu.root',
    'document.flowTitle',
    'document.newTabTitle',
    'document.popupTitle',
    'flow.page.title',
    'flow.ruleCard.not',
    'notifications.appTitle',
    'notifications.pomodoroTitle',
    'onboarding.extended.sync.badge',
    'options.addFeedDialog.urlPlaceholder',
    'options.groupList.sort.alphabetical',
    'options.helpPage.tabs.faq',
    'options.projectModal.colorLabel',
    'options.stats.noData',
    'options.stats.sessionCount.flowtime_one',
    'options.stats.sessionCount.pomodoro_one',
    'popup.errorBoundary.errorLabel',
    'popup.errorBoundary.errorShort',
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
    'settings.general.groupMemory.title',
    'settings.mcp.connectedClient.toolsets.brainDump',
    'settings.pomodoro.presets.classic.description',
    'settings.pomodoro.presets.deepWork.description',
    'settings.pomodoro.presets.short.description',
    'settingsTabs.adhd',
    'settingsTabs.brainDump',
    'settingsTabs.general',
    'settingsTabs.mcp',
    'settingsTabs.pomodoro',
    'sidepanel.aiPanel.chat',
    'sidepanel.aiUpgradePrompt.assistantName',
    'sidepanel.brainDump',
    'sidepanel.tabsPanel.loadError',
    'sidepanel.teams',
    'sidepanel.teamsChat.label',
    'sidepanel.teamsPreSession.codePlaceholder',
  ].sort();

  it('preserves protected tokens for every translated value', () => {
    for (const [key, englishValue] of Object.entries(english)) {
      expect({ key, tokens: protectedTokens(spanish[key] ?? '') }).toEqual({
        key,
        tokens: protectedTokens(englishValue),
      });
    }
  });

  it('translates all meaningful English copy and keeps only approved technical terms identical', () => {
    const identicalKeys = Object.keys(english)
      .filter((key) => english[key] === spanish[key])
      .sort();

    expect(identicalKeys).toEqual(intentionallyIdenticalKeys);
    expect(Object.entries(spanish).filter(([, value]) => value.trim() === '')).toEqual([]);
  });

  it('uses neutral Spanish for representative product copy', () => {
    expect(spanish['common.spanish']).toBe('Español');
    expect(spanish['common.cancel']).toBe('Cancelar');
    expect(spanish['common.save']).toBe('Guardar');
    expect(spanish['settings.brainDump.title']).toBe('Brain Dump');
    expect(spanish['settingsTabs.integrations']).toBe('Integraciones');
  });

  it('does not change representative English output', () => {
    expect(english['common.cancel']).toBe('Cancel');
    expect(english['common.save']).toBe('Save');
    expect(english['settings.brainDump.title']).toBe('Brain Dump');
  });

  it('routes user-visible omnibox and generated-group copy through i18n', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/background/service-worker.ts'),
      'utf8',
    );

    expect(source).toContain("translate('components.omnibox.groupDescription'");
    expect(source).toContain("translate('components.omnibox.tabDescription'");
    expect(source).toContain("translate('contextMenu.generatedGroups.singleTab'");
    expect(source).not.toContain('`<dim>Group:</dim>');
    expect(source).not.toContain('`<dim>Tab:</dim>');
    expect(source).not.toContain('`Single Tab: ${currentTab.title}`');
  });

  it('offers Spanish in both language selectors', () => {
    const settingsSource = readFileSync(
      resolve(process.cwd(), 'src/settings/components/GeneralSettings.tsx'),
      'utf8',
    );
    const onboardingSource = readFileSync(
      resolve(process.cwd(), 'src/onboarding/OnboardingWizard.tsx'),
      'utf8',
    );

    expect(settingsSource).toContain('<SelectItem value="es">{t(\'common.spanish\')}</SelectItem>');
    expect(onboardingSource).toContain("language === 'es'");
    expect(onboardingSource).toContain("onLanguageChange('es')");
    expect(onboardingSource).toContain("t('common.spanish')");
  });

  it('keeps translated sidepanel header actions accessible at 320px', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/sidepanel/components/SidepanelHeader.tsx'),
      'utf8',
    );

    expect(source).toContain('aria-label={t(\'sidepanel.header.saveCurrentTabs\')}');
    expect(source).toContain('aria-label={t(\'sidepanel.header.openManager\')}');
    expect(source).toContain('className="hidden min-[360px]:inline"');
  });
});
