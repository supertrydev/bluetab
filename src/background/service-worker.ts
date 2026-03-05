import { Storage } from '../utils/storage';
import { normalizeUrl } from '../utils/normalize';
import { deduplicateTabs, filterDuplicatesBySettings } from '../utils/dedupe';
import { getDefaultSettings } from '../utils/sorting';
import { AuthService } from '../services/auth-service';
import { FlowService } from '../services/flow-service';
import { FlowStorageService } from '../utils/flow-storage';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import { SyncEngine } from '../services/sync-engine';
import { BluetBridgeService, findChangedGroupIds, debouncedBluetSync } from '../services/bluet-bridge-service';
import { ALARM_NAMES } from '../config/alarms';
import type { TabGroup, TabItem, Settings, RememberedGroup, Project } from '../types/models';

// Setup auth alarms on extension load
chrome.alarms.create(ALARM_NAMES.AUTH_REFRESH, { periodInMinutes: 30 });
chrome.alarms.create(ALARM_NAMES.SUBSCRIPTION_CHECK, { periodInMinutes: 60 });
chrome.alarms.create(ALARM_NAMES.BLUET_BRIDGE_HEARTBEAT, { periodInMinutes: 360 }); // 6 hours

// Initialize sync engine on startup
initializeSyncEngine();

async function initializeSyncEngine(): Promise<void> {
    try {
        await SyncEngine.initialize();
        console.log('[BlueTab][Sync] Engine initialized');
    } catch (error) {
        console.error('[BlueTab][Sync] Failed to initialize:', error);
    }
}

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAMES.AUTH_REFRESH) {
        console.log('[BlueTab][Auth] Running scheduled token refresh');
        const refreshed = await AuthService.refreshTokenIfNeeded();
        if (refreshed) {
            // Token is valid — clear any stale auth suspension and resume sync
            SyncEngine.clearAuthSuspension();
            if (SyncEngine.isReady() && SyncEngine.isOnline()) {
                SyncEngine.handleOnline(true).catch((err: unknown) => {
                    console.error('[BlueTab][Sync] Resume after refresh failed:', err);
                });
            }
        }
    } else if (alarm.name === ALARM_NAMES.SUBSCRIPTION_CHECK) {
        console.log('[BlueTab][Auth] Running scheduled subscription check');
        await AuthService.checkSubscription();
    } else if (alarm.name === ALARM_NAMES.BLUET_BRIDGE_HEARTBEAT) {
        // Periodic check: prunes stale refs, detects revocation/expiry
        const connected = await BluetBridgeService.isConnected();
        if (connected) {
            console.log('[BlueTab][BluetBridge] Running heartbeat status check');
            await BluetBridgeService.getStatus();
        }
    } else if (alarm.name === ALARM_NAMES.SYNC_POLL) {
        console.log('[BlueTab][Sync] Running scheduled sync poll');
        // Bilateral sync: push local changes, then pull remote changes
        await SyncEngine.sync();
    }
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
    try {
        if (tab.windowId) {
            await chrome.sidePanel.open({ windowId: tab.windowId });
        }
    } catch (error) {
        console.error('[BlueTab] Failed to open side panel:', error);
    }
});

