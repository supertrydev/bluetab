/**
 * BlueTab Floating Button
 * A floating save button that appears on web pages for quick tab saving
 */
//
// IMPORTANT: keep this content script self-contained.
// When it grows top-level imports, the build can emit module imports and the
// registered content script may stop booting on pages where Chrome expects a
// plain injected script.

interface FloatingButtonSettings {
    enabled: boolean;
    position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
    confirmSaveAll: boolean;
    canSummarizePageToDump: boolean;
    hasRelatedDump: boolean;
    language: string;
    direction: 'ltr' | 'rtl';
    titles: FloatingButtonTitles;
}

interface FloatingButtonTitles {
    saveThisTab: string;
    matchingDump: string;
    saveTabsLeft: string;
    summarizePage: string;
    saveAllOtherTabs: string;
    saveTabsRight: string;
    hide: string;
    relatedDumpBubble: string;
    relatedDumpMore: string;
    relatedDumpOpen: string;
    summarizeProblem: string;
}

// Module-level flag: when user clicks dismiss, hide for current page session.
// On actual page navigation the content script re-runs and resets this to false.
let isHiddenByUser = false;

// Store shadow root reference since mode: 'closed' makes host.shadowRoot null
let closedShadowRoot: ShadowRoot | null = null;
let currentMainButton: HTMLButtonElement | null = null;
let currentObservedUrl = location.href;
let locationObserversInitialized = false;
let siteMatchRequestVersion = 0;
const EMPTY_BUTTON_TITLES: FloatingButtonTitles = {
    saveThisTab: '',
    matchingDump: '',
    saveTabsLeft: '',
    summarizePage: '',
    saveAllOtherTabs: '',
    saveTabsRight: '',
    hide: '',
    relatedDumpBubble: '',
    relatedDumpMore: '',
    relatedDumpOpen: '',
    summarizeProblem: '',
};
let currentButtonTitles = EMPTY_BUTTON_TITLES;
const MATCHING_DUMP_CLASS = 'bluetab-fab-main-has-related-dump';
const URL_CHANGE_EVENT = 'bluetab:floating-button-url-change';
const RELATED_DUMP_BUBBLE_MS = 6000;
const RELATED_DUMP_BUBBLE_RESUME_MS = 2000;
const SUMMARY_PROBLEM_MS = 6000;
const SUMMARY_PROBLEM_CLASS = 'bluetab-fab-problem';
let summaryProblemTimer: number | null = null;
// Pages (without hash) that already showed the bubble in this page session.
const relatedDumpBubbleShownFor = new Set<string>();
let currentRelatedDumpBubble: HTMLElement | null = null;
let relatedDumpBubbleTimer: number | null = null;
let pendingBubbleVisibilityListener: (() => void) | null = null;
// Newest matching note for the current page, sent by the service worker.
let currentDumpMatch = { preview: '', count: 0 };

function rememberDumpMatch(response: { relatedDumpPreview?: unknown; relatedDumpCount?: unknown } | undefined) {
    currentDumpMatch = {
        preview: typeof response?.relatedDumpPreview === 'string' ? response.relatedDumpPreview : '',
        count: typeof response?.relatedDumpCount === 'number' ? response.relatedDumpCount : 0,
    };
}

// Prevent multiple injections
if (!(window as any).__BLUETAB_FLOATING_BUTTON_INJECTED__) {
    (window as any).__BLUETAB_FLOATING_BUTTON_INJECTED__ = true;

    // Don't inject in iframes
    if (window.self === window.top) {
        initFloatingButton();
    }
}

async function initFloatingButton() {
    // If user dismissed the button on this page, don't show it
    if (isHiddenByUser) return;

    let settings: FloatingButtonSettings;
    try {
        settings = await getSettings();
    } catch (error) {
        console.warn('[BlueTab][FloatingButton] Failed to load settings, falling back to defaults', error);
        settings = {
            enabled: true,
            position: 'bottom-right',
            confirmSaveAll: true,
                canSummarizePageToDump: false,
                hasRelatedDump: false,
                language: 'en',
                direction: 'ltr',
                titles: EMPTY_BUTTON_TITLES,
        };
    }

    if (settings.enabled) {
        // Create and inject the floating button
        createFloatingButton(settings);
    }

    // Listen for settings changes (only once, outside createFloatingButton)
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'FLOATING_BUTTON_SETTINGS_CHANGED') {
            void rebuildFloatingButton({
                enabled: message.settings.floatingButtonEnabled ?? true,
                position: message.settings.floatingButtonPosition || 'bottom-right',
                confirmSaveAll: message.settings.floatingButtonConfirmSaveAll ?? true,
                    canSummarizePageToDump: message.settings.canSummarizePageToDump ?? false,
                    language: message.settings.floatingButtonLanguage ?? 'en',
                    direction: message.settings.floatingButtonDirection === 'rtl' ? 'rtl' : 'ltr',
                    titles: message.settings.floatingButtonTitles ?? EMPTY_BUTTON_TITLES,
            });
            return;
        }

        if (message.type === 'FLOATING_BUTTON_URL_CHANGED') {
            rememberDumpMatch(message);
            syncObservedUrl(
                typeof message.pageUrl === 'string' ? message.pageUrl : location.href,
                typeof message.hasRelatedDump === 'boolean' ? message.hasRelatedDump : undefined,
            );
        }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || (!changes.brain_dump_inbox && !changes.brain_dump_prefs)) {
            return;
        }

        void refreshMatchingDumpState();
    });

    setupLocationObservers();
}

