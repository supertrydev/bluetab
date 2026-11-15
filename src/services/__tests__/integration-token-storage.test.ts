/**
 * integration-token-storage.test.ts — GREEN on landing (Plan 14-01 Task 1).
 *
 * Contract: addAccount writes encrypted bundle; listConnectedAccounts
 * never returns access_token; getValidToken returns cached token if not
 * near expiry, else refreshes; disconnectAccount removes bundle.
 */

import {
  addAccount,
  listConnectedAccounts,
  getValidToken,
  disconnectAccount,
  disconnectAccountEverywhere,
  isIntegrationEncryptionReady,
} from '../../services/integration-token-storage';
import type { TokenBundle } from '../../types/integrations';
import {
  autoRestoreKeyFromSession,
  hasCachedKey,
} from '../../services/sync-crypto';
import {
  getCloudConnectionId,
  isCloudConnectionCredential,
} from '../../services/integrations/cloud-operation-client';

// Mock sync-crypto encryption — tests bypass real key derivation by treating
// the cache as already populated (hasCachedKey → true) so ensureCryptoKeyAvailable
// short-circuits before touching syncDeviceInfo or auto-restore.
jest.mock('../../services/sync-crypto', () => ({
  encryptSnapshot: jest.fn(async (data: unknown) => ({
    encryptedData: Buffer.from(JSON.stringify(data)).toString('base64'),
    iv: 'mockediv',
  })),
  decryptSnapshot: jest.fn(async (data: string) => {
    return JSON.parse(Buffer.from(data, 'base64').toString());
  }),
  hasCachedKey: jest.fn(() => true),
  autoRestoreKeyFromSession: jest.fn(async () => true),
  initializeEncryption: jest.fn(),
  getEncryptionConfig: jest.fn(() => ({ keySalt: 'salt', iterations: 100000 })),
}));

// Mock Storage
const localStore: Record<string, unknown> = {};
jest.mock('../../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => localStore[key] ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      localStore[key] = value;
    }),
    remove: jest.fn(async (key: string) => {
      delete localStore[key];
    }),
  },
}));

jest.mock('../../services/auth-service', () => ({
  AuthService: {
    refreshTokenIfNeeded: jest.fn(async () => undefined),
  },
}));

jest.mock('../../utils/auth-state', () => ({
  getAccessToken: jest.fn(async () => 'supertry-session-token'),
}));

jest.mock('../../config/config', () => ({
  config: {
    supertry: {
      apiUrl: 'https://api.supertry.test',
    },
  },
}));

function makeBundle(overrides: Partial<TokenBundle> = {}): TokenBundle {
  return {
    integration_id: 'linear',
    account_id: 'acc-uuid-123',
    account_label: 'Personal',
    access_token: 'tok_secret_access',
    refresh_token: 'tok_secret_refresh',
    expires_at: Date.now() + 3600_000,
    metadata: { team_id: 'team123' },
    created_at: Date.now(),
    last_used_at: Date.now(),
    ...overrides,
  };
}

describe('isIntegrationEncryptionReady', () => {
  const mockHasCachedKey = jest.mocked(hasCachedKey);
  const mockAutoRestoreKeyFromSession = jest.mocked(autoRestoreKeyFromSession);

  beforeEach(() => {
    for (const k of Object.keys(localStore)) delete localStore[k];
    jest.clearAllMocks();
    mockHasCachedKey.mockReturnValue(false);
    mockAutoRestoreKeyFromSession.mockResolvedValue(false);
  });

  afterEach(() => {
    mockHasCachedKey.mockReturnValue(true);
    mockAutoRestoreKeyFromSession.mockResolvedValue(true);
  });

  it('is unavailable before Sync creates keySalt', async () => {
    await expect(isIntegrationEncryptionReady()).resolves.toBe(false);
  });

  it('is unavailable when the configured Sync key cannot be restored', async () => {
    localStore.syncDeviceInfo = {
      keySalt: 'configured-salt',
      keySource: 'user-password',
      iterations: 100000,
    };

    await expect(isIntegrationEncryptionReady()).resolves.toBe(false);
  });

  it('does not treat a legacy device or its recovery as integration-ready', async () => {
    localStore.syncDeviceInfo = { keySalt: 'legacy-salt', userId: 'legacy-account' };
    mockAutoRestoreKeyFromSession.mockResolvedValue(true);

    await expect(isIntegrationEncryptionReady()).resolves.toBe(false);
    expect(mockAutoRestoreKeyFromSession).not.toHaveBeenCalled();
  });

  it('is ready when the configured Sync key can be restored', async () => {
    localStore.syncDeviceInfo = {
      keySalt: 'configured-salt',
      keySource: 'user-password',
      iterations: 100000,
    };
    mockAutoRestoreKeyFromSession.mockResolvedValue(true);

    await expect(isIntegrationEncryptionReady()).resolves.toBe(true);
  });
});

