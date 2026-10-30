// Apply theme immediately to prevent flash
(async function() {
    try {
        const result = await chrome.storage.local.get(['settings']);
        const theme = result.settings?.theme || 'system';
        const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (isDark) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    } catch (error) {
        // Fallback to system preference
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark');
        }
    }
})();