async function getSettings(): Promise<FloatingButtonSettings> {
    const baseSettings = await new Promise<FloatingButtonSettings>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_FLOATING_BUTTON_SETTINGS', pageUrl: location.href }, (response) => {
            if (response) {
                rememberDumpMatch(response);
                resolve({
                    enabled: response.floatingButtonEnabled ?? true,
                    position: response.floatingButtonPosition ?? 'bottom-right',
                    confirmSaveAll: response.floatingButtonConfirmSaveAll ?? true,
                        canSummarizePageToDump: response.canSummarizePageToDump ?? false,
                        hasRelatedDump: response.hasRelatedDump === true,
                        language: response.floatingButtonLanguage ?? 'en',
                        direction: response.floatingButtonDirection === 'rtl' ? 'rtl' : 'ltr',
                        titles: response.floatingButtonTitles ?? EMPTY_BUTTON_TITLES,
                });
            } else {
                resolve({
                    enabled: true,
                    position: 'bottom-right',
                    confirmSaveAll: true,
                        canSummarizePageToDump: false,
                        hasRelatedDump: false,
                        language: 'en',
                        direction: 'ltr',
                        titles: EMPTY_BUTTON_TITLES,
                });
            }
        });
    });

    return baseSettings;
}

function findFaviconHref(): string | undefined {
    const link = document.querySelector<HTMLLinkElement>(
        'link[rel~="icon"], link[rel="shortcut icon"]',
    );
    return link?.href || undefined;
}

async function requestRelatedDumpState(pageUrl: string = location.href): Promise<boolean> {
    try {
        const response = await new Promise<{ hasRelatedDump?: boolean; relatedDumpPreview?: string; relatedDumpCount?: number } | undefined>((resolve) => {
            chrome.runtime.sendMessage({ type: 'GET_FLOATING_BUTTON_SITE_MATCH', pageUrl }, resolve);
        });
        if (location.href === pageUrl) rememberDumpMatch(response);
        return response?.hasRelatedDump === true;
    } catch (error) {
        console.warn('[BlueTab][FloatingButton] Failed to resolve Brain Dump site indicator', error);
        return false;
    }
}

async function hasRelatedDumpForCurrentSite(): Promise<boolean> {
    return requestRelatedDumpState();
}

function applyMatchingDumpState(hasRelatedDump: boolean) {
    if (!currentMainButton) return;

    currentMainButton.classList.toggle(MATCHING_DUMP_CLASS, hasRelatedDump);
    currentMainButton.title = hasRelatedDump
        ? currentButtonTitles.matchingDump
        : currentButtonTitles.saveThisTab;

    if (hasRelatedDump) {
        maybeShowRelatedDumpBubble();
    } else {
        hideRelatedDumpBubble();
    }
}

/** Page key without the hash, so in-page anchors do not re-trigger the bubble. */
function getBubblePageKey(): string {
    return location.href.split('#')[0];
}

/**
 * Show the linked-note bubble once per page for a few seconds: a small card
 * next to the floating button with the newest matching note (clamped to the
 * card) and a "+N more" hint. Clicking it opens the side panel on the Dump
 * tab. Hovering pauses the timer. It waits until the tab is visible, so
 * background tabs do not flash it unseen. Text is set with textContent only.
 */
