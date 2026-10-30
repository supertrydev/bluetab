/**
 * integration-oauth-service.test.ts — GREEN on landing (Plan 14-01 Task 1).
 *
 * Contract: launchOAuthFlow stores verifier in chrome.storage.session at
 * pkce_${state} BEFORE chrome.identity.launchWebAuthFlow is called; state
 * mismatch throws; missing code throws; success path resolves with accountId
 * + token bundle and removes verifier from session storage.
 */

import {
  launchOAuthFlow,
  resetClientIdCache,
} from '../../services/integration-oauth-service';

// Mock fetch to avoid real HTTP calls during token exchange
const mockFetch = jest.fn();
(global as unknown as Record<string, unknown>).fetch = mockFetch;

// Default mock fetch returns a successful token exchange response
mockFetch.mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({
    access_token: 'mock_access_token_12345',
    refresh_token: 'mock_refresh_token_xyz',
    expires_in: 86400,
    token_type: 'Bearer',
  }),
  text: async () => JSON.stringify({ access_token: 'mock_access_token_12345' }),
});

// Mock chrome.storage.session
const sessionStore: Record<string, unknown> = {};
const sessionSetCalls: string[] = [];
const sessionRemoveCalls: string[] = [];

const mockChrome = {
  storage: {
    session: {
      set: jest.fn(async (items: Record<string, unknown>) => {
        Object.assign(sessionStore, items);
        sessionSetCalls.push(...Object.keys(items));
      }),
      get: jest.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        const keyArr = Array.isArray(keys) ? keys : [keys];
        for (const k of keyArr) {
          if (k in sessionStore) result[k] = sessionStore[k];
        }
        return result;
      }),
      remove: jest.fn(async (keys: string | string[]) => {
        const keyArr = Array.isArray(keys) ? keys : [keys];
        for (const k of keyArr) {
          delete sessionStore[k];
          sessionRemoveCalls.push(k);
        }
      }),
    },
    local: {
      get: jest.fn(async () => ({})),
      set: jest.fn(async () => {}),
      remove: jest.fn(async () => {}),
    },
  },
  identity: {
    launchWebAuthFlow: jest.fn(),
    getRedirectURL: jest.fn((path = '') =>
      `https://fakeextid.chromiumapp.org/${path.replace(/^\//, '')}`),
  },
};

(global as unknown as Record<string, unknown>).chrome = mockChrome;

const mockAddAccount = jest.fn(async (_integrationId: string, bundle: unknown) => bundle);
const mockDisconnectAccount = jest.fn(async (_integrationId: string, _accountId: string) => {});

// Also mock account persistence from integration-token-storage
jest.mock('../../services/integration-token-storage', () => ({
  addAccount: (...args: [string, unknown]) => mockAddAccount(...args),
  disconnectAccount: (...args: [string, string]) => mockDisconnectAccount(...args),
  listConnectedAccounts: jest.fn(async () => []),
}));

// Mock auth-state so the bridge resolver can read a fake Bluetab session token
// without touching chrome.storage.local + AES-GCM decryption.
const mockGetAccessToken = jest.fn(async (): Promise<string | null> => 'supertry-jwt-xyz');
jest.mock('../../utils/auth-state', () => ({
  getAccessToken: () => mockGetAccessToken(),
}));

const bridgeClients = {
  'google-calendar': 'google-client-id',
  github: 'github-client-id',
  linear: 'linear-client-id',
  notion: 'notion-client-id',
  trello: 'trello-public-key',
};

function mockBridgeFetch(clients: Record<string, string> = bridgeClients): void {
  mockFetch.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/v1/integrations/clients')) {
      return {
        ok: true,
        status: 200,
        json: async () => clients,
        text: async () => '',
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'mock_access_token_12345',
        refresh_token: 'mock_refresh_token_xyz',
        expires_in: 86400,
        token_type: 'Bearer',
      }),
      text: async () => JSON.stringify({ access_token: 'mock_access_token_12345' }),
    };
  });
}

