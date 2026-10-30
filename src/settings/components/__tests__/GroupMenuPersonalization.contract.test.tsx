import * as fs from 'fs';
import * as path from 'path';

const TYPES_FILE = path.resolve(__dirname, '../../../types/models.ts');
const SORTING_FILE = path.resolve(__dirname, '../../../utils/sorting.ts');
const SETTINGS_FILE = path.resolve(__dirname, '../GroupMenuSettings.tsx');
const MENU_FILE = path.resolve(__dirname, '../../../options/components/GroupMenu.tsx');

const typesSource = fs.readFileSync(TYPES_FILE, 'utf-8');
const sortingSource = fs.readFileSync(SORTING_FILE, 'utf-8');
const settingsSource = fs.readFileSync(SETTINGS_FILE, 'utf-8');
const menuSource = fs.readFileSync(MENU_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../i18n/locales/en.json'),
  'utf-8',
));

describe('Group Menu Personalization contract', () => {
  it('tracks integrations, reminder, and offline actions in the config model', () => {
    expect(typesSource).toContain("'integrations'");
    expect(typesSource).toContain("'setReminder'");
    expect(typesSource).toContain("'saveOffline'");
    expect(typesSource).toContain('integrations: boolean;');
    expect(typesSource).toContain('setReminder: boolean;');
    expect(typesSource).toContain('saveOffline: boolean;');
  });

  it('includes the new actions in the default main menu order', () => {
    expect(sortingSource).toContain('integrations: true');
    expect(sortingSource).toContain('setReminder: true');
    expect(sortingSource).toContain('saveOffline: true');
    expect(sortingSource).toContain("'integrations'");
    expect(sortingSource).toContain("'setReminder'");
    expect(sortingSource).toContain("'saveOffline'");
  });

  it('lets the settings UI describe the real top-level menu actions', () => {
    expect(settingsSource).toContain("integrations: t('settings.groupMenu.labels.integrations')");
    expect(settingsSource).toContain("setReminder: t('settings.groupMenu.labels.setReminder')");
    expect(settingsSource).toContain("saveOffline: t('settings.groupMenu.labels.saveOffline')");
    expect(english.settings.groupMenu.labels).toMatchObject({
      integrations: 'Integrations',
      setReminder: 'Set Reminder',
      saveOffline: 'Save Offline',
    });
  });

  it('hides Save Offline in settings while the Readings feature flag is off', () => {
    expect(settingsSource).toContain("if (item === 'saveOffline') return ENABLE_READINGS;");
  });

  it('renders integrations, reminder, and offline from the configurable main menu flow', () => {
    expect(menuSource).toContain("if (token === 'integrations')");
    expect(menuSource).toContain("if (token === 'setReminder')");
    expect(menuSource).toContain("if (token === 'saveOffline')");
    expect(menuSource).not.toContain('{renderIntegrationMenu()}');
  });

  it('resolves submenu names through the shared label helper instead of a hardcoded title', () => {
    expect(menuSource).toContain('getGroupSubmenuLabel(submenu, t)');
    expect(settingsSource).toContain('getGroupSubmenuLabel(submenu, t)');
    expect(menuSource).not.toContain("{isShareMenu ? 'Share to' : submenu.label}");
    expect(menuSource).not.toContain("{submenu.label || t('options.groupMenu.shareTo')}");
  });

  it('computes integration visibility before filtering the main menu items', () => {
    expect(menuSource.indexOf('const hasIntegrationMenu')).toBeGreaterThan(-1);
    expect(menuSource.indexOf('const renderedMainItems')).toBeGreaterThan(-1);
    expect(menuSource.indexOf('const hasIntegrationMenu')).toBeLessThan(menuSource.indexOf('const renderedMainItems'));
  });
});
