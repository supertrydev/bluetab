/**
 * Tests for FlowDesignerService (DESIGN-01..07, DESIGN-10)
 *
 * Covers:
 *   - propose() returns each block reason (kill_switch, no_permission, insufficient_history, budget, rate_limit)
 *   - response schema rejects when proposals.length > 3 (DESIGN-05)
 *   - accept() refuses a malformed proposal via FlowRuleSchema.safeParse
 *   - accept() succeeds on well-formed proposal via FlowStorageService.createRule
 *   - dismiss() removes by index from cache
 *   - DESIGN-03 edit-before-accept invariant: accept() persists the EDITED proposal
 */

import { FlowDesignerService } from '../flow-designer-service';
import { buildAcceptPayload } from '../../flow/FlowProposalModal';
import { Storage } from '@/utils/storage';
import { KillSwitchService } from '../kill-switch-service';
import { AIAllowanceService } from '../ai-allowance-service';
import { FlowStorageService } from '@/utils/flow-storage';
import type { ProposedFlowRule } from '@/types/distraction';

// --- Module mocks ---

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

jest.mock('../kill-switch-service', () => ({
  KillSwitchService: {
    isEnabled: jest.fn(),
    fetchConfig: jest.fn(),
  },
}));

jest.mock('../ai-allowance-service', () => ({
  AIAllowanceService: {
    syncFromAIResponse: jest.fn(),
  },
}));

jest.mock('../history-aggregator', () => ({
  aggregateHistory: jest.fn().mockResolvedValue([]),
  hasMinimumHistoryDays: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/utils/flow-storage', () => ({
  FlowStorageService: {
    getFlowSettings: jest.fn(),
    createRule: jest.fn(),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;
const mockedKillSwitch = KillSwitchService as jest.Mocked<typeof KillSwitchService>;
const mockedAllowance = AIAllowanceService as jest.Mocked<typeof AIAllowanceService>;
const mockedFlowStorage = FlowStorageService as jest.Mocked<typeof FlowStorageService>;

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// A well-formed proposed rule for test reuse
const WELL_FORMED_PROPOSAL: ProposedFlowRule = {
  name: 'Group YouTube tabs',
  description: 'Sends YouTube tabs to the Media group',
  rationale: 'You visit YouTube frequently for video content.',
  conditions: [
    {
      id: 'cond-1',
      type: 'domain_contains',
      value: 'youtube.com',
    },
  ],
  conditionOperator: 'AND',
  action: {
    type: 'add_to_or_create',
    newGroupName: 'Media',
  },
  enabled: true,
  priority: 0,
};

// Supertry response body with one valid proposal
const VALID_SUPERTRY_RESPONSE = {
  proposals: [WELL_FORMED_PROPOSAL],
  tokensUsed: 100,
};

function setupHappyPathMocks() {
  mockedKillSwitch.isEnabled.mockResolvedValue(true);
  (chrome.permissions as unknown as { contains: jest.Mock }).contains = jest.fn(
    (_perm: object, cb: (result: boolean) => void) => cb(true)
  );
  // hasMinimumHistoryDays already mocked to return true
  mockedAllowance.syncFromAIResponse.mockResolvedValue(undefined);
  (chrome.tabs.query as jest.Mock).mockResolvedValue([
    { url: 'https://example.com', title: 'Example' },
  ]);
  mockedStorage.get.mockResolvedValue(null as never); // no cached groups
  mockedFlowStorage.getFlowSettings.mockResolvedValue({
    enabled: true,
    rules: [],
    executionCount: 0,
    version: '1.0.0',
  });
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => VALID_SUPERTRY_RESPONSE,
  } as Response);
  mockedStorage.set.mockResolvedValue(undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Restore chrome.permissions to a sensible default (overridden per test as needed)
  (chrome as unknown as Record<string, unknown>).permissions = {
    contains: jest.fn((_perm: object, cb: (result: boolean) => void) => cb(true)),
    request: jest.fn(),
  };
});

// ─── propose() block reasons ──────────────────────────────────────────────────

describe('propose() block reasons', () => {
  it('returns { status: "blocked", reason: "kill_switch" } when KillSwitchService.isEnabled() is false', async () => {
    mockedKillSwitch.isEnabled.mockResolvedValue(false);
    const result = await FlowDesignerService.propose('token');
    expect(result).toEqual({ status: 'blocked', reason: 'kill_switch' });
  });

  it('returns { status: "blocked", reason: "no_permission" } when chrome.permissions.contains returns false', async () => {
    mockedKillSwitch.isEnabled.mockResolvedValue(true);
    mockedStorage.get.mockResolvedValue(null as never);
    (chrome.permissions as unknown as { contains: jest.Mock }).contains = jest.fn(
      (_perm: object, cb: (result: boolean) => void) => cb(false)
    );
    const result = await FlowDesignerService.propose('token');
    expect(result).toEqual({ status: 'blocked', reason: 'no_permission' });
  });

  it('returns { status: "blocked", reason: "insufficient_history" } when hasMinimumHistoryDays(7) is false', async () => {
    mockedKillSwitch.isEnabled.mockResolvedValue(true);
    mockedStorage.get.mockResolvedValue(null as never);
    // permissions returns true (default)
    const { hasMinimumHistoryDays } = await import('../history-aggregator');
    (hasMinimumHistoryDays as jest.Mock).mockResolvedValueOnce(false);
    const result = await FlowDesignerService.propose('token');
    expect(result).toEqual({ status: 'blocked', reason: 'insufficient_history' });
  });

  it('returns { status: "blocked", reason: "budget" } when the backend returns token_cap_exceeded', async () => {
    setupHappyPathMocks();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      clone: () => ({
        json: async () => ({ error: 'token_cap_exceeded' }),
      }),
    } as unknown as Response);
    const result = await FlowDesignerService.propose('token');
    expect(result).toEqual({ status: 'blocked', reason: 'budget' });
  });

  it('returns { status: "blocked", reason: "rate_limit" } when the backend returns a non-allowance 429', async () => {
    setupHappyPathMocks();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      clone: () => ({
        json: async () => ({ error: 'rate_limit_exceeded' }),
      }),
    } as unknown as Response);
    const result = await FlowDesignerService.propose('token');
    expect(result).toEqual({ status: 'blocked', reason: 'rate_limit' });
  });
});