describe.skip('retired device-side PKCE flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    resetClientIdCache();
    mockGetAccessToken.mockResolvedValue('supertry-jwt-xyz');
    mockBridgeFetch();
    sessionSetCalls.length = 0;
    sessionRemoveCalls.length = 0;
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  });

  it('stores verifier in chrome.storage.session BEFORE launchWebAuthFlow is called', async () => {
    const callOrder: string[] = [];

    mockChrome.storage.session.set.mockImplementation(async (items: Record<string, unknown>) => {
      callOrder.push('session.set');
      Object.assign(sessionStore, items);
    });

    mockChrome.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
      callOrder.push('launchWebAuthFlow');
      // The verifier should already be in session storage
      const stateParam = new URLSearchParams(new URL(url).search).get('state') || '';
      const verifierInStore = sessionStore[`pkce_${stateParam}`];
      if (!verifierInStore) {
        throw new Error('Verifier not in session storage before launchWebAuthFlow!');
      }
      // Simulate redirect with matching state and code
      return `https://fakeextid.chromiumapp.org/?code=authcode123&state=${stateParam}`;
    });

    await launchOAuthFlow('google-calendar');

    const sessionSetIndex = callOrder.indexOf('session.set');
    const launchIndex = callOrder.indexOf('launchWebAuthFlow');
    expect(sessionSetIndex).toBeLessThan(launchIndex);
    expect(sessionSetIndex).toBeGreaterThanOrEqual(0);
    expect(launchIndex).toBeGreaterThanOrEqual(0);
  });

  it('removes verifier from session storage after successful flow', async () => {
    mockChrome.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
      const stateParam = new URLSearchParams(new URL(url).search).get('state') || '';
      return `https://fakeextid.chromiumapp.org/?code=authcode123&state=${stateParam}`;
    });

    await launchOAuthFlow('google-calendar');
    // After success, pkce_* keys should be cleared
    const pkceKeys = Object.keys(sessionStore).filter((k) => k.startsWith('pkce_'));
    expect(pkceKeys).toHaveLength(0);
  });

  it('throws on state mismatch in redirect', async () => {
    mockChrome.identity.launchWebAuthFlow.mockResolvedValue(
      'https://fakeextid.chromiumapp.org/?code=authcode123&state=wrongstate'
    );

    await expect(launchOAuthFlow('google-calendar')).rejects.toThrow(/state mismatch/i);
  });

  it('throws when no code in redirect URL', async () => {
    mockChrome.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
      const stateParam = new URLSearchParams(new URL(url).search).get('state') || '';
      return `https://fakeextid.chromiumapp.org/?state=${stateParam}`;
    });

    await expect(launchOAuthFlow('google-calendar')).rejects.toThrow(/no code/i);
  });

  it('resolves with accountId and bundle on success', async () => {
    mockChrome.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
      const stateParam = new URLSearchParams(new URL(url).search).get('state') || '';
      return `https://fakeextid.chromiumapp.org/?code=authcode123&state=${stateParam}`;
    });

    const result = await launchOAuthFlow('google-calendar');
    expect(result).toHaveProperty('accountId');
    expect(result).toHaveProperty('bundle');
  });
});

