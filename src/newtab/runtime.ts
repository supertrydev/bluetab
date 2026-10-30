import type { Settings, TabGroup } from '@/types/models';

type NewTabSettings = Pick<Settings, 'customNewTabEnabled' | 'theme' | 'language' | 'timeFormat'>;

const DEFAULT_NEW_TAB_SETTINGS: NewTabSettings = {
  customNewTabEnabled: false,
  theme: 'system',
  language: 'system',
  timeFormat: 'system',
};

export async function getLocalStorageValue<T>(key: string): Promise<T | null> {
  try {
    const result = await chrome.storage.local.get(key) as Record<string, T | undefined>;
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      return result[key] ?? null;
    }
  } catch (error) {
    console.error(`[BlueTab][newtab] Failed to read "${key}" from local storage:`, error);
  }

  return null;
}

export async function loadNewTabSettings(): Promise<NewTabSettings> {
  const stored = await getLocalStorageValue<Partial<Settings>>('settings');
  return {
    ...DEFAULT_NEW_TAB_SETTINGS,
    ...(stored ?? {}),
  };
}

export async function loadNewTabGroups(): Promise<TabGroup[]> {
  return (await getLocalStorageValue<TabGroup[]>('groups')) ?? [];
}

export function applyNewTabTheme(theme: Settings['theme'] | undefined): void {
  const nextTheme = theme ?? DEFAULT_NEW_TAB_SETTINGS.theme;

  if (nextTheme === 'dark') {
    document.documentElement.classList.add('dark');
    return;
  }

  if (nextTheme === 'light') {
    document.documentElement.classList.remove('dark');
    return;
  }

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', prefersDark);
}
