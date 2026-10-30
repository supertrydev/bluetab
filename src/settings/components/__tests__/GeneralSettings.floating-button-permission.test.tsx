import * as fs from 'fs';
import * as path from 'path';
import { FLOATING_BUTTON_HOST_ORIGINS } from '@/services/floating-button-content-script';

const COMPONENT_FILE = path.resolve(__dirname, '../GeneralSettings.tsx');
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../i18n/locales/en.json'),
  'utf-8',
));

describe('GeneralSettings floating button site access contract', () => {
  it('checks optional host access before presenting the enabled state', () => {
    expect(source).toContain('hasFloatingButtonHostAccess');
    expect(source).toContain('floatingButtonSiteAccess');
  });

  it('requests optional host access from the explicit CTA', () => {
    expect(source).toContain('requestFloatingButtonHostAccess');
    expect(source).toContain("t('settings.general.floatingButton.enableSiteAccess')");
    expect(english.settings.general.floatingButton.enableSiteAccess).toBe('Enable site access');
  });

  it('asks the service worker to sync registered content scripts after settings or permission changes', () => {
    expect(source).toContain('FLOATING_BUTTON_SYNC_CONTENT_SCRIPT');
    expect(source).toContain('syncFloatingButtonRegistration');
  });

  it('shows the exact optional host origins in the site-access copy', () => {
    expect(source).toContain('FLOATING_BUTTON_HOST_ORIGINS');
    expect([...FLOATING_BUTTON_HOST_ORIGINS]).toEqual(['http://*/*', 'https://*/*']);
  });
});
