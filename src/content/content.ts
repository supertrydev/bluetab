// Enhanced metadata extraction for better tab information
function getEnhancedTitle(): string {
    const titleElement = document.querySelector('title');
    const h1Element = document.querySelector('h1');
    const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');

    return metaTitle || titleElement?.textContent || h1Element?.textContent || document.title;
}

function getEnhancedFavicon(): string | null {
    const iconLink = document.querySelector('link[rel*="icon"]') as HTMLLinkElement;
    if (iconLink) {
        return new URL(iconLink.href, window.location.href).href;
    }
    return null;
}

// Send enhanced metadata to background script if needed
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'getEnhancedMetadata') {
        sendResponse({
            title: getEnhancedTitle(),
            favicon: getEnhancedFavicon()
        });
    }
});
