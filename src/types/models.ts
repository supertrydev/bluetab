export interface Tag {
    id: string;
    name: string;
    color: string;
    created: number;
}

/**
 * Project Colors - predefined color palette for projects
 */
export const PROJECT_COLORS = {
    red: '#ef4444',
    orange: '#f97316',
    yellow: '#eab308',
    green: '#22c55e',
    blue: '#3b82f6',
    purple: '#a855f7',
    pink: '#ec4899',
} as const;

export type ProjectColor = keyof typeof PROJECT_COLORS;

/**
 * Project Icons - available icons for projects
 */
export type ProjectIcon =
    | 'folder'
    | 'briefcase'
    | 'code'
    | 'book'
    | 'shopping-cart'
    | 'plane'
    | 'gamepad'
    | 'heart'
    | 'star'
    | 'music'
    | 'graduation-cap'
    | 'home'
    | 'globe'
    | 'camera'
    | 'coffee'
    | 'film'
    | 'gift'
    | 'lightbulb'
    | 'palette'
    | 'settings';

/**
 * Search scope for project views
 */
export type ProjectSearchScope = 'project' | 'all';

/**
 * Project - organizes groups into logical collections
 */
export interface Project {
    id: string;
    name: string;
    color: ProjectColor;      // default: 'blue'
    icon: ProjectIcon;        // default: 'folder'
    searchScope: ProjectSearchScope;  // default: 'project' - search only project groups
    created: number;
    modified: number;
}

export interface TabItem {
    id: string;
    url: string;
    title: string;
    favicon?: string;
    timestamp: number;
    groupId: string;
    pinned?: boolean;
    tags?: string[]; // Array of tag IDs
}

export interface TabGroup {
    id: string;
    name: string;
    tabs: TabItem[];
    created: number;
    modified: number;
    color?: string;
    locked?: boolean;
    tags?: string[]; // Array of tag IDs
    isPinned?: boolean;        // Pin status
    pinnedAt?: number;         // Pin timestamp
    lastAccessed?: number;     // For archive suggestions
    accessCount?: number;      // For archive analytics
    projectId?: string;        // Project assignment
    notes?: string;            // User notes for this group
}

export interface Session {
    groups: TabGroup[];
    tags: Tag[];
    projects: Project[];
    settings: Settings;
    version: string;
}

export interface PinSettings {
    pinnedGroups: {
        [groupId: string]: {
            isPinned: boolean;
            pinnedAt: number;
        }
    };
}

export type GroupMenuMainItem = 'groupInfo' | 'archiveGroup' | 'assignToProject' | 'edit' | 'share' | 'deleteGroup';
export type GroupMenuEditItem = 'manageTags' | 'addNote' | 'lockUnlock' | 'rememberThisGroup';
export type GroupMenuShareItem = 'copyLinks' | 'shareToBluet';
export type GroupMenuDirectItem = 'groupInfo' | 'archiveGroup' | 'assignToProject' | 'deleteGroup';
export type GroupMenuSubmenuItem = GroupMenuEditItem | GroupMenuShareItem;

export interface GroupMenuSubmenu {
    id: string;
    label: string;
    visible: boolean;
}

export interface GroupMenuConfig {
    groupInfo: boolean;
    archiveGroup: boolean;
    assignToProject: boolean;
    manageTags: boolean;
    addNote: boolean;
    lockUnlock: boolean;
    rememberThisGroup: boolean;
    copyLinks: boolean;
    shareToBluet: boolean;
    deleteGroup: boolean;
    mainOrder: GroupMenuMainItem[];
    editOrder: GroupMenuEditItem[];
    shareOrder: GroupMenuShareItem[];
    mainOrderV2?: string[]; // direct keys + submenu refs in format: submenu:<id>
    submenus?: GroupMenuSubmenu[];
    submenuAssignments?: Partial<Record<GroupMenuSubmenuItem, string>>;
    submenuItemOrder?: Record<string, GroupMenuSubmenuItem[]>;
}

