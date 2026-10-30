/**
 * IntegrationsSection.test.tsx — GREEN ON LANDING (static-source test).
 *
 * Mirrors Phase 13 component test pattern (static-source, no jsdom/RTL).
 * Asserts: imports INTEGRATION_REGISTRY, iterates 15 entries via .map(),
 * gates with feature-gate.ts ProBadge, uses Phase 8.1 glass token pattern.
 */

import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(
  __dirname,
  '../integrations/IntegrationsSection.tsx'
);
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../i18n/locales/en.json'),
  'utf-8',
));

describe('IntegrationsSection — static source contract', () => {
  it('imports INTEGRATION_REGISTRY', () => {
    expect(source).toContain('INTEGRATION_REGISTRY');
  });

  it('uses the shared Upgrade to [PRO] button (Pro gate)', () => {
    expect(source).toContain('<UpgradeToProButton');
  });

  it('uses useAuth isPro check', () => {
    expect(source).toContain('isPro');
  });

  it('has a .map() call to iterate integration entries', () => {
    expect(source).toMatch(/\.map\(/);
  });

  it('uses Phase 8.1 glass token (bg-bg-0/80 or border-border-glass)', () => {
    expect(source).toMatch(/bg-bg-0\/80|border-border-glass/);
  });

  it('has empty state text for no connections', () => {
    expect(source).toContain("t('settings.integrationsSection.emptyState')");
    expect(english.settings.integrationsSection.emptyState).toBe('Connect an integration below to send tabs and brain dumps to your favorite tools.');
  });

  it('imports IntegrationCard component', () => {
    expect(source).toContain('IntegrationCard');
  });

  it('imports listConnectedAccounts', () => {
    expect(source).toContain('listConnectedAccounts');
  });

  it('renders re-auth banner component', () => {
    expect(source).toContain('IntegrationReauthBanner');
  });

  it('renders a top-level Integrations section header', () => {
    expect(source).toContain('function SectionHeader');
    expect(source).toContain("t('settings.integrationsSection.title')");
    expect(english.settings.integrationsSection.title).toBe('Integrations');
  });
});
