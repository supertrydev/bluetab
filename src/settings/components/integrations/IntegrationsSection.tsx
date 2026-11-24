/**
 * IntegrationsSection.tsx — Settings → Integrations tab body.
 *
 * WHY: INTEG-01 — Users can browse 15 curated integrations and connect them.
 *
 * WHAT: Gallery grid of active integration cards from INTEGRATION_REGISTRY.
 *       Pro-gated (same pattern as Phase 11 Distraction Detector + Phase 13 MCP).
 *       Connected integrations shown first (with account stacks).
 *       Available (unconnected) integrations shown as gallery below.
 *       Empty state when nothing connected.
 *
 * HOW: Reads listConnectedAccounts() on mount + on storage changes.
 *      Uses Phase 8.1 glass + radius tokens for card surfaces.
 */

import { useEffect, useState, useCallback } from 'react';
import { Plug2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UpgradeToProButton } from '@/components/auth/UpgradeToProButton';
import { useAuth } from '@/components/auth/useAuth';
import { INTEGRATION_REGISTRY } from '@/services/integrations/registry';
import { listConnectedAccounts } from '@/services/integration-token-storage';
import { IntegrationCard } from './IntegrationCard';
import { IntegrationReauthBanner } from './IntegrationReauthBanner';
import type { IntegrationAccount } from '@/types/integrations';

function SectionHeader() {
  const { t } = useTranslation();

  return (
    <h3 className="text-base font-semibold text-text-strong flex items-center gap-2">
      <Plug2 className="w-5 h-5" />
      {t('settings.integrationsSection.title')}
    </h3>
  );
}

interface IntegrationsSectionProps {
  onSetUpSync: () => void;
}

export function IntegrationsSection({ onSetUpSync }: IntegrationsSectionProps) {
  const { t } = useTranslation();
  const { isPro } = useAuth();
  const [accountsByIntegration, setAccountsByIntegration] = useState<
    Record<string, IntegrationAccount[]>
  >({});
  const [loading, setLoading] = useState(true);

  const loadAccounts = useCallback(async () => {
    try {
      const accounts = await listConnectedAccounts();
      const grouped: Record<string, IntegrationAccount[]> = {};
      for (const account of accounts) {
        if (!grouped[account.integrationId]) grouped[account.integrationId] = [];
        grouped[account.integrationId].push(account);
      }
      setAccountsByIntegration(grouped);
    } catch {
      setAccountsByIntegration({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.integration_tokens) loadAccounts();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [loadAccounts]);

  // Free user path: Pro gate
  if (!isPro) {
    return (
      <div className="space-y-4">
        <SectionHeader />
        <div className="rounded-lg border border-border-glass bg-bg-0/80 backdrop-blur-sm p-6 text-center">
          <Plug2 className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium mb-1">{t('settings.integrationsSection.title')}</p>
          <p className="text-xs text-muted-foreground mb-4">
            {t('settings.integrationsSection.upgradeDescription')}
          </p>
          <UpgradeToProButton size="sm" />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <SectionHeader />
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const connectedIds = new Set(Object.keys(accountsByIntegration));
  const connectedEntries = INTEGRATION_REGISTRY.filter((e) => connectedIds.has(e.id));
  const availableEntries = INTEGRATION_REGISTRY.filter((e) => !connectedIds.has(e.id));
  const hasConnections = connectedEntries.length > 0;

  return (
    <div className="space-y-6">
      <SectionHeader />

      {/* Re-auth banners */}
      <IntegrationReauthBanner />

      {/* Connected integrations */}
      {hasConnections && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">{t('settings.integrationsSection.connectedTitle')}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connectedEntries.map((entry) => (
              <IntegrationCard
                key={entry.id}
                entry={entry}
                accounts={accountsByIntegration[entry.id] || []}
                onAccountsChange={loadAccounts}
                onSetUpSync={onSetUpSync}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasConnections && (
        <div className="rounded-lg border border-border-glass bg-bg-0/80 backdrop-blur-sm p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t('settings.integrationsSection.emptyState')}
          </p>
        </div>
      )}

      {/* Available integrations gallery */}
      {availableEntries.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">{t('settings.integrationsSection.availableTitle')}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {availableEntries.map((entry) => (
              <IntegrationCard
                key={entry.id}
                entry={entry}
                accounts={[]}
                onAccountsChange={loadAccounts}
                onSetUpSync={onSetUpSync}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
