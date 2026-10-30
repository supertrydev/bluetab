/**
 * @module settings/components/MCPServerSection
 *
 * WHY: Users need to connect AI apps to BlueTab, see whether it works,
 * and control what each app may do, without reading config files.
 *
 * WHAT: "AI apps (MCP)" settings section:
 *   - server URL (always visible) and read-only URL, both copyable
 *   - master switch with an honest upload status (last success, last error)
 *   - test connection, per-app setup tabs with one-click installs
 *   - connected apps (read-only badge, token expiry, toolsets, revoke)
 *   - recent activity and, under Advanced, personal tokens
 *
 * HOW: Reads mcp_server_enabled and snapshot status from local storage,
 * polls snapshot status every 10s, refreshes connected clients every
 * 30s while enabled, and calls Supertry session-authenticated MCP
 * management routes with the existing Supertry access token.
 *
 * NOT: Does not push snapshots itself; MCPServerService owns that.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Plug, Server } from 'lucide-react';
import { toast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ModalTemplate,
  ModalTemplateMetric,
  ModalTemplateMetricGrid,
  ModalTemplateSection,
} from '@/components/ui/modal-template';
import { Switch } from '@/components/ui/switch';
import { UpgradeToProButton } from '@/components/auth/UpgradeToProButton';
import { useAuth } from '@/components/auth/useAuth';
import { config } from '@/config/config';
import { MCPServerService } from '@/services/mcp-server-service';
import { Storage } from '@/utils/storage';
import * as AuthState from '@/utils/auth-state';
import { t as translate } from '@/i18n';
import type { ToolsetCategory } from '@/types/mcp';
import { ConnectedClientCard, type ConnectedClient } from './mcp/ConnectedClientCard';
import { CodeBlock, UrlField } from './mcp/McpCode';
import { McpConnectGuide } from './mcp/McpConnectGuide';
import { McpConnectionTest } from './mcp/McpConnectionTest';
import { McpActivityList } from './mcp/McpActivityList';
import { describeUploadFailure, personalTokenSnippets, readOnlyMcpUrl } from './mcp/mcp-connect';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/i18n/format';

interface MCPServerStatus {
  /** Last successful upload. */
  lastPushAt?: number;
  lastAttemptAt?: number;
  lastPushOk?: boolean;
  lastError?: string;
}

interface PersonalTokenResponse {
  client_id: string;
  client_name: string;
  token: string;
  expires_at: string;
  scope: string;
}

const ALL_TOOLSETS: ToolsetCategory[] = ['groups', 'brain_dump', 'reminders'];

function formatPushStatus(status: MCPServerStatus | null): string {
  if (!status?.lastPushAt) return translate('settings.mcp.notYetPushed');
  const diffMs = Date.now() - status.lastPushAt;
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 5) return translate('settings.mcp.justPushed');
  if (diffSeconds < 60) return translate('settings.mcp.lastPushedSecondsAgo', { count: diffSeconds });
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return translate('settings.mcp.lastPushedMinutesAgo', { count: diffMinutes });
  const diffHours = Math.floor(diffMinutes / 60);
  return translate('settings.mcp.lastPushedHoursAgo', { count: diffHours });
}

function PersonalTokenGuides({ token }: { token: string }) {
  return (
    <div className="space-y-3 pt-1">
      {personalTokenSnippets(config.supertry.mcpUrl, token).map((snippet) => (
        <div key={snippet.title}>
          <p className="text-xs font-medium text-text-strong"><bdi dir="ltr">{snippet.title}</bdi></p>
          <CodeBlock code={snippet.code} />
        </div>
      ))}
    </div>
  );
}