function maybeShowRelatedDumpBubble() {
    const pageKey = getBubblePageKey();
    if (relatedDumpBubbleShownFor.has(pageKey) || !currentButtonTitles.relatedDumpBubble) return;

    if (document.visibilityState !== 'visible') {
        if (pendingBubbleVisibilityListener) return;
        pendingBubbleVisibilityListener = () => {
            if (document.visibilityState !== 'visible') return;
            document.removeEventListener('visibilitychange', pendingBubbleVisibilityListener!);
            pendingBubbleVisibilityListener = null;
            if (currentMainButton?.classList.contains(MATCHING_DUMP_CLASS)) maybeShowRelatedDumpBubble();
        };
        document.addEventListener('visibilitychange', pendingBubbleVisibilityListener);
        return;
    }

    const container = closedShadowRoot?.querySelector<HTMLElement>('.bluetab-fab-container');
    if (!container || !closedShadowRoot) return;

    relatedDumpBubbleShownFor.add(pageKey);
    hideRelatedDumpBubble();

    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'bluetab-fab-bubble';
    bubble.setAttribute('aria-live', 'polite');
    bubble.title = currentButtonTitles.relatedDumpOpen;

    const label = document.createElement('span');
    label.className = 'bluetab-fab-bubble-label';
    const extra = currentDumpMatch.count > 1 && currentButtonTitles.relatedDumpMore
        ? ` \u00b7 ${currentButtonTitles.relatedDumpMore.replace('__N__', String(currentDumpMatch.count - 1))}`
        : '';
    label.textContent = `${currentButtonTitles.relatedDumpBubble}${extra}`;
    bubble.appendChild(label);

    if (currentDumpMatch.preview) {
        const text = document.createElement('span');
        text.className = 'bluetab-fab-bubble-text';
        text.dir = 'auto';
        text.textContent = currentDumpMatch.preview;
        bubble.appendChild(text);
    }

    bubble.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        hideRelatedDumpBubble();
        try {
            chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL_BRAIN_DUMP' }, () => {
                void chrome.runtime.lastError;
            });
        } catch {
            // Extension reloaded; nothing to open.
        }
    });
    bubble.addEventListener('mouseenter', () => {
        if (relatedDumpBubbleTimer !== null) {
            clearTimeout(relatedDumpBubbleTimer);
            relatedDumpBubbleTimer = null;
        }
    });
    bubble.addEventListener('mouseleave', () => {
        relatedDumpBubbleTimer = window.setTimeout(hideRelatedDumpBubble, RELATED_DUMP_BUBBLE_RESUME_MS);
    });

    // Sibling of the FAB container (not a child) so hovering it does not
    // expand the FAB; anchored to the container's current box.
    const rect = container.getBoundingClientRect();
    const position = container.dataset.position || 'bottom-right';
    bubble.style.position = 'fixed';
    if (position.startsWith('top')) bubble.style.top = `${Math.round(rect.bottom + 8)}px`;
    else bubble.style.bottom = `${Math.round(window.innerHeight - rect.top + 8)}px`;
    if (position.endsWith('left')) bubble.style.left = `${Math.round(rect.left)}px`;
    else bubble.style.right = `${Math.round(window.innerWidth - rect.right)}px`;

    closedShadowRoot.appendChild(bubble);
    currentRelatedDumpBubble = bubble;

    requestAnimationFrame(() => bubble.classList.add('visible'));
    relatedDumpBubbleTimer = window.setTimeout(hideRelatedDumpBubble, RELATED_DUMP_BUBBLE_MS);
}

function hideRelatedDumpBubble() {
    if (relatedDumpBubbleTimer !== null) {
        clearTimeout(relatedDumpBubbleTimer);
        relatedDumpBubbleTimer = null;
    }
    const bubble = currentRelatedDumpBubble;
    if (!bubble) return;
    currentRelatedDumpBubble = null;
    bubble.classList.remove('visible');
    window.setTimeout(() => bubble.remove(), 300);
}

async function refreshMatchingDumpState(pageUrl: string = location.href) {
    const requestVersion = ++siteMatchRequestVersion;
    const hasRelatedDump = await requestRelatedDumpState(pageUrl);

    if (requestVersion !== siteMatchRequestVersion) {
        return;
    }

    if (location.href !== pageUrl) {
        return;
    }

    applyMatchingDumpState(hasRelatedDump);
}

function syncObservedUrl(nextUrl: string, hasRelatedDump?: boolean) {
    const urlChanged = nextUrl !== currentObservedUrl;
    currentObservedUrl = nextUrl;

    if (typeof hasRelatedDump === 'boolean') {
        siteMatchRequestVersion += 1;
        applyMatchingDumpState(hasRelatedDump);
        return;
    }

    if (!urlChanged) {
        return;
    }

    void refreshMatchingDumpState(nextUrl);
}

async function rebuildFloatingButton(
    settings: Omit<FloatingButtonSettings, 'hasRelatedDump'>,
) {
    const existingHost = document.getElementById('bluetab-floating-button-host');
    existingHost?.remove();
    currentMainButton = null;

    if (!settings.enabled) {
        return;
    }

    createFloatingButton({
        ...settings,
        hasRelatedDump: await hasRelatedDumpForCurrentSite(),
    });
}

