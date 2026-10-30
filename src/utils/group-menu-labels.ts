/**
 * @module utils/group-menu-labels
 *
 * WHY:  The default submenus ("Edit", "Share to") are stored in settings with
 *       English labels. Showing those raw strings leaves Turkish/Arabic/etc.
 *       users with an English menu, and an empty custom label used to fall
 *       back to "Share to" even for the Edit submenu.
 *
 * WHAT: Resolves the display label for a group menu submenu. Untouched default
 *       labels are translated; user-renamed labels are shown as typed.
 *
 * NOT:  Does not write anything back to settings.
 */

import type { TFunction } from 'i18next';
import type { GroupMenuSubmenu } from '@/types/models';

/** English labels written by getDefaultGroupMenuConfig() (plus the legacy "Share"). */
const DEFAULT_SUBMENU_LABELS: Record<string, string[]> = {
    edit: ['Edit'],
    share: ['Share to', 'Share'],
};

export function getGroupSubmenuLabel(
    submenu: Pick<GroupMenuSubmenu, 'id' | 'label'>,
    t: TFunction,
): string {
    const label = submenu.label?.trim() || '';
    const isDefaultLabel = !label || (DEFAULT_SUBMENU_LABELS[submenu.id] || []).includes(label);

    if (isDefaultLabel && submenu.id === 'share') return t('options.groupMenu.shareTo');
    if (isDefaultLabel && submenu.id === 'edit') return t('settings.groupMenu.editSubmenu');
    return label || t('settings.groupMenu.submenuFallback');
}
