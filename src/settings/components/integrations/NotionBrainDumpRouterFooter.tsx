/**
 * NotionBrainDumpRouterFooter — Notion-only IntegrationCard footer that
 * replaces the generic "Default sync target" text input. Lets the user
 * pick a Notion page and toggle a checkbox to auto-route every Brain
 * Dump capture into a "Bluetab Brain Dumps" database under that page.
 *
 * Off by default. Enabling creates a fresh database; disabling clears
 * the destination (the database is left in Notion — re-enable or
 * delete it manually if desired).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';
import { toast } from '@/components/Toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Storage } from '@/utils/storage';
import {
  listNotionPages,
  setBrainDumpDestination,
  clearBrainDumpDestination,
  type NotionPageOption,
} from '@/services/integration-service';

interface BrainDumpDestination {
  integrationId: string;
  accountId: string;
  parentPageId: string;
  databaseId: string;
}

interface IntegrationSettings {
  brain_dump_destination?: BrainDumpDestination | null;
  [key: string]: unknown;
}

interface NotionBrainDumpRouterFooterProps {
  /** Connected Notion account id. */
  accountId: string;
}

export function NotionBrainDumpRouterFooter({ accountId }: NotionBrainDumpRouterFooterProps) {
  const { t } = useTranslation();
  const [pages, setPages] = useState<NotionPageOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [pagesResult, settings] = await Promise.all([
          listNotionPages(accountId),
          Storage.get<IntegrationSettings>('integration_settings'),
        ]);
        if (cancelled) return;
        setPages(pagesResult);

        const dest = settings?.brain_dump_destination;
        if (dest && dest.integrationId === 'notion' && dest.accountId === accountId) {
          setSelectedPageId(dest.parentPageId);
          setEnabled(true);
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : t('components.notionPagePicker.loadError'));
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  async function handleToggle(next: boolean) {
    if (next && !selectedPageId) {
      toast.message(t('settings.integrations.pickPageFirst'));
      return;
    }
    setWorking(true);
    try {
      if (next) {
        await setBrainDumpDestination({
          accountId,
          parentPageId: selectedPageId,
        });
        setEnabled(true);
        toast.success(t('settings.integrations.brainDumpRouted'));
      } else {
        await clearBrainDumpDestination();
        setEnabled(false);
        toast.success(t('settings.integrations.brainDumpRoutingDisabled'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      toast.error(t('settings.integrations.updateDestinationError', { message: isolateBidi(msg) }));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-muted-foreground" htmlFor={`notion-bd-page-${accountId}`}>
        {t('settings.integrations.brainDumpDestination')}
      </label>
      <div className="flex items-center gap-2 min-w-0">
        <Select
          value={selectedPageId || undefined}
          onValueChange={setSelectedPageId}
          disabled={enabled || working || !pages || pages.length === 0}
        >
          <SelectTrigger className="flex-1 min-w-0 h-8 text-xs">
            <SelectValue placeholder={pages === null ? t('settings.integrations.loadingPages') : pages?.length === 0 ? t('settings.integrations.noAccessiblePages') : t('settings.integrations.selectPage')} />
          </SelectTrigger>
          <SelectContent>
            {pages?.map((page) => (
              <SelectItem key={page.id} value={page.id} className="text-xs">
                <bdi dir="auto">{page.title || t('settings.integrations.untitled')}</bdi>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={working || !selectedPageId}
          aria-label={t('settings.integrations.autoRouteAria')}
        />
      </div>
      {loadError && <p dir="auto" className="text-caption text-destructive">{loadError}</p>}
      <p className="text-caption text-muted-foreground leading-tight">
        {t('settings.integrations.brainDumpRouteHint')}
      </p>
    </div>
  );
}