// Handle messages from popup and other extension pages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OPEN_BLUETAB_PAGE') {
        const pagePath = message.pagePath || 'src/options/index.html';
        openBlueTabPage(pagePath).then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            console.error('[BlueTab] Failed to open page:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    // Floating button settings request
    if (message.type === 'GET_FLOATING_BUTTON_SETTINGS') {
        Storage.getSettings().then((settings) => {
            sendResponse({
                floatingButtonEnabled: settings.floatingButtonEnabled ?? true,
                floatingButtonPosition: settings.floatingButtonPosition ?? 'top-right',
                floatingButtonConfirmSaveAll: settings.floatingButtonConfirmSaveAll ?? true
            });
        });
        return true;
    }

    // Floating button save actions
    if (message.type === 'FLOATING_BUTTON_SAVE_THIS_TAB' && sender.tab) {
        saveThisTab(sender.tab);
        return false;
    }

    if (message.type === 'FLOATING_BUTTON_SAVE_TABS_LEFT' && sender.tab) {
        saveTabsToLeft(sender.tab);
        return false;
    }

    if (message.type === 'FLOATING_BUTTON_SAVE_TABS_RIGHT' && sender.tab) {
        saveTabsToRight(sender.tab);
        return false;
    }

    if (message.type === 'FLOATING_BUTTON_SAVE_ALL_OTHER' && sender.tab) {
        saveAllOtherTabs(sender.tab);
        return false;
    }

    if (message.type === 'FLOATING_BUTTON_SAVE_ALL_TABS') {
        saveAllTabs();
        return false;
    }

    // Sync message handlers
    if (message.type === 'SYNC_UI_ACTIVE') {
        SyncEngine.notifyUIActive().then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_UI_INACTIVE') {
        SyncEngine.notifyUIInactive();
        sendResponse({ success: true });
        return false;
    }

    if (message.type === 'SYNC_MANUAL_TRIGGER') {
        SyncEngine.sync().then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_GET_STATE') {
        SyncEngine.getState().then((state) => {
            sendResponse({ success: true, state });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_SETUP') {
        SyncEngine.setupSync(message.password, message.deviceName).then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_RESTORE') {
        SyncEngine.restoreSync(message.password).then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_UPLOAD_SNAPSHOTS') {
        SyncEngine.uploadSnapshots().then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, uploaded: 0, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_DOWNLOAD_SNAPSHOTS') {
        SyncEngine.downloadSnapshots(message.keys).then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, restored: 0, error: error.message });
        });
        return true;
    }

    if (message.type === 'SYNC_GET_DEVICES') {
        SyncEngine.getDevices().then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, devices: [], error: error.message });
        });
        return true;
    }

    // Clear sync data on logout (called from auth-service via message)
    if (message.type === 'SYNC_CLEAR_ON_LOGOUT') {
        SyncEngine.clearSyncOnLogout().then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    // Pause or resume sync (user toggle in settings)
    if (message.type === 'SYNC_SET_PAUSED') {
        const action = message.paused
            ? SyncEngine.pause()
            : SyncEngine.resume();
        action.then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    // Auto-setup sync (called after login or manually).
    // Also clears any stale authSuspended state in the SW context.
    if (message.type === 'SYNC_AUTO_SETUP') {
        SyncEngine.clearAuthSuspension();
        SyncEngine.autoSetup(message.deviceName).then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
});

// Intercept new tab pages and redirect to BlueTab (avoids Brave's NTP footer)
chrome.tabs.onCreated.addListener(async (tab) => {
    // Check if custom new tab is enabled
    const settings = await Storage.getSettings();
    if (!settings.customNewTabEnabled) {
        return; // Don't intercept if disabled
    }

    // Check multiple URL patterns that indicate a new tab
    // IMPORTANT: Don't intercept extension pages or other valid URLs
    const isNewTab = tab.pendingUrl === 'chrome://newtab/' ||
        tab.url === 'chrome://newtab/' ||
        (tab.url === 'about:blank' && !tab.pendingUrl);

    if (tab.id && isNewTab) {
        const bluetabUrl = chrome.runtime.getURL('src/newtab/index.html');

        // Small delay to ensure tab is ready
        setTimeout(async () => {
            try {
                await chrome.tabs.update(tab.id!, { url: bluetabUrl });
            } catch (error) {
                console.error('Failed to update new tab:', error);
            }
        }, 50);
    }
});

chrome.commands.onCommand.addListener(async (command) => {
    switch (command) {
        case 'save-all-tabs':
            await saveAllTabs();
            break;
        case 'restore-last-group':
            await restoreLastGroup();
            break;
        case 'open-manager':
            await openBlueTabManager();
            break;
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
        switch (info.menuItemId) {
            case 'save-all-tabs':
            case 'save-all-tabs-page':
                await saveAllTabs();
                break;
            case 'save-this-tab':
                if (tab) await saveThisTab(tab);
                break;
            case 'save-tabs-right':
                if (tab) await saveTabsToRight(tab);
                break;
            case 'save-tabs-left':
                if (tab) await saveTabsToLeft(tab);
                break;
            case 'save-all-other-tabs':
                if (tab) await saveAllOtherTabs(tab);
                break;
            case 'open-manager':
            case 'open-manager-link':
                await openBlueTabManager();
                break;
            case 'save-link':
                if (info.linkUrl) {
                    await saveLinkToNewGroup(info.linkUrl, info.linkUrl);
                }
                break;
            case 'save-this-tab-link':
                if (tab) await saveThisTab(tab);
                break;
            case 'save-tabs-right-link':
                if (tab) await saveTabsToRight(tab);
                break;
            case 'save-tabs-left-link':
                if (tab) await saveTabsToLeft(tab);
                break;
            case 'save-all-other-tabs-link':
                if (tab) await saveAllOtherTabs(tab);
                break;
            case 'save-all-tabs-link':
                await saveAllTabs();
                break;
            default:
                // Handle adding tabs to existing groups
                const menuId = info.menuItemId?.toString();

                if (menuId && tab) {
                    if (menuId.startsWith('add-this-to-group-')) {
                        const groupId = menuId.replace('add-this-to-group-', '');
                        await addTabToExistingGroup(tab, groupId);
                    } else if (menuId.startsWith('add-right-to-group-')) {
                        const groupId = menuId.replace('add-right-to-group-', '');
                        await addTabsToExistingGroup(tab, groupId, 'right');
                    } else if (menuId.startsWith('add-left-to-group-')) {
                        const groupId = menuId.replace('add-left-to-group-', '');
                        await addTabsToExistingGroup(tab, groupId, 'left');
                    } else if (menuId.startsWith('add-other-to-group-')) {
                        const groupId = menuId.replace('add-other-to-group-', '');
                        await addTabsToExistingGroup(tab, groupId, 'other');
                    } else if (menuId.startsWith('add-all-to-group-link-')) {
                        const groupId = menuId.replace('add-all-to-group-link-', '');
                        await addTabsToExistingGroup(tab, groupId, 'all');
                    } else if (menuId.startsWith('add-all-to-group-')) {
                        const groupId = menuId.replace('add-all-to-group-', '');
                        await addTabsToExistingGroup(tab, groupId, 'all');
                    } else if (menuId.startsWith('add-this-to-group-link-')) {
                        const groupId = menuId.replace('add-this-to-group-link-', '');
                        await addTabToExistingGroup(tab, groupId);
                    } else if (menuId.startsWith('add-right-to-group-link-')) {
                        const groupId = menuId.replace('add-right-to-group-link-', '');
                        await addTabsToExistingGroup(tab, groupId, 'right');
                    } else if (menuId.startsWith('add-left-to-group-link-')) {
                        const groupId = menuId.replace('add-left-to-group-link-', '');
                        await addTabsToExistingGroup(tab, groupId, 'left');
                    } else if (menuId.startsWith('add-other-to-group-link-')) {
                        const groupId = menuId.replace('add-other-to-group-link-', '');
                        await addTabsToExistingGroup(tab, groupId, 'other');
                    } else if (menuId.startsWith('add-link-to-group-') && info.linkUrl) {
                        const groupId = menuId.replace('add-link-to-group-', '');
                        await addLinkToExistingGroup(info.linkUrl, groupId);
                    } else if (menuId.startsWith('save-all-to-project-link-')) {
                        const projectId = menuId.replace('save-all-to-project-link-', '');
                        await saveAllTabsToProject(projectId);
                    } else if (menuId.startsWith('save-all-to-project-')) {
                        const projectId = menuId.replace('save-all-to-project-', '');
                        await saveAllTabsToProject(projectId);
                    }
                }
                break;
        }
    } catch (error) {
        console.error('Context menu error:', error);
    }
});

chrome.runtime.onStartup.addListener(async () => {
    const settings = await Storage.get<Settings>('settings');
    const startupBehavior = settings?.startupBehavior || 'manual';

    if (startupBehavior === 'show') {
        await openBlueTabPage('src/options/index.html');
    }
});

chrome.runtime.onInstalled.addListener(async () => {
    await createContextMenus();
});

// Listen for storage changes to update context menus when groups, settings or projects change
chrome.storage.onChanged.addListener(async (changes) => {
    if (changes.groups || changes.settings || changes.projects) {
        await createContextMenus();
    }

    // Bluet Bridge auto re-sync: detect tabGroups changes and re-sync shared groups
    if (changes.groups) {
        const oldGroups: TabGroup[] = changes.groups.oldValue || [];
        const newGroups: TabGroup[] = changes.groups.newValue || [];
        console.log('[BlueTab][BluetBridge] Storage groups changed, old:', oldGroups.length, 'new:', newGroups.length);
        const changedGroupIds = findChangedGroupIds(oldGroups, newGroups);
        console.log('[BlueTab][BluetBridge] Changed group IDs:', changedGroupIds);

        if (changedGroupIds.length > 0) {
            for (const groupId of changedGroupIds) {
                // Direct group share check
                debouncedBluetSync(groupId);

                // Also check if the group belongs to a shared project
                const group = newGroups.find(g => g.id === groupId);
                if (group?.projectId) {
                    debouncedBluetSync(group.projectId);
                }
            }
        }
    }
});

// Omnibox search functionality
chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    if (!text) return;

    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const suggestions: chrome.omnibox.SuggestResult[] = [];
    const lowerText = text.toLowerCase();

    // Search groups
    const matchingGroups = groups.filter(group =>
        group.name.toLowerCase().includes(lowerText)
    );

    for (const group of matchingGroups) {
        suggestions.push({
            content: `group:${group.id}`,
            description: `<dim>Group:</dim> <match>${escapeXml(group.name)}</match> <dim>(${group.tabs.length} tabs)</dim>`
        });
    }

    // Search tabs within groups
    for (const group of groups) {
        for (const tab of group.tabs) {
            if (tab.title.toLowerCase().includes(lowerText) || tab.url.toLowerCase().includes(lowerText)) {
                suggestions.push({
                    content: `tab:${tab.url}`,
                    description: `<dim>Tab:</dim> <match>${escapeXml(tab.title)}</match> <dim>- ${escapeXml(tab.url)}</dim>`
                });
            }
        }
    }

    suggest(suggestions.slice(0, 10));
});