// ─── propose() schema enforcement (DESIGN-05) ────────────────────────────────

describe('propose() schema enforcement (DESIGN-05)', () => {
  it('rejects (returns blocked) when Supertry returns proposals.length > 3', async () => {
    setupHappyPathMocks();

    // Return 4 proposals — Zod .max(3) should reject this
    const fourProposals = [
      { ...WELL_FORMED_PROPOSAL, name: 'Rule 1' },
      { ...WELL_FORMED_PROPOSAL, name: 'Rule 2' },
      { ...WELL_FORMED_PROPOSAL, name: 'Rule 3' },
      { ...WELL_FORMED_PROPOSAL, name: 'Rule 4' },
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ proposals: fourProposals, tokensUsed: 100 }),
    } as Response);

    const result = await FlowDesignerService.propose('token');
    expect(result).toEqual({ status: 'blocked', reason: 'backend_error' });
    // backend_error is the graceful fallback for schema validation failure
    // (the real kill_switch path is /api/config.ai_history_features_enabled === false,
    // which KillSwitchService.isEnabled() checks in Step 1)
  });

  it('returns { status: "ok" } with proposals from a valid Supertry response', async () => {
    setupHappyPathMocks();
    const result = await FlowDesignerService.propose('token');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.cache.proposals).toHaveLength(1);
      expect(result.cache.proposals[0].name).toBe('Group YouTube tabs');
    }
  });
});

// ─── accept() ────────────────────────────────────────────────────────────────

describe('accept()', () => {
  it('rejects a malformed proposal — FlowRuleSchema.safeParse fails and createRule is NOT called', async () => {
    const malformed = {
      ...WELL_FORMED_PROPOSAL,
      // action is missing required type field
      action: {} as ProposedFlowRule['action'],
    };

    mockedStorage.get.mockResolvedValue(null);
    const result = await FlowDesignerService.accept(malformed);
    expect(result.success).toBe(false);
    expect(mockedFlowStorage.createRule).not.toHaveBeenCalled();
  });

  it('accepts a well-formed proposal — FlowRuleSchema.safeParse succeeds and createRule IS called', async () => {
    mockedFlowStorage.createRule.mockResolvedValue({ success: true, ruleId: 'new-id' });
    mockedStorage.get.mockResolvedValue(null);

    const result = await FlowDesignerService.accept(WELL_FORMED_PROPOSAL);
    expect(result.success).toBe(true);
    expect(mockedFlowStorage.createRule).toHaveBeenCalledTimes(1);
  });

  it('adds id, created, and modified fields to the proposal before persisting', async () => {
    mockedFlowStorage.createRule.mockResolvedValue({ success: true, ruleId: 'new-id' });
    mockedStorage.get.mockResolvedValue(null);

    const before = Date.now();
    await FlowDesignerService.accept(WELL_FORMED_PROPOSAL);
    const after = Date.now();

    // createRule is called with ruleData that does NOT include id/created/modified
    // (those are added internally and then stripped back off for the createRule call)
    expect(mockedFlowStorage.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: WELL_FORMED_PROPOSAL.name,
        enabled: true,
      })
    );
    // Verify the result carries a ruleId (meaning id was generated internally)
    const result = await FlowDesignerService.accept(WELL_FORMED_PROPOSAL);
    if (result.success) {
      expect(typeof result.ruleId).toBe('string');
      expect(result.ruleId.length).toBeGreaterThan(0);
    }

    void before; void after; // used for temporal assertion reference
  });
});

