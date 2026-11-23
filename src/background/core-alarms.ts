import { ALARM_NAMES } from '../config/alarms';
import { ADHDService } from '../services/adhd-service';
import { AuthService } from '../services/auth-service';
import { BluetBridgeService } from '../services/bluet-bridge-service';
import { Storage } from '../utils/storage';
import type { Settings } from '../types/models';
import { RSS_STORAGE_KEYS, type RSSFeed } from '../types/rss';
import { ADHD_SETTINGS_STORAGE_KEY } from '../types/adhd';
import { config } from '../config/config';

async function reconcile(): Promise<void> {
  const [autoSuspend, signedIn, connected, feeds, settings] = await Promise.all([
    ADHDService.isFeatureActive('autoSuspend'),
    AuthService.isLoggedIn(),
    BluetBridgeService.isConnected(),
    Storage.get<RSSFeed[]>(RSS_STORAGE_KEYS.FEEDS),
    Storage.get<Settings>('settings'),
  ]);
  const alarms: [string, boolean, chrome.alarms.AlarmCreateInfo][] = [
    [ALARM_NAMES.ADHD_AUTOSUSPEND_SCAN, autoSuspend, { periodInMinutes: 1, delayInMinutes: 1 }],
    [ALARM_NAMES.RSS_REFRESH, Array.isArray(feeds) && feeds.length > 0, { periodInMinutes: 15, delayInMinutes: 1 }],
    [ALARM_NAMES.AUTH_REFRESH, signedIn, { periodInMinutes: 30 }],
    [ALARM_NAMES.SUBSCRIPTION_CHECK, signedIn, { periodInMinutes: 60 }],
    [ALARM_NAMES.BLUET_BRIDGE_HEARTBEAT, connected, { periodInMinutes: 360 }],
    [ALARM_NAMES.GROUP_AUTO_ARCHIVE_SCAN, settings?.autoArchiveInactiveGroups === true, { periodInMinutes: 60, delayInMinutes: 5 }],
    [ALARM_NAMES.V3_KILL_SWITCH_REFRESH, true, { periodInMinutes: 240 }],
  ];
  const results = await Promise.allSettled(alarms.map(async ([name, needed, info]) => {
    if (!needed) {
      await chrome.alarms.clear(name);
    } else if (!await chrome.alarms.get(name)) {
      await chrome.alarms.create(name, info);
    }
  }));
  // A rejected sibling must not let the queue overtake an unfinished write.
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

// Read each snapshot after the preceding reconciliation finishes. Rapid setting
// changes must never leave an older asynchronous create() as the last writer.
let pending = Promise.resolve();
export function ensureCoreAlarms(): Promise<void> {
  pending = pending.catch(() => {}).then(reconcile);
  return pending;
}

const SOURCE_KEYS = new Set([
  ADHD_SETTINGS_STORAGE_KEY, 'settings', RSS_STORAGE_KEYS.FEEDS,
  config.storage.keys.authToken, config.storage.keys.refreshToken, 'bluet_bridge',
]);

export function watchCoreAlarmChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.keys(changes).some((key) => SOURCE_KEYS.has(key))) return;
    return ensureCoreAlarms().catch((error) => {
      console.warn('[BlueTab][Alarms] Reconciliation failed:', error);
    });
  });
}
