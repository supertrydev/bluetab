import type { TFunction } from 'i18next';
import { getGroupSubmenuLabel } from '../group-menu-labels';

const t = ((key: string) => `t:${key}`) as unknown as TFunction;

describe('getGroupSubmenuLabel', () => {
  it('translates untouched default labels', () => {
    expect(getGroupSubmenuLabel({ id: 'edit', label: 'Edit' }, t)).toBe('t:settings.groupMenu.editSubmenu');
    expect(getGroupSubmenuLabel({ id: 'share', label: 'Share to' }, t)).toBe('t:options.groupMenu.shareTo');
    expect(getGroupSubmenuLabel({ id: 'share', label: 'Share' }, t)).toBe('t:options.groupMenu.shareTo');
  });

  it('keeps labels the user renamed', () => {
    expect(getGroupSubmenuLabel({ id: 'edit', label: 'Organize' }, t)).toBe('Organize');
    expect(getGroupSubmenuLabel({ id: 'submenu_1', label: 'Work' }, t)).toBe('Work');
  });

  it('does not fall back to "Share to" for an empty Edit or custom submenu', () => {
    expect(getGroupSubmenuLabel({ id: 'edit', label: '' }, t)).toBe('t:settings.groupMenu.editSubmenu');
    expect(getGroupSubmenuLabel({ id: 'submenu_1', label: '  ' }, t)).toBe('t:settings.groupMenu.submenuFallback');
  });
});
