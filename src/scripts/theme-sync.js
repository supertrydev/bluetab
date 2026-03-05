// Theme initialization script - runs before page render to prevent flash
// This must be loaded as a module to comply with Chrome Extension CSP
(function () {
    try {
        chrome.storage.sync.get(['theme'], function (result) {
            if (result.theme === 'dark') {
                document.documentElement.classList.add('dark');
            } else if (result.theme === 'light') {
                document.documentElement.classList.remove('dark');
            } else {
                // System preference
                if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                    document.documentElement.classList.add('dark');
                }
            }
        });
    } catch (e) {
        console.error('Failed to load theme:', e);
    }
})();