function handleObservedUrlChange(nextUrl: string) {
    syncObservedUrl(nextUrl);
}

function setupLocationObservers() {
    if (locationObserversInitialized) {
        return;
    }

    locationObserversInitialized = true;
    currentObservedUrl = location.href;

    const emitUrlChange = () => {
        window.dispatchEvent(new CustomEvent(URL_CHANGE_EVENT));
    };

    const originalPushState = history.pushState;
    history.pushState = function (this: History, ...args) {
        const result = originalPushState.apply(this, args as Parameters<History['pushState']>);
        emitUrlChange();
        return result;
    } as History['pushState'];

    const originalReplaceState = history.replaceState;
    history.replaceState = function (this: History, ...args) {
        const result = originalReplaceState.apply(this, args as Parameters<History['replaceState']>);
        emitUrlChange();
        return result;
    } as History['replaceState'];

    const syncFromLocation = () => {
        handleObservedUrlChange(location.href);
    };

    const navigationApi = (window as Window & {
        navigation?: { addEventListener?: (type: string, listener: EventListener) => void };
    }).navigation;

    window.addEventListener(URL_CHANGE_EVENT, syncFromLocation);
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
    navigationApi?.addEventListener?.('currententrychange', syncFromLocation as EventListener);
    window.setInterval(syncFromLocation, 750);
}

