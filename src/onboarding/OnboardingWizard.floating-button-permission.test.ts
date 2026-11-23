import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(__dirname, './OnboardingWizard.tsx');
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');

describe('OnboardingWizard onboarding steps', () => {
  it('checks existing floating button site access on load', () => {
    expect(source).toContain('hasFloatingButtonHostAccess');
    expect(source).toContain('refreshFloatingButtonAccess');
  });

  it('offers a first-run CTA that requests floating button site access', () => {
    expect(source).toContain('requestFloatingButtonHostAccess');
    expect(source).toContain("onboarding.floatingButton.enableCta");
  });

  it('moves the sidepanel step directly after welcome', () => {
    expect(source).toContain("id: 'welcome'");
    expect(source).toContain("id: 'sidepanel'");
    expect(source.indexOf("id: 'welcome'")).toBeLessThan(source.indexOf("id: 'sidepanel'"));
    expect(source.indexOf("id: 'sidepanel'")).toBeLessThan(source.indexOf("id: 'save'"));
  });

  it('syncs the floating button content script after the permission is granted', () => {
    expect(source).toContain("FLOATING_BUTTON_SYNC_CONTENT_SCRIPT");
  });

  it('adds a Brain Dump step that includes the default Alt+Q hint', () => {
    expect(source).toContain("id: 'brain-dump'");
    expect(source).toContain("onboarding.brainDump.description");
    expect(source).toContain("onboarding.brainDump.shortcut");
    expect(source).not.toContain('Open Chrome shortcuts');
    expect(source).not.toContain('chrome://extensions/shortcuts');
  });

  it('removes the dedicated keyboard shortcuts step from onboarding', () => {
    expect(source).not.toContain("id: 'shortcuts'");
    expect(source).not.toContain('Keyboard Shortcuts');
  });

  it('adds a sidepanel step that explains pinning the extension icon', () => {
    expect(source).toContain("id: 'sidepanel'");
    expect(source).toContain("onboarding.sidepanel.pinTitle");
    expect(source).toContain("onboarding.sidepanel.usesTitle");
  });

  it('lets the first step switch language immediately', () => {
    expect(source).toContain("const [language, setLanguage] = useState<LanguagePreference>('system')");
    expect(source).toContain('applyLanguagePreference');
    expect(source).toContain("onboarding.welcome.languageTitle");
    expect(source).toContain("common.browserDefault");
    expect(source).toContain("common.english");
    expect(source).toContain("common.turkish");
  });

  it('offers Brazilian Portuguese and restores its persisted preference', () => {
    expect(source).toContain('<SelectItem value="pt-BR">');
    expect(source).toContain("t('common.brazilianPortuguese')");
    expect(source).toContain("nextLanguage === 'pt-BR'");
  });

  it('offers Indonesian and restores its persisted preference', () => {
    expect(source).toContain('<SelectItem value="id">');
    expect(source).toContain("t('common.indonesian')");
    expect(source).toContain("nextLanguage === 'id'");
  });

  it('offers Arabic and restores its persisted preference', () => {
    expect(source).toContain('<SelectItem value="ar">');
    expect(source).toContain("t('common.arabic')");
    expect(source).toContain("nextLanguage === 'ar'");
  });
});