chrome.omnibox.onInputEntered.addListener(async (text) => {
    if (text.startsWith('group:')) {
        await openBlueTabManager();
    } else if (text.startsWith('tab:')) {
        const url = text.substring(4);
        // SECURITY: Validate URL before opening to prevent javascript:/data:/file: attacks
        if (isValidTabUrl(url)) {
            await chrome.tabs.create({ url });
        } else {
            console.warn('[BlueTab][Security] Blocked dangerous URL:', url.substring(0, 50));
        }
    } else {
        await openBlueTabManager();
    }
});

/**
 * SECURITY: Validate URL to prevent dangerous schemes
 * Blocks javascript:, data:, file:, vbscript: URLs that could execute code
 */
function isValidTabUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;

    const dangerousSchemes = ['javascript:', 'data:', 'file:', 'vbscript:'];
    const lowerUrl = url.toLowerCase().trim();

    // Block dangerous schemes
    if (dangerousSchemes.some(scheme => lowerUrl.startsWith(scheme))) {
        return false;
    }

    // Must be a valid URL with http/https or extension URL
    try {
        const parsed = new URL(url);
        const allowedProtocols = ['http:', 'https:', 'chrome-extension:'];
        return allowedProtocols.includes(parsed.protocol);
    } catch {
        return false;
    }
}

