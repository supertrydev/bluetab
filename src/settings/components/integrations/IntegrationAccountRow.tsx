/**
 * IntegrationAccountRow.tsx — Per-account row inside an IntegrationCard.
 *
 * WHY: INTEG-05 + INTEG-13. A single integration may have multiple connected
 *      accounts (work + personal Linear, two Notion workspaces, etc.) — each
 *      gets its own row with last-used timestamp + Reconnect / Disconnect
 *      buttons.
 *
 * WHAT: Renders one row per connected account:
 *         - <accountLabel>          (e.g. "Work team", "personal@example.com")
 *         - last_used_at relative time
 *         - Reconnect button — re-runs OAuth for the same accountId
 *         - Disconnect button — confirms then removes the bundle
 *
 * NOT: Does NOT expose manual pull controls. Live product keeps Google Keep
 *      disabled and manual pull hidden while integration sync semantics settle.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { launchOAuthFlow } from '@/services/integration-oauth-service';
import { disconnectAccountEverywhere } from '@/services/integration-token-storage';
import { IntegrationSessionError } from '@/services/integrations/cloud-operation-client';
import { toast } from '@/components/Toast';
import { formatRelativeTime } from '@/utils/format-time';
import { getIntegrationScopeLabel } from '@/utils/integration-labels';
import { isolateBidi } from '@/i18n/bidi';
import type { IntegrationRegistryEntry, IntegrationAccount } from '@/types/integrations';
import type { IntegrationId } from '@/services/integrations/registry';

interface IntegrationAccountRowProps {
  entry: IntegrationRegistryEntry;
  account: IntegrationAccount;
  onChanged: () => void;
}

export function IntegrationAccountRow({
  entry,
  account,
  onChanged,
}: IntegrationAccountRowProps) {
  const { t } = useTranslation();
  const [reconnecting, setReconnecting] = useState(false);

  const integrationId = entry.id as IntegrationId;
  const accountId = account.accountId;
  const displayLabel =
    getIntegrationScopeLabel(account, null, entry.display_name) ?? t('settings.integrations.connectedAccount');

  async function handleReconnect() {
    setReconnecting(true);
    try {
      await launchOAuthFlow(integrationId, accountId);
      onChanged();
    } catch {
      // OAuth was not completed; user can retry.
    } finally {
      setReconnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm(t('settings.integrations.disconnectConfirm', {
      name: isolateBidi(entry.display_name),
      account: isolateBidi(displayLabel),
    }))) {
      return;
    }
    try {
      await disconnectAccountEverywhere(integrationId, accountId);
      onChanged();
    } catch (err) {
      console.error('[IntegrationAccountRow] Disconnect error:', err);
      toast.error(err instanceof IntegrationSessionError
        ? err.message
        : t('settings.integrations.disconnectError', { name: isolateBidi(entry.display_name) }));
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm min-w-0">
      <div className="flex min-w-0 flex-col">
        <bdi dir="auto" className="truncate text-foreground">{displayLabel}</bdi>
        {account.lastUsedAt > 0 && (
          <time dir="ltr" className="truncate text-xs text-muted-foreground/70">
            {t('settings.integrations.lastUsed', {
              time: isolateBidi(formatRelativeTime(account.lastUsedAt), 'ltr'),
            })}
          </time>
        )}
      </div>
      {/* Action row sits below the label so narrow cards never truncate the
          account name. Icon-only buttons keep the row tight. */}
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={handleReconnect}
          disabled={reconnecting}
          title={t('settings.integrations.reconnectHelp')}
          aria-label={t('common.reconnect')}
        >
          <RotateCw
            className={`h-3.5 w-3.5 ${reconnecting ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={handleDisconnect}
          title={t('settings.integrations.disconnectHelp')}
          aria-label={t('common.remove')}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
