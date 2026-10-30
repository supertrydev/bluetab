import { Storage } from '@/utils/storage';
import type { Settings } from '@/types/models';

export const FLOATING_BUTTON_CONTENT_SCRIPT_ID = 'bluetab-floating-button';
export const FLOATING_BUTTON_HOST_ORIGINS = ['http://*/*', 'https://*/*'] as const;

type FloatingButtonRegistrationState = {
  enabled: boolean;
  hasHostAccess: boolean;
  registered: boolean;
};

function isInjectableFloatingButtonUrl(url?: string): boolean {
  return Boolean(url && (url.startsWith('http://') || url.startsWith('https://')));
}

function getHostOrigins(): string[] {
  return [...FLOATING_BUTTON_HOST_ORIGINS];
}

export async function hasFloatingButtonHostAccess(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    return false;
  }
  return chrome.permissions.contains({ origins: getHostOrigins() });
}

export async function requestFloatingButtonHostAccess(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) {
    return false;
  }
  return chrome.permissions.request({ origins: getHostOrigins() });
}

async function isFloatingButtonRegistered(): Promise<boolean> {
  if (!chrome.scripting?.getRegisteredContentScripts) return false;
  const scripts = await chrome.scripting.getRegisteredContentScripts({
    ids: [FLOATING_BUTTON_CONTENT_SCRIPT_ID],
  });
  return scripts.length > 0;
}

export async function unregisterFloatingButtonContentScript(): Promise<void> {
  if (!chrome.scripting?.unregisterContentScripts) return;
  await chrome.scripting.unregisterContentScripts({
    ids: [FLOATING_BUTTON_CONTENT_SCRIPT_ID],
  });
}

async function syncFloatingButtonIntoOpenTabs(): Promise<void> {
  if (!chrome.tabs?.query || !chrome.scripting?.executeScript) return;

  const tabs = await chrome.tabs.query({});
  const injectableTabs = tabs.filter((tab) => {
    if (typeof tab.id !== 'number') return false;
    return isInjectableFloatingButtonUrl(tab.url ?? tab.pendingUrl);
  });

  await Promise.allSettled(
    injectableTabs.map((tab) =>
      chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        files: ['src/content/floating-button.js'],
      }),
    ),
  );
}

export async function ensureFloatingButtonContentScript(
  settings?: Pick<Settings, 'floatingButtonEnabled'> | null,
): Promise<FloatingButtonRegistrationState> {
  const effectiveSettings = settings ?? await Storage.getSettings();
  const enabled = effectiveSettings.floatingButtonEnabled ?? true;
  const hasHostAccess = await hasFloatingButtonHostAccess();
  const registered = await isFloatingButtonRegistered();

  if (!enabled || !hasHostAccess) {
    if (registered) {
      await unregisterFloatingButtonContentScript();
    }
    return { enabled, hasHostAccess, registered: false };
  }

  if (!registered) {
    await chrome.scripting.registerContentScripts([
      {
        id: FLOATING_BUTTON_CONTENT_SCRIPT_ID,
        matches: getHostOrigins(),
        js: ['src/content/floating-button.js'],
        runAt: 'document_idle',
        allFrames: false,
      },
    ]);
  }

  await syncFloatingButtonIntoOpenTabs();

  return { enabled, hasHostAccess, registered: true };
}
