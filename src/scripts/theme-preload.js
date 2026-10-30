// Synchronous theme preload — runs before any content renders to prevent dark mode flash.
// Uses sessionStorage for instant access (kept in sync by ThemeManager at runtime).
;(function() {
  try {
    var theme = sessionStorage.getItem('bluetab-theme');
    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch(e) {}
})();
