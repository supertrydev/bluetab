/**
 * @module settings/components/StatsSettings
 *
 * WHY:  Privacy-conscious users need a way to opt out of browser usage
 *       tracking without losing other BlueTab features.
 *
 * WHAT: Settings section with a single toggle for browser usage tracking.
 *       When tracking is off, StatsService skips recording tab events.
 *
 * HOW:  Loads current opt-out state from StatsService on mount,
 *       toggles immediately on click, persists via StatsService.setOptOut.
 *
 * NOT:  Does not clear existing data on opt-out — only stops new recording.
 *       Does not render the statistics dashboard — that is StatsDashboard.
 */

import { useState, useEffect } from 'react';
import { BarChart2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { StatsService } from '@/services/stats-service';
import { useTranslation } from 'react-i18next';

export function StatsSettings() {
  const { t } = useTranslation();
  const [optOut, setOptOut] = useState(false);

  useEffect(() => {
    StatsService.isOptedOut().then(setOptOut);
  }, []);

  const handleToggle = async () => {
    const newValue = !optOut;
    setOptOut(newValue);
    await StatsService.setOptOut(newValue);
  };

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
        <BarChart2 className="w-5 h-5" />
        {t('settings.stats.title')}
      </h3>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-text-strong">
            {t('settings.stats.trackingLabel')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('settings.stats.trackingDescription')}
          </p>
        </div>
        <Switch checked={!optOut} onCheckedChange={handleToggle} aria-label={t('settings.stats.trackingAria')} />
      </div>
    </div>
  );
}
