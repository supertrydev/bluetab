import type { Settings } from '../types/models';
import { Storage } from './storage';

export type Theme = 'light' | 'dark' | 'system';

export class ThemeManager {
    private static mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    static applyTheme(theme: Theme) {
        const isDark = this.isDarkMode(theme);

        if (isDark) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }

    static isDarkMode(theme: Theme): boolean {
        switch (theme) {
            case 'dark':
                return true;
            case 'light':
                return false;
            case 'system':
                return this.mediaQuery.matches;
            default:
                return false;
        }
    }

    static async getCurrentTheme(): Promise<Theme> {
        const settings = await Storage.get<Settings>('settings');
        return settings?.theme || 'system';
    }

    static async initializeTheme(settings?: Settings) {
        const theme = settings?.theme || await this.getCurrentTheme();
        this.applyTheme(theme);

        // Listen for system theme changes
        this.mediaQuery.addEventListener('change', () => {
            this.getCurrentTheme().then(currentTheme => {
                if (currentTheme === 'system') {
                    this.applyTheme('system');
                }
            });
        });
    }
}

export default ThemeManager;