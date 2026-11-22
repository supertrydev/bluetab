/**
 * @module components/RestoreBackupDialog
 *
 * WHY:  When restoring a backup, users need to choose how they want the
 *       tabs restored: as a Bluetab group (for organizing later) or in
 *       new browser windows (for immediate use). This dialog provides
 *       that choice with clear descriptions of each option.
 *
 * WHAT: Radix Dialog with two option cards for restore mode selection.
 *       Shows backup metadata (date, tab count, window count) and calls
 *       BackupService.restore with the chosen mode.
 *
 * HOW:  - "Save as Bluetab Group" calls BackupService.restore(id, 'group')
 *       - "Open in New Window" calls BackupService.restore(id, 'window')
 *       - Shows loading spinner during restore, success toast on complete
 *       - Dialog closes automatically after restore
 *
 * NOT:  Does not list backups -- that is SessionBackupSettings.tsx.
 *       Saved data is restored by BackupService; this dialog converts the
 *       browser windows into saved groups when group mode is selected.
 */

import { Storage } from '@/utils/storage';
import type { TabGroup } from '@/types/models';
import { useState } from 'react';
import { FolderPlus, ExternalLink, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { BackupService } from '@/services/backup-service';
import { ToastManager } from '@/components/Toast';
import { formatDateTime } from '@/i18n/format';
import { isolateBidi } from '@/i18n/bidi';
import type { BackupSnapshot } from '@/types/productivity';

export interface RestoreBackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: BackupSnapshot | null;
}

export function RestoreBackupDialog({
  open,
  onOpenChange,
  snapshot,
}: RestoreBackupDialogProps) {
  const { t } = useTranslation();
  const [isRestoring, setIsRestoring] = useState(false);

  if (!snapshot) return null;

  const handleRestore = async (mode: 'group' | 'window') => {
    if (isRestoring) return;
    setIsRestoring(true);

    try {
      const restored = await BackupService.restore(snapshot.id, mode);
      if (mode === 'group' && restored) {
        const now = Date.now();
        const groups: TabGroup[] = restored.windows.filter(win => win.tabs.length > 0).map(win => {
          const id = crypto.randomUUID();
          return {
            id,
            name: `${t('settings.sessionBackup.title')} — ${formatDateTime(restored.timestamp)}`,
            created: now,
            modified: now,
            tabs: win.tabs.map(tab => ({
              id: crypto.randomUUID(), groupId: id, url: tab.url, title: tab.title,
              favicon: tab.favicon, pinned: tab.pinned, timestamp: now,
            })),
          };
        });
        if (groups.length > 0) await Storage.atomicUpdate<TabGroup[]>('groups', current => [...(current || []), ...groups], []);
      }
      const actionLabel =
        mode === 'group'
          ? t('dialogs.restoreBackup.savedAsGroup')
          : t('dialogs.restoreBackup.openedInWindows');
      ToastManager.getInstance().success(actionLabel);
      onOpenChange(false);
    } catch (error) {
      ToastManager.getInstance().error(
        (error as Error).message || t('dialogs.restoreBackup.restoreFailed'),
      );
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dialogs.restoreBackup.title')}</DialogTitle>
          <DialogDescription>
            {t('dialogs.restoreBackup.description', {
              count: snapshot.windows.length,
              date: isolateBidi(formatDateTime(snapshot.timestamp), 'ltr'),
              tabs: t('common.tabsCount', { count: snapshot.totalTabs }),
            })}
          </DialogDescription>
        </DialogHeader>
        {snapshot.savedData && <p className="text-sm text-muted-foreground">{t('dataSafety.restoreSavedData')}</p>}

        {isRestoring ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="ms-2 text-sm text-muted-foreground">
              {t('dialogs.restoreBackup.restoring')}
            </span>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <button
              onClick={() => handleRestore('group')}
              className="w-full flex items-start gap-3 p-4 border border-border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-start"
            >
              <FolderPlus className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-foreground">
                  {t('dialogs.restoreBackup.saveAsGroupTitle')}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('dialogs.restoreBackup.saveAsGroupDescription')}
                </p>
              </div>
            </button>

            <button
              onClick={() => handleRestore('window')}
              className="w-full flex items-start gap-3 p-4 border border-border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-start"
            >
              <ExternalLink className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-foreground">
                  {t('dialogs.restoreBackup.openInWindowTitle')}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('dialogs.restoreBackup.openInWindowDescription')}
                </p>
              </div>
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
