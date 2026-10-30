import { getLocalStorageValue } from './runtime';

type NewTabTextSize = 'small' | 'medium' | 'large';

interface NewTabTextSizeSettings {
  textSize?: unknown;
}

const STORAGE_KEY = 'bluetab_text_size_settings';
const CSS_PROPERTY = '--text-scale-factor';
const DEFAULT_TEXT_SIZE: NewTabTextSize = 'medium';
const TEXT_SIZE_VALUES: Record<NewTabTextSize, string> = {
  small: '0.875',
  medium: '1',
  large: '1.125',
};

function isValidTextSize(value: unknown): value is NewTabTextSize {
  return value === 'small' || value === 'medium' || value === 'large';
}

function applyTextSize(size: NewTabTextSize): void {
  document.documentElement.style.setProperty(CSS_PROPERTY, TEXT_SIZE_VALUES[size]);
}

async function getSyncStorageValue<T>(key: string): Promise<T | null> {
  try {
    const result = await chrome.storage.sync.get(key) as Record<string, T | undefined>;
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      return result[key] ?? null;
    }
  } catch {
    // Local fallback is enough for new tab bootstrap.
  }

  return null;
}

export async function initializeNewTabTextSize(): Promise<void> {
  const localSettings = await getLocalStorageValue<NewTabTextSizeSettings>(STORAGE_KEY);
  if (isValidTextSize(localSettings?.textSize)) {
    applyTextSize(localSettings.textSize);
    return;
  }

  const syncSettings = await getSyncStorageValue<NewTabTextSizeSettings>(STORAGE_KEY);
  if (isValidTextSize(syncSettings?.textSize)) {
    applyTextSize(syncSettings.textSize);
    return;
  }

  applyTextSize(DEFAULT_TEXT_SIZE);
}