describe('addAccount', () => {
  beforeEach(() => {
    for (const k of Object.keys(localStore)) delete localStore[k];
    jest.clearAllMocks();
  });

  it('writes an encrypted bundle to integration_tokens', async () => {
    const bundle = makeBundle();
    await addAccount('linear', bundle);
    const stored = localStore['integration_tokens'];
    expect(stored).toBeDefined();
    // The stored value should be encrypted (base64), not raw
    const raw = JSON.stringify(stored);
    expect(raw).not.toContain('tok_secret_access');
  });
});

describe('listConnectedAccounts', () => {
  beforeEach(() => {
    for (const k of Object.keys(localStore)) delete localStore[k];
    jest.clearAllMocks();
  });

  it('never returns access_token or refresh_token', async () => {
    const bundle = makeBundle();
    await addAccount('linear', bundle);

    const accounts = await listConnectedAccounts();
    const serialized = JSON.stringify(accounts);
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('tok_secret_access');
    expect(serialized).not.toContain('refresh_token');
    expect(serialized).not.toContain('tok_secret_refresh');
  });

  it('exposes a Cloud connection state without exposing its reference as a token', async () => {
    const bundle = makeBundle({
      access_token: undefined,
      refresh_token: undefined,
      cloud_connection_ref: 'cloud-connection-123',
    });
    await addAccount('linear', bundle);

    const accounts = await listConnectedAccounts();
    expect(accounts[0].connectionKind).toBe('cloud_reference');
    expect(JSON.stringify(accounts)).not.toContain('cloud-connection-123');
    const credential = await getValidToken('linear', 'acc-uuid-123');
    expect(isCloudConnectionCredential(credential)).toBe(true);
    expect(getCloudConnectionId(credential)).toBe('cloud-connection-123');
  });

  it('returns accountId, accountLabel, and metadata', async () => {
    const bundle = makeBundle();
    await addAccount('linear', bundle);

    const accounts = await listConnectedAccounts();
    expect(accounts.length).toBeGreaterThan(0);
    const acct = accounts[0];
    expect(acct).toHaveProperty('accountId');
    expect(acct).toHaveProperty('accountLabel');
    expect(acct).toHaveProperty('metadata');
    expect(acct).toHaveProperty('integrationId');
  });

  it('hides leftover bundles of removed integrations (Gmail, Google Keep)', async () => {
    await addAccount('linear', makeBundle());
    // @ts-expect-error Gmail was removed from the integration id list
    await addAccount('gmail', makeBundle({ integration_id: 'gmail', account_id: 'gmail-1' }));
    // @ts-expect-error Google Keep was removed from the integration id list
    await addAccount('google-keep', makeBundle({ integration_id: 'google-keep', account_id: 'keep-1' }));

    const accounts = await listConnectedAccounts();
    expect(accounts.map((account) => account.integrationId)).toEqual(['linear']);
  });
});

describe('getValidToken', () => {
  beforeEach(() => {
    for (const k of Object.keys(localStore)) delete localStore[k];
    jest.clearAllMocks();
  });

  it('returns cached access_token if not near expiry (expires_at - 60s > now)', async () => {
    const bundle = makeBundle({ expires_at: Date.now() + 120_000 }); // 2 minutes from now
    await addAccount('linear', bundle);

    const token = await getValidToken('linear', 'acc-uuid-123');
    expect(token).toBe('tok_secret_access');
  });

  it('non-expiring tokens (expires_at = MAX_SAFE_INTEGER) never trigger refresh', async () => {
    const bundle = makeBundle({ expires_at: Number.MAX_SAFE_INTEGER, refresh_token: undefined });
    await addAccount('linear', bundle);

    // Should not throw even without refresh_token
    const token = await getValidToken('linear', 'acc-uuid-123');
    expect(token).toBe('tok_secret_access');
  });

  it('keeps an existing legacy Trello device token usable without converting it to a Cloud reference', async () => {
    const bundle = makeBundle({
      integration_id: 'trello',
      expires_at: Number.MAX_SAFE_INTEGER,
      refresh_token: undefined,
    });
    await addAccount('trello', bundle);

    const token = await getValidToken('trello', 'acc-uuid-123');
    const accounts = await listConnectedAccounts();

    expect(token).toBe('tok_secret_access');
    expect(accounts[0].connectionKind).toBe('device_token');
  });

  it('dedupes concurrent refreshes for the same account', async () => {
    const bundle = makeBundle({ expires_at: Date.now() - 1 });
    await addAccount('linear', bundle);
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      access_token: 'tok_rotated_access',
      refresh_token: 'tok_rotated_refresh',
      expires_in: 3600,
    }), { status: 200 }));

    const [first, second] = await Promise.all([
      getValidToken('linear', 'acc-uuid-123'),
      getValidToken('linear', 'acc-uuid-123'),
    ]);

    expect(first).toBe('tok_rotated_access');
    expect(second).toBe('tok_rotated_access');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('disconnectAccount', () => {
  beforeEach(() => {
    for (const k of Object.keys(localStore)) delete localStore[k];
    jest.clearAllMocks();
  });

  it('removes the bundle from integration_tokens', async () => {
    const bundle = makeBundle();
    await addAccount('linear', bundle);

    let accounts = await listConnectedAccounts();
    expect(accounts).toHaveLength(1);

    await disconnectAccount('linear', 'acc-uuid-123');

    accounts = await listConnectedAccounts();
    expect(accounts).toHaveLength(0);
  });
});

