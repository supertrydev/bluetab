import * as fs from 'fs';
import * as path from 'path';
import { onDeltasGenerated, processStorageChange, type GeneratedDelta } from '@/services/delta-tracker';
import { getDefaultSettings } from '@/utils/sorting';

jest.mock('@/services/sync-crypto', () => ({
  encryptDelta: jest.fn().mockResolvedValue({ encryptedData: 'enc', iv: 'iv' }),
}));

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf-8');
const SECTIONS: Record<string, string[]> = {
  TabBehaviorSettings: ['restoreMode', 'tabGroupRestoreMode', 'pinnedTabsMode', 'restoreBehavior', 'openManagerAfterSave', 'duplicateHandling'],
  SidePanelSettings: ['browserTabsGroupBorder', 'browserTabsCloseOnSave', 'browserTabsShowInactiveIndicator'],
  GroupMemorySettings: ['groupMemoryEnabled', 'groupMemoryAutoRemember'],
  FloatingButtonSettings: ['floatingButtonEnabled', 'floatingButtonPosition', 'floatingButtonConfirmSaveAll'],
};
const written = (source: string) =>
  [...source.matchAll(/updateSetting(?:WithNotify)?\(\s*'(\w+)'/g)].map((match) => match[1]);

describe('settings sections', () => {
  it.each(Object.entries(SECTIONS))('%s owns its settings and General no longer writes them', (file, keys) => {
    expect(new Set(written(read(`components/${file}.tsx`)))).toEqual(new Set(keys));
    for (const key of keys) expect(written(read('components/GeneralSettings.tsx'))).not.toContain(key);
  });

  it('saves through the one storage key that backup and sync carry', () => {
    expect(read('hooks/useSettingsUpdater.ts')).toContain("Storage.set('settings', updatedSettings)");
    for (const file of Object.keys(SECTIONS)) {
      expect(read(`components/${file}.tsx`)).not.toContain('Storage.set');
      expect(read(`components/${file}.tsx`)).toContain('useSettingsUpdater');
    }
  });

  it.each(Object.values(SECTIONS).flat())('syncs a change to %s as that field alone', (key) => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const deltas: GeneratedDelta[] = [];
    const stop = onDeltasGenerated((generated) => deltas.push(...generated));
    const oldValue = getDefaultSettings();
    processStorageChange({ settings: { oldValue, newValue: { ...oldValue, [key]: 'changed' } } }, 'local');
    stop();
    expect(deltas).toHaveLength(1);
    expect(deltas[0].storageKey).toBe('settings');
    expect(deltas[0].payload).toEqual({ data: { [key]: 'changed' } });
  });
});
