import { blockSitesFromAI, createFlowRuleFromAI } from '../ai-flow-focus-tools';
import { FlowStorageService } from '@/utils/flow-storage';
import { Storage } from '@/utils/storage';
import { normalizeFocusDomain } from '@/utils/focus-domain';
import { isChatOnlyTurn } from '@/utils/ai-model-routing';
import { getDefaultFlowSettings, type FlowRule } from '@/types/flow';

jest.mock('@/utils/storage', () => ({
  Storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
}));

jest.mock('@/utils/flow-storage', () => ({
  FlowStorageService: { getFlowSettings: jest.fn(), createRule: jest.fn(), toggleFlow: jest.fn() },
}));

const getState = jest.fn();
jest.mock('@/services/focus-service', () => ({
  FocusService: {
    getState: () => getState(),
  },
}));

const hasFocusSiteAccess = jest.fn();
jest.mock('@/services/focus-site-access', () => ({
  hasFocusSiteAccess: () => hasFocusSiteAccess(),
}));

const mockedFlow = FlowStorageService as jest.Mocked<typeof FlowStorageService>;
const mockedStorage = Storage as jest.Mocked<typeof Storage>;

function existingRule(overrides: Partial<FlowRule> = {}): FlowRule {
  return {
    id: 'r1', name: 'Docs', enabled: true, priority: 4,
    conditions: [{ id: 'c', type: 'domain_contains', value: 'docs.dev' }],
    action: { type: 'add_to_or_create', newGroupName: 'Docs' },
    created: 1, modified: 1, ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedFlow.getFlowSettings.mockResolvedValue({ ...getDefaultFlowSettings(), rules: [existingRule()] });
  mockedFlow.createRule.mockResolvedValue({ success: true, ruleId: 'new-rule' } as never);
});

describe('createFlowRuleFromAI', () => {
  it('creates a validated rule appended after existing priorities', async () => {
    const result = await createFlowRuleFromAI({
      name: 'GitHub to Dev',
      conditions: [{ type: 'domain_contains', value: ' github.com ' }],
      groupName: 'Dev',
    });

    expect(result).toMatchObject({ status: 'success', ruleId: 'new-rule', conditionCount: 1 });
    const saved = mockedFlow.createRule.mock.calls[0][0];
    expect(saved).toMatchObject({
      name: 'GitHub to Dev',
      enabled: true,
      priority: 5,
      conditionOperator: 'AND',
      action: { type: 'add_to_or_create', newGroupName: 'Dev' },
    });
    expect(saved.conditions).toEqual([expect.objectContaining({ type: 'domain_contains', value: 'github.com' })]);
  });

  it('drops invalid conditions, including regexes that do not compile', async () => {
    const result = await createFlowRuleFromAI({
      name: 'Mixed',
      conditions: [
        { type: 'not_a_type', value: 'x' },
        { type: 'url_matches_regex', value: '([' },
        { type: 'title_contains', value: '' },
        { type: 'title_contains', value: 'invoice' },
      ],
      groupName: 'Finance',
    });
    expect(result).toMatchObject({ status: 'success', conditionCount: 1, skippedConditions: 3 });
  });

  it('accepts common model variants: no name, no groupName, aliases and JSON-string conditions', async () => {
    await expect(createFlowRuleFromAI({ conditions: [{ type: 'domain', value: 'github.com' }], newGroupName: 'Dev' }))
      .resolves.toMatchObject({ status: 'success', name: 'github.com \u2192 Dev' });
    expect(mockedFlow.createRule.mock.calls[0][0]).toMatchObject({
      conditions: [expect.objectContaining({ type: 'domain_contains', value: 'github.com' })],
      action: { type: 'add_to_or_create', newGroupName: 'Dev' },
    });

    await createFlowRuleFromAI({ name: 'Work', conditions: '[{"type":"title_contains","value":"Jira"}]' });
    expect(mockedFlow.createRule.mock.calls[1][0]).toMatchObject({ action: { newGroupName: 'Work' } });

    await createFlowRuleFromAI({ name: 'Nested', domain: 'gitlab.com', action: { type: 'create_group', newGroupName: 'Code' } });
    expect(mockedFlow.createRule.mock.calls[2][0]).toMatchObject({
      conditions: [expect.objectContaining({ type: 'domain_contains', value: 'gitlab.com' })],
      action: { type: 'create_group', newGroupName: 'Code' },
    });
  });

  it('rejects empty or invalid conditions, missing targets and duplicates without writing', async () => {
    await expect(createFlowRuleFromAI({ name: 'N', conditions: [] })).resolves.toMatchObject({ status: 'error' });
    await expect(createFlowRuleFromAI({ name: 'N', conditions: [{ type: 'unknown', value: 'a' }] }))
      .resolves.toMatchObject({ status: 'error' });
    await expect(createFlowRuleFromAI({
      name: 'N', conditions: [{ type: 'url_contains', value: 'a' }], actionType: 'add_to_existing_group',
    })).resolves.toMatchObject({ status: 'error' });
    await expect(createFlowRuleFromAI({ name: 'docs', conditions: [{ type: 'url_contains', value: 'a' }], groupName: 'G' }))
      .resolves.toMatchObject({ status: 'exists', ruleId: 'r1' });
    expect(mockedFlow.createRule).not.toHaveBeenCalled();
  });

  it('switches Flow on quietly when it was off', async () => {
    mockedFlow.getFlowSettings.mockResolvedValue({ ...getDefaultFlowSettings(), enabled: false });
    const result = await createFlowRuleFromAI({
      name: 'X', conditions: [{ type: 'domain_equals', value: 'x.com' }], groupName: 'Social',
    });
    expect(result).toMatchObject({ status: 'success' });
    expect(result).not.toHaveProperty('flowEnabled');
    expect(mockedFlow.toggleFlow).toHaveBeenCalledWith(true);
  });

  it('leaves Flow alone when it is already on', async () => {
    await createFlowRuleFromAI({ name: 'Y', conditions: [{ type: 'domain_equals', value: 'y.com' }], groupName: 'Y' });
    expect(mockedFlow.toggleFlow).not.toHaveBeenCalled();
  });
});

