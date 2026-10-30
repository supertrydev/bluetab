/**
 * IntegrationReauthBanner.test.tsx — RED stub.
 *
 * Real flow tested end-to-end in Plan 14-07 (human-verify checkpoint).
 * Static-source assertions on file structure.
 */

import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(
  __dirname,
  '../integrations/IntegrationReauthBanner.tsx'
);
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');

describe('IntegrationReauthBanner — static source contract (RED stub)', () => {
  it('file exists', () => {
    expect(fs.existsSync(COMPONENT_FILE)).toBe(true);
  });

  it('subscribes to chrome.storage.onChanged', () => {
    expect(source).toContain('chrome.storage.onChanged');
    expect(source).toContain('integration_reauth_required:');
  });

  it('renders Reconnect button', () => {
    expect(source).toContain('Reconnect');
  });

  it('uses amber styling (bg-amber-500/10 or border-amber-500/30)', () => {
    expect(source).toMatch(/amber-500/);
  });

  it('body copy does not use expired/broken/failed (SAFETY-02)', () => {
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const FORBIDDEN = /\b(expired|broken|failed)\b/i;
    expect(stripped).not.toMatch(FORBIDDEN);
  });

  it('uses "needs to be re-authorized" phrasing (not expired/broken)', () => {
    expect(source).toContain('needs to be re-authorized');
  });

  it('calls launchOAuthFlow on Reconnect', () => {
    expect(source).toContain('launchOAuthFlow');
  });

  it('Reconnect passes integration and account IDs to OAuth and clears the flag', () => {
    expect(source).toContain('launchOAuthFlow(item.integrationId, item.accountId)');
    expect(source).toContain('chrome.storage.local.remove');
    expect(source).toContain('integration_reauth_required:${item.integrationId}:${item.accountId}');
    expect(source).toContain('await loadReauthFlags()');
  });

  it('filters unavailable integrations before probing or rendering reauth actions', () => {
    expect(source).toContain('getIntegrationUnavailableMessage(integrationId)');
    expect(source.indexOf('getIntegrationUnavailableMessage(integrationId)')).toBeLessThan(
      source.indexOf('items.push({ integrationId, accountId })'),
    );
  });
});