function createFloatingButton(settings: FloatingButtonSettings) {
    currentButtonTitles = settings.titles;
    // Create shadow host for style isolation
    const host = document.createElement('div');
    host.id = 'bluetab-floating-button-host';
    host.lang = settings.language;
    host.dir = settings.direction;
    const shadow = host.attachShadow({ mode: 'closed' });
    closedShadowRoot = shadow;

    // Inject styles
    const styles = document.createElement('style');
    styles.textContent = getStyles(settings.position, settings.canSummarizePageToDump);
    shadow.appendChild(styles);

    // Create container
    const container = document.createElement('div');
    container.className = 'bluetab-fab-container';
    container.dataset.position = settings.position;

    // Row for all buttons
    const row = document.createElement('div');
    row.className = 'bluetab-fab-row';

    // Left tabs button
    const leftBtn = document.createElement('button');
    leftBtn.className = 'bluetab-fab-sub bluetab-fab-sub-left';
    leftBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`;
    leftBtn.title = settings.titles.saveTabsLeft;

    // Main button wrapper (contains main btn and bottom btn)
    const mainWrapper = document.createElement('div');
    mainWrapper.className = 'bluetab-fab-main-wrapper';

    let summarizeBtn: HTMLButtonElement | null = null;
    if (settings.canSummarizePageToDump) {
        summarizeBtn = document.createElement('button');
        summarizeBtn.className = 'bluetab-fab-sub bluetab-fab-sub-top';
        summarizeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3L12 3z"/><path d="M18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/></svg>`;
        summarizeBtn.title = settings.titles.summarizePage;
    }

    // Main button
    const mainBtn = document.createElement('button');
    mainBtn.className = 'bluetab-fab-main';
    const iconImg = document.createElement('img');
    iconImg.src = chrome.runtime.getURL('src/assets/icon48.png');
    iconImg.alt = 'Bluetab';
    mainBtn.appendChild(iconImg);
    currentMainButton = mainBtn;
    applyMatchingDumpState(settings.hasRelatedDump);

    // Progress ring for long press
    const progressRing = document.createElement('div');
    progressRing.className = 'bluetab-fab-progress';
    progressRing.innerHTML = '<div class="bluetab-fab-progress-ring"></div>';
    mainBtn.appendChild(progressRing);

    // All other tabs button (below main button)
    const allOtherBtn = document.createElement('button');
    allOtherBtn.className = 'bluetab-fab-sub bluetab-fab-sub-bottom';
    allOtherBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12l-4 4m0 0l4 4m-4-4h10"/><path d="M17 12l4-4m0 0l-4-4m4 4H11"/></svg>`;
    allOtherBtn.title = settings.titles.saveAllOtherTabs;

    // Build main wrapper - main button first, then bottom button below
    if (summarizeBtn) {
        mainWrapper.appendChild(summarizeBtn);
    }
    mainWrapper.appendChild(mainBtn);
    mainWrapper.appendChild(allOtherBtn);

    // Right tabs button
    const rightBtn = document.createElement('button');
    rightBtn.className = 'bluetab-fab-sub bluetab-fab-sub-right';
    rightBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
    rightBtn.title = settings.titles.saveTabsRight;

    // Build row: always [<] [MainWrapper] [>] - left button on left, right button on right
    row.appendChild(leftBtn);
    row.appendChild(mainWrapper);
    row.appendChild(rightBtn);

    // Dismiss button (X) - appears on hover to let user temporarily hide the FAB
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'bluetab-fab-dismiss';
    dismissBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>`;
    dismissBtn.title = settings.titles.hide;
    dismissBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    dismissBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    dismissBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isHiddenByUser = true;
        host.remove();
    });

    container.appendChild(row);
    container.appendChild(dismissBtn);

    shadow.appendChild(container);
    document.body.appendChild(host);

    // applyMatchingDumpState ran before the container was attached.
    if (settings.hasRelatedDump) {
        maybeShowRelatedDumpBubble();
    }

    // Tick icon for success state
    const tickSVG = `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="36" height="36" rx="18" fill="#22c55e"/>
        <path d="M12 18l5 5 8-10" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    // Event handlers
    let longPressTimer: number | null = null;
    let isLongPress = false;

    // Hover to show sub-buttons
    container.addEventListener('mouseenter', () => {
        container.classList.add('expanded');
    });

    container.addEventListener('mouseleave', () => {
        if (!isLongPress) {
            container.classList.remove('expanded');
        }
    });

    // Main button click - save current tab
    mainBtn.addEventListener('click', (e) => {
        if (!isLongPress) {
            e.preventDefault();
            saveCurrentTab();
        }
    });

    // Long press - save all tabs
    mainBtn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Only left click

        isLongPress = false;
        mainBtn.classList.add('pressing');

        longPressTimer = window.setTimeout(() => {
            isLongPress = true;
            mainBtn.classList.remove('pressing');

            // If confirmation disabled, save directly and show success
            if (!settings.confirmSaveAll) {
                saveAllTabs();
                // Show success tick briefly
                mainBtn.classList.add('confirming');
                iconImg.style.display = 'none';
                const successTickEl = document.createElement('div');
                successTickEl.className = 'bluetab-fab-tick';
                successTickEl.innerHTML = tickSVG;
                mainBtn.insertBefore(successTickEl, mainBtn.firstChild);

                setTimeout(() => {
                    mainBtn.classList.remove('confirming');
                    successTickEl.remove();
                    iconImg.style.display = '';
                    isLongPress = false;
                }, 1000);
                return;
            }

            // Change icon to tick (confirmation state)
            mainBtn.classList.add('confirming');
            iconImg.style.display = 'none';
            const tickEl = document.createElement('div');
            tickEl.className = 'bluetab-fab-tick';
            tickEl.innerHTML = tickSVG;
            mainBtn.insertBefore(tickEl, mainBtn.firstChild);

            // Revert timeout
            let revertTimer: number | null = window.setTimeout(() => {
                revertToNormal();
            }, 2000);

            // Click on tick to confirm save
            const confirmHandler = (e: Event) => {
                e.stopPropagation();
                if (revertTimer) {
                    clearTimeout(revertTimer);
                    revertTimer = null;
                }
                saveAllTabs();
                revertToNormal();
            };

            tickEl.addEventListener('click', confirmHandler);

            function revertToNormal() {
                mainBtn.classList.remove('confirming');
                tickEl.removeEventListener('click', confirmHandler);
                tickEl.remove();
                iconImg.style.display = '';
                isLongPress = false;
            }
        }, 1500);
    });

    mainBtn.addEventListener('mouseup', cancelLongPress);
    mainBtn.addEventListener('mouseleave', cancelLongPress);

    function cancelLongPress() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        mainBtn.classList.remove('pressing');

        // Reset long press flag after a short delay
        setTimeout(() => {
            isLongPress = false;
        }, 100);
    }

    // Sub-button clicks
    leftBtn.addEventListener('click', () => saveTabsToLeft());
    rightBtn.addEventListener('click', () => saveTabsToRight());
    allOtherBtn.addEventListener('click', () => saveAllOtherTabs());
    summarizeBtn?.addEventListener('click', () => summarizePageToDump(summarizeBtn));

}


