import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type FlatResource = Record<string, string>;

const pluralSuffix = /_(zero|one|two|few|many|other)$/;

function loadResource(fileName: 'ar.json' | 'en.json'): Record<string, unknown> {
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

describe('Arabic copy quality', () => {
  const english = flattenResource(loadResource('en.json'));
  const arabic = flattenResource(loadResource('ar.json'));

  const intentionalEnglishValues = [
    'auth.account.proPlan',
    'auth.login.emailPlaceholder',
    'brainDumpModal.title',
    'common.extensionName',
    'components.navigation.wrapped',
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
    'options.stats.noData',
    'settings.adhd.whitelistPlaceholder',
    'settings.brainDump.title',
    'settings.focus.blockedPhrasesPlaceholder',
    'settings.focus.domainPlaceholder',
    'settings.focus.presets.entertainment.examples',
    'settings.focus.presets.newsMedia.examples',
    'settings.focus.presets.shopping.examples',
    'settings.focus.presets.socialMedia.examples',
    'settings.mcp.connectedClient.toolsets.brainDump',
    'settings.pomodoro.presets.classic.description',
    'settings.pomodoro.presets.deepWork.description',
    'settings.pomodoro.presets.short.description',
    'settingsTabs.adhd',
    'settingsTabs.brainDump',
    'settingsTabs.mcp',
    'settingsTabs.pomodoro',
    'sidepanel.aiUpgradePrompt.assistantName',
    'sidepanel.brainDump',
    'sidepanel.teams',
    'sidepanel.teamsPreSession.codePlaceholder',
  ].sort();

  it('preserves protected tokens in non-plural copy', () => {
    for (const [key, englishValue] of Object.entries(english)) {
      if (pluralSuffix.test(key)) continue;
      expect({ key, tokens: protectedTokens(arabic[key] ?? '') }).toEqual({
        key,
        tokens: protectedTokens(englishValue),
      });
    }
  });

  it('preserves non-count protected tokens and count interpolation in Arabic plurals', () => {
    for (const [key, arabicValue] of Object.entries(arabic)) {
      const match = key.match(pluralSuffix);
      if (!match) continue;

      const family = key.replace(pluralSuffix, '');
      const englishTokens = [
        ...protectedTokens(english[`${family}_one`] ?? ''),
        ...protectedTokens(english[`${family}_other`] ?? ''),
      ];
      const expectedTechnicalTokens = [...new Set(
        englishTokens.filter((token) => token !== '{{count}}'),
      )].sort();
      const arabicTokens = protectedTokens(arabicValue);

      expect({
        key,
        tokens: arabicTokens.filter((token) => token !== '{{count}}'),
      }).toEqual({ key, tokens: expectedTechnicalTokens });

      if (englishTokens.includes('{{count}}')) {
        expect({ key, tokens: arabicTokens }).toEqual(
          expect.objectContaining({ tokens: expect.arrayContaining(['{{count}}']) }),
        );
      }
    }
  });

  it('uses Latin digits and contains no empty translated values', () => {
    expect(Object.entries(arabic).filter(([, value]) => value.trim() === '')).toEqual([]);
    expect(Object.entries(arabic).filter(([, value]) => /[٠-٩]/.test(value))).toEqual([]);
  });

  it('leaves English text only for reviewed brands, operators, placeholders, and identifiers', () => {
    const unchangedEnglishKeys = Object.keys(english)
      .filter((key) => english[key] === arabic[key] && key !== 'common.arabic')
      .sort();

    expect(unchangedEnglishKeys).toEqual(intentionalEnglishValues);
  });

  it('uses reviewed Modern Standard Arabic for representative product copy', () => {
    expect(arabic['common.arabic']).toBe('العربية');
    expect(arabic['common.cancel']).toBe('إلغاء');
    expect(arabic['common.save']).toBe('حفظ');
    expect(arabic['settingsTabs.integrations']).toBe('عمليات التكامل');
    expect(arabic['sidepanel.groupsPanel.noGroups']).toBe('لا توجد مجموعات محفوظة بعد');
    expect(arabic['components.teams.host']).toBe('المضيف');
  });

  it('keeps representative English output unchanged', () => {
    expect(english['common.cancel']).toBe('Cancel');
    expect(english['common.save']).toBe('Save');
    expect(english['settings.brainDump.title']).toBe('Brain Dump');
  });
});
