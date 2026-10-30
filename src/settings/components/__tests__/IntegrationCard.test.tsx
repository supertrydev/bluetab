/**
 * IntegrationCard.test.tsx — RED stub.
 *
 * Full account-stack rendering lands in Plan 14-07.
 * Static-source assertions on file structure.
 */

import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(
  __dirname,
  '../integrations/IntegrationCard.tsx'
);
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');

describe('IntegrationCard — static source contract (RED stub)', () => {
  it('file exists', () => {
    expect(fs.existsSync(COMPONENT_FILE)).toBe(true);
  });

  it('exports IntegrationCard function', () => {
    expect(source).toContain('export function IntegrationCard');
  });

  it('accepts entry: IntegrationRegistryEntry prop', () => {
    expect(source).toContain('IntegrationRegistryEntry');
    expect(source).toContain('entry');
  });

  it('accepts accounts: IntegrationAccount[] prop', () => {
    expect(source).toContain('IntegrationAccount');
    expect(source).toContain('accounts');
  });

  it('has Connect button literal', () => {
    expect(source).toContain('Connect');
  });

  it('has account row rendering when accounts exist', () => {
    expect(source).toMatch(/accounts\.(length|map)/);
  });

  it('offers Connect only while disconnected (one account per provider)', () => {
    expect(source).toContain('{!isConnected && (');
    expect(source).not.toContain("t('settings.integrations.addAccount')");
  });

  it('has Reconnect button for connected accounts', () => {
    expect(source).toContain('Reconnect');
  });

  it('has Disconnect action', () => {
    expect(source).toContain('Disconnect');
  });

  it('renders one IntegrationAccountRow per connected account', () => {
    expect(source).toContain('accounts.map((account)');
    expect(source).toContain('<IntegrationAccountRow');
    expect(source).toContain('account={account}');
    expect(source).toContain('key={account.accountId}');
  });

  it('uses the generic default target field with no Gmail special case left', () => {
    expect(source).toContain('DefaultSyncTargetField');
    expect(source).toContain("t('settings.integrations.defaultSyncTarget')");
    expect(source).not.toMatch(/gmail/i);
    expect(source).toContain('text-text-strong');
  });

  it('does not render the generic default target footer for Readwise', () => {
    expect(source).toContain("entry.id === 'readwise' ? null");
  });

  it('renders Discord channel names when metadata includes them', () => {
    expect(source).toContain('formatDiscordChannelName');
    expect(source).toContain('metadata.webhook_channel_name');
    expect(source).toContain("t('settings.integrations.selectedDiscordChannel')");
  });
});