function getStyles(position: string, hasTopAction: boolean): string {
    const positionStyles: Record<string, string> = {
        'top-right': 'top: 10px; right: 10px;',
        'top-left': 'top: 10px; left: 10px;',
        'bottom-right': 'bottom: 10px; right: 10px;',
        'bottom-left': 'bottom: 10px; left: 10px;'
    };

    return `
        .bluetab-fab-container {
            position: fixed;
            ${positionStyles[position] || positionStyles['bottom-right']}
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .bluetab-fab-row {
            display: flex;
            flex-direction: row;
            direction: ltr;
            align-items: flex-start;
            gap: 6px;
        }

        .bluetab-fab-main-wrapper {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
        }

        .bluetab-fab-main {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: none;
            background: transparent;
            box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            position: relative;
            overflow: visible;
            padding: 0;
        }

        .bluetab-fab-main:hover {
            transform: scale(1.1);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }

        .bluetab-fab-main.${MATCHING_DUMP_CLASS} {
            box-shadow:
                0 0 0 1px rgba(96, 165, 250, 0.55),
                0 6px 16px rgba(59, 130, 246, 0.5);
            animation: bluetab-matching-dump-glow 2s ease-in-out infinite;
        }

        .bluetab-fab-main.${MATCHING_DUMP_CLASS}::after {
            content: '';
            position: absolute;
            inset: -4px;
            border-radius: 50%;
            border: 1.5px solid rgba(96, 165, 250, 0.75);
            box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.2);
            opacity: 0.75;
            pointer-events: none;
            animation: bluetab-matching-dump-pulse 2s ease-in-out infinite;
        }

        .bluetab-fab-main:active {
            transform: scale(0.95);
        }

        .bluetab-fab-main img {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            transition: transform 0.2s ease, opacity 0.2s ease;
        }

        .bluetab-fab-tick {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            animation: bluetab-tick-in 0.3s ease forwards;
        }

        .bluetab-fab-tick svg {
            width: 100%;
            height: 100%;
        }

        @keyframes bluetab-tick-in {
            0% { transform: scale(0) rotate(-45deg); opacity: 0; }
            50% { transform: scale(1.2) rotate(0deg); opacity: 1; }
            100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }

        @keyframes bluetab-matching-dump-pulse {
            0%, 100% {
                transform: scale(1);
                opacity: 0.72;
                box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.2);
            }
            50% {
                transform: scale(1.28);
                opacity: 0.12;
                box-shadow: 0 0 0 12px rgba(59, 130, 246, 0);
            }
        }

        @keyframes bluetab-matching-dump-glow {
            0%, 100% {
                box-shadow:
                    0 0 0 1px rgba(96, 165, 250, 0.55),
                    0 6px 16px rgba(59, 130, 246, 0.45);
            }
            50% {
                box-shadow:
                    0 0 0 2px rgba(147, 197, 253, 0.9),
                    0 10px 26px rgba(59, 130, 246, 0.7);
            }
        }

        .bluetab-fab-main.confirming {
            box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
        }

        .bluetab-fab-main.confirming .bluetab-fab-tick {
            cursor: pointer;
        }

        .bluetab-fab-main.confirming .bluetab-fab-tick:hover {
            transform: scale(1.1);
        }

        .bluetab-fab-progress {
            position: absolute;
            inset: -4px;
            border-radius: 50%;
            pointer-events: none;
            opacity: 0;
        }

        .bluetab-fab-progress-ring {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            border: 3px solid transparent;
            border-top-color: #3b82f6;
            box-sizing: border-box;
        }

        .bluetab-fab-main.pressing .bluetab-fab-progress {
            opacity: 1;
        }

        .bluetab-fab-main.pressing .bluetab-fab-progress-ring {
            animation: bluetab-spin 1.5s linear forwards;
        }

        @keyframes bluetab-spin {
            0% { transform: rotate(0deg); border-top-color: #3b82f6; border-right-color: transparent; border-bottom-color: transparent; border-left-color: transparent; }
            25% { border-right-color: #3b82f6; }
            50% { border-bottom-color: #3b82f6; }
            75% { border-left-color: #3b82f6; }
            100% { transform: rotate(360deg); border-color: #3b82f6; }
        }

        .bluetab-fab-sub-left,
        .bluetab-fab-sub-right {
            opacity: 0;
            transform: scale(0.5);
            transition: opacity 0.15s ease, transform 0.15s ease;
            pointer-events: none;
            margin-top: ${hasTopAction ? '38px' : '4px'};
        }

        .bluetab-fab-container.expanded .bluetab-fab-sub-left,
        .bluetab-fab-container.expanded .bluetab-fab-sub-right {
            opacity: 1;
            transform: scale(1);
            pointer-events: auto;
        }

        .bluetab-fab-sub-top,
        .bluetab-fab-sub-bottom {
            opacity: 0;
            transform: scale(0.5);
            transition: opacity 0.15s ease, transform 0.15s ease;
            pointer-events: none;
        }

        .bluetab-fab-container.expanded .bluetab-fab-sub-top,
        .bluetab-fab-container.expanded .bluetab-fab-sub-bottom {
            opacity: 1;
            transform: scale(1);
            pointer-events: auto;
        }

        .bluetab-fab-sub {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            border: none;
            background: white;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.15s ease, background 0.15s ease;
            color: #374151;
        }

        .bluetab-fab-sub:hover {
            transform: scale(1.15);
            background: #3b82f6;
            color: white;
        }

        .bluetab-fab-sub svg {
            width: 14px;
            height: 14px;
        }

        .bluetab-fab-sub.${SUMMARY_PROBLEM_CLASS} {
            background: #f59e0b;
            color: #ffffff;
        }

        .bluetab-fab-main.${SUMMARY_PROBLEM_CLASS}::after {
            content: '!';
            position: absolute;
            top: -3px;
            right: -3px;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #f59e0b;
            color: #ffffff;
            font: 700 10px/14px system-ui, sans-serif;
            text-align: center;
            box-shadow: 0 0 0 2px #ffffff;
            pointer-events: none;
        }

        .bluetab-fab-notice {
            cursor: default;
            border-color: #f59e0b;
        }

        .bluetab-fab-notice:hover {
            border-color: #f59e0b;
        }

        .bluetab-fab-sub.loading {
            opacity: 0.7;
            pointer-events: none;
        }

        .bluetab-fab-sub.loading svg {
            animation: bluetab-spin-sub 1s linear infinite;
        }

        @keyframes bluetab-spin-sub {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .bluetab-fab-dismiss {
            position: absolute;
            top: -8px;
            right: -8px;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            border: none;
            background: #6b7280;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            opacity: 0;
            transform: scale(0.5);
            transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease;
            pointer-events: none;
            padding: 0;
            z-index: 5;
        }

        .bluetab-fab-dismiss svg {
            width: 10px;
            height: 10px;
        }

        .bluetab-fab-container.expanded .bluetab-fab-dismiss {
            opacity: 0.7;
            transform: scale(1);
            pointer-events: auto;
        }

        .bluetab-fab-dismiss:hover {
            opacity: 1 !important;
            background: #ef4444;
            transform: scale(1.15);
        }

        /* Hide on small screens */
        @media (max-width: 768px) {
            .bluetab-fab-container {
                display: none;
            }
        }

        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
            .bluetab-fab-sub {
                background: #374151;
                color: #e5e7eb;
            }

            .bluetab-fab-sub:hover {
                background: #3b82f6;
                color: white;
            }
        }

        /* Linked-page bubble: small, short-lived card next to the button */
        .bluetab-fab-bubble {
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            gap: 3px;
            width: max-content;
            max-width: 240px;
            margin: 0;
            padding: 8px 10px;
            border-radius: 10px;
            background: #16181d;
            color: #d5d7dd;
            border: 1px solid #2d3139;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
            font: inherit;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            text-align: start;
            cursor: pointer;
            opacity: 0;
            transform: translateY(${position.startsWith('top') ? '-4px' : '4px'});
            transition: opacity 0.25s ease, transform 0.25s ease, border-color 0.15s ease;
        }

        .bluetab-fab-bubble.visible {
            opacity: 1;
            transform: translateY(0);
        }

        .bluetab-fab-bubble:hover,
        .bluetab-fab-bubble:focus-visible {
            border-color: #2951d6;
            outline: none;
        }

        .bluetab-fab-bubble-label {
            font-size: 11px;
            font-weight: 600;
            color: #9da3af;
        }

        .bluetab-fab-bubble-text {
            font-size: 12px;
            line-height: 1.4;
            color: #d5d7dd;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            overflow-wrap: anywhere;
        }

        @media (max-width: 768px) {
            .bluetab-fab-bubble {
                display: none;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .bluetab-fab-bubble {
                transition: none;
                transform: none;
            }
        }
    `;
}

