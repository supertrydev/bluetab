const storageGetMock = jest.fn();
const storageSetMock = jest.fn().mockResolvedValue(undefined);
const storageRemoveMock = jest.fn().mockResolvedValue(undefined);
const storageAtomicUpdateMock = jest.fn().mockResolvedValue(undefined);

const onDeltasGeneratedMock: jest.Mock = jest.fn(() => jest.fn());
const processStorageChangeMock: jest.Mock = jest.fn();

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: (...args: any[]) => storageGetMock(...args),
    set: (...args: any[]) => storageSetMock(...args),
    remove: (...args: any[]) => storageRemoveMock(...args),
    atomicUpdate: (...args: any[]) => storageAtomicUpdateMock(...args),
  },
}));

jest.mock('./sync-transport', () => ({
  SyncTransport: {
    setDeviceId: jest.fn(),
    clearDeviceId: jest.fn(),
  },
}));

jest.mock('./sync-realtime', () => ({
  SyncRealtime: {
    initializeRealtime: jest.fn(),
    ensurePollingAlarm: jest.fn(),
    shutdownRealtime: jest.fn(),
    onUIActive: jest.fn(),
    onUIInactive: jest.fn(),
  },
}));

jest.mock('./auth-service', () => ({
  AuthService: {
    forceRefreshToken: jest.fn().mockResolvedValue({ success: false, sessionInvalid: false }),
  },
}));

jest.mock('@/utils/auth-state', () => ({
  getAccessToken: jest.fn().mockResolvedValue(null),
  getAuthState: jest.fn().mockResolvedValue({ isPro: false }),
}));

jest.mock('./delta-tracker', () => ({
  onDeltasGenerated: (callback: any) => onDeltasGeneratedMock(callback),
  processStorageChange: (changes: any, areaName: any) => processStorageChangeMock(changes, areaName),
  encryptGeneratedDeltas: jest.fn().mockResolvedValue([]),
  isArrayKey: jest.fn().mockReturnValue(false),
  isObjectKey: jest.fn().mockReturnValue(false),
}));

jest.mock('./sync-crypto', () => ({
  deriveSyncKey: jest.fn().mockResolvedValue(true),
  hasCachedKey: jest.fn().mockReturnValue(false),
  clearCachedKey: jest.fn(),
  generateSalt: jest.fn().mockReturnValue('salt'),
  initializeEncryption: jest.fn(),
  encryptSnapshot: jest.fn(),
  decryptSnapshot: jest.fn(),
  autoRestoreKeyFromSession: jest.fn().mockResolvedValue(false),
  clearAllSyncSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./delta-applier', () => ({
  applyDeltas: jest.fn().mockResolvedValue({ success: true, applied: 0, skipped: 0, failed: 0, errors: [] }),
  applySnapshot: jest.fn().mockResolvedValue(undefined),
  setLocalDeviceId: jest.fn(),
  getLocalDeviceId: jest.fn().mockReturnValue(null),
}));

jest.mock('./mcp-server-service', () => ({
  MCPServerService: {
    pushSnapshotIfEnabled: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('SyncEngine.initialize', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    storageSetMock.mockResolvedValue(undefined);
    storageRemoveMock.mockResolvedValue(undefined);
    storageAtomicUpdateMock.mockResolvedValue(undefined);
    processStorageChangeMock.mockReset();
    onDeltasGeneratedMock.mockReturnValue(jest.fn());
  });

  it('blocks password restore on a legacy device without changing its registration', async () => {
    storageGetMock.mockImplementation(async (key: string) => key === 'syncDeviceInfo'
      ? { deviceId: 'legacy-device', userId: 'account', keySalt: 'legacy-salt' }
      : null);

    const { restoreSync } = await import('./sync-engine');
    const { deriveSyncKey } = await import('./sync-crypto');

    await expect(restoreSync('new-password')).resolves.toMatchObject({ success: false });
    expect(deriveSyncKey).not.toHaveBeenCalled();
    expect(storageRemoveMock).not.toHaveBeenCalled();
  });

  it('registers the storage listener before async device restore completes', async () => {
    let resolveDeviceInfo!: (value: null) => void;
    const deviceInfoPromise = new Promise<null>((resolve) => {
      resolveDeviceInfo = resolve;
    });

    storageGetMock.mockImplementation((key: string) => {
      if (key === 'syncDeviceInfo') return deviceInfoPromise;
      if (key === 'syncPaused') return Promise.resolve(false);
      return Promise.resolve(null);
    });

    const { initialize, shutdown } = await import('./sync-engine');

    const initPromise = initialize();
    await Promise.resolve();

    expect(onDeltasGeneratedMock).toHaveBeenCalledTimes(1);
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalledWith(expect.any(Function));

    resolveDeviceInfo(null);
    await initPromise;
    await shutdown();
  });

  it('does not schedule the 1-minute sync poll before sync is set up on this device', async () => {
    storageGetMock.mockImplementation(async () => null);
    const { initialize, shutdown } = await import('./sync-engine');
    const { SyncRealtime } = await import('./sync-realtime');

    await initialize();

    expect(SyncRealtime.initializeRealtime).toHaveBeenCalledWith(expect.any(Object), { polling: false });
    await shutdown();
  });

  it('schedules the sync poll when this device has sync set up', async () => {
    storageGetMock.mockImplementation(async (key: string) => key === 'syncDeviceInfo'
      ? { deviceId: 'device', userId: 'account', keySalt: 'salt', keySource: 'user-password', iterations: 600000 }
      : null);
    const { initialize, shutdown } = await import('./sync-engine');
    const { SyncRealtime } = await import('./sync-realtime');

    await initialize();

    expect(SyncRealtime.initializeRealtime).toHaveBeenCalledWith(expect.any(Object), { polling: true });
    await shutdown();
  });
});
