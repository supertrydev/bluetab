/**
 * @module settings/components/mcp/ConnectedClientCard
 *
 * WHY:  Each connected external MCP client (Claude Desktop, Cursor, etc.)
 *       needs a card in the MCP Server Settings section showing its name,
 *       last-used timestamp, per-toolset-category toggles, and
 *       rotate/revoke actions.
 *
 * WHAT: Card with:
 *         - Top row: client name + auth mode + last-used relative timestamp
 *         - Toolset row: 3 Radix Switches (groups, brain_dump, reminders)
 *         - Action row: [Replace token] for personal-token clients + [Revoke]
 *
 * HOW:  Toolset toggles persist to mcp_server_toolset_prefs[clientId]
 *       in chrome.storage.local. Rotate/Revoke call Supertry endpoints.
 *
 * NOT:  Does NOT own the client roster lifecycle -- MCPServerSection
 *       fetches the roster from Supertry and passes individual clients
 *       as props.
 */

import { useState, useCallback } from 'react';
import { KeyRound, ShieldCheck, UserX } from 'lucide-react';
import { toast } from '@/components/Toast';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ModalTemplate, ModalTemplateSection } from '@/components/ui/modal-template';
import { Storage } from '@/utils/storage';
import type { ToolsetCategory } from '@/types/mcp';
import { t as translate } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { formatDate } from '@/i18n/format';
import { useTranslation } from 'react-i18next';

export interface ConnectedClient {
  id: string;
  name: string;
  authMode: 'oauth' | 'personal_token';
  lastUsedAt: number | null;
  /** Granted mcp:read only (the user unticked "Allow changes" on consent). */
  readOnly?: boolean;
  /** Personal-token expiry, when the client uses one. */
  tokenExpiresAt?: number | null;
  tokenExpiringSoon?: boolean;
}

interface ConnectedClientCardProps {
  client: ConnectedClient;
  /** Per-client toolset prefs from mcp_server_toolset_prefs. */
  allowedToolsets: ToolsetCategory[];
  /** Supertry MCP base URL for revoke flows. */
  mcpUrl: string;
  /** Auth token for Supertry requests. */
  authToken: string | null;
  onRotatePersonalToken: (client: ConnectedClient) => void;
  onRefresh: () => void;
  /** Called after a toolset switch changes so the server learns it soon. */
  onToolsetsChanged?: () => void;
}

const TOOLSET_LABEL_KEYS: Record<ToolsetCategory, 'settings.mcp.connectedClient.toolsets.groups' | 'settings.mcp.connectedClient.toolsets.brainDump' | 'settings.mcp.connectedClient.toolsets.reminders'> = {
  groups: 'settings.mcp.connectedClient.toolsets.groups',
  brain_dump: 'settings.mcp.connectedClient.toolsets.brainDump',
  reminders: 'settings.mcp.connectedClient.toolsets.reminders',
};

const ALL_TOOLSETS: ToolsetCategory[] = ['groups', 'brain_dump', 'reminders'];

