/**
 * Tests for ai-tools.ts
 * Verifies all 19 tool schemas are defined with Zod validation,
 * config is updated with ai_commands feature and AI endpoints.
 */

import { aiTools, DESTRUCTIVE_TOOLS, TOOL_LOADING_MESSAGES } from './ai-tools';
import { config } from '../config/config';
import { STORAGE_BUDGETS } from './storage-budget';
import { ZodError } from 'zod';

const EXPECTED_TOOLS = [
  'search_tabs',
  'group_tabs',
  'save_tabs',
  'archive_group',
  'delete_tabs',
  'open_tabs',
  'rename_group',
  'search_bluetab',
  'search_brain_dump',
  'search_rss',
  'web_search',
  'manage_projects',
  'update_settings',
  'get_context',
  'manage_groups',
  'create_flow_rule',
  'block_site',
  'manage_brain_dump',
  'set_reminder',
] as const;

describe('aiTools', () => {
  it('exports all 19 tool names', () => {
    const toolNames = Object.keys(aiTools);
    expect(toolNames).toHaveLength(19);
    for (const name of EXPECTED_TOOLS) {
      expect(toolNames).toContain(name);
    }
  });

  it('each tool has a description string and an inputSchema that is a Zod object', () => {
    for (const name of EXPECTED_TOOLS) {
      const toolDef = aiTools[name] as Record<string, unknown>;
      expect(typeof toolDef.description).toBe('string');
      expect((toolDef.description as string).length).toBeGreaterThan(0);
      // Zod object schemas have a .parse method (inputSchema is the AI SDK v6 key)
      const schema = toolDef.inputSchema as Record<string, unknown>;
      expect(schema).toBeDefined();
      expect(typeof schema.parse).toBe('function');
    }
  });

  it('DESTRUCTIVE_TOOLS only includes unconditional confirmation-gated tools', () => {
    expect(DESTRUCTIVE_TOOLS).toContain('delete_tabs');
    expect(DESTRUCTIVE_TOOLS).toContain('manage_projects');
    expect(DESTRUCTIVE_TOOLS).toHaveLength(2);
  });
});

describe('manage_groups schema', () => {
  it('accepts valid merge action with groupIds', () => {
    expect(() =>
      (aiTools.manage_groups.inputSchema as { parse: (x: unknown) => unknown }).parse({
        action: 'merge',
        groupIds: ['g1', 'g2'],
        newName: 'Merged',
      })
    ).not.toThrow();
  });

  it('accepts valid delete action with groupId', () => {
    expect(() =>
      (aiTools.manage_groups.inputSchema as { parse: (x: unknown) => unknown }).parse({
        action: 'delete',
        groupId: 'g1',
      })
    ).not.toThrow();
  });

  it('rejects invalid action enum', () => {
    expect(() =>
      (aiTools.manage_groups.inputSchema as { parse: (x: unknown) => unknown }).parse({
        action: 'invalid',
      })
    ).toThrow(ZodError);
  });

  it('accepts all 5 action values', () => {
    const actions = ['edit_tabs', 'merge', 'split', 'delete', 'move_tabs'] as const;
    for (const action of actions) {
      expect(() =>
        (aiTools.manage_groups.inputSchema as { parse: (x: unknown) => unknown }).parse({ action })
      ).not.toThrow();
    }
  });
});

describe('archive_group schema', () => {
  it('accepts groupId-only (existing path)', () => {
    expect(() =>
      (aiTools.archive_group.inputSchema as { parse: (x: unknown) => unknown }).parse({
        groupId: 'g1',
      })
    ).not.toThrow();
  });

  it('accepts tabIds for direct-from-browser archive', () => {
    expect(() =>
      (aiTools.archive_group.inputSchema as { parse: (x: unknown) => unknown }).parse({
        tabIds: [1, 2, 3],
      })
    ).not.toThrow();
  });
});