describe('disconnectAccountEverywhere', () => {
  beforeEach(() => {
    for (const k of Object.keys(localStore)) delete localStore[k];
    jest.clearAllMocks();
  });

  function cloudBundle(): TokenBundle {
    return makeBundle({ access_token: undefined, refresh_token: undefined, cloud_connection_ref: 'cloud-connection-123' });
  }

  it('deletes the cloud connection first, then the local bundle', async () => {
    await addAccount('linear', cloudBundle());
    global.fetch = jest.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

    await disconnectAccountEverywhere('linear', 'acc-uuid-123');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.supertry.test/v1/integrations/connections/cloud-connection-123',
      { method: 'DELETE', headers: { Authorization: 'Bearer supertry-session-token' } },
    );
    expect(await listConnectedAccounts()).toEqual([]);
  });

  it('treats an already deleted cloud connection as gone', async () => {
    await addAccount('linear', cloudBundle());
    global.fetch = jest.fn(async () => new Response('{"error":"oauth_not_found"}', { status: 404 })) as unknown as typeof fetch;

    await disconnectAccountEverywhere('linear', 'acc-uuid-123');

    expect(await listConnectedAccounts()).toEqual([]);
  });

  it('keeps the local bundle when the cloud could not revoke and delete the tokens', async () => {
    await addAccount('linear', cloudBundle());
    global.fetch = jest.fn(async () => new Response('{"error":"oauth_unavailable"}', { status: 503 })) as unknown as typeof fetch;

    await expect(disconnectAccountEverywhere('linear', 'acc-uuid-123')).rejects.toThrow('cloud_connection_delete_failed:503');
    expect(await listConnectedAccounts()).toHaveLength(1);
  });

  it('removes a device-token bundle without calling the cloud', async () => {
    await addAccount('linear', makeBundle());
    global.fetch = jest.fn() as unknown as typeof fetch;

    await disconnectAccountEverywhere('linear', 'acc-uuid-123');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(await listConnectedAccounts()).toEqual([]);
  });
});

describe('one cloud connection per provider', () => {
  beforeEach(() => {
    for (const k of Object.keys(localStore)) delete localStore[k];
    jest.clearAllMocks();
  });

  function cloud(accountId: string, lastUsedAt: number): TokenBundle {
    return makeBundle({
      integration_id: 'notion',
      account_id: accountId,
      access_token: undefined,
      refresh_token: undefined,
      cloud_connection_ref: 'shared-connection',
      last_used_at: lastUsedAt,
    });
  }

  it('replaces an older local bundle of the same cloud connection when adding', async () => {
    await addAccount('notion', cloud('first', 1));
    await addAccount('notion', cloud('second', 2));

    const accounts = await listConnectedAccounts();
    expect(accounts.map((account) => account.accountId)).toEqual(['second']);
  });

  function storeRaw(map: Record<string, TokenBundle>): void {
    // Same envelope the mocked encryptSnapshot produces.
    localStore.integration_tokens = { encryptedData: Buffer.from(JSON.stringify(map)).toString('base64'), iv: 'mockediv' };
  }

  it('shows only the most recently used of duplicates left by older builds', async () => {
    storeRaw({
      'notion:older': cloud('older', 1),
      'notion:newer': cloud('newer', 5),
      'linear:device-token': makeBundle({ account_id: 'device-token' }),
    });

    const accounts = await listConnectedAccounts();
    expect(accounts.map((account) => account.accountId).sort()).toEqual(['device-token', 'newer']);
  });

  it('removes every local duplicate when the shared cloud connection is disconnected', async () => {
    storeRaw({ 'notion:older': cloud('older', 1), 'notion:newer': cloud('newer', 5) });
    global.fetch = jest.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

    await disconnectAccountEverywhere('notion', 'newer');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await listConnectedAccounts()).toEqual([]);
  });
});
