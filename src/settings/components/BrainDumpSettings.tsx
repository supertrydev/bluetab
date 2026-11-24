/**
 * @module settings/components/BrainDumpSettings
 *
 * WHY: Brain Dump graduated from an ADHD Mode sub-toggle into a first-class
 *      capture surface. This settings section owns the feature gate and the
 *      modal's default attach behavior.
 */

import { useCallback, useEffect, useState } from 'react';
import { StickyNote } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { BrainDumpService } from '@/services/brain-dump-service';
import { BRAIN_DUMP_PREFS_KEY, type BrainDumpPrefs } from '@/types/adhd';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';

const DEFAULT_PREFS: BrainDumpPrefs = {
  enabled: true,
  tabContextDefault: true,
  linkedPageIndicatorEnabled: true,
};

export function BrainDumpSettings() {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<BrainDumpPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    let cancelled = false;
    BrainDumpService.getPrefs().then((current) => {
      if (!cancelled) setPrefs(current);
    });

    const unsubscribe = BrainDumpService.subscribePrefs((next) => {
      if (!cancelled) setPrefs(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const updatePrefs = useCallback(async (patch: Partial<BrainDumpPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      await BrainDumpService.setPrefs(patch);
    } catch (err) {
      setPrefs(prefs);
      console.error('[BlueTab][BrainDumpSettings] preference update error:', err);
    }
  }, [prefs]);

  const handleEnabledChange = useCallback((next: boolean) => {
    void updatePrefs({ enabled: next });
  }, [updatePrefs]);

  const handleTabContextDefaultChange = useCallback((next: boolean) => {
    void updatePrefs({ tabContextDefault: next });
  }, [updatePrefs]);

  const handleLinkedPageIndicatorChange = useCallback((next: boolean) => {
    void updatePrefs({ linkedPageIndicatorEnabled: next });
  }, [updatePrefs]);

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
        <StickyNote className="w-5 h-5" />
        {t('settings.brainDump.title')}
      </h3>

      <p className="text-sm text-muted-foreground mb-6 max-w-prose">
        {t('settings.brainDump.description')}
      </p>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="pe-4">
            <p className="text-sm font-medium text-text-strong">
              {t('settings.brainDump.enableLabel')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('settings.brainDump.enableDescription')}
            </p>
          </div>
          <Switch
            checked={prefs.enabled}
            onCheckedChange={handleEnabledChange}
            aria-label={t('settings.brainDump.enableAria')}
          />
        </div>

        <div className={`space-y-5 ${prefs.enabled ? '' : 'opacity-50'}`}>
          <div className="flex items-start justify-between">
            <div className="pe-4">
              <p className="text-sm font-medium text-text-strong">
                {t('settings.brainDump.includeActiveTabLabel')}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-prose">
                {t('settings.brainDump.includeActiveTabDescription')}
              </p>
            </div>
            <Switch
              checked={prefs.tabContextDefault}
              onCheckedChange={handleTabContextDefaultChange}
              disabled={!prefs.enabled}
              aria-label={t('settings.brainDump.includeActiveTabAria')}
            />
          </div>

          <div className="flex items-start justify-between">
            <div className="pe-4">
              <p className="text-sm font-medium text-text-strong">
                {t('settings.brainDump.highlightExactPagesLabel')}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-prose">
                {t('settings.brainDump.highlightExactPagesDescription')}
              </p>
            </div>
            <Switch
              checked={prefs.linkedPageIndicatorEnabled !== false}
              onCheckedChange={handleLinkedPageIndicatorChange}
              disabled={!prefs.enabled}
              aria-label={t('settings.brainDump.highlightExactPagesAria')}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {t('settings.brainDump.storageNote', { key: isolateBidi(BRAIN_DUMP_PREFS_KEY, 'ltr') })}
          </p>
        </div>
      </div>
    </div>
  );
}