// Communication with service worker
function saveCurrentTab() {
    chrome.runtime.sendMessage({ type: 'FLOATING_BUTTON_SAVE_THIS_TAB' });
    showSaveAnimation();
}

function saveTabsToLeft() {
    chrome.runtime.sendMessage({ type: 'FLOATING_BUTTON_SAVE_TABS_LEFT' });
    showSaveAnimation();
}

function saveTabsToRight() {
    chrome.runtime.sendMessage({ type: 'FLOATING_BUTTON_SAVE_TABS_RIGHT' });
    showSaveAnimation();
}

function saveAllOtherTabs() {
    chrome.runtime.sendMessage({ type: 'FLOATING_BUTTON_SAVE_ALL_OTHER' });
    showSaveAnimation();
}

function saveAllTabs() {
    chrome.runtime.sendMessage({ type: 'FLOATING_BUTTON_SAVE_ALL_TABS' });
    showSaveAnimation();
}

function summarizePageToDump(button: HTMLButtonElement) {
    clearSummaryProblem(button);
    button.classList.add('loading');
    try {
        chrome.runtime.sendMessage({
            action: 'brain-dump:summarize-page',
            url: location.href,
            title: document.title || location.href,
            html: document.documentElement?.outerHTML ?? '',
            tabContext: {
                url: location.href,
                title: document.title || location.href,
                favicon: findFaviconHref(),
            },
        }, (response?: { success?: boolean; error?: string }) => {
            button.classList.remove('loading');
            if (chrome.runtime.lastError || !response?.success) {
                void chrome.runtime.lastError;
                showSummaryProblem(button, response?.error);
                return;
            }
            showActionAnimation(button);
        });
    } catch {
        // Extension was reloaded under this page: the call cannot reach it.
        button.classList.remove('loading');
        showSummaryProblem(button);
    }
}

