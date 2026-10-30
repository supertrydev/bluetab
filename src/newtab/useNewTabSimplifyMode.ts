import { useEffect } from 'react';
import { getLocalStorageValue } from './runtime';

interface NewTabSimplifySettings {
  masterEnabled?: boolean;
  simplify?: {
    enabled?: boolean;
    aggressive?: boolean;
  };
}

function applySimplifyAttributes(settings: NewTabSimplifySettings | null): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  if (!root) {
    return;
  }

  const simplifyEnabled = Boolean(settings?.masterEnabled && settings?.simplify?.enabled);
  const aggressiveEnabled = Boolean(simplifyEnabled && settings?.simplify?.aggressive);

  if (simplifyEnabled) {
    root.setAttribute('data-simplify', 'true');
  } else {
    root.removeAttribute('data-simplify');
  }

  if (aggressiveEnabled) {
    root.setAttribute('data-simplify-aggressive', 'true');
  } else {
    root.removeAttribute('data-simplify-aggressive');
  }
}

export function useNewTabSimplifyMode(): void {
  useEffect(() => {
    let cancelled = false;

    void getLocalStorageValue<NewTabSimplifySettings>('adhd_settings')
      .then((settings) => {
        if (!cancelled) {
          applySimplifyAttributes(settings);
        }
      })
      .catch((error) => {
        console.error('[BlueTab][newtab] Failed to load simplify settings:', error);
      });

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes.adhd_settings) {
        return;
      }

      applySimplifyAttributes((changes.adhd_settings.newValue as NewTabSimplifySettings | undefined) ?? null);
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);
}
