/**
 * IntegrationCard.tsx — Per-integration card in Settings → Integrations.
 *
 * WHY: INTEG-01 — Users need to see connected accounts and manage them.
 *
 * WHAT: Shows integration logo, display name, and auth status pill.
 *       Lists connected accounts via IntegrationAccountRow with
 *       Reconnect / Disconnect / Pull actions.
 *       "+ Add account" button re-runs OAuth for an additional account.
 *       Connect button for unconnected integrations.
 *       Footer:
 *         - Default sync target text input. Writes
 *           integration_settings.default_sync_target[id].
 *           (Replaced by a Notion page select + brain-dump auto-route
 *            checkbox in Batch 4.)
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/components/Toast';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Button } from '@/components/ui/button';
import { ServiceIcon, getServiceBrandHex } from '@/components/icons/ServiceIcon';
import { launchOAuthFlow } from '@/services/integration-oauth-service';
import { OAuthProviderUnreachableError } from '@/services/oauth-errors';
import {
  addAccount,
  isIntegrationEncryptionReady,
} from '@/services/integration-token-storage';
import { IntegrationAccountRow } from './IntegrationAccountRow';
import { NotionBrainDumpRouterFooter } from './NotionBrainDumpRouterFooter';
import { LinearTeamSelector } from './LinearTeamSelector';
import { TodoistProjectSelector } from './TodoistProjectSelector';
import { GitHubRepoSelector } from './GitHubRepoSelector';
import { GoogleCalendarSelector } from './GoogleCalendarSelector';
import { OutlookCalendarSelector } from './OutlookCalendarSelector';
import { SlackChannelSelector } from './SlackChannelSelector';
import { TrelloListSelector } from './TrelloListSelector';
import { JiraProjectSelector } from './JiraProjectSelector';
import { AsanaProjectSelector } from './AsanaProjectSelector';
import { GitLabProjectSelector } from './GitLabProjectSelector';
import { OAuthNetworkErrorModal } from './OAuthNetworkErrorModal';
import { Storage } from '@/utils/storage';
import type { IntegrationRegistryEntry, IntegrationAccount } from '@/types/integrations';
import type { IntegrationId } from '@/services/integrations/registry';
import { isolateBidi } from '@/i18n/bidi';

interface IntegrationSettings {
  default_sync_target?: Record<string, string>;
  [key: string]: unknown;
}

const MIRROR_TARGET_HINT_KEYS: Partial<Record<IntegrationId, string>> = {
  notion: 'components.integrationTarget.notionDatabase',
  linear: 'components.integrationTarget.linearTeam',
  slack: 'components.integrationTarget.slackChannel',
  jira: 'components.integrationTarget.jiraProject',
  trello: 'components.integrationTarget.trelloList',
  asana: 'components.integrationTarget.asanaProject',
  gitlab: 'components.integrationTarget.gitlabProject',
  todoist: 'components.integrationTarget.todoistProject',
  'google-calendar': 'components.integrationTarget.primaryCalendar',
  'outlook-calendar': 'components.integrationTarget.primaryCalendar',
};

interface IntegrationCardProps {
  entry: IntegrationRegistryEntry;
  accounts: IntegrationAccount[];
  onAccountsChange: () => void;
  onSetUpSync: () => void;
}

function formatDiscordChannelName(
  metadata: Record<string, string>,
  fallbackLabel: string,
): string {
  const rawName = metadata.webhook_channel_name;
  const trimmed = rawName?.trim();
  if (!trimmed) return fallbackLabel;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function DiscordWebhookInfo({ metadata }: { metadata: Record<string, string> }) {
  const { t } = useTranslation();
  const channelName = formatDiscordChannelName(metadata, t('settings.integrations.selectedDiscordChannel'));

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{t('settings.integrations.connectedChannel')}</span>
      <div className="rounded-md border border-border bg-bg-1/50 px-2 py-1.5">
        <bdi dir="auto" className="block truncate text-xs font-medium text-text-strong">
          {channelName}
        </bdi>
      </div>
    </div>
  );
}

interface DefaultSyncTargetFieldProps {
  integrationId: IntegrationId;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}

function DefaultSyncTargetField({
  integrationId,
  value,
  placeholder,
  onChange,
  onBlur,
}: DefaultSyncTargetFieldProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={`default-sync-${integrationId}`}
        className="text-xs text-muted-foreground"
      >
        {t('settings.integrations.defaultSyncTarget')}
      </label>
      <input
        id={`default-sync-${integrationId}`}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        title={value || placeholder}
        autoComplete="off"
        dir="ltr"
        className="h-8 w-full min-w-0 rounded-input border border-field bg-bg-1 px-3 py-1.5 text-xs text-text-strong placeholder:text-text-muted shadow-inner"
      />
    </div>
  );
}

export function IntegrationCard({
  entry,
  accounts,
  onAccountsChange,
  onSetUpSync,
}: IntegrationCardProps) {
  const { t } = useTranslation();
  const [connecting, setConnecting] = useState(false);
  const [syncSetupRequired, setSyncSetupRequired] = useState(false);
  const [unreachableProviderName, setUnreachableProviderName] = useState<string | null>(null);
  const [defaultSyncTarget, setDefaultSyncTarget] = useState('');
  const [pasteFormOpen, setPasteFormOpen] = useState(false);
  const [pasteToken, setPasteToken] = useState('');

  // Load + subscribe to footer settings.
  useEffect(() => {
    let cancelled = false;
    async function reload() {
      const settings = await Storage.get<IntegrationSettings>('integration_settings');
      if (cancelled) return;
      setDefaultSyncTarget(settings?.default_sync_target?.[entry.id] ?? '');
    }
    reload();

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.integration_settings) reload();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [entry.id]);

  async function handleConnect() {
    if (entry.auth_type === 'token_paste') {
      setPasteFormOpen(true);
      return;
    }
    if (!(await isIntegrationEncryptionReady())) {
      setSyncSetupRequired(true);
      return;
    }
    await runOAuthFlow();
  }

  function handleSetUpSync() {
    setSyncSetupRequired(false);
    onSetUpSync();
  }

  async function handlePasteSubmit() {
    const token = pasteToken.trim();
    if (!token) return;
    setConnecting(true);
    try {
      const now = Date.now();
      await addAccount(entry.id as IntegrationId, {
        integration_id: entry.id,
        account_id: crypto.randomUUID(),
        account_label: 'Personal',
        access_token: token,
        refresh_token: undefined,
        expires_at: Number.MAX_SAFE_INTEGER,
        metadata: {},
        created_at: now,
        last_used_at: now,
      });
      setPasteFormOpen(false);
      setPasteToken('');
      onAccountsChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t('settings.integrations.connectError', {
        name: isolateBidi(entry.display_name),
      }), { description: isolateBidi(message) });
    } finally {
      setConnecting(false);
    }
  }
  async function runOAuthFlow() {
    setConnecting(true);
    try {
      await launchOAuthFlow(entry.id as IntegrationId);
      onAccountsChange();
    } catch (err) {
      if (err instanceof OAuthProviderUnreachableError) {
        setUnreachableProviderName(err.providerName);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[IntegrationCard:${entry.id}] OAuth flow could not complete:`, err);
      // User-visible feedback so a quiet error does not look like a dead button.
      toast.error(t('settings.integrations.connectError', {
        name: isolateBidi(entry.display_name),
      }), {
        description: isolateBidi(message),
      });
    } finally {
      setConnecting(false);
    }
  }

  async function handleOAuthRetry() {
    setUnreachableProviderName(null);
    await runOAuthFlow();
  }

  function handleOAuthLearnMore() {
    setUnreachableProviderName(null);
    void chrome.tabs.create({ url: 'chrome://settings/security' });
  }

  async function persistSettings(patch: Partial<IntegrationSettings>) {
    const settings = (await Storage.get<IntegrationSettings>('integration_settings')) ?? {};
    await Storage.set('integration_settings', { ...settings, ...patch });
  }

  async function handleSyncTargetBlur() {
    const settings = (await Storage.get<IntegrationSettings>('integration_settings')) ?? {};
    const map = { ...(settings.default_sync_target ?? {}) };
    if (defaultSyncTarget.trim().length === 0) {
      delete map[entry.id];
    } else {
      map[entry.id] = defaultSyncTarget.trim();
    }
    await persistSettings({ default_sync_target: map });
  }

  const isConnected = accounts.length > 0;
  const targetHint = entry.id === 'github'
    ? 'owner/repo'
    : t((
        MIRROR_TARGET_HINT_KEYS[entry.id as IntegrationId]
          ?? 'components.integrationTarget.defaultIdentifier'
      ) as never) as unknown as string;

  const brandHex = getServiceBrandHex(entry.id);
  const iconChipStyle = {
    backgroundColor: brandHex ? `#${brandHex}` : 'var(--muted, rgba(127,127,127,0.12))',
    color: '#fff',
    boxShadow: brandHex ? `0 0 0 1px #${brandHex}40` : undefined,
  };

  return (
    <div className="flex flex-col rounded-md bg-muted border-border-glass backdrop-blur-sm p-4 gap-3">
      {/* Top row — brand icon + name, with status pill stacked below the name
          so cramped widths don't truncate the integration name to "N..." */}
      <div className="flex items-start gap-3 min-w-0">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg"
          style={iconChipStyle}
        >
          <ServiceIcon id={entry.id} size={19} />
        </div>
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <bdi dir="auto" className="truncate text-sm font-medium leading-tight">
            {entry.display_name}
          </bdi>
          <span
            className={`self-start inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-medium leading-none ${
              isConnected
                ? 'bg-success-muted text-success'
                : 'bg-muted text-muted-foreground'
            }`}
            title={isConnected ? t('settings.integrations.connected') : t('settings.integrations.notConnected')}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected ? 'bg-success' : 'bg-muted-foreground/60'
              }`}
              aria-hidden="true"
            />
            {isConnected ? t('settings.integrations.connected') : t('settings.integrations.notConnected')}
          </span>
        </div>
      </div>

      {/* Account stack — Plan 14-07 Task 2 uses IntegrationAccountRow. */}
      {accounts.length > 0 && (
        <div className="flex flex-col gap-2">
          {accounts.map((account) => (
            <IntegrationAccountRow
              key={account.accountId}
              entry={entry}
              account={account}
              onChanged={onAccountsChange}
            />
          ))}
        </div>
      )}

      {/* One account per provider: the cloud keeps a single connection per
          user and provider, so a connected card only offers the row actions
          (reconnect / disconnect). */}
      {!isConnected && (
        <Button
          size="sm"
          className="w-full"
          onClick={handleConnect}
          disabled={connecting}
        >
          {connecting ? t('settings.integrations.connecting') : t('common.connect')}
        </Button>
      )}

      {/* Footer — shown for connected integrations only. Notion gets the
          page-select + brain-dump auto-route toggle (Batch 4) plus a
          smart-import button (Batch 5); Linear gets team dropdown; other
          providers keep the generic default-sync-target text input. */}
      {isConnected && (
        <div className="flex flex-col gap-3 border-t border-border-glass pt-3">
          {entry.id === 'notion' && accounts[0] ? (
            <NotionBrainDumpRouterFooter accountId={accounts[0].accountId} />
          ) : entry.id === 'linear' && accounts[0] ? (
            <LinearTeamSelector accountId={accounts[0].accountId} />
          ) : entry.id === 'todoist' && accounts[0] ? (
            <TodoistProjectSelector accountId={accounts[0].accountId} />
          ) : entry.id === 'github' && accounts[0] ? (
            <GitHubRepoSelector accountId={accounts[0].accountId} />
          ) : entry.id === 'google-calendar' && accounts[0] ? (
            <GoogleCalendarSelector accountId={accounts[0].accountId} />
          ) : entry.id === 'outlook-calendar' && accounts[0] ? (
            <OutlookCalendarSelector accountId={accounts[0].accountId} />
          ) : entry.id === 'slack' && accounts[0] ? (
            <SlackChannelSelector accountId={accounts[0].accountId} />
          ) : entry.id === 'trello' && accounts[0] ? (
            <TrelloListSelector accountId={accounts[0].accountId} />
          ) : entry.id === 'discord' && accounts[0] ? (
            <DiscordWebhookInfo metadata={accounts[0].metadata} />
          ) : entry.id === 'jira' && accounts[0] ? (
            <JiraProjectSelector
              accountId={accounts[0].accountId}
              cloudId={accounts[0].metadata.cloud_id ?? ''}
            />
          ) : entry.id === 'asana' && accounts[0] ? (
            <AsanaProjectSelector
              accountId={accounts[0].accountId}
              workspaceGid={accounts[0].metadata.workspace_gid ?? ''}
            />
          ) : entry.id === 'gitlab' && accounts[0] ? (
            <GitLabProjectSelector accountId={accounts[0].accountId} />
          ) : entry.id === 'readwise' ? null : (
            <DefaultSyncTargetField
              integrationId={entry.id as IntegrationId}
              value={defaultSyncTarget}
              onChange={setDefaultSyncTarget}
              onBlur={handleSyncTargetBlur}
              placeholder={targetHint}
            />
          )}
        </div>
      )}

      {/* Token-paste inline form */}
      {pasteFormOpen && entry.auth_type === 'token_paste' && (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
          <span className="text-xs text-muted-foreground">
            {t('settings.integrations.pasteApiToken')}
            {entry.token_paste_instructions_url && (
              <>
                {' — '}
                <a
                  href={entry.token_paste_instructions_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {t('settings.integrations.getToken')}
                </a>
              </>
            )}
          </span>
          <input
            type="password"
            dir="ltr"
            autoFocus
            value={pasteToken}
            onChange={(e) => setPasteToken(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handlePasteSubmit(); }}
            placeholder={t('settings.integrations.pasteTokenPlaceholder')}
            className="w-full text-xs rounded-input border border-field bg-bg-1 px-3 py-1.5"
          />
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={handlePasteSubmit} disabled={connecting || !pasteToken.trim()}>
              {connecting ? t('settings.integrations.saving') : t('common.save')}
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => { setPasteFormOpen(false); setPasteToken(''); }} disabled={connecting}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={syncSetupRequired}
        type="info"
        title={t('components.integrations.syncSetupTitle')}
        message={t('components.integrations.syncSetupDescription')}
        confirmText={t('components.integrations.syncSetupConfirm')}
        cancelText={t('options.manager.organizeDialog.notNow')}
        onConfirm={handleSetUpSync}
        onCancel={() => setSyncSetupRequired(false)}
      />
      <OAuthNetworkErrorModal
        isOpen={unreachableProviderName !== null}
        providerName={unreachableProviderName ?? entry.display_name}
        onRetry={() => void handleOAuthRetry()}
        onLearnMore={handleOAuthLearnMore}
        onDismiss={() => setUnreachableProviderName(null)}
      />
    </div>
  );
}