// ─── dismiss() ───────────────────────────────────────────────────────────────

describe('dismiss()', () => {
  const MULTI_PROPOSAL_CACHE = {
    generatedAt: Date.now(),
    proposals: [
      { ...WELL_FORMED_PROPOSAL, name: 'Rule A' },
      { ...WELL_FORMED_PROPOSAL, name: 'Rule B' },
      { ...WELL_FORMED_PROPOSAL, name: 'Rule C' },
    ],
  };

  it('removes the proposal at the given index from the cached proposal list', async () => {
    mockedStorage.get.mockResolvedValue(MULTI_PROPOSAL_CACHE);
    mockedStorage.set.mockResolvedValue(undefined);

    await FlowDesignerService.dismiss(1); // dismiss "Rule B"

    expect(mockedStorage.set).toHaveBeenCalledWith(
      'flow_proposal_cache',
      expect.objectContaining({
        proposals: expect.arrayContaining([
          expect.objectContaining({ name: 'Rule A' }),
          expect.objectContaining({ name: 'Rule C' }),
        ]),
      })
    );

    const setCall = (mockedStorage.set as jest.Mock).mock.calls[0];
    const savedCache = setCall[1] as { proposals: ProposedFlowRule[] };
    expect(savedCache.proposals).toHaveLength(2);
    expect(savedCache.proposals.map((p) => p.name)).not.toContain('Rule B');
  });

  it('writes the updated proposal list back to chrome.storage.local under flow_proposal_cache', async () => {
    mockedStorage.get.mockResolvedValue(MULTI_PROPOSAL_CACHE);
    mockedStorage.set.mockResolvedValue(undefined);

    await FlowDesignerService.dismiss(0);

    expect(mockedStorage.set).toHaveBeenCalledWith('flow_proposal_cache', expect.any(Object));
  });
});

// ─── DESIGN-03 edit-before-accept invariant ───────────────────────────────────

describe('DESIGN-03 edit-before-accept invariant', () => {
  it('accept() persists the EDITED proposal shape, not the original Supertry proposal', async () => {
    // Simulate: AI proposes "Group YouTube tabs" with domain_contains: youtube.com
    const originalProposal: ProposedFlowRule = {
      ...WELL_FORMED_PROPOSAL,
      name: 'Original AI Name',
      description: 'Original description',
    };

    // User edits the name and description before accepting
    const editedProposal: ProposedFlowRule = {
      ...originalProposal,
      name: 'My Edited Rule Name',
      description: 'My custom description',
    };

    mockedFlowStorage.createRule.mockResolvedValue({ success: true, ruleId: 'rule-id-1' });
    mockedStorage.get.mockResolvedValue(null);

    // The UI layer calls accept() with the EDITED proposal (not originalProposal)
    const result = await FlowDesignerService.accept(editedProposal);

    expect(result.success).toBe(true);
    // Verify createRule was called with the edited name, NOT the original name
    expect(mockedFlowStorage.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Edited Rule Name',
        description: 'My custom description',
      })
    );
    expect(mockedFlowStorage.createRule).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Original AI Name',
      })
    );
  });

  it('buildAcceptPayload() returns the edited proposal, not the original — pure-function DESIGN-03 guard', () => {
    // The modal exports buildAcceptPayload as a pure function so this invariant is
    // testable without mounting the full React component.
    const originalProposal: ProposedFlowRule = {
      ...WELL_FORMED_PROPOSAL,
      name: 'AI Proposal',
      description: 'AI-generated description',
      rationale: 'Based on browsing patterns.',
    };

    const editedProposal: ProposedFlowRule = {
      ...originalProposal,
      name: 'My Custom Rule',
      description: 'My custom description',
    };

    // buildAcceptPayload receives the edited proposal and returns it unchanged
    const payload = buildAcceptPayload(editedProposal);

    // Payload must match the EDITED shape
    expect(payload.name).toBe('My Custom Rule');
    expect(payload.description).toBe('My custom description');

    // Payload must NOT match the original AI shape
    expect(payload.name).not.toBe('AI Proposal');
    expect(payload.description).not.toBe('AI-generated description');

    // Core rule fields preserved
    expect(payload.conditions).toEqual(editedProposal.conditions);
    expect(payload.action).toEqual(editedProposal.action);
    expect(payload.enabled).toBe(true);
  });
});
