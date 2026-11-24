import { useCallback } from 'react';
import { ToastManager } from '@/components/Toast';
import { isolateBidi } from '@/i18n/bidi';
import { Storage } from '@/utils/storage';
import type { Settings } from '@/types/models';

export interface SettingsSectionProps {
    settings: Settings;
    onSettingsChange: (updated: Settings) => void;
}

/**
 * Every section writes to the same `settings` storage key, which is the one
 * backup and sync carry, so moving a setting between sections never moves data.
 */
export function useSettingsUpdater({ settings, onSettingsChange }: SettingsSectionProps) {
    /** Saves the settings and reports whether that worked. */
    const saveSettings = useCallback(async (updatedSettings: Settings): Promise<boolean> => {
        try {
            await Storage.set('settings', updatedSettings);
            onSettingsChange(updatedSettings);
            return true;
        } catch (error) {
            ToastManager.getInstance().error({
                key: 'feedback.settingSaveFailed',
                values: { message: isolateBidi((error as Error).message) },
            });
            return false;
        }
    }, [onSettingsChange]);

    const updateSetting = useCallback(async <K extends keyof Settings>(
        key: K,
        value: Settings[K],
        successMsg?: string,
    ): Promise<void> => {
        const saved = await saveSettings({ ...settings, [key]: value });
        if (saved && successMsg) ToastManager.getInstance().success(successMsg);
    }, [saveSettings, settings]);

    return { saveSettings, updateSetting };
}