function escapeXml(str: string): string {
    return str.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

async function createContextMenus() {
    // Use promise-based removeAll to ensure proper sequencing
    await new Promise<void>((resolve) => {
        chrome.contextMenus.removeAll(() => resolve());
    });

    try {
        // Page context menus (right-click on page)
        chrome.contextMenus.create({
            id: 'page-parent',
            title: 'BlueTab',
            contexts: ['page']
        });

        chrome.contextMenus.create({
            id: 'open-manager',
            parentId: 'page-parent',
            title: 'Open BlueTab Manager',
            contexts: ['page']
        });

        // Extension icon context menu
        chrome.contextMenus.create({
            id: 'save-all-tabs',
            title: 'Save Current Tabs',
            contexts: ['action']
        });

        // Link context menu (right-click on a link) - CREATE BEFORE adding groups
        chrome.contextMenus.create({
            id: 'link-parent',
            title: 'BlueTab',
            contexts: ['link']
        });

        chrome.contextMenus.create({
            id: 'open-manager-link',
            parentId: 'link-parent',
            title: 'Open BlueTab Manager',
            contexts: ['link']
        });

        // Now add existing groups to both contexts (parents exist)
        await addExistingGroupsToContextMenu();
        await addExistingGroupsToLinkContextMenu();
        await addExistingGroupsToLinkContextMenuTabs();
        await addProjectsToContextMenu();

        // Page context - remaining items
        chrome.contextMenus.create({
            id: 'separator-1',
            parentId: 'page-parent',
            type: 'separator',
            contexts: ['page']
        });

        chrome.contextMenus.create({
            id: 'save-this-tab',
            parentId: 'page-parent',
            title: 'Save This Tab',
            contexts: ['page']
        });

        chrome.contextMenus.create({
            id: 'save-all-other-tabs',
            parentId: 'page-parent',
            title: 'Send All Other Tabs to BlueTab',
            contexts: ['page']
        });

        chrome.contextMenus.create({
            id: 'save-tabs-right',
            parentId: 'page-parent',
            title: 'Save Tabs to the Right',
            contexts: ['page']
        });

        chrome.contextMenus.create({
            id: 'save-tabs-left',
            parentId: 'page-parent',
            title: 'Save Tabs to the Left',
            contexts: ['page']
        });

        chrome.contextMenus.create({
            id: 'save-all-tabs-page',
            parentId: 'page-parent',
            title: 'Save All Tabs',
            contexts: ['page']
        });

        // Link context - remaining items
        chrome.contextMenus.create({
            id: 'link-separator-1',
            parentId: 'link-parent',
            type: 'separator',
            contexts: ['link']
        });

        chrome.contextMenus.create({
            id: 'save-link',
            parentId: 'link-parent',
            title: 'Save This Link',
            contexts: ['link']
        });

        chrome.contextMenus.create({
            id: 'save-this-tab-link',
            parentId: 'link-parent',
            title: 'Save This Tab',
            contexts: ['link']
        });

        chrome.contextMenus.create({
            id: 'save-all-other-tabs-link',
            parentId: 'link-parent',
            title: 'Send All Other Tabs to BlueTab',
            contexts: ['link']
        });

        chrome.contextMenus.create({
            id: 'save-tabs-right-link',
            parentId: 'link-parent',
            title: 'Save Tabs to the Right',
            contexts: ['link']
        });

        chrome.contextMenus.create({
            id: 'save-tabs-left-link',
            parentId: 'link-parent',
            title: 'Save Tabs to the Left',
            contexts: ['link']
        });

        chrome.contextMenus.create({
            id: 'save-all-tabs-link',
            parentId: 'link-parent',
            title: 'Save All Tabs',
            contexts: ['link']
        });
    } catch (error) {
        console.error('Error creating context menus:', error);
    }
}

async function addExistingGroupsToLinkContextMenu() {
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const storedSettings = await Storage.get<Settings>('settings');
    const settings = { ...getDefaultSettings(), ...storedSettings };
    const groupLimit = settings.contextMenuGroupLimit || 25;

    if (groups.length > 0) {
        chrome.contextMenus.create({
            id: 'link-existing-groups-parent',
            parentId: 'link-parent',
            title: 'Add Link to Existing Group',
            contexts: ['link']
        });

        // Sort groups by modified date (most recent first) and apply limit
        const recentGroups = groups
            .sort((a, b) => b.modified - a.modified)
            .slice(0, groupLimit);

        recentGroups.forEach((group) => {
            const truncatedName = group.name.length > 25 ?
                group.name.substring(0, 25) + '...' :
                group.name;

            chrome.contextMenus.create({
                id: `add-link-to-group-${group.id}`,
                parentId: 'link-existing-groups-parent',
                title: `${truncatedName} (${group.tabs.length})`,
                contexts: ['link']
            });
        });
    }
}

async function addExistingGroupsToContextMenu() {
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const storedSettings = await Storage.get<Settings>('settings');
    const settings = { ...getDefaultSettings(), ...storedSettings };
    const groupLimit = settings.contextMenuGroupLimit || 25;

    if (groups.length > 0) {
        // Page context - Add Tab to Existing Group
        chrome.contextMenus.create({
            id: 'existing-groups-parent',
            parentId: 'page-parent',
            title: 'Add Tab to Existing Group',
            contexts: ['page']
        });

        // Sort groups by modified date (most recent first) and apply limit from settings
        const recentGroups = groups
            .sort((a, b) => b.modified - a.modified)
            .slice(0, groupLimit);

        recentGroups.forEach((group) => {
            const truncatedName = group.name.length > 25 ?
                group.name.substring(0, 25) + '...' :
                group.name;

            // Create group submenu for page context
            chrome.contextMenus.create({
                id: `group-${group.id}`,
                parentId: 'existing-groups-parent',
                title: `${truncatedName} (${group.tabs.length})`,
                contexts: ['page']
            });

            // Add action submenus for page context
            chrome.contextMenus.create({
                id: `add-this-to-group-${group.id}`,
                parentId: `group-${group.id}`,
                title: 'This Tab',
                contexts: ['page']
            });

            chrome.contextMenus.create({
                id: `add-right-to-group-${group.id}`,
                parentId: `group-${group.id}`,
                title: 'Tabs to the Right',
                contexts: ['page']
            });

            chrome.contextMenus.create({
                id: `add-left-to-group-${group.id}`,
                parentId: `group-${group.id}`,
                title: 'Tabs to the Left',
                contexts: ['page']
            });

            chrome.contextMenus.create({
                id: `add-other-to-group-${group.id}`,
                parentId: `group-${group.id}`,
                title: 'All Other Tabs',
                contexts: ['page']
            });

            chrome.contextMenus.create({
                id: `add-all-to-group-${group.id}`,
                parentId: `group-${group.id}`,
                title: 'All Tabs',
                contexts: ['page']
            });
        });
    }
}

// Add projects to context menu
async function addProjectsToContextMenu() {
    const projects = await Storage.getProjects();

    if (projects.length > 0) {
        // Page context - Save All Tabs to Project
        chrome.contextMenus.create({
            id: 'save-to-project-parent',
            parentId: 'page-parent',
            title: 'Save All Tabs to Project',
            contexts: ['page']
        });

        projects.forEach((project) => {
            chrome.contextMenus.create({
                id: `save-all-to-project-${project.id}`,
                parentId: 'save-to-project-parent',
                title: project.name,
                contexts: ['page']
            });
        });

        // Link context - Save All Tabs to Project
        chrome.contextMenus.create({
            id: 'save-to-project-parent-link',
            parentId: 'link-parent',
            title: 'Save All Tabs to Project',
            contexts: ['link']
        });

        projects.forEach((project) => {
            chrome.contextMenus.create({
                id: `save-all-to-project-link-${project.id}`,
                parentId: 'save-to-project-parent-link',
                title: project.name,
                contexts: ['link']
            });
        });
    }
}

// Save all tabs to a specific project
async function saveAllTabsToProject(projectId: string): Promise<void> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groupName = `Session ${new Date().toLocaleTimeString()}`;
    const { processedTabs, tabsToClose } = await processTabsWithSettings(tabs, groupName);

    if (processedTabs.length === 0) return;

    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const newGroup: TabGroup = {
        id: crypto.randomUUID(),
        name: groupName,
        tabs: processedTabs,
        created: Date.now(),
        modified: Date.now(),
        projectId: projectId,
    };

    await Storage.set('groups', [...groups, newGroup]);

    // Close saved tabs
    const tabIdsToClose = tabsToClose.map(tab => tab.id).filter(id => id !== undefined) as number[];
    if (tabIdsToClose.length > 0) {
        await chrome.tabs.remove(tabIdsToClose);
    }

    await openBlueTabManagerIfEnabled();

    // Show notification
    const project = (await Storage.getProjects()).find(p => p.id === projectId);
    try {
        await chrome.notifications.create({
            type: 'basic',
            iconUrl: 'src/assets/icon48.png',
            title: 'BlueTab',
            message: `Saved ${processedTabs.length} tabs to project "${project?.name || 'Unknown'}"`
        });
    } catch (notificationError) {
        console.error('Notification error:', notificationError);
    }
}

