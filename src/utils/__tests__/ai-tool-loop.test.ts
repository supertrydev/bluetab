import { decideToolLoop, MAX_AUTO_TOOL_ROUNDS, previousToolError, toolLoopNotice } from '../ai-tool-loop';

const user = { role: 'user', parts: [{ type: 'text' }] };
const toolRound = (input: unknown, output: unknown) => [
  { type: 'step-start' },
  { type: 'tool-create_flow_rule', state: 'output-available', input, output },
];

describe('decideToolLoop', () => {
  it('continues for a normal tool round', () => {
    expect(decideToolLoop([user, { role: 'assistant', parts: toolRound({ a: 1 }, { status: 'success' }) }]))
      .toEqual({ continue: true });
  });

  it('stops after the maximum number of tool rounds in one turn', () => {
    const parts = Array.from({ length: MAX_AUTO_TOOL_ROUNDS }, (_, i) => toolRound({ i }, { status: 'success' })).flat();
    expect(decideToolLoop([user, { role: 'assistant', parts }])).toEqual({ continue: false, reason: 'max_rounds' });
  });

  it('stops when the same call fails twice, but allows a corrected retry', () => {
    const failed = { status: 'error', message: 'groupName is required' };
    const retried = [...toolRound({ name: 'x' }, failed), ...toolRound({ name: 'x', groupName: 'Dev' }, { status: 'success' })];
    expect(decideToolLoop([user, { role: 'assistant', parts: retried }])).toEqual({ continue: true });

    const repeated = [...toolRound({ name: 'x' }, failed), ...toolRound({ name: 'x' }, failed)];
    expect(decideToolLoop([user, { role: 'assistant', parts: repeated }]))
      .toEqual({ continue: false, reason: 'repeated_error' });
  });

  it('carries a known error code and its params, never the English message', () => {
    const failed = { status: 'error', message: 'Linear is not connected.', code: 'notConnected', params: { app: 'Linear' } };
    const repeated = [...toolRound({ name: 'x' }, failed), ...toolRound({ name: 'x' }, failed)];
    expect(decideToolLoop([user, { role: 'assistant', parts: repeated }]))
      .toEqual({ continue: false, reason: 'repeated_error', code: 'notConnected', params: { app: 'Linear' } });

    const unknown = { status: 'error', message: 'boom', code: 'missing_team_id' };
    const repeatedUnknown = [...toolRound({ name: 'x' }, unknown), ...toolRound({ name: 'x' }, unknown)];
    expect(decideToolLoop([user, { role: 'assistant', parts: repeatedUnknown }]))
      .toEqual({ continue: false, reason: 'repeated_error' });
  });

  it('maps a stop to a localized notice key', () => {
    expect(toolLoopNotice({ reason: 'repeated_error', code: 'reconnect', params: { app: 'Slack' } }))
      .toEqual({ key: 'sidepanel.aiChatThread.toolErrors.reconnect', params: { app: 'Slack' } });
    expect(toolLoopNotice({ reason: 'repeated_error' })).toEqual({ key: 'sidepanel.aiChatThread.toolLoopStopped' });
    expect(toolLoopNotice({ reason: 'max_rounds' })).toEqual({ key: 'sidepanel.aiChatThread.toolLoopStopped' });
  });

  it('ignores turns that do not end with an assistant message', () => {
    expect(decideToolLoop([user])).toEqual({ continue: true });
  });

  it('finds the error an identical call already returned in the current turn', () => {
    const failed = { status: 'error', message: 'Google Calendar 403: Forbidden', code: 'appError', params: { app: 'Google Calendar' } };
    const turn = [user, { role: 'assistant', parts: toolRound({ title: 'Birthday' }, failed) }];

    expect(previousToolError(turn, 'create_flow_rule', { title: 'Birthday' })).toEqual(failed);
    expect(previousToolError(turn, 'create_flow_rule', { title: 'Party' })).toBeNull();
    expect(previousToolError(turn, 'block_site', { title: 'Birthday' })).toBeNull();
    // A new user turn ("try again") may run the action again.
    expect(previousToolError([...turn, user], 'create_flow_rule', { title: 'Birthday' })).toBeNull();
    expect(previousToolError([user, { role: 'assistant', parts: toolRound({ title: 'Birthday' }, { status: 'success' }) }],
      'create_flow_rule', { title: 'Birthday' })).toBeNull();
  });
});