export function MCPServerSection() {
  const { t } = useTranslation();
  const { isPro } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<MCPServerStatus | null>(null);
  const [clients, setClients] = useState<ConnectedClient[]>([]);
  const [toolsetPrefs, setToolsetPrefs] = useState<Record<string, ToolsetCategory[]>>({});
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [personalTokenDialogOpen, setPersonalTokenDialogOpen] = useState(false);
  const [personalTokenBusy, setPersonalTokenBusy] = useState(false);
  const [personalTokenTarget, setPersonalTokenTarget] = useState<ConnectedClient | null>(null);
  const [personalClientName, setPersonalClientName] = useState('Codex');
  const [personalTokenResult, setPersonalTokenResult] = useState<PersonalTokenResponse | null>(null);

  const resetPersonalTokenDialog = useCallback(() => {
    setPersonalTokenDialogOpen(false);
    setPersonalTokenBusy(false);
    setPersonalTokenTarget(null);
    setPersonalClientName('Codex');
    setPersonalTokenResult(null);
  }, []);

  useEffect(() => {
    Storage.get<boolean>('mcp_server_enabled').then((value) => setEnabled(!!value));
    Storage.get<MCPServerStatus>('mcp_server_status').then((value) => setStatus(value ?? null));
    Storage.get<Record<string, ToolsetCategory[]>>('mcp_server_toolset_prefs').then((value) =>
      setToolsetPrefs(value ?? {}),
    );
    AuthState.getAccessToken().then(setAuthToken);
  }, []);

  useEffect(() => {
    const poll = async () => {
      const nextStatus = await Storage.get<MCPServerStatus>('mcp_server_status');
      setStatus(nextStatus ?? null);
    };
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  }, []);

  const refreshToolsetPrefs = useCallback(async () => {
    const prefs =
      (await Storage.get<Record<string, ToolsetCategory[]>>('mcp_server_toolset_prefs')) ?? {};
    setToolsetPrefs(prefs);
  }, []);

  const fetchClients = useCallback(async () => {
    if (!authToken) return;

    try {
      const response = await fetch(`${config.supertry.mcpUrl}/clients`, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) return;

      const raw = (await response.json()) as Array<Record<string, unknown>>;
      const active: ConnectedClient[] = raw
        .filter((client) => client.active !== false && !client.revokedAt)
        .map((client) => ({
          id: String(client.id ?? ''),
          name: String(client.name ?? client.client_name ?? client.id ?? ''),
          authMode:
            client.authMode === 'personal_token' || client.auth_mode === 'personal_token'
              ? 'personal_token'
              : 'oauth',
          lastUsedAt: (client.lastUsedAt ??
            client.last_used_at ??
            client.createdAt ??
            client.created_at ??
            null) as number | null,
          readOnly: client.readOnly === true,
          tokenExpiresAt: typeof client.tokenExpiresAt === 'number' ? client.tokenExpiresAt : null,
          tokenExpiringSoon: client.tokenExpiringSoon === true,
        }));

      setClients(active);
    } catch {
      // Silent fallback to current UI state
    }
  }, [authToken]);

  // Connected apps keep their access while the switch is off, so the list
  // (and revoke) stays available either way.
  useEffect(() => {
    if (!authToken || !isPro) return;
    fetchClients();
    const interval = setInterval(fetchClients, 30_000);
    return () => clearInterval(interval);
  }, [authToken, isPro, fetchClients]);

  const refreshStatus = useCallback(async () => {
    setStatus((await Storage.get<MCPServerStatus>('mcp_server_status')) ?? null);
  }, []);

  const handleUploadNow = useCallback(async () => {
    await MCPServerService.pushSnapshotIfEnabled().catch(() => {});
    await refreshStatus();
  }, [refreshStatus]);

  const handleToolsetsChanged = useCallback(() => {
    // The server reads per-app toolsets from the snapshot; upload soon.
    MCPServerService.scheduleSnapshotPush();
  }, []);

  const clientNames = useMemo(
    () => Object.fromEntries(clients.map((client) => [client.id, client.name])),
    [clients],
  );

  const refreshClients = useCallback(async () => {
    await fetchClients();
    await refreshToolsetPrefs();
  }, [fetchClients, refreshToolsetPrefs]);

  const handleToggle = useCallback(async (next: boolean) => {
    await Storage.set('mcp_server_enabled', next);
    setEnabled(next);
    if (next) {
      MCPServerService.pushSnapshotIfEnabled().catch(() => {});
    }
  }, []);

  const openCreatePersonalToken = useCallback(() => {
    setPersonalTokenTarget(null);
    setPersonalClientName('Codex');
    setPersonalTokenResult(null);
    setPersonalTokenDialogOpen(true);
  }, []);

  const openRotatePersonalToken = useCallback((client: ConnectedClient) => {
    setPersonalTokenTarget(client);
    setPersonalClientName(client.name);
    setPersonalTokenResult(null);
    setPersonalTokenDialogOpen(true);
  }, []);

  const handleCreateOrRotatePersonalToken = useCallback(async () => {
    if (!authToken) return;

    const trimmedName = personalClientName.trim();
    if (!trimmedName) {
      toast.error(t('settings.mcp.clientNameRequired'));
      return;
    }

    setPersonalTokenBusy(true);
    try {
      const response = await fetch(`${config.supertry.mcpUrl}/personal-tokens`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: personalTokenTarget?.id,
          client_name: trimmedName,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        toast.error(t('settings.mcp.unableToCreateToken'));
        return;
      }

      const result = (await response.json()) as PersonalTokenResponse;
      setPersonalTokenResult(result);
      await refreshClients();
      toast.success(personalTokenTarget ? t('settings.mcp.personalTokenReplaced') : t('settings.mcp.personalTokenCreated'));
    } catch {
      toast.error(t('settings.mcp.unableToCreateToken'));
    } finally {
      setPersonalTokenBusy(false);
    }
  }, [authToken, personalClientName, personalTokenTarget, refreshClients, t]);

  const personalTokenDialogTitle = personalTokenTarget ? t('settings.mcp.replacePersonalToken') : t('settings.mcp.createPersonalToken');
  const personalTokenActionLabel = personalTokenTarget ? t('settings.mcp.replaceToken') : t('settings.mcp.createToken');
  const personalTokenGuideKey = personalTokenResult?.token ?? '';

  const connectedClientsEmptyText = useMemo(() => {
    return t('settings.mcp.noClients');
  }, [t]);

  if (!isPro) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Server className="w-5 h-5" />
          {t('settings.mcp.title')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('settings.mcp.proDescription')}
        </p>
        <UpgradeToProButton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Server className="w-5 h-5" />
          {t('settings.mcp.title')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('settings.mcp.intro')}</p>
      </div>

      <div className="space-y-3">
        <UrlField url={config.supertry.mcpUrl} label={t('settings.mcp.serverUrl')} large />
        <UrlField url={readOnlyMcpUrl(config.supertry.mcpUrl)} label={t('settings.mcp.readOnlyUrl')} />
      </div>

      <div className="rounded-lg border border-border-glass bg-bg-1/60 backdrop-blur-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.mcp.enableLabel')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('settings.mcp.enableDescription')}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            aria-label={t('settings.mcp.enableAria')}
          />
        </div>

        <div aria-live="polite" className="space-y-1">
          {!enabled ? (
            <p dir="auto" className="text-xs text-muted-foreground">{t('settings.mcp.serverOff')}</p>
          ) : status?.lastPushOk === false ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p dir="auto" className="text-xs text-text-strong">
                {t('settings.mcp.statusFailed', { reason: t(describeUploadFailure(status.lastError)) })}{' '}
                <span className="text-muted-foreground">{formatPushStatus(status)}</span>
              </p>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleUploadNow}>
                {t('settings.mcp.uploadNow')}
              </Button>
            </div>
          ) : (
            <p dir="auto" className="text-xs text-muted-foreground">{formatPushStatus(status)}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('settings.mcp.writesNote')}</p>
        </div>

        <McpConnectionTest
          url={config.supertry.mcpUrl}
          authToken={authToken}
          enabled={enabled}
          onFinished={refreshStatus}
        />
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('settings.mcp.connectApp')}
        </h4>
        <McpConnectGuide url={config.supertry.mcpUrl} />
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
          <Plug className="w-4 h-4" />
          {t('settings.mcp.connectedClients')}
        </h4>

        {clients.length === 0 ? (
          <p className="text-xs text-muted-foreground">{connectedClientsEmptyText}</p>
        ) : (
          <div className="space-y-2">
            {clients.map((client) => (
              <ConnectedClientCard
                key={client.id}
                client={client}
                allowedToolsets={toolsetPrefs[client.id] ?? [...ALL_TOOLSETS]}
                mcpUrl={config.supertry.mcpUrl}
                authToken={authToken}
                onRotatePersonalToken={openRotatePersonalToken}
                onRefresh={refreshClients}
                onToolsetsChanged={handleToolsetsChanged}
              />
            ))}
          </div>
        )}

        <McpActivityList mcpUrl={config.supertry.mcpUrl} authToken={authToken} clientNames={clientNames} />
      </div>

      <details className="group rounded-lg border border-border-glass bg-bg-1/60 backdrop-blur-sm p-4">
        <summary className="cursor-pointer select-none list-none text-sm font-medium text-text-strong flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90">&#9654;</span>
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          {t('settings.mcp.advancedTitle')}
        </summary>
        <div className="pt-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {t('settings.mcp.personalTokenDescription')}
            </p>
            <Button variant="outline" size="sm" onClick={openCreatePersonalToken}>
              {t('settings.mcp.createToken')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('settings.mcp.personalTokenStoredHint')}
          </p>
        </div>
      </details>

      <ModalTemplate
        open={personalTokenDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetPersonalTokenDialog();
            return;
          }
          setPersonalTokenDialogOpen(true);
        }}
        className="sm:max-w-xl"
        heading={personalTokenDialogTitle}
        description={t('settings.mcp.dialogDescription')}
        titleIcon={<KeyRound className="h-5 w-5 text-primary" />}
        footerClassName="bg-transparent"
        footer={(
          <>
            <Button variant="ghost" onClick={resetPersonalTokenDialog}>
              {t('common.close')}
            </Button>
            <Button onClick={handleCreateOrRotatePersonalToken} disabled={personalTokenBusy}>
              {personalTokenBusy ? t('settings.mcp.working') : personalTokenActionLabel}
            </Button>
          </>
        )}
      >
        <div className="space-y-2">
          <Label htmlFor="mcp-personal-client-name">{t('settings.mcp.clientName')}</Label>
          <Input
            id="mcp-personal-client-name"
            dir="auto"
            value={personalClientName}
            onChange={(event) => setPersonalClientName(event.target.value)}
            placeholder={t('settings.mcp.clientNamePlaceholder')}
            className="bg-bg-0 text-text-strong placeholder:text-gray-400 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
          />
        </div>

        {personalTokenResult && (
          <>
            <ModalTemplateSection
              heading={t('settings.mcp.bearerToken')}
              description={t('settings.mcp.bearerTokenDescription')}
              className="rounded-lg"
            >
              <CodeBlock code={personalTokenResult.token} />
            </ModalTemplateSection>
            <ModalTemplateMetricGrid>
              <ModalTemplateMetric
                label={t('settings.mcp.client')}
                value={<bdi dir="auto">{personalTokenResult.client_name}</bdi>}
              />
              <ModalTemplateMetric
                label={t('settings.mcp.expires')}
                value={<time dir="ltr">{formatDate(new Date(personalTokenResult.expires_at))}</time>}
              />
            </ModalTemplateMetricGrid>
            <ModalTemplateSection heading={t('settings.mcp.connectionGuides')} className="rounded-lg">
              <PersonalTokenGuides token={personalTokenGuideKey} />
            </ModalTemplateSection>
          </>
        )}
      </ModalTemplate>

    </div>
  );
}

export default MCPServerSection;