async function addExistingGroupsToLinkContextMenuTabs() {
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const storedSettings = await Storage.get<Settings>('settings');
    const settings = { ...getDefaultSettings(), ...storedSettings };
    const groupLimit = settings.contextMenuGroupLimit || 25;

    if (groups.length > 0) {
        // Link context - Add Tab to Existing Group
        chrome.contextMenus.create({
            id: 'existing-groups-parent-link',
            parentId: 'link-parent',
            title: 'Add Tab to Existing Group',
            contexts: ['link']
        });

        const recentGroups = groups
            .sort((a, b) => b.modified - a.modified)
            .slice(0, groupLimit);

        recentGroups.forEach((group) => {
            const truncatedName = group.name.length > 25 ?
                group.name.substring(0, 25) + '...' :
                group.name;

            // Create group submenu for link context
            chrome.contextMenus.create({
                id: `group-link-${group.id}`,
                parentId: 'existing-groups-parent-link',
                title: `${truncatedName} (${group.tabs.length})`,
                contexts: ['link']
            });

            // Add action submenus for link context
            chrome.contextMenus.create({
                id: `add-this-to-group-link-${group.id}`,
                parentId: `group-link-${group.id}`,
                title: 'This Tab',
                contexts: ['link']
            });

            chrome.contextMenus.create({
                id: `add-right-to-group-link-${group.id}`,
                parentId: `group-link-${group.id}`,
                title: 'Tabs to the Right',
                contexts: ['link']
            });

            chrome.contextMenus.create({
                id: `add-left-to-group-link-${group.id}`,
                parentId: `group-link-${group.id}`,
                title: 'Tabs to the Left',
                contexts: ['link']
            });

            chrome.contextMenus.create({
                id: `add-other-to-group-link-${group.id}`,
                parentId: `group-link-${group.id}`,
                title: 'All Other Tabs',
                contexts: ['link']
            });

            chrome.contextMenus.create({
                id: `add-all-to-group-link-${group.id}`,
                parentId: `group-link-${group.id}`,
                title: 'All Tabs',
                contexts: ['link']
            });
        });
    }
}

// Helper function to process tabs according to settings
async function processTabsWithSettings(tabs: chrome.tabs.Tab[], groupName: string): Promise<{ processedTabs: TabItem[], tabsToClose: chrome.tabs.Tab[] }> {
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    const storedSettings = await Storage.get<Settings>('settings');
    const settings = { ...getDefaultSettings(), ...storedSettings };

    // Filter out extension pages and apply pinned tabs setting
    let filteredTabs = tabs.filter(tab =>
        tab.url &&
        !tab.url.startsWith('chrome-extension://') &&
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('edge://') &&
        !tab.url.startsWith('about:') &&
        !tab.url.startsWith('moz-extension://') &&
        tab.url !== 'about:blank'
    );

    // Apply pinned tabs filter
    if (settings.pinnedTabsMode === 'exclude') {
        filteredTabs = filteredTabs.filter(tab => !tab.pinned);
    }

    const tabItems: TabItem[] = filteredTabs.map(tab => ({
        id: crypto.randomUUID(),
        url: normalizeUrl(tab.url || ''),
        title: tab.title || '',
        favicon: tab.favIconUrl,
        timestamp: Date.now(),
        groupId: crypto.randomUUID(),
        pinned: tab.pinned
    }));

    // Apply duplicate filtering based on settings
    const filteredTabItems = filterDuplicatesBySettings(tabItems, groups, settings);
    const dedupedTabs = deduplicateTabs(filteredTabItems);

    return { processedTabs: dedupedTabs, tabsToClose: filteredTabs };
}

// Helper function to check Group Memory for matching URLs
async function checkGroupMemoryMatch(tabs: TabItem[]): Promise<{
    matchedGroup: RememberedGroup | null;
    matchedUrls: string[];
}> {
    const settings = await Storage.getSettings();
    if (settings.groupMemoryEnabled === false) {
        return { matchedGroup: null, matchedUrls: [] };
    }

    const matchedUrls: string[] = [];

    for (const tab of tabs) {
        const normalizedUrl = normalizeUrl(tab.url);
        const group = await GroupMemoryStorageService.findGroupByUrl(normalizedUrl);
        if (group) {
            // Found a matching group, collect all matching URLs
            matchedUrls.push(normalizedUrl);

            // Check if other tabs also match this group
            for (const otherTab of tabs) {
                if (otherTab.id !== tab.id) {
                    const otherUrl = normalizeUrl(otherTab.url);
                    const matchesGroup = group.tabs.some(t => t.url === otherUrl);
                    if (matchesGroup && !matchedUrls.includes(otherUrl)) {
                        matchedUrls.push(otherUrl);
                    }
                }
            }

            return { matchedGroup: group, matchedUrls };
        }
    }

    return { matchedGroup: null, matchedUrls: [] };
}

