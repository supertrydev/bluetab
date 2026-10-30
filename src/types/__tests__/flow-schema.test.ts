/**
 * Tests for FlowRuleSchema Zod migration (DESIGN-07)
 *
 * Verifies:
 *   - FlowRuleSchema.safeParse accepts a valid FlowRule fixture
 *   - FlowRuleSchema.safeParse rejects a rule missing `action`
 *   - z.infer<typeof FlowRuleSchema> is assignable to/from the prior interface shape (compile-time check)
 */

import { FlowRuleSchema, FlowConditionSchema, FlowActionSchema } from '../../types/flow';
import type { FlowRule, FlowCondition, FlowAction } from '../../types/flow';

const VALID_RULE: FlowRule = {
  id: 'rule-001',
  name: 'YouTube Videos',
  description: 'Group YouTube tabs',
  enabled: true,
  priority: 10,
  conditions: [
    {
      id: 'cond-001',
      type: 'domain_equals',
      value: 'youtube.com',
      caseSensitive: false,
      negate: false,
    },
  ],
  conditionOperator: 'AND',
  action: {
    type: 'add_to_or_create',
    newGroupName: 'Video',
    groupColor: '#ff0000',
  },
  created: 1700000000000,
  modified: 1700000001000,
  isTemplate: false,
  triggerCount: 5,
};

describe('FlowRuleSchema (DESIGN-07 Zod migration)', () => {
  describe('safeParse on valid input', () => {
    it('accepts a well-formed FlowRule fixture', () => {
      const result = FlowRuleSchema.safeParse(VALID_RULE);
      expect(result.success).toBe(true);
    });

    it('accepts a minimal FlowRule (only required fields)', () => {
      const minimal = {
        id: 'rule-min',
        name: 'Minimal Rule',
        enabled: true,
        priority: 1,
        conditions: [],
        action: { type: 'create_group' as const },
        created: 1700000000000,
        modified: 1700000000000,
      };
      const result = FlowRuleSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    it('accepts a FlowRule with optional lastTriggered + templateId fields', () => {
      const result = FlowRuleSchema.safeParse({
        ...VALID_RULE,
        lastTriggered: 1700000002000,
        templateId: 'tpl-001',
        isTemplate: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('safeParse on invalid input', () => {
    it('rejects a rule missing `action`', () => {
      const { action: _action, ...withoutAction } = VALID_RULE;
      const result = FlowRuleSchema.safeParse(withoutAction);
      expect(result.success).toBe(false);
    });

    it('rejects a rule with invalid condition type', () => {
      const bad = {
        ...VALID_RULE,
        conditions: [{ id: 'c1', type: 'not_a_real_type', value: 'x' }],
      };
      const result = FlowRuleSchema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it('rejects a rule with invalid action type', () => {
      const bad = {
        ...VALID_RULE,
        action: { type: 'teleport_tab' },
      };
      const result = FlowRuleSchema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it('rejects a rule missing required `name` field', () => {
      const { name: _name, ...withoutName } = VALID_RULE;
      const result = FlowRuleSchema.safeParse(withoutName);
      expect(result.success).toBe(false);
    });
  });

  describe('Type compatibility (compile-time checks via typed fixtures)', () => {
    it('z.infer<FlowRuleSchema> is assignable to FlowRule', () => {
      // If this compiles, z.infer<typeof FlowRuleSchema> === FlowRule
      const result = FlowRuleSchema.safeParse(VALID_RULE);
      if (result.success) {
        const rule: FlowRule = result.data;
        expect(rule.id).toBe('rule-001');
      }
    });

    it('FlowCondition is compatible with FlowConditionSchema inferred type', () => {
      const cond: FlowCondition = {
        id: 'c1',
        type: 'url_contains',
        value: 'github',
        caseSensitive: false,
      };
      const result = FlowConditionSchema.safeParse(cond);
      expect(result.success).toBe(true);
    });

    it('FlowAction is compatible with FlowActionSchema inferred type', () => {
      const action: FlowAction = {
        type: 'add_to_existing_group',
        targetGroupId: 'grp-001',
        tags: ['work', 'dev'],
      };
      const result = FlowActionSchema.safeParse(action);
      expect(result.success).toBe(true);
    });
  });
});
