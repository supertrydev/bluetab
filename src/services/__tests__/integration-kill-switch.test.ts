/**
 * integration-kill-switch.test.ts — GREEN on landing (Plan 14-01 Task 1).
 *
 * Contract: when KillSwitchService cache has integrationDisabled=['notion'],
 * dispatchVerb('notion', ...) resolves with {success:false, error:'kill_switched'}
 * without ever calling the adapter; other integrations unaffected.
 */

import { dispatchVerb } from '../../services/integration-service';

const localStore: Record<string, unknown> = {};
jest.mock('../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => localStore[key] ?? null),
    set: jest.fn(async (key: string, value: unknown) => { localStore[key] = value; }),
    remove: jest.fn(async () => {}),
  },
}));

jest.mock('../../services/integration-token-storage', () => ({
  getValidToken: jest.fn(async () => 'mock_token'),
  listConnectedAccounts: jest.fn(async () => []),
  addAccount: jest.fn(async () => {}),
}));

(global as unknown as Record<string, unknown>).chrome = {
  storage: {
    local: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
    session: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
  },
};

describe('dispatchVerb — kill-switch per-integration guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(localStore)) delete localStore[k];
  });

  it('returns kill_switched error for notion when integrationDisabled includes notion', async () => {
    localStore['ai_kill_switch_cache'] = {
      enabled: true,
      fetchedAt: Date.now(),
      integrationDisabled: ['notion'],
    };

    const result = await dispatchVerb('notion', 'create_page', { title: 'Test' }, 'acc-uuid');
    expect(result.success).toBe(false);
    expect(result.error).toBe('kill_switched');
  });

  it('does NOT kill-switch linear when only notion is disabled', async () => {
    localStore['ai_kill_switch_cache'] = {
      enabled: true,
      fetchedAt: Date.now(),
      integrationDisabled: ['notion'],
    };

    const result = await dispatchVerb('linear', 'create_issue', { title: 'Test' }, 'acc-uuid');
    // Should NOT be kill_switched — should use placeholder adapter (not_implemented)
    expect(result.error).not.toBe('kill_switched');
  });

  it('kills all integrations when integrationsDisabled=true', async () => {
    localStore['ai_kill_switch_cache'] = {
      enabled: true,
      fetchedAt: Date.now(),
      integrationsDisabled: true,
    };

    const notionResult = await dispatchVerb('notion', 'create_page', {}, 'acc-uuid');
    const linearResult = await dispatchVerb('linear', 'create_issue', {}, 'acc-uuid');

    expect(notionResult.error).toBe('kill_switched');
    expect(linearResult.error).toBe('kill_switched');
  });
});