export interface Settings {
    maxGroups: number;
    theme: 'light' | 'dark' | 'system';
    sortOrder: 'newest' | 'oldest' | 'alphabetical' | 'mostTabs' | 'leastTabs';
    restoreMode: 'smart' | 'newWindow' | 'currentWindow';
    pinnedTabsMode: 'exclude' | 'include';
    startupBehavior: 'show' | 'manual';
    restoreBehavior: 'removeFromList' | 'keepInList';
    duplicateHandling: 'allow' | 'reject';
    /**
     * Custom New Tab Page
     * - Enable or disable the custom new tab page
     * @default false
     */
    customNewTabEnabled?: boolean;
    /**
     * Tab Group Restore Mode
     * - 'normal': Restore tabs without grouping (default)
     * - 'browserGroups': Use Chrome's native tab groups
     * @default 'normal'
     * @since Feature 018
     */
    tabGroupRestoreMode?: 'normal' | 'browserGroups';
    /**
     * Context Menu Group Limit
     * - Maximum number of groups to show in the right-click context menu
     * - Higher values may affect menu usability
     * @default 25
     */
    contextMenuGroupLimit?: number;
    /**
     * Group Memory - Enable/disable group memory feature
     * When enabled, restored groups are remembered and can be automatically
     * recreated when a tab from that group is saved again
     * @default true
     */
    groupMemoryEnabled?: boolean;
    /**
     * Group Memory - Auto remember all groups
     * When enabled, all groups are automatically remembered on restore
     * When disabled, use "Remember" option from group menu
     * @default true
     */
    groupMemoryAutoRemember?: boolean;
    /**
     * Open BlueTab Manager After Save
     * When enabled, BlueTab manager opens after saving tabs
     * When disabled, only a notification is shown
     * @default true
     */
    openManagerAfterSave?: boolean;
    /**
     * Floating Button - Enable/disable floating save button on web pages
     * @default true
     */
    floatingButtonEnabled?: boolean;
    /**
     * Floating Button Position
     * @default 'top-right'
     */
    floatingButtonPosition?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
    /**
     * Floating Button - Confirm before saving all tabs (long press)
     * @default true
     */
    floatingButtonConfirmSaveAll?: boolean;
    /**
     * Browser Tabs - Show colored border on browser group cards in sidepanel
     * @default true
     */
    browserTabsGroupBorder?: boolean;
    /**
     * Browser Tabs - Close tabs after saving to BlueTab from sidepanel
     * @default true
     */
    browserTabsCloseOnSave?: boolean;
    /**
     * Browser Tabs - Show discarded/inactive tab indicator
     * @default true
     */
    browserTabsShowInactiveIndicator?: boolean;
    /**
     * Tab URL Display Mode
     * - 'full': Show complete URL (e.g. https://example.com/path)
     * - 'hostname': Show only domain name (e.g. example.com)
     * @default 'full'
     */
    tabUrlDisplay?: 'full' | 'hostname';
    /**
     * Group Notes Display Mode
     * - 'full': Show complete note text on card
     * - 'preview': Show truncated single-line preview
     * @default 'preview'
     */
    groupNotesDisplay?: 'full' | 'preview';
    /**
     * 3-dot group menu personalization
     * Controls which menu actions are visible to the user
     */
    groupMenuConfig?: GroupMenuConfig;
}

/**
 * Remembered Tab - stored in group memory
 * Contains essential tab info for URL matching
 */
export interface RememberedTab {
    url: string;              // Normalized URL (primary key for matching)
    title: string;            // Last known title
    favicon?: string;         // Last known favicon
    originalId: string;       // Original tab ID
}

/**
 * Remembered Group - stored in group memory
 * Contains group properties to restore when a matching URL is saved
 */
export interface RememberedGroup {
    id: string;               // Original group ID (will be reused)
    name: string;             // Group name
    color?: string;           // Group color
    tags?: string[];          // Tag IDs
    isPinned?: boolean;       // Pin status
    pinnedAt?: number;        // Pin timestamp
    projectId?: string;       // Project ID (for project restoration)
    tabs: RememberedTab[];    // Remembered tabs (for URL matching)
    created: number;          // Original creation timestamp
    rememberedAt: number;     // When the group was added to memory
}