/**
 * Show that the page summary did not work. The sub-button folds away when
 * the pointer leaves the FAB, so the main button also gets an amber badge
 * and a short note next to it carries the reason (from the service worker).
 */
function showSummaryProblem(button: HTMLButtonElement, reason?: string) {
    const message = reason?.trim() || currentButtonTitles.summarizeProblem;
    button.classList.add(SUMMARY_PROBLEM_CLASS);
    if (message) {
        button.title = message;
        button.setAttribute('aria-label', message);
    }
    currentMainButton?.classList.add(SUMMARY_PROBLEM_CLASS);
    currentMainButton?.animate([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-3px)' },
        { transform: 'translateX(3px)' },
        { transform: 'translateX(-2px)' },
        { transform: 'translateX(0)' },
    ], { duration: 360, easing: 'ease-out' });
    if (message) showFabNotice(message);

    if (summaryProblemTimer !== null) clearTimeout(summaryProblemTimer);
    summaryProblemTimer = window.setTimeout(() => clearSummaryProblem(button), SUMMARY_PROBLEM_MS);
}

function clearSummaryProblem(button: HTMLButtonElement) {
    if (summaryProblemTimer !== null) {
        clearTimeout(summaryProblemTimer);
        summaryProblemTimer = null;
    }
    button.classList.remove(SUMMARY_PROBLEM_CLASS);
    button.title = currentButtonTitles.summarizePage;
    button.removeAttribute('aria-label');
    currentMainButton?.classList.remove(SUMMARY_PROBLEM_CLASS);
}

/** Short, non-clickable note next to the FAB (shares the bubble styling). */
function showFabNotice(text: string) {
    const container = closedShadowRoot?.querySelector<HTMLElement>('.bluetab-fab-container');
    if (!container || !closedShadowRoot) return;
    hideRelatedDumpBubble();

    const notice = document.createElement('div');
    notice.className = 'bluetab-fab-bubble bluetab-fab-notice';
    notice.setAttribute('role', 'status');
    const label = document.createElement('span');
    label.className = 'bluetab-fab-bubble-text';
    label.dir = 'auto';
    label.textContent = text;
    notice.appendChild(label);

    const rect = container.getBoundingClientRect();
    const position = container.dataset.position || 'bottom-right';
    notice.style.position = 'fixed';
    if (position.startsWith('top')) notice.style.top = `${Math.round(rect.bottom + 8)}px`;
    else notice.style.bottom = `${Math.round(window.innerHeight - rect.top + 8)}px`;
    if (position.endsWith('left')) notice.style.left = `${Math.round(rect.left)}px`;
    else notice.style.right = `${Math.round(window.innerWidth - rect.right)}px`;

    closedShadowRoot.appendChild(notice);
    currentRelatedDumpBubble = notice;
    requestAnimationFrame(() => notice.classList.add('visible'));
    relatedDumpBubbleTimer = window.setTimeout(hideRelatedDumpBubble, SUMMARY_PROBLEM_MS - 1000);
}

function showSaveAnimation() {
    if (!closedShadowRoot) return;

    const mainBtn = closedShadowRoot.querySelector('.bluetab-fab-main') as HTMLElement;
    if (!mainBtn) return;

    // Quick pulse animation
    mainBtn.animate([
        { transform: 'scale(1)', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)' },
        { transform: 'scale(1.2)', boxShadow: '0 8px 24px rgba(59, 130, 246, 0.6)' },
        { transform: 'scale(1)', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)' }
    ], {
        duration: 300,
        easing: 'ease-out'
    });
}

function showActionAnimation(element: HTMLElement) {
    element.animate([
        { transform: 'scale(1)', boxShadow: '0 2px 6px rgba(59, 130, 246, 0.18)' },
        { transform: 'scale(1.15)', boxShadow: '0 8px 24px rgba(59, 130, 246, 0.35)' },
        { transform: 'scale(1)', boxShadow: '0 2px 6px rgba(59, 130, 246, 0.18)' }
    ], {
        duration: 320,
        easing: 'ease-out'
    });
}