function formatRelativeTime(ts: number | null): string {
  if (!ts) return translate('settings.mcp.connectedClient.neverUsed');
  const diffMs = Date.now() - ts;
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return translate('time.justNow');
  if (diffMinutes < 60) return translate('time.minutesAgo', { count: diffMinutes });
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return translate('time.hoursAgo', { count: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  return translate('time.daysAgo', { count: diffDays });
}

export function ConnectedClientCard({
  client,
  allowedToolsets,
  mcpUrl,
  authToken,
  onRotatePersonalToken,
  onRefresh,
  onToolsetsChanged,
}: ConnectedClientCardProps) {
  const { t } = useTranslation();
  const [revokeOpen, setRevokeOpen] = useState(false);

  const handleToolsetToggle = useCallback(
    async (toolset: ToolsetCategory, enabled: boolean) => {
      const prefs =
        (await Storage.get<Record<string, ToolsetCategory[]>>(
          'mcp_server_toolset_prefs',
        )) ?? {};
      const current = prefs[client.id] ?? [...ALL_TOOLSETS];
      const next = enabled
        ? [...new Set([...current, toolset])]
        : current.filter((t) => t !== toolset);
      prefs[client.id] = next;
      await Storage.set('mcp_server_toolset_prefs', prefs);
      onToolsetsChanged?.();
      onRefresh();
    },
    [client.id, onRefresh, onToolsetsChanged],
  );

  const handleRevoke = useCallback(async () => {
    if (!authToken) return;
    try {
      const revokeUrl =
        client.authMode === 'personal_token'
          ? `${mcpUrl}/personal-tokens/${encodeURIComponent(client.id)}`
          : `${mcpUrl}/clients?client_id=${encodeURIComponent(client.id)}`;

      const resp = await fetch(revokeUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        toast.success(t('settings.mcp.connectedClient.clientRevoked'));
        setRevokeOpen(false);
        onRefresh();
      } else {
        toast.error(t('settings.mcp.connectedClient.unableToRevoke'));
      }
    } catch {
      toast.error(t('settings.mcp.connectedClient.unableToRevoke'));
    }
  }, [authToken, client.authMode, mcpUrl, client.id, onRefresh, t]);

  return (
    <>
      <div className="rounded-md bg-muted border-border-glass backdrop-blur-sm p-3 space-y-3">
        {/* Top row: name + last used */}
        <div className="flex items-center justify-between">
          <div className="min-w-0 space-y-1">
            <bdi dir="auto" className="block text-sm font-medium text-text-strong truncate">
              {client.name}
            </bdi>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-0/70 px-2 py-0.5 text-xs text-muted-foreground">
              {client.authMode === 'personal_token' ? (
                <KeyRound className="h-3 w-3" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              {client.authMode === 'personal_token'
                ? t('settings.mcp.connectedClient.personalToken')
                : <bdi dir="ltr">OAuth</bdi>}
            </span>
            {client.readOnly && (
              <span className="ms-1 inline-flex items-center rounded-full border border-border bg-bg-0/70 px-2 py-0.5 text-xs text-muted-foreground">
                {t('settings.mcp.connectedClient.readOnly')}
              </span>
            )}
          </div>
          <time dir="ltr" className="text-xs text-muted-foreground shrink-0 ms-2">
            {formatRelativeTime(client.lastUsedAt)}
          </time>
        </div>

        {client.tokenExpiringSoon && client.tokenExpiresAt && (
          <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-text-strong">
            {t('settings.mcp.connectedClient.tokenExpiresSoon', { date: formatDate(new Date(client.tokenExpiresAt)) })}
          </p>
        )}

        {/* Toolset toggles */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('settings.mcp.connectedClient.toolsetsHint')}</p>
          {ALL_TOOLSETS.map((ts) => (
            <div key={ts} className="flex items-center justify-between">
              <span className="text-xs text-text-muted">
                {t(TOOLSET_LABEL_KEYS[ts])}
              </span>
              <Switch
                checked={allowedToolsets.includes(ts)}
                onCheckedChange={(checked: boolean) =>
                  handleToolsetToggle(ts, checked)
                }
                aria-label={t('settings.mcp.connectedClient.toolsetAria', {
                  toolset: t(TOOLSET_LABEL_KEYS[ts]),
                  client: isolateBidi(client.name),
                })}
              />
            </div>
          ))}
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          {client.authMode === 'personal_token' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRotatePersonalToken(client)}
              className="text-xs"
            >
              <KeyRound className="h-3 w-3" />
              {t('settings.mcp.connectedClient.replaceToken')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRevokeOpen(true)}
            className="text-xs text-danger hover:text-danger"
          >
            <UserX className="h-3 w-3" />
            {t('settings.mcp.connectedClient.revoke')}
          </Button>
        </div>
      </div>

      {/* Revoke confirmation dialog */}
      <ModalTemplate
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        className="sm:max-w-sm"
        heading={t('settings.mcp.connectedClient.revokeHeading')}
        description={<>{t('settings.mcp.connectedClient.revokeDescriptionPrefix')} <strong><bdi dir="auto">{client.name}</bdi></strong>? {t('settings.mcp.connectedClient.revokeDescriptionSuffix')}</>}
        titleIcon={<UserX className="h-5 w-5 text-danger" />}
        footerClassName="bg-transparent"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setRevokeOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleRevoke}>
              {t('settings.mcp.connectedClient.revoke')}
            </Button>
          </>
        )}
      >
        <ModalTemplateSection tone="danger" className="rounded-lg">
          <p className="text-sm text-text-muted">
            {t('settings.mcp.connectedClient.revokeWarning')}
          </p>
        </ModalTemplateSection>
      </ModalTemplate>
    </>
  );
}

export default ConnectedClientCard;
