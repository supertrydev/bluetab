import {
  FULL_DETAIL_USER_TURNS,
  HISTORY_MAX_MESSAGES,
  OLD_TOOL_OUTPUT_MAX_CHARS,
  shapeHistoryForRequest,
  type WireMessage,
} from '../ai-history-window';
import { AIService, PROMPT_GROUP_LIMIT } from '@/services/ai-service';

jest.mock('@/services/ai-integration-tools', () => ({
  buildAIIntegrationTools: jest.fn(async () => [{
    name: 'outlook_calendar__create_event',
    description: 'Create an event.',
    parameters: { type: 'object', properties: {}, required: [] },
  }]),
  isAIIntegrationToolName: (name: string) => name.includes('__'),
}));

const user = (text: string): WireMessage => ({ role: 'user', parts: [{ type: 'text', text }] });
const assistantText = (text: string): WireMessage => ({ role: 'assistant', parts: [{ type: 'text', text }] });
const assistantTool = (output: unknown): WireMessage => ({
  role: 'assistant',
  parts: [{ type: 'tool-search_bluetab', toolCallId: 'c', state: 'output-available', input: {}, output }],
});

const big = { groups: 'x'.repeat(OLD_TOOL_OUTPUT_MAX_CHARS + 500) };

describe('shapeHistoryForRequest', () => {
  it('leaves short conversations untouched', () => {
    const messages = [user('hi'), assistantTool(big), assistantText('done')];
    expect(shapeHistoryForRequest(messages)).toEqual(messages);
  });

  it('shortens large tool outputs only in turns older than the recent ones', () => {
    const messages = [
      user('first'), assistantTool(big), assistantText('first answer'),
      user('second'), assistantTool(big), assistantText('second answer'),
      user('third'), assistantTool(big),
    ];
    const shaped = shapeHistoryForRequest(messages);

    const oldOutput = shaped[1].parts![0].output as { truncated: boolean; preview: string };
    expect(oldOutput.truncated).toBe(true);
    expect(oldOutput.preview).toHaveLength(OLD_TOOL_OUTPUT_MAX_CHARS);
    // Recent turns (last FULL_DETAIL_USER_TURNS user messages onward) keep full results.
    expect(FULL_DETAIL_USER_TURNS).toBe(2);
    expect(shaped[4].parts![0].output).toEqual(big);
    expect(shaped[7].parts![0].output).toEqual(big);
    // The model's own text is never rewritten.
    expect(shaped[2]).toBe(messages[2]);
  });

  it('keeps small old tool outputs as they are', () => {
    const small = { status: 'success', count: 3 };
    const messages = [user('a'), assistantTool(small), user('b'), user('c')];
    expect(shapeHistoryForRequest(messages)[1].parts![0].output).toEqual(small);
  });

  it('bounds long chats and starts the window at a user message', () => {
    const messages: WireMessage[] = [];
    for (let index = 0; index < 30; index += 1) {
      messages.push(user(`q${index}`), assistantTool({ ok: index }), assistantText(`a${index}`));
    }
    const shaped = shapeHistoryForRequest(messages);
    expect(shaped.length).toBeLessThanOrEqual(HISTORY_MAX_MESSAGES);
    expect(shaped[0].role).toBe('user');
    expect(shaped[shaped.length - 1]).toBe(messages[messages.length - 1]);
  });
});

describe('system prompt saved-group list', () => {
  it('lists the most recent groups up to the limit and points to search_bluetab for the rest', () => {
    const groupSummary = Array.from({ length: PROMPT_GROUP_LIMIT + 5 }, (_, index) => ({
      id: `g${index}`, name: `Group ${index}`, tabCount: 1, modified: index,
    }));
    const prompt = AIService.buildSystemPrompt({ tabs: [], groupSummary, totalTabCount: 0 }, true);

    expect(prompt).toContain(`${PROMPT_GROUP_LIMIT + 5} saved groups`);
    expect(prompt).toContain(`"Group ${PROMPT_GROUP_LIMIT + 4}"`);
    expect(prompt).not.toContain('"Group 0"');
    expect(prompt).toContain('... and 5 more saved groups');
    expect(prompt).toContain('call search_bluetab');
  });
});


describe('chat tool schema', () => {
  it('advertises the base tools plus connected-app actions with provider-safe names', async () => {
    const { getToolsForBody } = await import('@/utils/ai-tools');
    const tools = await AIService.buildToolSchemaForTurn();
    expect(Object.keys(tools).sort()).toEqual(
      [...Object.keys(getToolsForBody()), 'outlook_calendar__create_event'].sort(),
    );
    // Provider function-name rule.
    for (const name of Object.keys(tools)) expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });
});
