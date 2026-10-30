import type { IntegrationAccount } from '@/types/integrations';
import type { IntegrationId } from '@/services/integrations/registry';
import { isolateBidi } from '@/i18n/bidi';

export interface IntegrationMenuSettings {
  default_sync_target?: Record<string, string>;
  default_sync_target_labels?: Record<string, string>;
  [key: string]: unknown;
}

export type IntegrationActionLabelKey =
  | 'contextMenu.mirrorToProvider'
  | 'contextMenu.mirrorToIntegration'
  | 'contextMenu.saveToProvider'
  | 'contextMenu.saveToIntegration';

export interface IntegrationActionLabelValues extends Record<string, string> {
  integration: string;
  account: string;
}

export type IntegrationLabelTranslator = (
  key: IntegrationActionLabelKey,
  values: IntegrationActionLabelValues,
) => string;

const GROUP_MENU_EXCLUDED_INTEGRATIONS = new Set([
  'github',
  'google-calendar',
  'outlook-calendar',
]);

const GROUP_MIRROR_INTEGRATIONS = new Set([
  'notion',
  'linear',
  'todoist',
  'slack',
  'discord',
]);

const GENERIC_ACCOUNT_LABELS = new Set([
  'personal',
  'default',
  'connected',
]);

const METADATA_LABEL_KEYS = [
  'workspace_name',
  'workspace',
  'team_name',
  'team',
  'organization_name',
  'org_name',
  'cloud_name',
  'site_name',
  'webhook_channel_name',
  'channel_name',
  'channel',
  'webhook_name',
  'guild_name',
  'server_name',
  'project_name',
  'project_key',
  'board_name',
  'list_name',
  'repo_full_name',
  'default_repo',
  'database_name',
  'calendar_name',
  'email',
  'login',
  'username',
  'name',
];

function cleanLabel(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isGenericAccountLabel(label: string, providerDisplayName: string): boolean {
  const normalized = label.trim().toLowerCase();
  return (
    GENERIC_ACCOUNT_LABELS.has(normalized) ||
    normalized === providerDisplayName.trim().toLowerCase()
  );
}

export function isGroupMenuIntegration(integrationId: string): boolean {
  return !GROUP_MENU_EXCLUDED_INTEGRATIONS.has(integrationId);
}

export function isGroupMirrorIntegration(integrationId: string): boolean {
  return GROUP_MIRROR_INTEGRATIONS.has(integrationId);
}

export function getIntegrationScopeLabel(
  account: IntegrationAccount,
  settings: IntegrationMenuSettings | null | undefined,
  providerDisplayName: string,
): string | null {
  const targetLabel = cleanLabel(settings?.default_sync_target_labels?.[account.integrationId]);
  if (targetLabel) return targetLabel;

  const metadataLabelKeys = account.integrationId === 'discord'
    ? ['webhook_channel_name']
    : METADATA_LABEL_KEYS;
  for (const key of metadataLabelKeys) {
    const value = cleanLabel(account.metadata?.[key]);
    if (value) return value;
  }

  const accountLabel = cleanLabel(account.accountLabel);
  if (accountLabel && !isGenericAccountLabel(accountLabel, providerDisplayName)) {
    return accountLabel;
  }

  return null;
}

export function formatIntegrationActionLabel(
  action: 'Mirror to' | 'Save to',
  providerDisplayName: string,
  account: IntegrationAccount,
  settings?: IntegrationMenuSettings | null,
  translate?: IntegrationLabelTranslator,
): string {
  const scope = getIntegrationScopeLabel(account, settings, providerDisplayName);
  const isolatedProvider = isolateBidi(providerDisplayName, 'ltr');
  const isolatedScope = scope ? isolateBidi(scope, 'auto') : '';
  if (translate) {
    const isMirror = action === 'Mirror to';
    const key = scope
      ? isMirror ? 'contextMenu.mirrorToIntegration' : 'contextMenu.saveToIntegration'
      : isMirror ? 'contextMenu.mirrorToProvider' : 'contextMenu.saveToProvider';

    return translate(key, {
      integration: isolatedProvider,
      account: isolatedScope,
    });
  }

  return scope
    ? `${action} ${isolatedProvider} (${isolatedScope})`
    : `${action} ${isolatedProvider}`;
}

export function formatIntegrationDestinationLabel(
  providerDisplayName: string,
  account: IntegrationAccount,
  settings?: IntegrationMenuSettings | null,
): string {
  const scope = getIntegrationScopeLabel(account, settings, providerDisplayName);
  const isolatedProvider = isolateBidi(providerDisplayName, 'ltr');
  return scope
    ? `${isolatedProvider} (${isolateBidi(scope, 'auto')})`
    : isolatedProvider;
}

export function getGroupIntegrationAction(integrationId: string): 'Mirror to' | 'Save to' {
  return isGroupMirrorIntegration(integrationId) ? 'Mirror to' : 'Save to';
}

export function withDefaultSyncTargetLabel(
  settings: IntegrationMenuSettings,
  integrationId: IntegrationId,
  targetId: string,
  targetLabel?: string | null,
): IntegrationMenuSettings {
  const targets = { ...(settings.default_sync_target ?? {}) };
  const labels = { ...(settings.default_sync_target_labels ?? {}) };

  if (targetId.trim() === '') {
    delete targets[integrationId];
    delete labels[integrationId];
  } else {
    targets[integrationId] = targetId.trim();
    const clean = cleanLabel(targetLabel);
    if (clean) {
      labels[integrationId] = clean;
    } else {
      delete labels[integrationId];
    }
  }

  return {
    ...settings,
    default_sync_target: targets,
    default_sync_target_labels: labels,
  };
}
