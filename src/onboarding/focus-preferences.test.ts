import { applyFocusPreferences, type FocusPreferences } from './focus-preferences';
import { ADHDService } from '@/services/adhd-service';
import { PomodoroService } from '@/services/pomodoro-service';
import { Storage } from '@/utils/storage';

jest.mock('@/utils/storage', () => ({ Storage: { get: jest.fn(), set: jest.fn() } }));
const off: FocusPreferences = { tabs: null, timer: 'none', suspend: null };
let data: Record<string, unknown>;
beforeEach(() => {
  jest.clearAllMocks();
  data = {};
  (Storage.get as jest.Mock).mockImplementation(async key => data[key] ?? null);
  (Storage.set as jest.Mock).mockImplementation(async (key, value) => { data[key] = value; });
});

it.each([8, 12, 20] as const)('persists a visible tab limit of %s', async tabs => {
  await applyFocusPreferences({ ...off, tabs });
  expect(await ADHDService.getSettings()).toMatchObject({ masterEnabled: true, visibleTabLimit: { enabled: true, limit: tabs } });
});

it.each(['pomodoro', 'flowtime', 'visual'] as const)('persists %s using the shared services', async timer => {
  const preset = jest.spyOn(PomodoroService, 'setPreset');
  await applyFocusPreferences({ ...off, timer });
  expect(await ADHDService.getSettings()).toMatchObject({ masterEnabled: true, flowtimeTimer: { enabled: timer === 'flowtime' }, visualTime: { enabled: timer === 'visual' } });
  if (timer !== 'flowtime') {
    expect(preset).toHaveBeenCalledWith('classic');
    expect(data.pomodoroSettings).toMatchObject({ preset: 'classic', customWork: 25 });
  } else expect(data.pomodoroSettings).toBeUndefined();
  preset.mockRestore();
});

it.each([30, 120] as const)('persists suspension after %s minutes', async suspend => {
  await applyFocusPreferences({ ...off, suspend });
  expect(await ADHDService.getSettings()).toMatchObject({ masterEnabled: true, autoSuspend: { enabled: true, thresholdMin: suspend } });
});

it('leaves every feature and the master off for all opt-out answers', async () => {
  await applyFocusPreferences(off);
  const settings = await ADHDService.getSettings();
  expect(settings.masterEnabled).toBe(false);
  expect(settings.visibleTabLimit.enabled).toBe(false);
  expect(settings.flowtimeTimer.enabled).toBe(false);
  expect(settings.visualTime.enabled).toBe(false);
  expect(settings.autoSuspend.enabled).toBe(false);
  expect(data.pomodoroSettings).toBeUndefined();
});