// Helper function to restore group from memory
async function restoreGroupFromMemory(
    rememberedGroup: RememberedGroup,
    newTabs: TabItem[]
): Promise<void> {
    const groups = await Storage.get<TabGroup[]>('groups') || [];

    // Validate projectId - only use if project still exists
    let validProjectId: string | undefined = undefined;
    if (rememberedGroup.projectId) {
        const projects = await Storage.getProjects();
        const projectExists = projects.some(p => p.id === rememberedGroup.projectId);
        if (projectExists) {
            validProjectId = rememberedGroup.projectId;
        } else {
            console.log(`[BlueTab][Memory] Project ${rememberedGroup.projectId} no longer exists, skipping projectId`);
        }
    }

    // Check if the group still exists (shouldn't happen, but be safe)
    const existingGroup = groups.find(g => g.id === rememberedGroup.id);

    if (existingGroup) {
        // Group exists (restored manually?), add tabs to it
        const updatedGroups = groups.map(g => {
            if (g.id === rememberedGroup.id) {
                // Dedupe - don't add tabs that already exist in group
                const existingUrls = new Set(g.tabs.map(t => normalizeUrl(t.url)));
                const newUniqueTabs = newTabs.filter(t => !existingUrls.has(normalizeUrl(t.url)));

                return {
                    ...g,
                    tabs: [...g.tabs, ...newUniqueTabs],
                    modified: Date.now()
                };
            }
            return g;
        });
        await Storage.set('groups', updatedGroups);
        console.log(`[BlueTab][Memory] Added ${newTabs.length} tabs to existing group "${existingGroup.name}"`);
    } else {
        // Group doesn't exist, recreate it with remembered properties
        const restoredGroup: TabGroup = {
            id: rememberedGroup.id,
            name: rememberedGroup.name,
            color: rememberedGroup.color,
            tags: rememberedGroup.tags,
            isPinned: rememberedGroup.isPinned,
            pinnedAt: rememberedGroup.pinnedAt,
            projectId: validProjectId,
            tabs: newTabs.map(tab => ({ ...tab, groupId: rememberedGroup.id })),
            created: rememberedGroup.created,
            modified: Date.now()
        };
        await Storage.set('groups', [...groups, restoredGroup]);
        console.log(`[BlueTab][Memory] Restored group "${rememberedGroup.name}" from memory with ${newTabs.length} tabs`);
    }
}

// Helper function to save tabs with Flow support
async function saveTabsWithFlow(
    processedTabs: TabItem[],
    defaultGroupName: string,
    tabsToClose: chrome.tabs.Tab[]
): Promise<void> {
    if (processedTabs.length === 0) return;

    // Check Group Memory first (available to all users, not just Pro)
    const memoryMatch = await checkGroupMemoryMatch(processedTabs);
    if (memoryMatch.matchedGroup) {
        // Restore group from memory
        await restoreGroupFromMemory(memoryMatch.matchedGroup, processedTabs);

        // Close saved tabs
        const tabIdsToClose = tabsToClose.map(tab => tab.id).filter(id => id !== undefined) as number[];
        if (tabIdsToClose.length > 0) {
            await chrome.tabs.remove(tabIdsToClose);
        }

        // Show notification
        try {
            await chrome.notifications.create({
                type: 'basic',
                iconUrl: 'src/assets/icon48.png',
                title: 'BlueTab',
                message: `Restored "${memoryMatch.matchedGroup.name}" from memory`
            });
        } catch (notificationError) {
            console.error('Notification error:', notificationError);
        }

        return;
    }

    // Check if Flow should be used (Pro feature)
    const flowSettings = await FlowStorageService.getFlowSettings();
    const useFlow = flowSettings.enabled && flowSettings.rules.length > 0;

    if (useFlow) {
        // Process tabs through Flow
        const groups = await Storage.get<TabGroup[]>('groups') || [];
        const flowResult = await FlowService.processTabs(processedTabs, groups);

        if (flowResult.success && flowResult.matched > 0) {
            console.log(`[BlueTab][Flow] Processed ${flowResult.processed} tabs, matched ${flowResult.matched}`);

            // Get unmatched tabs
            const unmatchedTabs = processedTabs.filter(tab =>
                flowResult.results.some(r => r.tabId === tab.id && r.actionTaken === 'no_match')
            );

            // If there are unmatched tabs, create a default group for them
            if (unmatchedTabs.length > 0) {
                const updatedGroups = await Storage.get<TabGroup[]>('groups') || [];
                const newGroup: TabGroup = {
                    id: crypto.randomUUID(),
                    name: defaultGroupName,
                    tabs: unmatchedTabs,
                    created: Date.now(),
                    modified: Date.now()
                };
                await Storage.set('groups', [...updatedGroups, newGroup]);
            }
        } else {
            // Flow didn't match anything or failed, use default behavior
            const groups = await Storage.get<TabGroup[]>('groups') || [];
            const newGroup: TabGroup = {
                id: crypto.randomUUID(),
                name: defaultGroupName,
                tabs: processedTabs,
                created: Date.now(),
                modified: Date.now()
            };
            await Storage.set('groups', [...groups, newGroup]);
        }
    } else {
        // Default behavior - create single group
        const groups = await Storage.get<TabGroup[]>('groups') || [];
        const newGroup: TabGroup = {
            id: crypto.randomUUID(),
            name: defaultGroupName,
            tabs: processedTabs,
            created: Date.now(),
            modified: Date.now()
        };
        await Storage.set('groups', [...groups, newGroup]);
    }

    // Close saved tabs
    const tabIdsToClose = tabsToClose.map(tab => tab.id).filter(id => id !== undefined) as number[];
    if (tabIdsToClose.length > 0) {
        await chrome.tabs.remove(tabIdsToClose);
    }
}

async function saveAllTabs(): Promise<void> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groupName = `Session ${new Date().toLocaleTimeString()}`;
    const { processedTabs, tabsToClose } = await processTabsWithSettings(tabs, groupName);

    await saveTabsWithFlow(processedTabs, groupName, tabsToClose);
    await openBlueTabManagerIfEnabled();
}

async function restoreLastGroup(): Promise<void> {
    const groups = await Storage.get<TabGroup[]>('groups') || [];
    if (groups.length === 0) return;

    const lastGroup = groups[groups.length - 1];
    for (const tab of lastGroup.tabs) {
        await chrome.tabs.create({ url: tab.url });
    }
}

async function saveThisTab(currentTab: chrome.tabs.Tab): Promise<void> {
    const groupName = `Single Tab: ${currentTab.title}`;
    const { processedTabs, tabsToClose } = await processTabsWithSettings([currentTab], groupName);

    await saveTabsWithFlow(processedTabs, groupName, tabsToClose);
    await openBlueTabManagerIfEnabled();
}

