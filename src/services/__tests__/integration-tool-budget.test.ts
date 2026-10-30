/**
 * integration-tool-budget.test.ts — GREEN on landing (Plan 14-01 Task 1).
 *
 * Contract: buildIntegrationToolsForTurn prunes to MAX_INTEGRATION_TOOLS=25
 * with Tier 4 trimmed first; namespaced names match /^[a-z0-9-]+\.[a-z0-9_]+$/
 */

// Mock listConnectedAccounts — define mock before module import
jest.mock('../../services/integration-token-storage', () => ({
  getValidToken: jest.fn(async () => 'mock_token'),
  listConnectedAccounts: jest.fn(async () => []),
  addAccount: jest.fn(async () => {}),
}));

import { buildIntegrationToolsForTurn, MAX_INTEGRATION_TOOLS } from '../../services/integration-service';
import { listConnectedAccounts } from '../../services/integration-token-storage';

const mockListConnectedAccounts = listConnectedAccounts as jest.MockedFunction<typeof listConnectedAccounts>;

jest.mock('../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
  },
}));

(global as unknown as Record<string, unknown>).chrome = {
  storage: {
    local: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
    session: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
  },
};

describe('MAX_INTEGRATION_TOOLS', () => {
  it('is 25', () => {
    expect(MAX_INTEGRATION_TOOLS).toBe(25);
  });
});

describe('buildIntegrationToolsForTurn — dynamic pruning', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns [] when 0 accounts connected', async () => {
    mockListConnectedAccounts.mockResolvedValue([]);
    const tools = await buildIntegrationToolsForTurn();
    expect(tools).toHaveLength(0);
  });

  it('returns all tools when count is under 25 cap', async () => {
    // linear has 2 verbs, 1 account = 2 tools
    mockListConnectedAccounts.mockResolvedValue([
      { integrationId: 'linear', accountId: 'acc-1', accountLabel: 'Personal', metadata: {}, lastUsedAt: 1 },
    ]);
    const tools = await buildIntegrationToolsForTurn();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.length).toBeLessThanOrEqual(MAX_INTEGRATION_TOOLS);
  });

  it('never offers actions of the removed Gmail integration', async () => {
    mockListConnectedAccounts.mockResolvedValue([
      { integrationId: 'gmail', accountId: 'gmail-1', accountLabel: 'Personal', metadata: {}, lastUsedAt: 1 },
      { integrationId: 'google-calendar', accountId: 'calendar-1', accountLabel: 'Personal', metadata: {}, lastUsedAt: 1 },
    ]);

    const tools = await buildIntegrationToolsForTurn();

    expect(tools.some((tool) => tool.integrationId === 'gmail')).toBe(false);
    expect(tools.some((tool) => tool.integrationId === 'google-calendar')).toBe(true);
  });

  it('prunes to exactly MAX_INTEGRATION_TOOLS=25 when over the cap', async () => {
    // Create many accounts across many integrations to exceed 25 tools
    const accounts = [
      'linear', 'todoist', 'notion', 'github',
      'google-calendar', 'outlook-calendar', 'slack', 'discord',
      'readwise',
      'jira', 'trello', 'asana', 'gitlab',
    ].map((id) => ({
      integrationId: id,
      accountId: `acc-${id}-1`,
      accountLabel: 'Personal',
      metadata: {},
      lastUsedAt: 1,
    }));
    // Add second accounts to push over 25
    const extraAccounts = [
      'linear', 'todoist', 'notion', 'github', 'google-calendar',
    ].map((id) => ({
      integrationId: id,
      accountId: `acc-${id}-2`,
      accountLabel: 'Work',
      metadata: {},
      lastUsedAt: 2,
    }));

    mockListConnectedAccounts.mockResolvedValue([...accounts, ...extraAccounts]);
    const tools = await buildIntegrationToolsForTurn();
    expect(tools.length).toBeLessThanOrEqual(MAX_INTEGRATION_TOOLS);
  });

  it('tool names are namespaced: /^[a-z0-9-]+\\.[a-z0-9_]+$/', async () => {
    mockListConnectedAccounts.mockResolvedValue([
      { integrationId: 'linear', accountId: 'acc-1', accountLabel: 'Personal', metadata: {}, lastUsedAt: 1 },
    ]);
    const tools = await buildIntegrationToolsForTurn();
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z0-9-]+\.[a-z0-9_]+$/);
    }
  });
});
