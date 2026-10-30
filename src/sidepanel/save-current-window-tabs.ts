import { saveCurrentWindowTabs, type SaveCurrentWindowTabsOptions } from '../services/save-current-window-tabs';
import type { SaveTabsToBlueTabResult } from '../services/saved-tab-actions';

export async function saveCurrentWindowTabsFromSidepanel(
  options: SaveCurrentWindowTabsOptions = {},
): Promise<SaveTabsToBlueTabResult | null> {
  return saveCurrentWindowTabs(options);
}
