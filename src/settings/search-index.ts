/**
 * @module settings/search-index
 *
 * WHY:  Settings search has to find any text in settings, including text that
 *       is not on screen: closed lists, dialogs and options that only show
 *       after a switch is turned on.
 *
 * WHAT: Collects what a section shows right now and adds its translations.
 *
 * NOT:  Never reads what the user typed into a field; those can hold secrets.
 */

import { normalizeForSearch } from '@/utils/search-text';

/** Translation branches that belong to each section. A test keeps this complete. */
export const SECTION_TRANSLATIONS: Record<string, readonly string[]> = {
    appearance: ['settingsTabs.appearance', 'settings.theme', 'textSize', 'common.light', 'common.dark'],
    general: [
        'language.title',
        'common.browserDefault',
        'common.english',
        'common.turkish',
        'common.spanish',
        'common.brazilianPortuguese',
        'common.indonesian',
        'common.arabic',
        'settings.general.languageTitle',
        'settings.general.languageDescription',
        'settings.general.timeFormat',
        'settings.general.startupBehavior',
        'settings.general.customNewTab',
        'settings.general.contextMenu',
        'settings.general.tabUrlDisplay',
        'settings.general.groupNotesDisplay',
        'settings.general.autoArchive',
    ],
    tabs: [
        'settings.general.tabRestoration',
        'settings.general.tabGroupRestoreMode',
        'settings.general.pinnedTabs',
        'settings.general.restoreBehavior',
        'settings.general.saveBehavior',
        'settings.general.duplicates',
    ],
    'side-panel': ['settings.general.browserTabs'],
    'group-memory': ['settings.general.groupMemory'],
    'floating-button': ['settings.general.floatingButton'],
    pomodoro: ['settings.pomodoro', 'common.sounds'],
    focus: ['settings.focus', 'settings.distractionScan'],
    'brain-dump': ['settings.brainDump'],
    adhd: ['settings.adhd', 'settings.autoSuspendOnboarding'],
    readings: ['settings.readings'],
    rss: ['settings.rss', 'common.sounds'],
    reminders: ['settings.reminders', 'common.sounds'],
    ai: ['settings.ai'],
    stats: ['settings.stats'],
    'group-menu': ['settings.groupMenu'],
    sync: ['components.sync'],
    mcp: ['settings.mcp'],
    integrations: ['settings.integrations', 'settings.integrationsSection'],
    'backup-sessions': ['settings.sessionBackup'],
    backup: ['settings.backup'],
    about: ['settings.about', 'settings.aboutDescription'],
};

function collectStrings(value: unknown, into: string[]): void {
    if (typeof value === 'string') into.push(value.replace(/\{\{[^}]*\}\}|<[^>]*>/g, ' '));
    else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, into));
}

/** Visible text plus the labels that are not text nodes, kept apart word by word. */
function collectElementText(element: Element): string {
    const texts: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node.nodeValue ?? '');
    element.querySelectorAll('[placeholder], [aria-label], [title], [alt]').forEach((item) => {
        for (const name of ['placeholder', 'aria-label', 'title', 'alt']) texts.push(item.getAttribute(name) ?? '');
    });
    return texts.join(' ');
}

export function buildSectionSearchText(
    sectionId: string,
    element: Element | undefined,
    getTranslation: (key: string) => unknown,
): string {
    const texts = element ? [collectElementText(element)] : [];
    for (const key of SECTION_TRANSLATIONS[sectionId] ?? []) collectStrings(getTranslation(key), texts);
    return normalizeForSearch(texts.join(' '));
}

/** Every word of the query has to be somewhere in the section, in any order. */
export function matchesSectionSearch(haystack: string, query: string): boolean {
    const text = normalizeForSearch(haystack);
    return normalizeForSearch(query).split(' ').every((word) => text.includes(word));
}
