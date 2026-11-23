import { t } from '@/i18n';

declare const __BLUETAB_BROWSER__: string | undefined;

/** Display the save result immediately, then amend that notification in place. */
export async function showSaveNotification(message: string, freedMemory?: Promise<number | null>): Promise<void> {
  const id = `saved-tabs-${crypto.randomUUID()}`;
  await chrome.notifications.create(id, {
    type: 'basic', iconUrl: 'src/assets/icon48.png', title: t('notifications.appTitle'), message,
  });
  // Firefox has no notifications.update (and never measures memory); dropped from that build.
  if (typeof __BLUETAB_BROWSER__ !== 'undefined' && __BLUETAB_BROWSER__ === 'firefox') return;
  if (freedMemory) {
    void freedMemory.then(async mb => {
      if (mb !== null) await chrome.notifications.update(id, {
        message: message + t('notifications.memoryFreed', { mb }),
      });
    }).catch(() => {});
  }
}
