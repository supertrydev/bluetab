import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(__dirname, '../AIUpgradePrompt.tsx');
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../i18n/locales/en.json'),
  'utf-8',
));

describe('AIUpgradePrompt free state design contract', () => {
  it('presents one chat message instead of a generic feature card stack', () => {
    expect(source).toContain('LockedPreviewMessage');
    expect(source).toContain('bluetabAvatar');
    expect(source).not.toContain("from '@/components/ui/card'");
    expect(source).not.toContain("from '@/components/ui/input'");
  });

  it('keeps the free state minimal without the helper command grid', () => {
    expect(source).not.toContain('It can help with');
    expect(source).not.toContain('EXAMPLE_COMMANDS');
    expect(source).not.toContain('gradient');
    expect(source).not.toContain('LockKeyhole');
  });

  it('keeps the upgrade action wired to the feature gate URL', () => {
    expect(source).toContain('getUpgradeUrl()');
    expect(source).toContain('chrome.tabs.create({ url: upgradeUrl })');
    expect(source).toContain("t('sidepanel.aiUpgradePrompt.upgrade')");
    expect(english.sidepanel.aiUpgradePrompt.upgrade).toBe('Upgrade to Pro');
  });
});