describe('save_tabs schema', () => {
  it('accepts preserve_set mode for exact bundle saves', () => {
    const parsed = (aiTools.save_tabs.inputSchema as { parse: (x: unknown) => { mode?: string } }).parse({
        mode: 'preserve_set',
        groups: [{ tabIds: [1, 2, 3], groupName: 'AI Models 2025' }],
      });

    expect(parsed.mode).toBe('preserve_set');
  });
});

describe('web_search schema', () => {
  it('accepts freshness hints for current-information research', () => {
    const parsed = (aiTools.web_search.inputSchema as { parse: (x: unknown) => { freshness?: string } }).parse({
        query: 'latest ai models',
        freshness: 'month',
      });

    expect(parsed.freshness).toBe('month');
  });
});

describe('search_bluetab schema', () => {
  it('describes saved groups only, not archive search', () => {
    expect(aiTools.search_bluetab.description).toContain('saved Bluetab groups');
    expect(aiTools.search_bluetab.description).not.toContain('archived tabs');
  });
});

describe('search_brain_dump schema', () => {
  it('accepts compact search mode', () => {
    const parsed = (aiTools.search_brain_dump.inputSchema as {
      parse: (x: unknown) => { action?: string; query?: string; limit?: number };
    }).parse({
      action: 'search',
      query: 'gemini',
      limit: 5,
    });

    expect(parsed.action).toBe('search');
    expect(parsed.query).toBe('gemini');
    expect(parsed.limit).toBe(5);
  });

  it('accepts full-content fetch mode by entry id', () => {
    const parsed = (aiTools.search_brain_dump.inputSchema as {
      parse: (x: unknown) => { action?: string; entryId?: string };
    }).parse({
      action: 'get',
      entryId: 'dump-123',
    });

    expect(parsed.action).toBe('get');
    expect(parsed.entryId).toBe('dump-123');
  });
});

describe('get_context schema', () => {
  it('accepts all for a combined snapshot', () => {
    const parsed = (aiTools.get_context.inputSchema as { parse: (x: unknown) => { source: string } }).parse({
      source: 'all',
    });

    expect(parsed.source).toBe('all');
  });
});

describe('TOOL_LOADING_MESSAGES', () => {
  it('has a message for every tool in aiTools', () => {
    Object.keys(aiTools).forEach((name) => {
      expect(TOOL_LOADING_MESSAGES[name]).toBeDefined();
    });
  });

  it('all messages are non-empty strings', () => {
    Object.values(TOOL_LOADING_MESSAGES).forEach((msg) => {
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    });
  });

  it('includes specific messages from CONTEXT.md', () => {
    expect(TOOL_LOADING_MESSAGES.search_tabs).toBe('Searching your tabs...');
    expect(TOOL_LOADING_MESSAGES.manage_groups).toBe('Organizing groups...');
  });
});

describe('config.premium.features', () => {
  it('includes ai_commands', () => {
    expect(config.premium.features).toContain('ai_commands');
  });
});

describe('config.supertry', () => {
  it('has AI endpoint paths', () => {
    const aiSection = (config as Record<string, unknown>).ai as Record<string, unknown>;
    expect(aiSection).toBeDefined();
    expect(typeof aiSection.chatEndpoint).toBe('string');
    expect(typeof aiSection.nameGroupEndpoint).toBe('string');
    expect(typeof aiSection.searchEndpoint).toBe('string');
  });
});

describe('config.ai.storageBudgetBytes', () => {
  it('equals 200 * 1024', () => {
    const aiSection = (config as Record<string, unknown>).ai as Record<string, unknown>;
    expect(aiSection.storageBudgetBytes).toBe(200 * 1024);
  });
});

describe('STORAGE_BUDGETS', () => {
  it('includes AI budget of 200KB', () => {
    const budgets = STORAGE_BUDGETS as Record<string, unknown>;
    expect(budgets.AI).toBe(200 * 1024);
  });
});
