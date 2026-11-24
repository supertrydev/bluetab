/**
 * JiraProjectSelector — Jira-specific IntegrationCard footer that
 * replaces the generic "Default sync target" text input with a
 * projects dropdown fetched from Jira API.
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
import { fetchAccessibleResources, fetchProjects } from '@/services/integrations/jira/adapter';
import { launchOAuthFlow } from '@/services/integration-oauth-service';

type JiraProject = {
  id: string;
  key: string;
  name: string;
};

type IntegrationSettings = IntegrationMenuSettings;

interface JiraProjectSelectorProps {
  accountId: string;
  cloudId: string;
}

export function JiraProjectSelector({ accountId, cloudId }: JiraProjectSelectorProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<JiraProject[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [selectedProjectKey, setSelectedProjectKey] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        setNeedsReauth(false);
        setLoadError(null);

        const settings = await Storage.get<IntegrationSettings>('integration_settings');
        const currentProjectKey = settings?.default_sync_target?.jira ?? '';
        if (!cancelled) {
          setSelectedProjectKey(currentProjectKey);
        }

        const accessToken = await getValidToken('jira', accountId);
        if (!accessToken) {
          throw new Error(t('components.integrationErrors.invalidJiraToken'));
        }

        let resolvedCloudId = cloudId.trim();
        if (!resolvedCloudId) {
          const resources = await fetchAccessibleResources(accessToken);
          const jiraResource =
            resources.find((resource) => resource.scopes.includes('write:jira-work')) ??
            resources[0];
          resolvedCloudId = jiraResource?.id ?? '';
        }

        if (!resolvedCloudId) {
          throw new Error(t('components.integrationErrors.missingJiraSite'));
        }

        const jiraProjects = await fetchProjects(resolvedCloudId, accessToken);
        if (!cancelled) {
          setProjects(jiraProjects);
          setLoadError(null);
          await chrome.storage.local.remove(`integration_reauth_required:jira:${accountId}`);
        }
      } catch (error) {
        if (!cancelled) {
          const is401 = error instanceof Response && error.status === 401;
          const is403 = error instanceof Response && error.status === 403;
          const is404 = error instanceof Response && error.status === 404;

          if (is401 || is404) {
            await chrome.storage.local.set({
              [`integration_reauth_required:jira:${accountId}`]: true,
            });
            setNeedsReauth(true);
          } else if (is403) {
            setLoadError(t('settings.integrations.missingJiraPermission'));
          } else {
            setLoadError(error instanceof Error ? error.message : t('components.integrationErrors.loadProjects'));
            console.error('[JiraProjectSelector] Failed to fetch projects:', error);
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
  }, [accountId, cloudId, t]);

  async function handleProjectChange(projectKey: string) {
    try {
      setSelectedProjectKey(projectKey);

      const settings = (await Storage.get<IntegrationSettings>('integration_settings')) ?? {};
      const selectedProject = projects?.find((project) => project.key === projectKey);
      const label = selectedProject
        ? `${selectedProject.name} (${selectedProject.key})`
        : null;
      await Storage.set(
        'integration_settings',
        withDefaultSyncTargetLabel(settings, 'jira', projectKey, label),
      );

      toast.success(t('settings.integrations.jiraUpdated'));
    } catch (error) {
      console.error('[JiraProjectSelector] Failed to save project:', error);
      toast.error(t('settings.integrations.projectSaveError'));
    }
  }

  async function handleReconnect() {
    try {
      await launchOAuthFlow('jira', accountId);
      await chrome.storage.local.remove(`integration_reauth_required:jira:${accountId}`);
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
        <label className="text-xs text-muted-foreground">{t('settings.integrations.jiraProject')}</label>
        <div className="h-8 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (needsReauth) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.jiraProject')}</label>
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
    const needsReconnect = loadError === t('settings.integrations.missingJiraPermission');
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.jiraProject')}</label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-danger">
            {needsReconnect
              ? loadError
              : t('settings.integrations.errorLoading', {
                resource: t('settings.integrations.resources.projects'),
                message: isolateBidi(loadError),
              })}
          </span>
          {needsReconnect && (
            <button
              className="text-xs font-medium text-warning underline hover:no-underline"
              onClick={handleReconnect}
            >
              {t('common.reconnect')}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.jiraProject')}</label>
        <div className="text-xs text-muted-foreground">
          {t('settings.integrations.noFound', { resource: t('settings.integrations.resources.projects') })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{t('settings.integrations.jiraProject')}</label>
      <Select value={selectedProjectKey} onValueChange={handleProjectChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={t('settings.integrations.selectProject')} />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.key} value={project.key} className="text-xs">
              <bdi dir="auto">{project.name}</bdi>
              {' ('}<bdi dir="ltr">{project.key}</bdi>{')'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
