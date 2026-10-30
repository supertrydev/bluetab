import * as fs from 'fs';
import * as path from 'path';

const TABS_PANEL_FILE = path.resolve(__dirname, 'TabsPanel.tsx');
const source = fs.readFileSync(TABS_PANEL_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../i18n/locales/en.json'),
  'utf-8',
));

describe('sidepanel save-all contract', () => {
  it('routes Save All through saveTabsToBlueTab and forwards Pro state for smart naming', () => {
    expect(source).toContain("import { useAuth } from '@/components/auth/useAuth';");
    expect(source).toContain('const { isPro } = useAuth();');
    expect(source).toContain("groupName || t('sidepanel.tabsPanel.defaultSavedGroup'");
    expect(english.sidepanel.tabsPanel.defaultSavedGroup).toBe('Saved {{date}}');
    expect(source).toContain('isPro,');
  });
});
