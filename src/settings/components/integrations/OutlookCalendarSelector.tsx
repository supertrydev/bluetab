import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';
import { toast } from '@/components/Toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Storage } from '@/utils/storage';
import { getValidToken } from '@/services/integration-token-storage';
import { fetchCalendars, type OutlookCalendarSummary } from '@/services/integrations/outlook-calendar/adapter';
import { launchOAuthFlow } from '@/services/integration-oauth-service';
import { IntegrationAccountUnsupportedError } from '@/services/integrations/cloud-operation-client';

interface IntegrationSettings {
  default_sync_target?: Record<string, string>;
  [key: string]: unknown;
}

interface OutlookCalendarSelectorProps {
  accountId: string;
}

export function OutlookCalendarSelector({ accountId }: OutlookCalendarSelectorProps) {
  const { t } = useTranslation();
  const [calendars, setCalendars] = useState<OutlookCalendarSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [accountUnsupported, setAccountUnsupported] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const settings = await Storage.get<IntegrationSettings>('integration_settings');
        const currentId = settings?.default_sync_target?.['outlook-calendar'] ?? '';
        if (!cancelled) setSelectedId(currentId);

        const accessToken = await getValidToken('outlook-calendar', accountId);
        if (!accessToken) throw new Error(t('components.integrationErrors.invalidOutlookCalendarToken'));
        const list = await fetchCalendars(accessToken);
        if (!cancelled) {
          setCalendars(list);
          setLoadError(null);
          if (!currentId && list.some((c) => c.isDefaultCalendar)) {
            const primary = list.find((c) => c.isDefaultCalendar);
            if (primary) setSelectedId(primary.id);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const is401 = err instanceof Response && err.status === 401;
          if (err instanceof IntegrationAccountUnsupportedError) {
            setAccountUnsupported(true);
          } else if (is401) {
            await chrome.storage.local.set({
              [`integration_reauth_required:outlook-calendar:${accountId}`]: true,
            });
            setNeedsReauth(true);
          } else {
            setLoadError(err instanceof Error ? err.message : t('components.integrationErrors.loadCalendars'));
            console.error('[OutlookCalendarSelector] Failed:', err);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [accountId, t]);

  async function handleReconnect() {
    try {
      await launchOAuthFlow('outlook-calendar', accountId);
      await chrome.storage.local.remove(`integration_reauth_required:outlook-calendar:${accountId}`);
      setNeedsReauth(false);
      setLoadError(null);
      setLoading(true);
    } catch {
      toast.error(t('settings.integrations.reconnectCancelled'));
    }
  }

  async function handleChange(calendarId: string) {
    try {
      setSelectedId(calendarId);
      const settings = (await Storage.get<IntegrationSettings>('integration_settings')) ?? {};
      const defaults = { ...(settings.default_sync_target ?? {}) };
      if (calendarId.trim() === '') {
        delete defaults['outlook-calendar'];
      } else {
        defaults['outlook-calendar'] = calendarId;
      }
      await Storage.set('integration_settings', { ...settings, default_sync_target: defaults });
      toast.success(t('settings.integrations.calendarUpdated'));
    } catch (err) {
      console.error('[OutlookCalendarSelector] Persist failed:', err);
      toast.error(t('settings.integrations.calendarSaveError'));
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.calendarLabel')}</label>
        <div className="h-8 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (needsReauth) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.calendarLabel')}</label>
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

  if (accountUnsupported) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.calendarLabel')}</label>
        <span className="text-xs text-amber-600 dark:text-amber-400">{t('settings.integrations.outlookNoMailbox')}</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.calendarLabel')}</label>
        <div className="text-xs text-red-600 dark:text-red-400">
          {t('settings.integrations.errorLoading', {
            resource: t('settings.integrations.resources.calendars'),
            message: isolateBidi(loadError),
          })}
        </div>
      </div>
    );
  }

  if (!calendars || calendars.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.calendarLabel')}</label>
        <div className="text-xs text-muted-foreground">
          {t('settings.integrations.noFound', { resource: t('settings.integrations.resources.calendars') })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{t('settings.integrations.defaultCalendar')}</label>
      <Select value={selectedId} onValueChange={handleChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={t('settings.integrations.selectCalendar')} />
        </SelectTrigger>
        <SelectContent>
          {calendars.map((c) => (
            <SelectItem key={c.id} value={c.id} className="text-xs">
              <bdi dir="auto">{c.name}</bdi>
              {c.isDefaultCalendar ? ` · ${t('settings.integrations.primaryLabel')}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