async function saveTabsToRight(currentTab: chrome.tabs.Tab): Promise<void> {
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const currentIndex = currentTab.index;
    const tabsToRight = allTabs.filter(tab => tab.index > currentIndex);

    const { processedTabs, tabsToClose } = await processTabsWithSettings(tabsToRight, `Tabs to Right`);
    const groupName = `Tabs to Right (${processedTabs.length} tabs) - ${new Date().toLocaleTimeString()}`;

    await saveTabsWithFlow(processedTabs, groupName, tabsToClose);
    await openBlueTabManagerIfEnabled();
}

async function saveTabsToLeft(currentTab: chrome.tabs.Tab): Promise<void> {
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const currentIndex = currentTab.index;
    const tabsToLeft = allTabs.filter(tab => tab.index < currentIndex);

    const { processedTabs, tabsToClose } = await processTabsWithSettings(tabsToLeft, `Tabs to Left`);
    const groupName = `Tabs to Left (${processedTabs.length} tabs) - ${new Date().toLocaleTimeString()}`;

    await saveTabsWithFlow(processedTabs, groupName, tabsToClose);
    await openBlueTabManagerIfEnabled();
}

async function saveAllOtherTabs(currentTab: chrome.tabs.Tab): Promise<void> {
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const otherTabs = allTabs.filter(tab => tab.id !== currentTab.id);

    const { processedTabs, tabsToClose } = await processTabsWithSettings(otherTabs, `All Other Tabs`);
    const groupName = `All Other Tabs (${processedTabs.length} tabs) - ${new Date().toLocaleTimeString()}`;

    await saveTabsWithFlow(processedTabs, groupName, tabsToClose);
    await openBlueTabManagerIfEnabled();
}

async function addTabToExistingGroup(currentTab: chrome.tabs.Tab, groupId: string): Promise<void> {
    try {
        // Check if tab should be filtered out
        if (!currentTab.url ||
            currentTab.url.startsWith('chrome-extension://') ||
            currentTab.url.startsWith('chrome://') ||
            currentTab.url.startsWith('edge://') ||
            currentTab.url.startsWith('about:') ||
            currentTab.url.startsWith('moz-extension://') ||
            currentTab.url === 'about:blank') {
            return;
        }

        const groups = await Storage.get<TabGroup[]>('groups') || [];
        const targetGroup = groups.find(group => group.id === groupId);

        if (!targetGroup) return;

        // Apply settings for duplicate handling
        const storedSettings = await Storage.get<Settings>('settings');
        const settings = { ...getDefaultSettings(), ...storedSettings };

        const newTabItem: TabItem = {
            id: crypto.randomUUID(),
            url: normalizeUrl(currentTab.url),
            title: currentTab.title || '',
            favicon: currentTab.favIconUrl,
            timestamp: Date.now(),
            groupId: groupId,
            pinned: currentTab.pinned
        };

        // Check for duplicates if setting is enabled
        if (settings.duplicateHandling === 'reject') {
            const isDuplicate = targetGroup.tabs.some(tab =>
                normalizeUrl(tab.url) === normalizeUrl(newTabItem.url)
            );
            if (isDuplicate) {
                return; // Silently reject duplicate
            }
        }

        // Add tab to the target group
        const updatedGroups = groups.map(group => {
            if (group.id === groupId) {
                return {
                    ...group,
                    tabs: [...group.tabs, newTabItem],
                    modified: Date.now()
                };
            }
            return group;
        });

        await Storage.set('groups', updatedGroups);

        // Close the tab
        if (currentTab.id) {
            await chrome.tabs.remove(currentTab.id);
        }

        // Open BlueTab manager if enabled
        await openBlueTabManagerIfEnabled();

        // Show notification
        try {
            await chrome.notifications.create({
                type: 'basic',
                iconUrl: 'src/assets/icon48.png',
                title: 'BlueTab',
                message: `Tab added to "${targetGroup.name}"`
            });
        } catch (notificationError) {
            console.error('Notification error:', notificationError);
        }
    } catch (error) {
        console.error('Error in addTabToExistingGroup:', error);
    }
}

async function addTabsToExistingGroup(currentTab: chrome.tabs.Tab, groupId: string, action: 'right' | 'left' | 'other' | 'all'): Promise<void> {
    try {
        const groups = await Storage.get<TabGroup[]>('groups') || [];
        const targetGroup = groups.find(group => group.id === groupId);

        if (!targetGroup) return;

        const allTabs = await chrome.tabs.query({ currentWindow: true });
        let tabsToAdd: chrome.tabs.Tab[] = [];

        switch (action) {
            case 'right':
                tabsToAdd = allTabs.filter(tab => tab.index > currentTab.index);
                break;
            case 'left':
                tabsToAdd = allTabs.filter(tab => tab.index < currentTab.index);
                break;
            case 'other':
                tabsToAdd = allTabs.filter(tab => tab.id !== currentTab.id);
                break;
            case 'all':
                tabsToAdd = allTabs;
                break;
        }

        const { processedTabs, tabsToClose } = await processTabsWithSettings(tabsToAdd, targetGroup.name);

        if (processedTabs.length === 0) return;

        // Update the target group
        const updatedGroups = groups.map(group => {
            if (group.id === groupId) {
                return {
                    ...group,
                    tabs: [...group.tabs, ...processedTabs.map(tab => ({ ...tab, groupId }))],
                    modified: Date.now()
                };
            }
            return group;
        });

        await Storage.set('groups', updatedGroups);

        // Close the tabs that were added
        const tabIdsToClose = tabsToClose.map(tab => tab.id).filter(id => id !== undefined) as number[];
        if (tabIdsToClose.length > 0) {
            await chrome.tabs.remove(tabIdsToClose);
        }

        // Open BlueTab manager if enabled
        await openBlueTabManagerIfEnabled();

        // Show notification
        try {
            await chrome.notifications.create({
                type: 'basic',
                iconUrl: 'src/assets/icon48.png',
                title: 'BlueTab',
                message: `${processedTabs.length} tabs added to "${targetGroup.name}"`
            });
        } catch (notificationError) {
            console.error('Notification error:', notificationError);
        }
    } catch (error) {
        console.error('Error in addTabsToExistingGroup:', error);
    }
}