describe.skip('retired Web client-id bridge flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionSetCalls.length = 0;
    sessionRemoveCalls.length = 0;
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
    mockFetch.mockReset();
    resetClientIdCache();
    mockGetAccessToken.mockResolvedValue('supertry-jwt-xyz');
  });

  it('fetches /v1/integrations/clients and uses returned client_id for Notion authorize URL', async () => {
    let capturedAuthorizeUrl = '';

    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/integrations/clients')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            notion: 'real-notion-id-from-supertry',
            github: 'real-github-id',
          }),
          text: async () => '',
        };
      }
      if (url.endsWith('/v1/integrations/notion/exchange')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'notion-tok',
            token_type: 'Bearer',
            metadata: { workspace_id: 'ws-1', workspace_name: 'X', bot_id: 'b' },
          }),
          text: async () => '',
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    mockChrome.identity.launchWebAuthFlow.mockImplementation(
      async ({ url }: { url: string }) => {
        capturedAuthorizeUrl = url;
        const stateParam = new URLSearchParams(new URL(url).search).get('state') || '';
        return `https://fakeextid.chromiumapp.org/?code=authcode&state=${stateParam}`;
      }
    );

    await launchOAuthFlow('notion');

    const parsed = new URL(capturedAuthorizeUrl);
    expect(parsed.searchParams.get('client_id')).toBe('real-notion-id-from-supertry');

    const clientsCalls = mockFetch.mock.calls.filter((c) =>
      String(c[0]).endsWith('/v1/integrations/clients')
    );
    expect(clientsCalls.length).toBe(1);
  });

  it('caches the response — a second OAuth flow within TTL does not re-fetch /clients', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/integrations/clients')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ notion: 'id-a', github: 'id-b' }),
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 't',
          token_type: 'Bearer',
          metadata: {},
        }),
        text: async () => '',
      };
    });

    mockChrome.identity.launchWebAuthFlow.mockImplementation(
      async ({ url }: { url: string }) => {
        const stateParam = new URLSearchParams(new URL(url).search).get('state') || '';
        return `https://fakeextid.chromiumapp.org/?code=c&state=${stateParam}`;
      }
    );

    await launchOAuthFlow('notion');
    await launchOAuthFlow('github');

    const clientsCalls = mockFetch.mock.calls.filter((c) =>
      String(c[0]).endsWith('/v1/integrations/clients')
    );
    expect(clientsCalls.length).toBe(1);
  });

  it('throws a clear error when the bridge response omits the requested provider', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/integrations/clients')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ github: 'only-github' }),
          text: async () => '',
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(launchOAuthFlow('notion')).rejects.toThrow(
      /OAuth not configured for notion/i
    );
  });

  it('throws when /clients returns non-2xx', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/integrations/clients')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({}),
          text: async () => 'unauthorized',
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(launchOAuthFlow('notion')).rejects.toThrow(
      /Failed to fetch integration client_ids/i
    );
  });

  it('Linear uses Supertry bridge to fetch client_id like other integrations', async () => {
    let capturedAuthorizeUrl = '';

    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/integrations/clients')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            linear: 'real-linear-id-from-supertry',
            notion: 'real-notion-id',
          }),
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'linear-tok',
          token_type: 'Bearer',
        }),
        text: async () => '',
      };
    });
    mockChrome.identity.launchWebAuthFlow.mockImplementation(
      async ({ url }: { url: string }) => {
        capturedAuthorizeUrl = url;
        const stateParam = new URLSearchParams(new URL(url).search).get('state') || '';
        return `https://fakeextid.chromiumapp.org/?code=c&state=${stateParam}`;
      }
    );

    await launchOAuthFlow('linear');

    const parsed = new URL(capturedAuthorizeUrl);
    expect(parsed.searchParams.get('client_id')).toBe('real-linear-id-from-supertry');

    const clientsCalls = mockFetch.mock.calls.filter((c) =>
      String(c[0]).endsWith('/v1/integrations/clients')
    );
    expect(clientsCalls.length).toBe(1);
  });
});

describe('launchOAuthFlow — Cloud connection reference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    mockGetAccessToken.mockResolvedValue('supertry-jwt-xyz');
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/authorize')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            authorizationUrl: 'https://linear.app/oauth/authorize?state=cloud-state',
            state: 'cloud-state',
          }),
        };
      }
      if (url.endsWith('/callback')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            connectionId: 'cloud-connection-ref',
            provider: 'linear',
            scopes: ['read'],
            metadata: { organization_id: 'org-1' },
            operationsAvailable: true,
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    mockChrome.identity.launchWebAuthFlow.mockResolvedValue(
      'https://fakeextid.chromiumapp.org/?code=cloud-code&state=cloud-state'
    );
  });

  it('sends the provider-specific chromiumapp callback URI to Cloud authorize', async () => {
    await launchOAuthFlow('linear');
    const authorizeCall = mockFetch.mock.calls.find(([url]) =>
      String(url).endsWith('/linear/authorize')
    );
    expect(JSON.parse(String(authorizeCall?.[1]?.body))).toEqual({
      redirectUri: 'https://fakeextid.chromiumapp.org/v1/integrations/providers/linear/callback',
      scopes: ['read', 'issues:create', 'write'],
    });
  });

  it.each([
    'Authorization page could not be loaded.',
    'net::ERR_NAME_NOT_RESOLVED',
    'LOAD_FAILED',
  ])(
    'maps launchWebAuthFlow navigation failure %s to a provider-aware unreachable error',
    async (message) => {
      mockChrome.identity.launchWebAuthFlow.mockRejectedValueOnce(new Error(message));

      await expect(launchOAuthFlow('discord')).rejects.toMatchObject({
        name: 'OAuthProviderUnreachableError',
        code: 'oauth_provider_unreachable',
        providerName: 'Discord',
      });
    },
  );

  it('does not classify user cancellation as a provider network failure', async () => {
    const cancellation = new Error('The user did not approve access.');
    mockChrome.identity.launchWebAuthFlow.mockRejectedValueOnce(cancellation);

    await expect(launchOAuthFlow('discord')).rejects.toBe(cancellation);
  });

  it('keeps callback 503 failures outside the launch navigation error contract', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/authorize')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            authorizationUrl: 'https://discord.com/oauth2/authorize?state=cloud-state',
            state: 'cloud-state',
          }),
        };
      }
      if (url.endsWith('/callback')) {
        return { ok: false, status: 503 };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    mockChrome.identity.launchWebAuthFlow.mockResolvedValueOnce(
      'https://fakeextid.chromiumapp.org/?code=cloud-code&state=cloud-state',
    );

    await expect(launchOAuthFlow('discord')).rejects.toEqual(
      new Error('Cloud OAuth callback failed (503)'),
    );
  });

  it('persists the opaque Cloud reference separately and never as access_token', async () => {
    const result = await launchOAuthFlow('linear');
    expect(result.bundle.cloud_connection_ref).toBe('cloud-connection-ref');
    expect(result.bundle.access_token).toBeUndefined();
    expect(result.bundle.metadata).toEqual({
      cloud_provider: 'linear',
      organization_id: 'org-1',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/linear\/authorize$/),
      expect.objectContaining({ body: expect.not.stringContaining('access_token') }),
    );
  });
});

