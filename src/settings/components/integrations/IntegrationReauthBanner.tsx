/**
 * IntegrationReauthBanner.tsx — Amber re-authorization banner.
 *
 * WHY: INTEG-07 — When an integration token refresh fails, users must be
 *      informed and able to reconnect without hunting through settings.
 *
 * WHAT: Subscribes to chrome.storage.onChanged for integration_reauth_required:*
 *       keys. Renders an inline amber banner with a Reconnect button.
 *
 * HOW: Uses chrome.storage.onChanged listener (same as sync-engine state watchers).
 *      Reconnect button reopens the OAuth flow for that integration+account.
 *
 * SAFETY-02: Copy uses "needs to be re-authorized".
 */

import { useEffect, useState } from 'react';
import { launchOAuthFlow } from '@/services/integration-oauth-service';
import { getValidToken } from '@/services/integration-token-storage';
import { isCloudConnectionCredential } from '@/services/integrations/cloud-operation-client';
import {
  getIntegrationUnavailableMessage,
  INTEGRATION_REGISTRY_MAP,
} from '@/services/integrations/registry';
import type { IntegrationId } from '@/services/integrations/registry';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';

interface ReauthItem {
  integrationId: IntegrationId;
  accountId: string;
  accountLabel?: string;
}

export function IntegrationReauthBanner() {
  const { t } = useTranslation();
  const [reauthItems, setReauthItems] = useState<ReauthItem[]>([]);

  useEffect(() => {
    // Load initial reauth flags
    loadReauthFlags();

    // Subscribe to storage changes
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      const reauthChanges = Object.entries(changes).filter(([key]) =>
        key.startsWith('integration_reauth_required:')
      );
      if (reauthChanges.length > 0) {
        loadReauthFlags();
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  async function loadReauthFlags() {
    const all = await chrome.storage.local.get(null);
    const items: ReauthItem[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith('integration_reauth_required:') && value === true) {
        const parts = key.replace('integration_reauth_required:', '').split(':');
        if (parts.length >= 2) {
          const integrationId = parts[0] as IntegrationId;
          const accountId = parts.slice(1).join(':');
          if (getIntegrationUnavailableMessage(integrationId)) continue;
          items.push({ integrationId, accountId });
        }
      }
    }

    // Silent probe: try refreshing each flagged token. If it now succeeds
    // (stale flag from before the refresh-path fix), auto-clear the flag.
    const stillBroken: ReauthItem[] = [];
    await Promise.allSettled(
      items.map(async (item) => {
        try {
          const token = await getValidToken(item.integrationId, item.accountId);
          // Cloud connections have no local token to test (the credential
          // is just a reference), so a "success" here proves nothing. Their
          // flag is cleared by the next successful call or a reconnect.
          if (isCloudConnectionCredential(token)) {
            stillBroken.push(item);
            return;
          }
          // Refresh succeeded — clear the stale reauth flag
          await chrome.storage.local.remove(
            `integration_reauth_required:${item.integrationId}:${item.accountId}`
          );
        } catch {
          stillBroken.push(item);
        }
      })
    );
    setReauthItems(stillBroken);
  }

  async function handleReconnect(item: ReauthItem) {
    try {
      await launchOAuthFlow(item.integrationId, item.accountId);
      // Clear the reauth flag after successful reconnect
      await chrome.storage.local.remove(
        `integration_reauth_required:${item.integrationId}:${item.accountId}`
      );
      await loadReauthFlags();
    } catch {
      // OAuth was not completed; banner stays visible
    }
  }

  if (reauthItems.length === 0) return null;

  return (
    <div className="space-y-2">
      {reauthItems.map((item) => {
        const entry = INTEGRATION_REGISTRY_MAP.get(item.integrationId);
        const displayName = entry?.display_name || item.integrationId;
        const accountLabel = item.accountLabel || item.accountId.slice(0, 8);
        const accountDirection = item.accountLabel ? 'auto' : 'ltr';

        return (
          <div
            key={`${item.integrationId}:${item.accountId}`}
            className="flex items-center justify-between rounded-md border border-warning/30 bg-warning-muted px-4 py-3"
          >
            <p dir="auto" className="text-sm text-warning">
              {t('components.integrations.reauth', {
                name: isolateBidi(displayName),
                account: isolateBidi(accountLabel, accountDirection),
              })}
            </p>
            <button
              className="ms-4 shrink-0 text-sm font-medium text-warning underline hover:no-underline"
              onClick={() => handleReconnect(item)}
            >
              {t('common.reconnect')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
