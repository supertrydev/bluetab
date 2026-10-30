/**
 * SlackChannelSelector.tsx — Default Slack channel picker in Settings → Integrations.
 *
 * WHY: Users need to pick a default channel for share_to_channel /
 *      send_group_to_slack / push_brain_dump_to_slack without typing IDs.
 *      Requires channels:read scope (added to registry alongside chat:write).
 *
 * WHAT: Select dropdown populated from conversations.list (public channels,
 *       archived excluded). Value is persisted as
 *       integration_settings.default_sync_target['slack'] (channel ID).
 *       Shows "Reconnect" if the token lacks channels:read (missing_scope).
 *
 * HOW: On mount fetches channel list via fetchChannels from the adapter.
 *      On selection change persists the channel ID. Handles loading / error /
 *      reauth states identically to GoogleCalendarSelector.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';
import { toast } from '@/components/Toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Storage } from '@/utils/storage';
import {
  withDefaultSyncTargetLabel,
  type IntegrationMenuSettings,
} from '@/utils/integration-labels';
import { getValidToken } from '@/services/integration-token-storage';
import { fetchChannels, type SlackChannel } from '@/services/integrations/slack/adapter';
import { launchOAuthFlow } from '@/services/integration-oauth-service';

type IntegrationSettings = IntegrationMenuSettings;

interface SlackChannelSelectorProps {
  accountId: string;
}

export function SlackChannelSelector({ accountId }: SlackChannelSelectorProps) {
  const { t } = useTranslation();
  const [channels, setChannels] = useState<SlackChannel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadChannels() {
    setLoading(true);
    setLoadError(null);
    setNeedsReauth(false);
    try {
      const settings = await Storage.get<IntegrationSettings>('integration_settings');
      const currentId = settings?.default_sync_target?.['slack'] ?? '';
      setSelectedId(currentId);

      const accessToken = await getValidToken('slack', accountId);
      if (!accessToken) throw new Error(t('components.integrationErrors.invalidSlackToken'));
      const list = await fetchChannels(accessToken);
      setChannels(list);
    } catch (err) {
      const is401 = err instanceof Response && err.status === 401;
      const isMissingScope =
        err instanceof Error && err.message.includes('missing_scope');
      if (is401 || isMissingScope) {
        await chrome.storage.local.set({
          [`integration_reauth_required:slack:${accountId}`]: true,
        });
        setNeedsReauth(true);
      } else {
        setLoadError(err instanceof Error ? err.message : t('components.integrationErrors.loadChannels'));
        console.error('[SlackChannelSelector] Failed:', err);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function handleReconnect() {
    try {
      await launchOAuthFlow('slack', accountId);
      await chrome.storage.local.remove(`integration_reauth_required:slack:${accountId}`);
      await loadChannels();
    } catch {
      toast.error(t('settings.integrations.reconnectCancelled'));
    }
  }

  async function handleChange(channelId: string) {
    try {
      setSelectedId(channelId);
      const settings = (await Storage.get<IntegrationSettings>('integration_settings')) ?? {};
      const selectedChannel = channels?.find((channel) => channel.id === channelId);
      await Storage.set(
        'integration_settings',
        withDefaultSyncTargetLabel(
          settings,
          'slack',
          channelId,
          selectedChannel ? `#${selectedChannel.name}` : null,
        ),
      );
      toast.success(t('settings.integrations.channelUpdated'));
    } catch (err) {
      console.error('[SlackChannelSelector] Persist failed:', err);
      toast.error(t('settings.integrations.channelSaveError'));
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.defaultChannel')}</label>
        <div className="h-8 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (needsReauth) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.defaultChannel')}</label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {t('settings.integrations.reconnectNeeded', {
              resource: t('settings.integrations.resources.channels'),
            })}
          </span>
          <button
            className="text-xs font-medium text-amber-600 underline dark:text-amber-400 hover:no-underline"
            onClick={() => void handleReconnect()}
          >
            {t('common.reconnect')}
          </button>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.defaultChannel')}</label>
        <div className="text-xs text-red-600 dark:text-red-400">
          {t('settings.integrations.errorLoading', {
            resource: t('settings.integrations.resources.channels'),
            message: isolateBidi(loadError),
          })}
        </div>
      </div>
    );
  }

  if (!channels || channels.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.defaultChannel')}</label>
        <div className="text-xs text-muted-foreground">
          {t('settings.integrations.noFound', { resource: t('settings.integrations.resources.channels') })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{t('settings.integrations.defaultChannel')}</label>
      <Select value={selectedId} onValueChange={(v) => void handleChange(v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={t('settings.integrations.selectChannel')} />
        </SelectTrigger>
        <SelectContent>
          {channels.map((ch) => (
            <SelectItem key={ch.id} value={ch.id} className="text-xs">
              <bdi dir="auto">#{ch.name}</bdi>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
