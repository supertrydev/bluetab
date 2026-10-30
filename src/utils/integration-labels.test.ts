import {
  formatIntegrationDestinationLabel,
  formatIntegrationActionLabel,
  getGroupIntegrationAction,
  withDefaultSyncTargetLabel,
} from './integration-labels';
import type { IntegrationAccount } from '@/types/integrations';

function account(partial: Partial<IntegrationAccount>): IntegrationAccount {
  return {
    integrationId: 'linear',
    accountId: 'acc-1',
    accountLabel: 'Personal',
    metadata: {},
    lastUsedAt: 0,
    ...partial,
  };
}

describe('integration-labels', () => {
  const translate = (key: string, values: Record<string, string>): string => {
    const templates: Record<string, string> = {
      'contextMenu.mirrorToProvider': '{{integration}} hedefine yansıt',
      'contextMenu.mirrorToIntegration': '{{integration}} hedefine yansıt ({{account}})',
      'contextMenu.saveToProvider': '{{integration}} hedefine kaydet',
      'contextMenu.saveToIntegration': '{{integration}} hesabına kaydet ({{account}})',
    };

    return Object.entries(values).reduce(
      (result, [name, value]) => result.replace(`{{${name}}}`, value),
      templates[key] ?? key,
    );
  };

  it('formats the complete action sentence through the active locale', () => {
    expect(
      formatIntegrationActionLabel(
        'Mirror to',
        'Linear',
        account({ integrationId: 'linear', metadata: { workspace_name: 'Core team' } }),
        {},
        translate,
      ),
    ).toBe('\u2066Linear\u2069 hedefine yansıt (\u2068Core team\u2069)');
  });

  it('isolates dynamic provider labels even when no account suffix is rendered', () => {
    expect(
      formatIntegrationActionLabel(
        'Save to',
        'Notion',
        account({ integrationId: 'notion', accountLabel: 'Personal' }),
        {},
        translate,
      ),
    ).toBe('\u2066Notion\u2069 hedefine kaydet');
  });

  it('uses saved target labels before generic account labels', () => {
    const label = formatIntegrationActionLabel(
      'Mirror to',
      'Linear',
      account({ integrationId: 'linear', metadata: { workspace_name: 'Fallback workspace' } }),
      { default_sync_target_labels: { linear: 'Core team' } },
    );

    expect(label).toBe('Mirror to \u2066Linear\u2069 (\u2068Core team\u2069)');
  });

  it('uses metadata labels when no saved target label exists', () => {
    const label = formatIntegrationActionLabel(
      'Mirror to',
      'Notion',
      account({ integrationId: 'notion', metadata: { workspace_name: 'Design Ops' } }),
      {},
    );

    expect(label).toBe('Mirror to \u2066Notion\u2069 (\u2068Design Ops\u2069)');
  });

  it('uses Discord channel metadata when available', () => {
    const label = formatIntegrationActionLabel(
      'Mirror to',
      'Discord',
      account({
        integrationId: 'discord',
        metadata: { webhook_channel_name: 'launch-room', webhook_channel_id: '1506606910248321095' },
      }),
      {},
    );

    expect(label).toBe('Mirror to \u2066Discord\u2069 (\u2068launch-room\u2069)');
  });

  it('does not treat Discord webhook names or raw ids as channel display names', () => {
    const label = formatIntegrationActionLabel(
      'Mirror to',
      'Discord',
      account({
        integrationId: 'discord',
        metadata: {
          webhook_name: 'Bluetab Webhook',
          webhook_channel_id: '1506606910248321095',
          guild_id: '657320984123768111',
        },
      }),
      {},
    );

    expect(label).toBe('Mirror to \u2066Discord\u2069');
  });

  it('omits generic Personal/provider labels instead of showing noisy suffixes', () => {
    expect(
      formatIntegrationActionLabel(
        'Save to',
        'Readwise',
        account({ integrationId: 'readwise', accountLabel: 'Personal' }),
        {},
      ),
    ).toBe('Save to \u2066Readwise\u2069');

    expect(
      formatIntegrationActionLabel(
        'Save to',
        'Trello',
        account({ integrationId: 'trello', accountLabel: 'Trello' }),
        {},
      ),
    ).toBe('Save to \u2066Trello\u2069');
  });

  it('formats destination picker labels without generic Personal noise', () => {
    expect(
      formatIntegrationDestinationLabel(
        'Slack',
        account({ integrationId: 'slack', accountLabel: 'Personal' }),
        { default_sync_target_labels: { slack: '#social' } },
      ),
    ).toBe('\u2066Slack\u2069 (\u2068#social\u2069)');

    expect(
      formatIntegrationDestinationLabel(
        'Readwise',
        account({ integrationId: 'readwise', accountLabel: 'Personal' }),
        {},
      ),
    ).toBe('\u2066Readwise\u2069');
  });

  it('classifies actual group-mirror integrations as Mirror to actions', () => {
    expect(getGroupIntegrationAction('notion')).toBe('Mirror to');
    expect(getGroupIntegrationAction('linear')).toBe('Mirror to');
    expect(getGroupIntegrationAction('todoist')).toBe('Mirror to');
    expect(getGroupIntegrationAction('slack')).toBe('Mirror to');
    expect(getGroupIntegrationAction('discord')).toBe('Mirror to');
    expect(getGroupIntegrationAction('readwise')).toBe('Save to');
  });

  it('persists readable target labels next to target ids', () => {
    const next = withDefaultSyncTargetLabel(
      {},
      'trello',
      'list-1',
      'Work / Inbox',
    );

    expect(next.default_sync_target?.trello).toBe('list-1');
    expect(next.default_sync_target_labels?.trello).toBe('Work / Inbox');
  });
});
