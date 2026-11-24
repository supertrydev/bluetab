import { useState, useEffect } from 'react';
import { Sun, Moon, Palette } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { ThemeManager, type Theme } from '@/utils/theme';
import { Storage } from '@/utils/storage';
import { ToastManager } from '@/components/Toast';
import type { Settings } from '@/types/models';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';

export interface ThemeSettingsProps {
    settings: Settings;
    onSettingsChange: (updated: Settings) => void;
}

export function ThemeSettings({ settings, onSettingsChange }: ThemeSettingsProps) {
    const { t } = useTranslation();
    const [isDarkMode, setIsDarkMode] = useState(false);

    useEffect(() => {
        const currentTheme = settings.theme;
        if (currentTheme === 'dark') {
            setIsDarkMode(true);
        } else if (currentTheme === 'light') {
            setIsDarkMode(false);
        } else {
            setIsDarkMode(window.matchMedia('(prefers-color-scheme: dark)').matches);
        }
    }, [settings.theme]);

    const handleThemeToggle = async (checked: boolean) => {
        try {
            const newTheme: Theme = checked ? 'dark' : 'light';
            const updatedSettings = { ...settings, theme: newTheme };
            await Storage.set('settings', updatedSettings);
            onSettingsChange(updatedSettings);
            setIsDarkMode(checked);
            ThemeManager.applyTheme(newTheme);
        } catch (error) {
            ToastManager.getInstance().error(t('settings.theme.saveFailed', {
                message: isolateBidi((error as Error).message),
            }));
        }
    };

    return (
        <div>
            <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                <Palette className="w-5 h-5" />
                {t('settingsTabs.appearance')}
            </h3>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Palette className="h-4 w-4 text-text-muted" />
                        <span className="text-base font-medium text-text-strong">
                            {t('settings.theme.label')}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-text-muted">
                            {isDarkMode ? t('common.dark') : t('common.light')}
                        </span>
                        <Switch
                            checked={isDarkMode}
                            onCheckedChange={handleThemeToggle}
                            aria-label={t('settings.theme.toggleAria')}
                        />
                        {isDarkMode ? (
                            <Moon className="h-4 w-4 text-text-muted" />
                        ) : (
                            <Sun className="h-4 w-4 text-text-muted" />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
