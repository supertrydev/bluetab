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
import { fetchProjects } from '@/services/integrations/asana/adapter';
import { launchOAuthFlow } from '@/services/integration-oauth-service';

type IntegrationSettings = IntegrationMenuSettings;

interface AsanaProjectSelectorProps {
  accountId: string;
  workspaceGid: string;
}

export function AsanaProjectSelector({ accountId, workspaceGid }: AsanaProjectSelectorProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<{ gid: string; name: string }[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [selectedProjectGid, setSelectedProjectGid] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const settings = await Storage.get<IntegrationSettings>('integration_settings');
        const currentGid = settings?.default_sync_target?.asana ?? '';
        if (!cancelled) setSelectedProjectGid(currentGid);

        if (!workspaceGid) {
          throw new Error(t('components.integrationErrors.missingAsanaWorkspace'));
        }

        const accessToken = await getValidToken('asana', accountId);
        if (!accessToken) throw new Error(t('components.integrationErrors.invalidAsanaToken'));

        const result = await fetchProjects(workspaceGid, accessToken);
        if (!cancelled) {
          setProjects(result);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          const is401 = error instanceof Response && error.status === 401;
          if (is401) {
            await chrome.storage.local.set({
              [`integration_reauth_required:asana:${accountId}`]: true,
            });
            setNeedsReauth(true);
          } else {
            const msg = error instanceof Error
              ? error.message
              : error instanceof Response
                ? `HTTP ${error.status}`
                : t('components.integrationErrors.loadProjects');
            setLoadError(msg);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [accountId, workspaceGid, t]);

  async function handleProjectChange(projectGid: string) {
    try {
      setSelectedProjectGid(projectGid);
      const settings = (await Storage.get<IntegrationSettings>('integration_settings')) ?? {};
      const selectedProject = projects?.find((project) => project.gid === projectGid);
      await Storage.set(
        'integration_settings',
        withDefaultSyncTargetLabel(settings, 'asana', projectGid, selectedProject?.name),
      );
      toast.success(t('settings.integrations.asanaUpdated'));
    } catch {
      toast.error(t('settings.integrations.projectSaveError'));
    }
  }

  async function handleReconnect() {
    try {
      await launchOAuthFlow('asana', accountId);
      await chrome.storage.local.remove(`integration_reauth_required:asana:${accountId}`);
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
        <label className="text-xs text-muted-foreground">{t('settings.integrations.asanaProject')}</label>
        <div className="h-8 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (needsReauth) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.asanaProject')}</label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-amber-600 dark:text-amber-400">{t('settings.integrations.sessionExpired')}</span>
          <button
            className="text-xs font-medium text-amber-600 underline dark:text-amber-400 hover:no-underline"
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
        <label className="text-xs text-muted-foreground">{t('settings.integrations.asanaProject')}</label>
        <div className="text-xs text-red-600 dark:text-red-400">
          {t('settings.integrations.errorLoading', {
            resource: t('settings.integrations.resources.projects'),
            message: isolateBidi(loadError),
          })}
        </div>
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.asanaProject')}</label>
        <div className="text-xs text-muted-foreground">
          {t('settings.integrations.noFound', { resource: t('settings.integrations.resources.projects') })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{t('settings.integrations.asanaProject')}</label>
      <Select value={selectedProjectGid} onValueChange={handleProjectChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={t('settings.integrations.selectProject')} />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.gid} value={project.gid} className="text-xs">
              <bdi dir="auto">{project.name}</bdi>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
