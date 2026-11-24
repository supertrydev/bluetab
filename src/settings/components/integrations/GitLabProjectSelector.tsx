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
import { fetchProjects, type GitLabProject } from '@/services/integrations/gitlab/adapter';
import { launchOAuthFlow } from '@/services/integration-oauth-service';

type IntegrationSettings = IntegrationMenuSettings;

interface GitLabProjectSelectorProps {
  accountId: string;
}

export function GitLabProjectSelector({ accountId }: GitLabProjectSelectorProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<GitLabProject[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [loading, setLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNeedsReauth(false);
    try {
      const settings = await Storage.get<IntegrationSettings>('integration_settings');
      setSelectedProjectId(settings?.default_sync_target?.gitlab ?? '');

      const accessToken = await getValidToken('gitlab', accountId);
      if (!accessToken) throw new Error(t('components.integrationErrors.invalidGitlabToken'));

      const result = await fetchProjects(accessToken);
      setProjects(result);
      await chrome.storage.local.remove(`integration_reauth_required:gitlab:${accountId}`);
    } catch (error) {
      const is401 = error instanceof Response && error.status === 401;
      if (is401) {
        await chrome.storage.local.set({
          [`integration_reauth_required:gitlab:${accountId}`]: true,
        });
        setNeedsReauth(true);
      } else {
        const message = error instanceof Error
          ? error.message
          : error instanceof Response
            ? `HTTP ${error.status}`
            : t('components.integrationErrors.loadProjects');
        setLoadError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [accountId, t]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function handleProjectChange(projectId: string) {
    try {
      setSelectedProjectId(projectId);
      const settings = (await Storage.get<IntegrationSettings>('integration_settings')) ?? {};
      const selectedProject = projects?.find((project) => String(project.id) === projectId);
      const label = selectedProject
        ? selectedProject.name_with_namespace ?? selectedProject.path_with_namespace ?? selectedProject.name
        : null;
      await Storage.set(
        'integration_settings',
        withDefaultSyncTargetLabel(settings, 'gitlab', projectId, label),
      );
      toast.success(t('settings.integrations.gitlabUpdated'));
    } catch {
      toast.error(t('settings.integrations.projectSaveError'));
    }
  }

  async function handleReconnect() {
    try {
      await launchOAuthFlow('gitlab', accountId);
      await chrome.storage.local.remove(`integration_reauth_required:gitlab:${accountId}`);
      await loadProjects();
    } catch {
      toast.error(t('settings.integrations.reconnectCancelled'));
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.gitlabProject')}</label>
        <div className="h-8 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (needsReauth) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.gitlabProject')}</label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-warning">{t('settings.integrations.sessionExpired')}</span>
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
        <label className="text-xs text-muted-foreground">{t('settings.integrations.gitlabProject')}</label>
        <div className="text-xs text-danger">
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
        <label className="text-xs text-muted-foreground">{t('settings.integrations.gitlabProject')}</label>
        <div className="text-xs text-muted-foreground">
          {t('settings.integrations.noFound', { resource: t('settings.integrations.resources.projects') })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{t('settings.integrations.gitlabProject')}</label>
      <Select value={selectedProjectId} onValueChange={(v) => void handleProjectChange(v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={t('settings.integrations.selectProject')} />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.id} value={String(project.id)} className="text-xs">
              <bdi dir="auto">
                {project.name_with_namespace ?? project.path_with_namespace ?? project.name}
              </bdi>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
