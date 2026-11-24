import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as runtimeResources from './runtime-resources';
function flattenKeys(
  value: Record<string, unknown>,
  prefix = '',
  target: string[] = [],
): string[] {
  for (const [key, nested] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      flattenKeys(nested as Record<string, unknown>, nextKey, target);
    } else {
      target.push(nextKey);
    }
  }
  return target;
}

function hasNestedPath(value: Record<string, unknown>, path: string): boolean {
  const flatKeys = flattenKeys(value);
  return flatKeys.some((key) => key === path || key.endsWith(`.${path}`));
}

function nestedString(value: Record<string, unknown>, path: string): string | undefined {
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

function loadResourceFromDisk(fileName: 'ar.json' | 'en.json' | 'es.json' | 'id.json' | 'pt-BR.json' | 'tr.json'): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'src/i18n/locales', fileName), 'utf8'),
  ) as Record<string, unknown>;
}

describe('i18n resource parity', () => {
  it('keeps the bundled fallback synchronized with English', () => {
    expect(runtimeResources.EN_RESOURCES).toEqual(loadResourceFromDisk('en.json'));
    expect(Object.keys(runtimeResources)).toEqual(['EN_RESOURCES']);
  });

  it('packages every other language as JSON synchronized with its source', () => {
    const { getLocaleAssets } = require('../../scripts/generate-runtime-resources.cjs');
    const assets = getLocaleAssets();
    expect(assets.map((asset: { fileName: string }) => asset.fileName).sort()).toEqual([
      'locales/ar.json', 'locales/es.json', 'locales/id.json', 'locales/pt-BR.json', 'locales/tr.json',
    ]);
    for (const asset of assets) {
      expect(JSON.parse(asset.source)).toEqual(loadResourceFromDisk(asset.fileName.replace('locales/', '')));
    }
  });

  it('keeps English and Turkish resources in sync', () => {
    const english = loadResourceFromDisk('en.json');
    const turkish = loadResourceFromDisk('tr.json');
    const englishKeys = flattenKeys(english).sort();
    const turkishKeys = flattenKeys(turkish).sort();

    expect(turkishKeys).toEqual(englishKeys);
  });

  it('keeps English and Spanish resources in sync', () => {
    const english = loadResourceFromDisk('en.json');
    const spanish = loadResourceFromDisk('es.json');
    const englishKeys = flattenKeys(english).sort();
    const spanishKeys = flattenKeys(spanish).sort();

    expect(spanishKeys).toEqual(englishKeys);
  });

  it('keeps English and Brazilian Portuguese resources in sync', () => {
    const english = loadResourceFromDisk('en.json');
    const portuguese = loadResourceFromDisk('pt-BR.json');
    const englishKeys = flattenKeys(english).sort();
    const portugueseKeys = flattenKeys(portuguese).sort();

    expect(portugueseKeys).toEqual(englishKeys);
  });

  it('keeps English and Indonesian resources in sync', () => {
    const english = loadResourceFromDisk('en.json');
    const indonesian = loadResourceFromDisk('id.json');
    const englishKeys = flattenKeys(english).sort();
    const indonesianKeys = flattenKeys(indonesian).sort();

    expect(indonesianKeys).toEqual(englishKeys);
  });

  it('keeps Arabic semantic keys aligned while requiring all Arabic plural forms', () => {
    const pluralCategories = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
    const pluralSuffix = new RegExp(`_(${pluralCategories.join('|')})$`);
    const englishKeys = flattenKeys(loadResourceFromDisk('en.json')).sort();
    const arabicKeys = flattenKeys(loadResourceFromDisk('ar.json')).sort();
    const englishNonPlural = englishKeys.filter((key) => !pluralSuffix.test(key));
    const arabicNonPlural = arabicKeys.filter((key) => !pluralSuffix.test(key));
    const englishPluralFamilies = [...new Set(
      englishKeys
        .filter((key) => pluralSuffix.test(key))
        .map((key) => key.replace(pluralSuffix, '')),
    )].sort();
    const arabicPluralFamilies = [...new Set(
      arabicKeys
        .filter((key) => pluralSuffix.test(key))
        .map((key) => key.replace(pluralSuffix, '')),
    )].sort();

    expect(arabicNonPlural).toEqual(englishNonPlural);
    expect(arabicPluralFamilies).toEqual(englishPluralFamilies);

    for (const family of englishPluralFamilies) {
      for (const category of pluralCategories) {
        expect(arabicKeys).toContain(`${family}_${category}`);
      }
    }
  });

  it('keeps newly localized complete-sentence templates reviewed in every supported locale', () => {
    const expected = {
      'en.json': {
        'settings.integrations.primaryLabel': 'primary',
        'contextMenu.saveToProvider': 'Save to {{integration}}',
        'contextMenu.mirrorToProvider': 'Mirror to {{integration}}',
        'contextMenu.mirrorToIntegration': 'Mirror to {{integration}} ({{account}})',
        'sidepanel.teamsCode.shareMessage': 'Join my Bluetab session: {{code}}',
      },
      'tr.json': {
        'settings.integrations.primaryLabel': 'birincil',
        'contextMenu.saveToProvider': '{{integration}} hedefine kaydet',
        'contextMenu.mirrorToProvider': '{{integration}} hedefine yansıt',
        'contextMenu.mirrorToIntegration': '{{integration}} hedefine yansıt ({{account}})',
        'sidepanel.teamsCode.shareMessage': 'Bluetab oturumuma katıl: {{code}}',
      },
      'es.json': {
        'settings.integrations.primaryLabel': 'principal',
        'contextMenu.saveToProvider': 'Guardar en {{integration}}',
        'contextMenu.mirrorToProvider': 'Reflejar en {{integration}}',
        'contextMenu.mirrorToIntegration': 'Reflejar en {{integration}} ({{account}})',
        'sidepanel.teamsCode.shareMessage': 'Únete a mi sesión de Bluetab: {{code}}',
      },
      'pt-BR.json': {
        'settings.integrations.primaryLabel': 'principal',
        'contextMenu.saveToProvider': 'Salvar no {{integration}}',
        'contextMenu.mirrorToProvider': 'Espelhar no {{integration}}',
        'contextMenu.mirrorToIntegration': 'Espelhar no {{integration}} ({{account}})',
        'sidepanel.teamsCode.shareMessage': 'Participe da minha sessão do Bluetab: {{code}}',
      },
      'id.json': {
        'settings.integrations.primaryLabel': 'utama',
        'contextMenu.saveToProvider': 'Simpan ke {{integration}}',
        'contextMenu.mirrorToProvider': 'Cerminkan ke {{integration}}',
        'contextMenu.mirrorToIntegration': 'Cerminkan ke {{integration}} ({{account}})',
        'sidepanel.teamsCode.shareMessage': 'Bergabunglah dengan sesi Bluetab saya: {{code}}',
      },
      'ar.json': {
        'settings.integrations.primaryLabel': 'أساسي',
        'contextMenu.saveToProvider': 'الحفظ في {{integration}}',
        'contextMenu.mirrorToProvider': 'العكس إلى {{integration}}',
        'contextMenu.mirrorToIntegration': 'العكس إلى {{integration}} ({{account}})',
        'sidepanel.teamsCode.shareMessage': 'انضم إلى جلسة Bluetab الخاصة بي: {{code}}',
      },
    } as const;

    for (const [fileName, values] of Object.entries(expected)) {
      const resource = loadResourceFromDisk(fileName as keyof typeof expected);
      for (const [path, copy] of Object.entries(values)) {
        expect({ fileName, path, copy: nestedString(resource, path) }).toEqual({
          fileName,
          path,
          copy,
        });
      }
    }
  });

  it('includes critical settings and auth localization branches', () => {
    const english = loadResourceFromDisk('en.json');
    const arabic = loadResourceFromDisk('ar.json');
    const indonesian = loadResourceFromDisk('id.json');
    const portuguese = loadResourceFromDisk('pt-BR.json');
    const spanish = loadResourceFromDisk('es.json');
    const turkish = loadResourceFromDisk('tr.json');
    const requiredPaths = [
      'textSize.title',
      'textSize.options.small.label',
      'auth.login.title',
      'auth.account.title',
      'settings.general.tabRestoration.title',
      'settings.general.tabGroupRestoreMode.title',
      'settings.general.pinnedTabs.title',
      'settings.general.startupBehavior.title',
      'settings.general.customNewTab.title',
      'settings.general.contextMenu.title',
      'settings.general.restoreBehavior.title',
      'settings.general.saveBehavior.title',
      'settings.general.tabUrlDisplay.title',
      'settings.general.groupNotesDisplay.title',
      'settings.general.browserTabs.groupBorderLabel',
      'settingsTabs.tabs',
      'settingsTabs.sidePanel',
      'settings.general.groupMemory.title',
      'settings.general.floatingButton.title',
      'settings.general.duplicates.allow',
    ];

    const missingEnglish = requiredPaths.filter((path) => !hasNestedPath(english, path));
    const missingArabic = requiredPaths.filter((path) => !hasNestedPath(arabic, path));
    const missingIndonesian = requiredPaths.filter((path) => !hasNestedPath(indonesian, path));
    const missingPortuguese = requiredPaths.filter((path) => !hasNestedPath(portuguese, path));
    const missingSpanish = requiredPaths.filter((path) => !hasNestedPath(spanish, path));
    const missingTurkish = requiredPaths.filter((path) => !hasNestedPath(turkish, path));

    expect(missingEnglish).toEqual([]);
    expect(missingArabic).toEqual([]);
    expect(missingIndonesian).toEqual([]);
    expect(missingPortuguese).toEqual([]);
    expect(missingSpanish).toEqual([]);
    expect(missingTurkish).toEqual([]);
  });
});
