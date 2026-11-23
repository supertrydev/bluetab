import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type FlatResource = Record<string, string>;

const localePath = resolve(process.cwd(), 'src/i18n/locales/id.json');

function loadResource(fileName: 'en.json' | 'id.json'): Record<string, unknown> {
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

describe('Indonesian copy quality', () => {
  const intentionallyIdenticalKeys = [
    'auth.account.proPlan',
    'auth.login.email',
    'auth.login.emailPlaceholder',
    'brainDumpModal.title',
    'common.arabic',
    'common.brazilianPortuguese',
    'common.browser',
    'common.edit',
    'common.extensionName',
    'common.indonesian',
    'common.sounds.blip',
    'common.sounds.ping',
    'common.turkish',
    'components.a11y.breadcrumb',
    'components.a11y.sidebar',
    'components.confirmation.fallbackTab',
    'components.groupInfo.tab_one',
    'components.navigation.wrapped',
    'components.omnibox.tabDescription',
    'components.syncStatus.offline',
    'components.teams.host',
    'components.teams.offline',
    'components.teams.online',
    'components.teams.tab_one',
    'contextMenu.root',
    'document.flowTitle',
    'document.newTabTitle',
    'document.popupTitle',
    'flow.page.title',
    'managerWelcome.tabs.bluetab', // Product name stays unchanged in every locale.
    'flow.ruleCard.templateBadge',
    'navigation.menu',
    'newTab.tabLabel',
    'notifications.appTitle',
    'notifications.pomodoroTitle',
    'onboarding.extended.sync.badge',
    'options.addFeedDialog.urlPlaceholder',
    'options.addGroupToProject.tabs_one',
    'options.dragDrop.tabCount_one',
    'options.groupList.sort.alphabetical',
    'options.helpPage.tabs.faq',
    'options.manager.organizeProgress.batch',
    'options.stats.noData',
    'options.stats.sessionCount.flowtime_one',
    'options.stats.sessionCount.pomodoro_one',
    'popup.archiveModal.tabCount_one',
    'settings.adhd.whitelistPlaceholder',
    'settings.about.browser', // Browser is also the established Indonesian UI term.
    'settings.about.copyright', // Copyright symbol, year, and company name are language-neutral.
    'settings.brainDump.title',
    'settings.focus.blockedPhrasesPlaceholder',
    'settings.focus.domainPlaceholder',
    'settings.focus.presets.entertainment.examples',
    'settings.focus.presets.newsMedia.examples',
    'settings.focus.presets.shopping.examples',
    'settings.focus.presets.socialMedia.examples',
    'settings.focus.summaryDomainCount_one',
    'settings.groupMenu.editSubmenu',
    'settings.groupMenu.submenuFallback',
    'settings.integrations.channel',
    'settings.mcp.bearerToken',
    'settings.mcp.connectedClient.toolsets.brainDump',
    'settings.pomodoro.presets.classic.description',
    'settings.pomodoro.presets.deepWork.description',
    'settings.pomodoro.presets.short.description',
    'settings.sessionBackup.tabs_one',
    'settingsTabs.adhd',
    'settingsTabs.brainDump',
    'settingsTabs.mcp',
    'settingsTabs.pomodoro',
    'sidepanel.aiPanel.chat',
    'sidepanel.aiUpgradePrompt.assistantName',
    'sidepanel.brainDump',
    'sidepanel.teams',
    'sidepanel.teamsChat.label',
    'sidepanel.teamsPreSession.codePlaceholder',
    'sidepanel.teamsSession.live',
    'sidepanel.teamsSession.offline',
  ].sort();

  it('provides a checked-in Indonesian locale', () => {
    expect(existsSync(localePath)).toBe(true);
  });

  it('matches every English key and preserves protected tokens', () => {
    const english = flattenResource(loadResource('en.json'));
    const indonesian = flattenResource(loadResource('id.json'));

    expect(Object.keys(indonesian).sort()).toEqual(Object.keys(english).sort());
    for (const [key, englishValue] of Object.entries(english)) {
      expect({ key, tokens: protectedTokens(indonesian[key] ?? '') }).toEqual({
        key,
        tokens: protectedTokens(englishValue),
      });
    }
    expect(Object.entries(indonesian).filter(([, value]) => value.trim() === '')).toEqual([]);
  });

  it('uses neutral Indonesian for representative product copy', () => {
    const indonesian = flattenResource(loadResource('id.json'));

    expect(indonesian['common.indonesian']).toBe('Bahasa Indonesia');
    expect(indonesian['common.cancel']).toBe('Batal');
    expect(indonesian['common.save']).toBe('Simpan');
    expect(indonesian['settingsTabs.integrations']).toBe('Integrasi');
    expect(indonesian['sidepanel.teamsPreSession.hostTitle']).toBe('Selenggarakan sesi');
    expect(indonesian['sidepanel.groupsPanel.noGroups']).toBe('Belum ada grup tersimpan');
    expect(indonesian['blocked.siteFallback']).toBe('situs ini');
    expect(indonesian['components.floatingButton.saveThisTab']).toBe(
      'Simpan tab ini (tahan untuk semua tab)',
    );
  });

  it('keeps identical English copy only for reviewed brands and technical terms', () => {
    const english = flattenResource(loadResource('en.json'));
    const indonesian = flattenResource(loadResource('id.json'));
    const identicalKeys = Object.keys(english)
      .filter((key) => english[key] === indonesian[key])
      .sort();

    expect(identicalKeys).toEqual(intentionallyIdenticalKeys);
  });

  it('keeps representative English output unchanged', () => {
    const english = flattenResource(loadResource('en.json'));

    expect(english['common.cancel']).toBe('Cancel');
    expect(english['common.save']).toBe('Save');
    expect(english['settings.brainDump.title']).toBe('Brain Dump');
    expect(english['components.floatingButton.saveThisTab']).toBe(
      'Save this tab (hold for all tabs)',
    );
  });
});
