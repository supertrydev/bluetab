// Clean up URL bar appearance
window.addEventListener('load', () => {
  // Use History API to replace the URL with a cleaner version
  if (window.history && window.history.replaceState) {
    // Replace with a simple path without query params
    window.history.replaceState({}, '', window.location.pathname.split('/').pop() || 'newtab-app.html');
  }

  // Focus on page content immediately
  setTimeout(() => {
    document.body.focus();
    document.body.click();
  }, 100);
});