describe('launchOAuthFlow — Trello Cloud OAuth 1.0a', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionSetCalls.length = 0;
    sessionRemoveCalls.length = 0;
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
    mockFetch.mockReset();
    resetClientIdCache();
    mockGetAccessToken.mockResolvedValue('supertry-jwt-xyz');
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/trello/authorize')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            authorizationUrl: 'https://trello.com/1/OAuthAuthorizeToken?oauth_token=request-token',
            state: 'cloud-state',
          }),
        };
      }
      if (String(url).endsWith('/trello/callback')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            connectionId: 'trello-cloud-connection',
            provider: 'trello',
            scopes: ['read', 'write'],
            metadata: {},
            operationsAvailable: true,
            access_token: 'must-not-be-persisted',
            token_secret: 'must-not-be-persisted',
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    mockChrome.identity.launchWebAuthFlow.mockResolvedValue(
      'https://fakeextid.chromiumapp.org/v1/integrations/providers/trello/callback?oauth_token=request-token&oauth_verifier=oauth-verifier&state=cloud-state',
    );
  });

  it('uses the Cloud authorize and OAuth1 callback envelopes without fetching the legacy Web client ID', async () => {
    const result = await launchOAuthFlow('trello');

    const authorizeCall = mockFetch.mock.calls.find(([url]) =>
      String(url).endsWith('/trello/authorize')
    );
    expect(JSON.parse(String(authorizeCall?.[1]?.body))).toEqual({
      redirectUri: 'https://fakeextid.chromiumapp.org/v1/integrations/providers/trello/callback',
      scopes: ['read', 'write'],
    });
    const callbackCall = mockFetch.mock.calls.find(([url]) =>
      String(url).endsWith('/trello/callback')
    );
    expect(JSON.parse(String(callbackCall?.[1]?.body))).toEqual({
      oauthToken: 'request-token',
      oauthVerifier: 'oauth-verifier',
      state: 'cloud-state',
    });
    expect(mockFetch.mock.calls.some(([url]) =>
      String(url).endsWith('/v1/integrations/clients')
    )).toBe(false);
    expect(result.bundle.cloud_connection_ref).toBe('trello-cloud-connection');
    expect(result.bundle.access_token).toBeUndefined();
    expect(result.bundle.refresh_token).toBeUndefined();
    expect(JSON.stringify(result.bundle)).not.toMatch(/must-not-be-persisted/);
  });

  it('rejects a Trello callback missing oauth_verifier without falling back to OAuth2 code parsing', async () => {
    mockChrome.identity.launchWebAuthFlow.mockResolvedValueOnce(
      'https://fakeextid.chromiumapp.org/v1/integrations/providers/trello/callback?oauth_token=request-token&state=cloud-state',
    );

    await expect(launchOAuthFlow('trello')).rejects.toThrow(/oauth_verifier/i);
    expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith('/trello/callback'))).toBe(false);
  });
});
