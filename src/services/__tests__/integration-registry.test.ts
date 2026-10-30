/**
 * integration-registry.test.ts — GREEN on landing (Plan 14-01 Task 1).
 *
 * Contract: INTEGRATION_REGISTRY has 13 active entries. Gmail and Google Keep
 * were removed (Gmail's restricted scope needs a yearly paid CASA assessment;
 * the Keep API needs Workspace accounts).
 * Out-of-scope ids are absent; each entry parses against Zod schema; tier
 * distribution is 4/4/1/4.
 */

import {
  getIntegrationUnavailableMessage,
  INTEGRATION_REGISTRY,
  INTEGRATION_IDS,
} from '../../services/integrations/registry';
import { IntegrationRegistryEntrySchema } from '../../types/integrations';

const OUT_OF_SCOPE = ['spotify', 'raindrop', 'pocket', 'perplexity', 'obsidian', 'chatgpt'];

describe('INTEGRATION_REGISTRY — locked id list + allowlist contract', () => {
  it('has exactly 13 active entries', () => {
    expect(INTEGRATION_REGISTRY).toHaveLength(13);
  });

  it('every id is in INTEGRATION_IDS', () => {
    for (const entry of INTEGRATION_REGISTRY) {
      expect(INTEGRATION_IDS).toContain(entry.id);
    }
  });

  it('contains no out-of-scope ids (spotify/raindrop/pocket/perplexity/obsidian/chatgpt)', () => {
    const ids = INTEGRATION_REGISTRY.map((e) => e.id);
    for (const oos of OUT_OF_SCOPE) {
      expect(ids).not.toContain(oos);
    }
  });

  it('every entry parses against IntegrationRegistryEntrySchema', () => {
    for (const entry of INTEGRATION_REGISTRY) {
      const result = IntegrationRegistryEntrySchema.safeParse(entry);
      if (!result.success) {
        throw new Error(`Entry ${entry.id} failed Zod parse: ${result.error.message}`);
      }
    }
  });

  it('has no Gmail or Google Keep id left', () => {
    const ids = INTEGRATION_REGISTRY.map((e) => e.id);
    for (const removed of ['gmail', 'google-keep']) {
      expect(ids).not.toContain(removed);
      expect(INTEGRATION_IDS).not.toContain(removed);
    }
    expect(ids).toContain('google-calendar');
  });

  it('keeps every registered integration available', () => {
    for (const id of INTEGRATION_IDS) {
      expect(getIntegrationUnavailableMessage(id)).toBeNull();
    }
  });

  it('tier distribution is 4 Tier-1, 4 Tier-2, 1 Tier-3, 4 Tier-4', () => {
    const tierCounts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 };
    for (const entry of INTEGRATION_REGISTRY) {
      tierCounts[entry.tier]++;
    }
    expect(tierCounts['1']).toBe(4);
    expect(tierCounts['2']).toBe(4);
    expect(tierCounts['3']).toBe(1);
    expect(tierCounts['4']).toBe(4);
  });

  it('contains expected Tier-1 ids: linear, todoist, notion, github', () => {
    const tier1 = INTEGRATION_REGISTRY.filter((e) => e.tier === '1').map((e) => e.id);
    expect(tier1).toContain('linear');
    expect(tier1).toContain('todoist');
    expect(tier1).toContain('notion');
    expect(tier1).toContain('github');
  });

  it('auth_type distribution: active OAuth flows use Supertry bridge plus token-paste fallbacks', () => {
    const bridgeCount = INTEGRATION_REGISTRY.filter((e) => e.auth_type === 'oauth_pkce_via_supertry').length;
    const pasteCount = INTEGRATION_REGISTRY.filter((e) => e.auth_type === 'token_paste').length;
    const pkceCount = INTEGRATION_REGISTRY.filter((e) => e.auth_type === 'oauth_pkce').length;
    expect(bridgeCount).toBe(12);
    expect(pasteCount).toBe(1);
    expect(pkceCount).toBe(0);
  });

  it('routes new Trello connections through Cloud OAuth instead of redirect-intercept token storage', () => {
    const trello = INTEGRATION_REGISTRY.find((entry) => entry.id === 'trello');
    expect(trello?.auth_type).toBe('oauth_pkce_via_supertry');
    expect(Object.prototype.hasOwnProperty.call(trello ?? {}, 'trello_redirect_intercept')).toBe(false);
  });

  it('manual pull is disabled for all active integrations', () => {
    const manualPull = INTEGRATION_REGISTRY.filter((e) => e.supports_manual_pull === true);
    const manualPullIds = manualPull.map((e) => e.id).sort();
    expect(manualPullIds).toEqual([]);
  });

  it('treats Asana OAuth access tokens as expiring and refreshable', () => {
    const asana = INTEGRATION_REGISTRY.find((e) => e.id === 'asana');
    expect(asana).toBeDefined();
    expect(asana?.token_expiry_seconds).toBe(3600);
    expect(asana?.supports_refresh).toBe(true);
  });
});
