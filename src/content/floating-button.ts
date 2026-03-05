/**
 * BlueTab Floating Button
 * A floating save button that appears on web pages for quick tab saving
 */

interface FloatingButtonSettings {
    enabled: boolean;
    position: 'bottom-right' | 'top-left' | 'bottom-right' | 'bottom-left';
    confirmSaveAll: boolean;
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
    // Get settings from storage
    const settings = await getSettings();

    if (settings.enabled) {
        // Create and inject the floating button
        createFloatingButton(settings);
    }

    // Listen for settings changes (only once, outside createFloatingButton)
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'FLOATING_BUTTON_SETTINGS_CHANGED') {
            const existingHost = document.getElementById('bluetab-floating-button-host');

            if (!message.settings.floatingButtonEnabled) {
                existingHost?.remove();
            } else {
                const newPosition = message.settings.floatingButtonPosition || 'top-right';
                const newConfirmSaveAll = message.settings.floatingButtonConfirmSaveAll ?? true;

                // Always rebuild to apply new settings
                existingHost?.remove();
                createFloatingButton({
                    enabled: true,
                    position: newPosition,
                    confirmSaveAll: newConfirmSaveAll
                });
            }
        }
    });
}

async function getSettings(): Promise<FloatingButtonSettings> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_FLOATING_BUTTON_SETTINGS' }, (response) => {
            if (response) {
                resolve({
                    enabled: response.floatingButtonEnabled ?? true,
                    position: response.floatingButtonPosition ?? 'bottom-right',
                    confirmSaveAll: response.floatingButtonConfirmSaveAll ?? true
                });
            } else {
                resolve({
                    enabled: true,
                    position: 'bottom-right',
                    confirmSaveAll: true
                });
            }
        });
    });
}

function createFloatingButton(settings: FloatingButtonSettings) {
    // Create shadow host for style isolation
    const host = document.createElement('div');
    host.id = 'bluetab-floating-button-host';
    const shadow = host.attachShadow({ mode: 'closed' });

    // Inject styles
    const styles = document.createElement('style');
    styles.textContent = getStyles(settings.position);
    shadow.appendChild(styles);

    // Create container
    const container = document.createElement('div');
    container.className = 'bluetab-fab-container';

    // Row for all buttons
    const row = document.createElement('div');
    row.className = 'bluetab-fab-row';

    // Left tabs button
    const leftBtn = document.createElement('button');
    leftBtn.className = 'bluetab-fab-sub bluetab-fab-sub-left';
    leftBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`;
    leftBtn.title = 'Save tabs to the left';

    // Main button wrapper (contains main btn and bottom btn)
    const mainWrapper = document.createElement('div');
    mainWrapper.className = 'bluetab-fab-main-wrapper';

    // Main button
    const mainBtn = document.createElement('button');
    mainBtn.className = 'bluetab-fab-main';
    const iconImg = document.createElement('img');
    iconImg.src = chrome.runtime.getURL('src/assets/icon48.png');
    iconImg.alt = 'BlueTab';
    mainBtn.appendChild(iconImg);
    mainBtn.title = 'Save this tab (hold for all tabs)';

    // Progress ring for long press
    const progressRing = document.createElement('div');
    progressRing.className = 'bluetab-fab-progress';
    progressRing.innerHTML = '<div class="bluetab-fab-progress-ring"></div>';
    mainBtn.appendChild(progressRing);

    // All other tabs button (below main button)
    const allOtherBtn = document.createElement('button');
    allOtherBtn.className = 'bluetab-fab-sub bluetab-fab-sub-bottom';
    allOtherBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12l-4 4m0 0l4 4m-4-4h10"/><path d="M17 12l4-4m0 0l-4-4m4 4H11"/></svg>`;
    allOtherBtn.title = 'Save all other tabs';

    // Build main wrapper - main button first, then bottom button below
    mainWrapper.appendChild(mainBtn);
    mainWrapper.appendChild(allOtherBtn);

    // Right tabs button
    const rightBtn = document.createElement('button');
    rightBtn.className = 'bluetab-fab-sub bluetab-fab-sub-right';
    rightBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
    rightBtn.title = 'Save tabs to the right';

    // Build row: always [<] [MainWrapper] [>] - left button on left, right button on right
    row.appendChild(leftBtn);
    row.appendChild(mainWrapper);
    row.appendChild(rightBtn);

    container.appendChild(row);

    shadow.appendChild(container);
    document.body.appendChild(host);

    // Tick icon for success state
    const tickSVG = `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="36" height="36" rx="18" fill="#22c55e"/>
        <path d="M12 18l5 5 8-10" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    const originalIconSrc = chrome.runtime.getURL('src/assets/icon48.png');

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

}


function getStyles(position: string): string {
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
        }

        .bluetab-fab-container.expanded .bluetab-fab-sub-left,
        .bluetab-fab-container.expanded .bluetab-fab-sub-right {
            opacity: 1;
            transform: scale(1);
            pointer-events: auto;
        }

        .bluetab-fab-sub-bottom {
            opacity: 0;
            transform: scale(0.5);
            transition: opacity 0.15s ease, transform 0.15s ease;
            pointer-events: none;
        }

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

function showSaveAnimation() {
    const host = document.getElementById('bluetab-floating-button-host');
    if (!host?.shadowRoot) return;

    const mainBtn = host.shadowRoot.querySelector('.bluetab-fab-main') as HTMLElement;
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