/**
 * Opens a BlueTab extension page ensuring only one instance exists.
 * If the page is already open, focuses it. Otherwise, creates a new tab.
 * Also closes any duplicate tabs of the same page.
 */
async function openBlueTabPage(pagePath: string): Promise<void> {
    const pageUrl = chrome.runtime.getURL(pagePath);

    // Check if this page is already open
    const existingTabs = await chrome.tabs.query({ url: pageUrl });

    if (existingTabs.length > 0) {
        // Page exists, focus the first one
        const existingTab = existingTabs[0];
        await chrome.tabs.update(existingTab.id!, { active: true });
        await chrome.windows.update(existingTab.windowId!, { focused: true });

        // Close any duplicate tabs (keep only the first one)
        if (existingTabs.length > 1) {
            const duplicateIds = existingTabs.slice(1).map(t => t.id!).filter(id => id !== undefined);
            if (duplicateIds.length > 0) {
                await chrome.tabs.remove(duplicateIds);
                console.log(`[BlueTab] Closed ${duplicateIds.length} duplicate tabs of ${pagePath}`);
            }
        }
    } else {
        // Page doesn't exist, create one
        await chrome.tabs.create({ url: pageUrl });
    }
}

async function openBlueTabManager(): Promise<void> {
    await openBlueTabPage('src/options/index.html');
}

/**
 * Opens BlueTab manager only if the setting is enabled.
 * Used after save operations to respect user preference.
 */
async function openBlueTabManagerIfEnabled(): Promise<void> {
    const settings = await Storage.getSettings();
    if (settings.openManagerAfterSave !== false) {
        await openBlueTabManager();
    }
}

async function saveLinkToNewGroup(linkUrl: string, linkText: string): Promise<void> {
    try {
        // Validate URL
        if (!isValidTabUrl(linkUrl)) {
            console.warn('[BlueTab][Security] Blocked dangerous link URL:', linkUrl.substring(0, 50));
            return;
        }

        const normalizedLinkUrl = normalizeUrl(linkUrl);

        // Check Group Memory first
        const settings = await Storage.getSettings();
        if (settings.groupMemoryEnabled !== false) {
            const rememberedGroup = await GroupMemoryStorageService.findGroupByUrl(normalizedLinkUrl);
            if (rememberedGroup) {
                // Found a matching group in memory, restore it
                const newTabItem: TabItem = {
                    id: crypto.randomUUID(),
                    url: normalizedLinkUrl,
                    title: linkText || linkUrl,
                    favicon: undefined,
                    timestamp: Date.now(),
                    groupId: rememberedGroup.id
                };

                await restoreGroupFromMemory(rememberedGroup, [newTabItem]);
                await openBlueTabManagerIfEnabled();

                // Show notification
                try {
                    await chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'src/assets/icon48.png',
                        title: 'BlueTab',
                        message: `Restored "${rememberedGroup.name}" from memory`
                    });
                } catch (notificationError) {
                    console.error('Notification error:', notificationError);
                }
                return;
            }
        }

        // No memory match, create new group
        const groups = await Storage.get<TabGroup[]>('groups') || [];

        // Extract domain for group name
        let groupName = 'Saved Link';
        try {
            const url = new URL(linkUrl);
            groupName = `Link: ${url.hostname}`;
        } catch {
            // Use default name if URL parsing fails
        }

        const newTabItem: TabItem = {
            id: crypto.randomUUID(),
            url: normalizedLinkUrl,
            title: linkText || linkUrl,
            favicon: undefined, // We don't have favicon for links
            timestamp: Date.now(),
            groupId: crypto.randomUUID()
        };

        const newGroup: TabGroup = {
            id: crypto.randomUUID(),
            name: groupName,
            tabs: [newTabItem],
            created: Date.now(),
            modified: Date.now()
        };

        await Storage.set('groups', [...groups, newGroup]);
        await openBlueTabManagerIfEnabled();

        // Show notification
        try {
            await chrome.notifications.create({
                type: 'basic',
                iconUrl: 'src/assets/icon48.png',
                title: 'BlueTab',
                message: `Link saved to "${groupName}"`
            });
        } catch (notificationError) {
            console.error('Notification error:', notificationError);
        }
    } catch (error) {
        console.error('Error saving link:', error);
    }
}

async function addLinkToExistingGroup(linkUrl: string, groupId: string): Promise<void> {
    try {
        // Validate URL
        if (!isValidTabUrl(linkUrl)) {
            console.warn('[BlueTab][Security] Blocked dangerous link URL:', linkUrl.substring(0, 50));
            return;
        }

        const groups = await Storage.get<TabGroup[]>('groups') || [];
        const targetGroup = groups.find(group => group.id === groupId);

        if (!targetGroup) return;

        // Apply settings for duplicate handling
        const storedSettings = await Storage.get<Settings>('settings');
        const settings = { ...getDefaultSettings(), ...storedSettings };

        const newTabItem: TabItem = {
            id: crypto.randomUUID(),
            url: normalizeUrl(linkUrl),
            title: linkUrl, // Use URL as title since we don't have the link text
            favicon: undefined,
            timestamp: Date.now(),
            groupId: groupId
        };

        // Check for duplicates if setting is enabled
        if (settings.duplicateHandling === 'reject') {
            const isDuplicate = targetGroup.tabs.some(tab =>
                normalizeUrl(tab.url) === normalizeUrl(newTabItem.url)
            );
            if (isDuplicate) {
                return; // Silently reject duplicate
            }
        }

        // Add link to the target group
        const updatedGroups = groups.map(group => {
            if (group.id === groupId) {
                return {
                    ...group,
                    tabs: [...group.tabs, newTabItem],
                    modified: Date.now()
                };
            }
            return group;
        });

        await Storage.set('groups', updatedGroups);
        await openBlueTabManagerIfEnabled();

        // Show notification
        try {
            await chrome.notifications.create({
                type: 'basic',
                iconUrl: 'src/assets/icon48.png',
                title: 'BlueTab',
                message: `Link added to "${targetGroup.name}"`
            });
        } catch (notificationError) {
            console.error('Notification error:', notificationError);
        }
    } catch (error) {
        console.error('Error adding link to group:', error);
    }
}