describe('blockSitesFromAI', () => {
  let sendMessage: jest.Mock;

  beforeEach(() => {
    mockedStorage.get.mockResolvedValue({ enabled: true, customDomains: ['youtube.com'] });
    getState.mockResolvedValue({ isActive: true, activatedAt: 1 });
    hasFocusSiteAccess.mockResolvedValue(true);
    sendMessage = jest.fn((_message: unknown, callback: (response: unknown) => void) => callback({ success: true }));
    (chrome.runtime as unknown as { sendMessage: jest.Mock }).sendMessage = sendMessage;
  });

  it('normalises and merges only new domains in a single write', async () => {
    const result = await blockSitesFromAI({
      domains: ['https://www.Reddit.com/r/all', 'youtube.com', 'reddit.com', 'not a domain', 42],
    });
    expect(mockedStorage.set).toHaveBeenCalledTimes(1);
    expect(mockedStorage.set).toHaveBeenCalledWith('focusSettings', expect.objectContaining({
      enabled: true,
      customDomains: ['reddit.com', 'youtube.com'],
    }));
    expect(result).toMatchObject({ status: 'success', added: ['reddit.com'], alreadyBlocked: ['youtube.com'], focusActive: true });
    expect(sendMessage).not.toHaveBeenCalled();
    expect((result as { note?: string }).note).toBeUndefined();
  });

  it('turns Focus Mode on when it is off, without telling the user it was off', async () => {
    mockedStorage.get.mockResolvedValue({ enabled: false, customDomains: [] });
    getState.mockResolvedValue({ isActive: false, activatedAt: null });

    const result = await blockSitesFromAI({ domains: ['x.com'] });

    expect(mockedStorage.set).toHaveBeenCalledWith('focusSettings', expect.objectContaining({ enabled: true, customDomains: ['x.com'] }));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'ENABLE_FOCUS' }, expect.any(Function));
    expect(result).toMatchObject({ status: 'success', focusActive: true });
    expect((result as { note?: string }).note).toBeUndefined();
  });

  it('only mentions missing site access, which needs a click in Settings', async () => {
    hasFocusSiteAccess.mockResolvedValue(false);
    const result = await blockSitesFromAI({ domains: ['x.com'] });
    expect((result as { note: string }).note).toMatch(/Site access/);
  });

  it('returns an error and writes nothing when no domain is valid', async () => {
    await expect(blockSitesFromAI({ domains: ['localhost', ''] })).resolves.toMatchObject({ status: 'error' });
    expect(mockedStorage.set).not.toHaveBeenCalled();
  });
});

describe('normalizeFocusDomain', () => {
  it.each([
    ['https://www.example.com/path?q=1#x', 'example.com'],
    ['user:pw@sub.example.org:8080', 'sub.example.org'],
    ['EXAMPLE.com.', 'example.com'],
    ['localhost', null],
    ['exa mple.com', null],
    ['.com', null],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeFocusDomain(input)).toBe(expected);
  });
});

describe('isChatOnlyTurn', () => {
  it('keeps short greetings on the fast path', () => {
    expect(isChatOnlyTurn('hi', false)).toBe(true);
    expect(isChatOnlyTurn('merhaba', false)).toBe(true);
  });

  it('sends tools for short commands with a target, longer text or tool history', () => {
    expect(isChatOnlyTurn('block x.com', false)).toBe(false);
    expect(isChatOnlyTurn('open 3 tabs', false)).toBe(false);
    expect(isChatOnlyTurn('organize my saved groups', false)).toBe(false);
    expect(isChatOnlyTurn('hi', true)).toBe(false);
  });
});
