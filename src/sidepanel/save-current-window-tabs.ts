import { saveCurrentWindowTabs, type SaveCurrentWindowTabsOptions, type SaveCurrentWindowTabsResult } from '../services/save-current-window-tabs';
import { toast } from '@/components/Toast';
import { t } from '@/i18n';

export async function saveCurrentWindowTabsFromSidepanel(
  options: SaveCurrentWindowTabsOptions = {},
): Promise<SaveCurrentWindowTabsResult | null> {
  const result = await saveCurrentWindowTabs(options);
  if (result && result.processedCount > 0) {
    const message = t('notifications.savedTabsFallback', { count: result.processedCount });
    const id = toast.success(message);
    if (result.freedMemory && id !== undefined) {
      void result.freedMemory.then(mb => {
        if (mb !== null) toast.success(message + t('notifications.memoryFreed', { mb }), { id });
      }).catch(() => {});
    }
  }
  return result;
}
