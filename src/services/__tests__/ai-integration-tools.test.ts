const mockListConnectedAccounts = jest.fn();
const mockDispatchVerb = jest.fn();
const localStore: Record<string, unknown> = {};

jest.mock('../integration-token-storage', () => ({
  listConnectedAccounts: (...args: unknown[]) => mockListConnectedAccounts(...args),
}));

jest.mock('../integration-service', () => ({
  dispatchVerb: (...args: unknown[]) => mockDispatchVerb(...args),
}));

jest.mock('../../utils/storage', () => ({
  Storage: { get: jest.fn(async (key: string) => localStore[key] ?? null) },
}));

import {
  buildAIIntegrationTools,
  isAIIntegrationToolName,
  prepareAIIntegrationAction,
  runAIIntegrationTool,
  shouldConfirmIntegrationAction,
} from '../ai-integration-tools';
import { initI18n } from '../../i18n';

function account(integrationId: string, accountId = `${integrationId}-1`) {
  return { integrationId, accountId, accountLabel: 'Personal', metadata: {}, lastUsedAt: 1 };
}

describe('AI integration tools', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en', manageDocumentMetadata: false });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(localStore)) delete localStore[key];
    mockDispatchVerb.mockResolvedValue({ success: true, result: { id: 'created-1' } });
  });

  it('offers provider-safe tools only for connected apps', async () => {
    mockListConnectedAccounts.mockResolvedValue([account('outlook-calendar'), account('linear')]);

    const tools = await buildAIIntegrationTools();

    expect(tools.map((tool) => tool.name)).toEqual(['outlook_calendar__create_event', 'linear__create_issue']);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false });
    }
    expect(isAIIntegrationToolName('outlook_calendar__create_event')).toBe(true);
    expect(isAIIntegrationToolName('notion.create_page')).toBe(false);
    expect(isAIIntegrationToolName('delete_tabs')).toBe(false);
  });

  it('lists the GitHub repositories the user added in the tool description', async () => {
    mockListConnectedAccounts.mockResolvedValue([account('github')]);
    localStore.integration_settings = { github_repos: [{ fullName: 'team/site' }, { fullName: 'team/api' }] };

    const tools = await buildAIIntegrationTools();

    expect(tools.find((tool) => tool.name === 'github__create_issue')?.description)
      .toContain('team/site, team/api');
  });

  it.each([
    ['listed repository', ['team/site'], 'team/site', false],
    ['unlisted repository', ['team/site'], 'other/site', true],
    ['different case', ['Team/Site'], 'TEAM/site', false],
    ['default repository', ['team/site'], undefined, false],
    ['empty list', [], 'team/site', true],
    ['missing list', undefined, 'team/site', true],
  ])('handles issue confirmation for a %s', async (_name, repos, repo, forced) => {
    mockListConnectedAccounts.mockResolvedValue([account('github')]);
    localStore.integration_settings = { github_repos: repos?.map((fullName) => ({ fullName })) };

    const plan = await prepareAIIntegrationAction('github__create_issue', { title: 'Bug', repo });
    if ('status' in plan) throw new Error('expected a plan');
    expect(plan.alwaysConfirm).toBe(forced);
    expect(shouldConfirmIntegrationAction(plan, true)).toBe(forced);
    expect(shouldConfirmIntegrationAction(plan, false)).toBe(true);
    expect(mockDispatchVerb).not.toHaveBeenCalled();
  });

  it('maps an Outlook event to the adapter fields and the connected account', async () => {
    mockListConnectedAccounts.mockResolvedValue([account('outlook-calendar', 'outlook-acc')]);
    const input = { title: 'Birthday', start: '2026-10-12T12:00:00', end: '2026-10-12T13:00:00' };

    const plan = await prepareAIIntegrationAction('outlook_calendar__create_event', input);
    expect(plan).toEqual({
      integrationName: 'Outlook Calendar',
      details: ['Birthday', '2026-10-12T12:00:00 – 2026-10-12T13:00:00'],
      alwaysConfirm: false,
    });

    const result = await runAIIntegrationTool('outlook_calendar__create_event', input);
    expect(mockDispatchVerb).toHaveBeenCalledWith(
      'outlook-calendar',
      'create_event',
      { subject: 'Birthday', start: '2026-10-12T12:00:00', end: '2026-10-12T13:00:00' },
      'outlook-acc',
    );
    expect(result).toEqual({ status: 'success', integration: 'Outlook Calendar', result: { id: 'created-1' } });
  });

  it('fills Bluetab default targets the adapters do not read from metadata', async () => {
    mockListConnectedAccounts.mockResolvedValue([account('todoist'), account('notion'), account('github')]);
    localStore.integration_settings = {
      default_sync_target: { todoist: 'project-9' },
      brain_dump_destination: { integrationId: 'notion', parentPageId: 'page-7' },
      github_repos: [{ fullName: 'team/site' }],
    };

    await runAIIntegrationTool('todoist__create_task', { content: 'Buy milk' });
    await runAIIntegrationTool('notion__create_page', { title: 'Idea' });
    await runAIIntegrationTool('github__create_issue', { title: 'Bug' });

    expect(mockDispatchVerb).toHaveBeenNthCalledWith(1, 'todoist', 'create_task', { content: 'Buy milk', project_id: 'project-9' }, 'todoist-1');
    expect(mockDispatchVerb).toHaveBeenNthCalledWith(2, 'notion', 'create_page', { parent: { page_id: 'page-7' }, title: 'Idea' }, 'notion-1');
    expect(mockDispatchVerb).toHaveBeenNthCalledWith(3, 'github', 'create_issue', { owner: 'team', repo: 'site', title: 'Bug' }, 'github-1');
  });

  it('explains missing fields, missing settings and unconnected apps before anything runs', async () => {
    mockListConnectedAccounts.mockResolvedValue([account('notion'), account('google-calendar')]);

    await expect(prepareAIIntegrationAction('google_calendar__create_event', { title: 'X' }))
      .resolves.toEqual({ status: 'error', message: 'Missing required field(s): start, end', code: 'missingFields' });
    await expect(prepareAIIntegrationAction('notion__create_page', { title: 'Idea' }))
      .resolves.toMatchObject({ status: 'error', code: 'notionPageMissing', message: expect.stringContaining('No Notion page is chosen') });
    await expect(prepareAIIntegrationAction('linear__create_issue', { title: 'Bug' }))
      .resolves.toEqual({ status: 'error', message: 'Linear is not connected.', code: 'notConnected', params: { app: 'Linear' } });
    expect(mockDispatchVerb).not.toHaveBeenCalled();
  });

  it('turns a reconnect signal into a readable error', async () => {
    mockListConnectedAccounts.mockResolvedValue([account('linear')]);
    mockDispatchVerb.mockRejectedValue(new Response(null, { status: 401 }));

    await expect(runAIIntegrationTool('linear__create_issue', { title: 'Bug' })).resolves.toEqual({
      status: 'error',
      message: 'Linear needs to be reconnected in Bluetab Settings > Integrations.',
      code: 'reconnect',
      params: { app: 'Linear' },
    });
  });

  it('classifies adapter errors into stable codes, keeping the detail for the model', async () => {
    mockListConnectedAccounts.mockResolvedValue([account('linear')]);

    mockDispatchVerb.mockResolvedValueOnce({ success: false, error: 'missing_team_id' });
    await expect(runAIIntegrationTool('linear__create_issue', { title: 'Bug' }))
      .resolves.toMatchObject({ status: 'error', code: 'targetMissing', params: { app: 'Linear' }, message: expect.stringContaining('missing_team_id') });

    mockDispatchVerb.mockResolvedValueOnce({ success: false, error: 'reauth_required' });
    await expect(runAIIntegrationTool('linear__create_issue', { title: 'Bug' }))
      .resolves.toMatchObject({ code: 'reconnect' });

    mockDispatchVerb.mockResolvedValueOnce({ success: false, error: 'Linear 400: Bad Request' });
    await expect(runAIIntegrationTool('linear__create_issue', { title: 'Bug' }))
      .resolves.toEqual({ status: 'error', message: 'Linear 400: Bad Request', code: 'appError', params: { app: 'Linear' } });
  });

  it('always asks before posting to Slack or Discord or publishing a public gist', async () => {
    mockListConnectedAccounts.mockResolvedValue([account('slack'), account('discord'), account('github'), account('linear')]);
    localStore.integration_settings = { default_sync_target: { slack: 'C-DEFAULT' } };

    const slack = await prepareAIIntegrationAction('slack__share_to_channel', { text: 'Hi team', channel: 'C-OTHER' });
    const slackDefault = await prepareAIIntegrationAction('slack__share_to_channel', { text: 'Hi team' });
    const discord = await prepareAIIntegrationAction('discord__share_to_channel', { content: 'Hi' });
    const publicGist = await prepareAIIntegrationAction('github__create_gist', { filename: 'a.md', content: 'x', public: true });
    const privateGist = await prepareAIIntegrationAction('github__create_gist', { filename: 'a.md', content: 'x' });
    const issue = await prepareAIIntegrationAction('linear__create_issue', { title: 'Bug' });

    for (const plan of [slack, slackDefault, discord, publicGist]) {
      expect(plan).toMatchObject({ alwaysConfirm: true });
      if ('status' in plan) throw new Error('expected a plan');
      // "Always allow app actions" is on, the card must still show.
      expect(shouldConfirmIntegrationAction(plan, true)).toBe(true);
    }
    for (const plan of [privateGist, issue]) {
      if ('status' in plan) throw new Error('expected a plan');
      expect(plan.alwaysConfirm).toBe(false);
      expect(shouldConfirmIntegrationAction(plan, true)).toBe(false);
      expect(shouldConfirmIntegrationAction(plan, false)).toBe(true);
    }

    // The card names the target channel and the public visibility.
    expect(slack).toMatchObject({ details: ['Hi team', 'Channel: C-OTHER'] });
    expect(slackDefault).toMatchObject({ details: ['Hi team', 'Channel: C-DEFAULT'] });
    expect(publicGist).toMatchObject({ details: ['a.md', 'Public: anyone can see this gist'] });
    expect(privateGist).toMatchObject({ details: ['a.md'] });
  });
});
