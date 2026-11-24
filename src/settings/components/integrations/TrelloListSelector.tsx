import { useCallback, useEffect, useState } from 'react';
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
import { fetchLists, type TrelloList } from '@/services/integrations/trello/adapter';
import { launchOAuthFlow } from '@/services/integration-oauth-service';

type IntegrationSettings = IntegrationMenuSettings;

interface TrelloListSelectorProps {
  accountId: string;
}

export function TrelloListSelector({ accountId }: TrelloListSelectorProps) {
  const { t } = useTranslation();
  const [lists, setLists] = useState<TrelloList[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLists = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNeedsReauth(false);
    try {
      const settings = await Storage.get<IntegrationSettings>('integration_settings');
      const currentId = settings?.default_sync_target?.trello ?? '';
      setSelectedId(currentId);

      const accessToken = await getValidToken('trello', accountId);
      if (!accessToken) throw new Error(t('components.integrationErrors.invalidTrelloToken'));
      const result = await fetchLists(accessToken);
      setLists(result);
    } catch (err) {
      const is401 = err instanceof Response && err.status === 401;
      if (is401) {
        await chrome.storage.local.set({
          [`integration_reauth_required:trello:${accountId}`]: true,
        });
        setNeedsReauth(true);
      } else {
        setLoadError(err instanceof Error ? err.message : t('components.integrationErrors.loadLists'));
        console.error('[TrelloListSelector] Failed:', err);
      }
    } finally {
      setLoading(false);
    }
  }, [accountId, t]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  async function handleReconnect() {
    try {
      await launchOAuthFlow('trello', accountId);
      await chrome.storage.local.remove(`integration_reauth_required:trello:${accountId}`);
      await loadLists();
    } catch {
      toast.error(t('settings.integrations.reconnectCancelled'));
    }
  }

  async function handleChange(listId: string) {
    try {
      setSelectedId(listId);
      const settings = (await Storage.get<IntegrationSettings>('integration_settings')) ?? {};
      const selectedList = lists?.find((list) => list.id === listId);
      await Storage.set(
        'integration_settings',
        withDefaultSyncTargetLabel(
          settings,
          'trello',
          listId,
          selectedList ? `${selectedList.boardName} / ${selectedList.name}` : null,
        ),
      );
      toast.success(t('settings.integrations.trelloUpdated'));
    } catch (err) {
      console.error('[TrelloListSelector] Persist failed:', err);
      toast.error(t('settings.integrations.listSaveError'));
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.trelloList')}</label>
        <div className="h-8 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (needsReauth) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.trelloList')}</label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-warning">
            {t('settings.integrations.reconnectNeeded', {
              resource: t('settings.integrations.resources.lists'),
            })}
          </span>
          <button
            className="text-xs font-medium text-warning underline hover:no-underline"
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
        <label className="text-xs text-muted-foreground">{t('settings.integrations.trelloList')}</label>
        <div className="text-xs text-danger">
          {t('settings.integrations.errorLoading', {
            resource: t('settings.integrations.resources.lists'),
            message: isolateBidi(loadError),
          })}
        </div>
      </div>
    );
  }

  if (!lists || lists.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.trelloList')}</label>
        <div className="text-xs text-muted-foreground">
          {t('settings.integrations.noFound', { resource: t('settings.integrations.resources.lists') })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{t('settings.integrations.trelloList')}</label>
      <Select value={selectedId} onValueChange={(v) => void handleChange(v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={t('settings.integrations.selectList')} />
        </SelectTrigger>
        <SelectContent>
          {lists.map((list) => (
            <SelectItem key={list.id} value={list.id} className="text-xs">
              <bdi dir="auto">{list.boardName}</bdi>
              {' / '}
              <bdi dir="auto">{list.name}</bdi>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
