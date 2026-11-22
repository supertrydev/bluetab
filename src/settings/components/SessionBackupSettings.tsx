/**
 * @module settings/components/SessionBackupSettings
 *
 * WHY:  Users need to configure automatic session backup: enable/disable,
 *       choose frequency, view backup history, and restore from snapshots.
 *       Without this UI, the backup service would run with no user control
 *       or visibility.
 *
 * WHAT: Settings section with enable/disable toggle, frequency selector
 *       (hourly/daily/weekly/monthly), "Last backup" indicator, and scrollable
 *       backup history with restore buttons.
 *
 * HOW:  - BackupService.getSettings() and BackupService.listSnapshots() on mount
 *       - Toggle calls BackupService.enable() or BackupService.disable()
 *       - Frequency buttons call BackupService.setFrequency(freq)
 *       - Restore button opens RestoreBackupDialog
 *       - Listens to chrome.storage.onChanged for 'backupSettings' and
 *         'sessionBackups' keys for reactive updates
 *       - Automatic backup is enabled monthly by default
 *
 * NOT:  Does not perform backups -- that is BackupService + service-worker.ts.
 *       Does not handle group creation from restore -- BackupService returns data.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';
import { HardDrive, RotateCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { formatCompactPastTime, formatDateTime, formatNumber } from '@/i18n/format';
import { BackupService, DEFAULT_BACKUP_SETTINGS } from '@/services/backup-service';
import { RestoreBackupDialog } from '@/components/RestoreBackupDialog';
import { ToastManager } from '@/components/Toast';
import type { BackupSnapshot, BackupSettings } from '@/types/productivity';

type Frequency = BackupSettings['frequency'];

const FREQUENCY_OPTIONS: Frequency[] = ['hourly', 'daily', 'weekly', 'monthly'];

function formatSnapshotDate(timestamp: number): string {
  return formatDateTime(timestamp, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)}B`;
  const kb = Math.round(bytes / 1024);
  return `${formatNumber(kb)}KB`;
}

export function SessionBackupSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<BackupSettings>(DEFAULT_BACKUP_SETTINGS);
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<BackupSnapshot | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const [, refreshRelativeTime] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => refreshRelativeTime(value => value + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      const backupSettings = await BackupService.getSettings();
      setSettings(backupSettings);

      const snaps = await BackupService.listSnapshots();
      setSnapshots(snaps);
    };
    loadData();
  }, []);

  // Listen for storage changes
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.backupSettings) {
        setSettings(
          changes.backupSettings.newValue || DEFAULT_BACKUP_SETTINGS,
        );
      }
      if (changes.sessionBackups) {
        const snaps: BackupSnapshot[] = changes.sessionBackups.newValue || [];
        setSnapshots(snaps.sort((a, b) => b.timestamp - a.timestamp));
      }
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  const handleToggle = async (enabled: boolean) => {
    setIsToggling(true);
    try {
      if (enabled) {
        await BackupService.enable();
        ToastManager.getInstance().success(t('settings.sessionBackup.enabledToast'));
      } else {
        await BackupService.disable();
        ToastManager.getInstance().success(t('settings.sessionBackup.disabledToast'));
      }
    } catch {
      ToastManager.getInstance().error(t('settings.sessionBackup.toggleError'));
    } finally {
      setIsToggling(false);
    }
  };

  const handleFrequencyChange = async (freq: Frequency) => {
    try {
      await BackupService.setFrequency(freq);
      ToastManager.getInstance().success(
        t('settings.sessionBackup.frequencyToast', {
          frequency: t(`settings.sessionBackup.frequencies.${freq}`),
        }),
      );
    } catch {
      ToastManager.getInstance().error(t('settings.sessionBackup.frequencyError'));
    }
  };

  const lastBackup = snapshots.length > 0 ? snapshots[0] : null;

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
        <HardDrive className="w-5 h-5" />
        {t('settings.sessionBackup.title')}
      </h3>

      <div className="space-y-6">
        {/* Enable Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <label
              htmlFor="backup-toggle"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('settings.sessionBackup.enableTitle')}
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('settings.sessionBackup.enableDescription')}
            </p>
          </div>
          <Switch
            id="backup-toggle"
            checked={settings.enabled}
            onCheckedChange={handleToggle}
            disabled={isToggling}
          />
        </div>

        {/* Frequency Selector */}
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
            {t('settings.sessionBackup.frequency')}
          </label>
          <div className="flex flex-wrap gap-2">
            {FREQUENCY_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => handleFrequencyChange(opt)}
                disabled={!settings.enabled}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  settings.frequency === opt
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {t(`settings.sessionBackup.frequencies.${opt}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Last Backup Indicator */}
        {lastBackup ? (
          <div className="text-sm text-muted-foreground">
            {t('settings.sessionBackup.lastBackup', {
              time: isolateBidi(formatCompactPastTime(lastBackup.timestamp), 'ltr'),
            })}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">{t('settings.sessionBackup.noBackupYet')}</div>
        )}

        {/* Backup History */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('settings.sessionBackup.history')}
          </h4>

          {snapshots.length === 0 ? (
            <div className="p-4 border border-border rounded-lg text-center">
              <p className="text-sm text-muted-foreground">
                {settings.enabled
                  ? t('settings.sessionBackup.emptyEnabled')
                  : t('settings.sessionBackup.emptyDisabled')}
              </p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
              {snapshots.map((snapshot) => (
                <div
                  key={snapshot.id}
                  className="flex items-center justify-between px-3 py-2.5 text-sm"
                >
                  <div className="flex flex-col min-w-0 flex-1 me-3">
                    <time dir="ltr" className="text-foreground">
                      {formatSnapshotDate(snapshot.timestamp)}
                    </time>
                    <span dir="ltr" className="text-xs text-muted-foreground">
                      {t('settings.sessionBackup.tabs', { count: snapshot.totalTabs })},{' '}
                      {t('settings.sessionBackup.groups', { count: snapshot.totalGroups })}{' '}
                      ({formatBytes(snapshot.sizeBytes)})
                    </span>
                  </div>
                  <button
                    onClick={() => setRestoreTarget(snapshot)}
                    className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                  >
                    <RotateCw className="w-3 h-3" />
                    {t('common.restore')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Restore Dialog */}
      <RestoreBackupDialog
        open={!!restoreTarget}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        snapshot={restoreTarget}
      />
    </div>
  );
}
