export interface SupportSettings {
  showDiagnostics: boolean;
}

export const SUPPORT_SETTINGS_KEY = 'support_settings';
export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  showDiagnostics: false,
};

export async function getSupportSettings(): Promise<SupportSettings> {
  try {
    const result = await chrome.storage.local.get(SUPPORT_SETTINGS_KEY);
    return {
      ...DEFAULT_SUPPORT_SETTINGS,
      ...(result[SUPPORT_SETTINGS_KEY] as Partial<SupportSettings> | undefined),
    };
  } catch {
    return DEFAULT_SUPPORT_SETTINGS;
  }
}

export async function shouldShowDiagnostics(): Promise<boolean> {
  const settings = await getSupportSettings();
  return settings.showDiagnostics;
}
