import { useState, useEffect } from 'react';
import { ThemeManager, type Theme } from '../utils/theme';
import { Button } from '@/components/ui/button';
import { Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThemeToggleProps {
    onThemeChange?: (theme: Theme) => void;
    className?: string;
}

export function ThemeToggle({ onThemeChange, className = '' }: ThemeToggleProps) {
    const [currentTheme, setCurrentTheme] = useState<Theme>('system');
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        const loadTheme = async () => {
            const theme = await ThemeManager.getCurrentTheme();
            setCurrentTheme(theme);

            // Determine if we should show dark mode
            if (theme === 'dark') {
                setIsDark(true);
            } else if (theme === 'light') {
                setIsDark(false);
            } else {
                // System theme - check system preference
                setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
            }
        };

        loadTheme();
    }, []);

    const toggleTheme = () => {
        let newTheme: Theme;

        if (currentTheme === 'system') {
            // If system, toggle to opposite of current appearance
            newTheme = isDark ? 'light' : 'dark';
        } else if (currentTheme === 'light') {
            newTheme = 'dark';
        } else {
            newTheme = 'light';
        }

        setCurrentTheme(newTheme);
        setIsDark(newTheme === 'dark');
        ThemeManager.applyTheme(newTheme);
        onThemeChange?.(newTheme);
    };

    return (
        <Button
            variant="secondary"
            size="icon"
            onClick={toggleTheme}
            className={cn(
                'relative border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700',
                className
            )}
            aria-label="Toggle theme"
            title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
            <Sun className={cn(
                'h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all text-gray-900 dark:text-gray-100',
                isDark && '-rotate-90 scale-0'
            )} />
            <Moon className={cn(
                'absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all text-gray-900 dark:text-gray-100',
                isDark && 'rotate-0 scale-100'
            )} />
        </Button>
    );
}

export default ThemeToggle;
