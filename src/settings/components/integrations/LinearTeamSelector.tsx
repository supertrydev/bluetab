/**
 * LinearTeamSelector — Linear-specific IntegrationCard footer that
 * replaces the generic "Default sync target" text input with a
 * teams dropdown fetched from Linear API.
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
import { fetchTeams } from '@/services/integrations/linear/adapter';
import { launchOAuthFlow } from '@/services/integration-oauth-service';

type LinearTeam = {
  id: string;
  name: string;
  description?: string;
};

type IntegrationSettings = IntegrationMenuSettings;

interface LinearTeamSelectorProps {
  accountId: string;
}

export function LinearTeamSelector({ accountId }: LinearTeamSelectorProps) {
  const { t } = useTranslation();
  const [teams, setTeams] = useState<LinearTeam[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const settings = await Storage.get<IntegrationSettings>('integration_settings');
        const currentTeamId = settings?.default_sync_target?.linear ?? '';
        if (!cancelled) {
          setSelectedTeamId(currentTeamId);
        }

        const accessToken = await getValidToken('linear', accountId);
        if (!accessToken) throw new Error(t('components.integrationErrors.invalidLinearToken'));

        const linearTeams = await fetchTeams(accessToken);
        if (!cancelled) {
          setTeams(linearTeams);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          const is401 = error instanceof Response && error.status === 401;
          if (is401) {
            await chrome.storage.local.set({
              [`integration_reauth_required:linear:${accountId}`]: true,
            });
            setNeedsReauth(true);
          } else {
            setLoadError(error instanceof Error ? error.message : t('components.integrationErrors.loadTeams'));
            console.error('[LinearTeamSelector] Failed to fetch teams:', error);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  async function handleTeamChange(teamId: string) {
    try {
      setSelectedTeamId(teamId);

      const settings = (await Storage.get<IntegrationSettings>('integration_settings')) ?? {};
      const selectedTeam = teams?.find((team) => team.id === teamId);
      await Storage.set(
        'integration_settings',
        withDefaultSyncTargetLabel(settings, 'linear', teamId, selectedTeam?.name),
      );

      toast.success(t('settings.integrations.linearUpdated'));
    } catch (error) {
      console.error('[LinearTeamSelector] Failed to save team:', error);
      toast.error(t('settings.integrations.teamSaveError'));
    }
  }

  async function handleReconnect() {
    try {
      await launchOAuthFlow('linear', accountId);
      await chrome.storage.local.remove(`integration_reauth_required:linear:${accountId}`);
      setNeedsReauth(false);
      setLoadError(null);
      setLoading(true);
    } catch {
      toast.error(t('settings.integrations.reconnectCancelled'));
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.linearTeam')}</label>
        <div className="h-8 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (needsReauth) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.linearTeam')}</label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-warning">{t('settings.integrations.sessionExpired')}</span>
          <button
            className="text-xs font-medium text-warning underline hover:no-underline"
            onClick={handleReconnect}
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
        <label className="text-xs text-muted-foreground">{t('settings.integrations.linearTeam')}</label>
        <div className="text-xs text-danger">
          {t('settings.integrations.errorLoading', {
            resource: t('settings.integrations.resources.teams'),
            message: isolateBidi(loadError),
          })}
        </div>
      </div>
    );
  }

  if (!teams || teams.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.linearTeam')}</label>
        <div className="text-xs text-muted-foreground">
          {t('settings.integrations.noFound', { resource: t('settings.integrations.resources.teams') })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{t('settings.integrations.linearTeam')}</label>
      <Select value={selectedTeamId} onValueChange={handleTeamChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={t('settings.integrations.selectTeam')} />
        </SelectTrigger>
        <SelectContent>
          {teams.map((team) => (
            <SelectItem key={team.id} value={team.id} className="text-xs">
              <bdi dir="auto">{team.name}</bdi>
              {team.description && <>{' — '}<bdi dir="auto">{team.description}</bdi></>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
