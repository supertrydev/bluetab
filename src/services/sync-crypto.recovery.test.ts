import {
  autoRestoreKeyFromSession,
  clearAllSyncSession,
  clearCachedKey,
  deriveSyncKey,
} from './sync-crypto';
import { getRefreshToken } from '@/utils/auth-state';

jest.mock('@/utils/auth-state', () => ({
  getRefreshToken: jest.fn(),
}));

const FAKE_CRYPTO_KEY = {
  type: 'secret',
  extractable: false,
  algorithm: { name: 'AES-GCM' },
  usages: ['encrypt', 'decrypt'],
} as unknown as CryptoKey;

const RAW_KEY_BYTES = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));

describe('sync-crypto recovery cache', () => {
  const localStore: Record<string, unknown> = {};
  const sessionStore: Record<string, unknown> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    clearCachedKey();

    for (const key of Object.keys(localStore)) delete localStore[key];
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];

    (getRefreshToken as jest.Mock).mockResolvedValue('recovery-token');

    (chrome.storage.local.get as jest.Mock).mockImplementation(async (keys?: string | string[]) => {
      if (!keys) return { ...localStore };
      if (Array.isArray(keys)) {
        return keys.reduce<Record<string, unknown>>((acc, key) => {
          if (key in localStore) acc[key] = localStore[key];
          return acc;
        }, {});
      }
      return { [keys]: localStore[keys] };
    });
    (chrome.storage.local.set as jest.Mock).mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(localStore, items);
    });
    (chrome.storage.local.remove as jest.Mock).mockImplementation(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete localStore[key];
      }
    });
    (chrome.storage.local.setAccessLevel as jest.Mock | undefined)?.mockResolvedValue(undefined);

    (chrome.storage.session.get as jest.Mock).mockImplementation(async (keys?: string | string[]) => {
      if (!keys) return { ...sessionStore };
      if (Array.isArray(keys)) {
        return keys.reduce<Record<string, unknown>>((acc, key) => {
          if (key in sessionStore) acc[key] = sessionStore[key];
          return acc;
        }, {});
      }
      return { [keys]: sessionStore[keys] };
    });
    (chrome.storage.session.set as jest.Mock).mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(sessionStore, items);
    });
    (chrome.storage.session.remove as jest.Mock).mockImplementation(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete sessionStore[key];
      }
    });

    (global as Record<string, unknown>).crypto = {
      getRandomValues: jest.fn().mockImplementation((array: Uint8Array) => {
        for (let index = 0; index < array.length; index += 1) {
          array[index] = (index % 251) + 1;
        }
        return array;
      }),
      subtle: {
        importKey: jest.fn().mockResolvedValue(FAKE_CRYPTO_KEY),
        deriveBits: jest.fn().mockResolvedValue(RAW_KEY_BYTES.buffer),
        encrypt: jest.fn().mockImplementation(async (_algorithm: unknown, _key: unknown, data: BufferSource) => {
          if (data instanceof ArrayBuffer) return data;
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }),
        decrypt: jest.fn().mockImplementation(async (_algorithm: unknown, _key: unknown, data: BufferSource) => {
          if (data instanceof ArrayBuffer) return data;
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }),
      },
    };
  });

  afterEach(async () => {
    await clearAllSyncSession();
    clearCachedKey();
    delete (global as Record<string, unknown>).crypto;
  });

  it('persists a wrapped recovery blob and restores the key when the session password is gone', async () => {
    const salt = btoa('test-salt-16byte');

    await expect(deriveSyncKey('super-secret-password', salt, 600000)).resolves.toBe(true);

    expect(sessionStore.syncPasswordSession).toBe('super-secret-password');
    expect(localStore.syncKeyRecovery).toBeDefined();
    expect(JSON.stringify(localStore.syncKeyRecovery)).not.toContain('super-secret-password');

    delete sessionStore.syncPasswordSession;
    clearCachedKey();

    await expect(autoRestoreKeyFromSession(salt)).resolves.toBe(true);
  });

  it('clears the persisted recovery blob when sync session data is cleared', async () => {
    const salt = btoa('test-salt-16byte');

    await deriveSyncKey('another-secret-password', salt, 600000);
    expect(localStore.syncKeyRecovery).toBeDefined();

    await clearAllSyncSession();

    expect(localStore.syncKeyRecovery).toBeUndefined();
    expect(sessionStore.syncPasswordSession).toBeUndefined();
  });
});
