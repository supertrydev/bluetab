import { ensureCoreAlarms, watchCoreAlarmChanges } from './core-alarms';
import { ADHDService } from '../services/adhd-service';
import { AuthService } from '../services/auth-service';
import { BluetBridgeService } from '../services/bluet-bridge-service';
import { Storage } from '../utils/storage';
import { ALARM_NAMES as A } from '../config/alarms';

jest.mock('../services/adhd-service', () => ({ ADHDService: { isFeatureActive: jest.fn() } }));
jest.mock('../services/auth-service', () => ({ AuthService: { isLoggedIn: jest.fn() } }));
jest.mock('../services/bluet-bridge-service', () => ({ BluetBridgeService: { isConnected: jest.fn() } }));
jest.mock('../utils/storage');

let alarms: Map<string, chrome.alarms.AlarmCreateInfo>;
let state: Record<string, unknown>;
beforeEach(() => {
  jest.clearAllMocks();
  alarms = new Map();
  state = {};
  (Storage.get as jest.Mock).mockImplementation(async (key) => state[key]);
  (ADHDService.isFeatureActive as jest.Mock).mockResolvedValue(false);
  (AuthService.isLoggedIn as jest.Mock).mockResolvedValue(false);
  (BluetBridgeService.isConnected as jest.Mock).mockResolvedValue(false);
  (chrome.alarms.get as jest.Mock).mockImplementation(async (name) => alarms.get(name));
  (chrome.alarms.create as jest.Mock).mockImplementation(async (name, info) => { alarms.set(name, info); });
  (chrome.alarms.clear as jest.Mock).mockImplementation(async (name) => alarms.delete(name));
});

it.each([
  [A.ADHD_AUTOSUSPEND_SCAN, 1, (on: boolean) => (ADHDService.isFeatureActive as jest.Mock).mockResolvedValue(on)],
  [A.AUTH_REFRESH, 30, (on: boolean) => (AuthService.isLoggedIn as jest.Mock).mockResolvedValue(on)],
  [A.SUBSCRIPTION_CHECK, 60, (on: boolean) => (AuthService.isLoggedIn as jest.Mock).mockResolvedValue(on)],
  [A.BLUET_BRIDGE_HEARTBEAT, 360, (on: boolean) => (BluetBridgeService.isConnected as jest.Mock).mockResolvedValue(on)],
  [A.RSS_REFRESH, 15, (on: boolean) => { state.rssFeeds = on ? [{ id: 'feed' }] : []; }],
  [A.GROUP_AUTO_ARCHIVE_SCAN, 60, (on: boolean) => { state.settings = { autoArchiveInactiveGroups: on }; }],
] as const)('%s exists only while its feature is active', async (name, period, setEnabled) => {
  setEnabled(true);
  await ensureCoreAlarms();
  expect(alarms.get(name)?.periodInMinutes).toBe(period);
  setEnabled(false);
  await ensureCoreAlarms();
  expect(alarms.has(name)).toBe(false);
});

it('keeps the kill switch and does not reset existing schedules', async () => {
  await ensureCoreAlarms();
  expect([...alarms.keys()]).toEqual([A.V3_KILL_SWITCH_REFRESH]);
  expect(alarms.get(A.V3_KILL_SWITCH_REFRESH)?.periodInMinutes).toBe(240);
  await ensureCoreAlarms();
  expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
});

it('rechecks local feature/feed/auth/bridge changes and ignores unrelated writes', async () => {
  watchCoreAlarmChanges();
  const listener = (chrome.storage.onChanged.addListener as jest.Mock).mock.calls[0][0];
  for (const key of ['adhd_settings', 'settings', 'rssFeeds', 'bluetab_auth_token', 'bluetab_refresh_token', 'bluet_bridge']) {
    jest.mocked(Storage.get).mockClear();
    await listener({ [key]: { newValue: {} } }, 'local');
    expect(Storage.get).toHaveBeenCalled();
  }
  jest.mocked(Storage.get).mockClear();
  await listener({ groups: { newValue: [] } }, 'local');
  await listener({ settings: { newValue: {} } }, 'sync');
  expect(Storage.get).not.toHaveBeenCalled();
});

it('serializes reconciliation so a slow enable cannot undo a later disable', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  (chrome.alarms.create as jest.Mock).mockImplementationOnce(async (name, info) => {
    await pending;
    alarms.set(name, info);
  });
  (ADHDService.isFeatureActive as jest.Mock).mockResolvedValue(true);
  const first = ensureCoreAlarms();
  // Wait until the first snapshot has reached alarm creation.
  while (!(chrome.alarms.create as jest.Mock).mock.calls.length) await Promise.resolve();
  (ADHDService.isFeatureActive as jest.Mock).mockResolvedValue(false);
  const second = ensureCoreAlarms();
  release();
  await Promise.all([first, second]);
  expect(alarms.has(A.ADHD_AUTOSUSPEND_SCAN)).toBe(false);
});

it('waits for in-flight alarm writes even when a sibling operation rejects', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  (chrome.alarms.create as jest.Mock).mockImplementationOnce(async (name, info) => {
    await pending;
    alarms.set(name, info);
  });
  (chrome.alarms.clear as jest.Mock).mockRejectedValueOnce(new Error('API unavailable'));
  (ADHDService.isFeatureActive as jest.Mock).mockResolvedValue(true);
  const first = ensureCoreAlarms().catch(() => {});
  while (!(chrome.alarms.create as jest.Mock).mock.calls.length) await Promise.resolve();
  (ADHDService.isFeatureActive as jest.Mock).mockResolvedValue(false);
  const second = ensureCoreAlarms();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const readsWhileWritePending = (ADHDService.isFeatureActive as jest.Mock).mock.calls.length;
  release();
  await Promise.all([first, second]);
  expect(readsWhileWritePending).toBe(1);
  expect(alarms.has(A.ADHD_AUTOSUSPEND_SCAN)).toBe(false);
});
