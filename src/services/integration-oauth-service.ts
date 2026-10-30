/**
 * @module services/integration-oauth-service
 *
 * WHY: Handle OAuth PKCE flows for curated third-party integrations.
 *
 * WHAT: Exports:
 *   - generatePKCE(): Web Crypto PKCE code_verifier + code_challenge helper
 *   - launchOAuthFlow(integrationId): Full OAuth dance via chrome.identity
 *   - exchangeCodeForToken(code, verifier, integrationId): Direct or Supertry bridge
 *   - resetClientIdCache(): test helper to drop the in-memory client_id cache
 *
 * HOW: For oauth_pkce integrations: generates PKCE pair, stores verifier in
 *      chrome.storage.session BEFORE calling launchWebAuthFlow (RESEARCH §Pitfall 1
 *      SW-restart guard), then exchanges code for token bundle. Direct PKCE
 *      providers carry their public client_id in the registry entry.
 *      For oauth_pkce_via_supertry: client_id is NOT in the registry — it is
 *      fetched at runtime from GET /api/v1/integrations/clients so Dokploy env
 *      remains the single source of truth (rotation = restart, no rebuild).
 *      In-memory cache, 5-minute TTL.
 *      For token_paste: returns a marker the UI uses to render the paste form.
 *
 * NOT: Does not store tokens (that's integration-token-storage.ts).
 *      Does not embed client_secret (that's the Supertry bridge's job).
 */

import {
  getIntegrationUnavailableMessage,
  getRegistryEntry,
} from './integrations/registry';
import type { IntegrationId } from './integrations/registry';
import type { TokenBundle } from '../types/integrations';
import { addAccount, disconnectAccount } from './integration-token-storage';
import { getAccessToken } from '../utils/auth-state';
import { config } from '../config/config';
import { mapOAuthLaunchError } from './oauth-errors';

// ============================================================================
// PKCE Helper (Web Crypto — ~30 lines)
// ============================================================================

/**
 * Generate a PKCE code_verifier and code_challenge pair.
 * code_verifier: 32 random bytes → base64url (no padding, - for +, _ for /)
 * code_challenge: base64url(SHA-256(verifier))
 *
 * RESEARCH §Pattern 2 — standard PKCE, RFC 7636 compliant.
 */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const challengeBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return { verifier, challenge };
}

// ============================================================================
// Bridge client_id resolver — runtime fetch + in-memory cache
// ============================================================================

const BRIDGE_AUTH_TYPE = 'oauth_pkce_via_supertry';
const CLIENT_ID_CACHE_TTL_MS = 5 * 60 * 1000;

interface ClientsCacheEntry {
  fetchedAt: number;
  clients: Partial<Record<IntegrationId, string>>;
}

let clientsCache: ClientsCacheEntry | null = null;

/**
 * Test helper — drops the in-memory client_id cache so tests start clean.
 */
export function resetClientIdCache(): void {
  clientsCache = null;
}

function resolveAccountLabel(
  fallback: string,
  metadata: Record<string, string> | undefined,
): string {
  const candidates = [
    metadata?.workspace_name,
    metadata?.team_name,
    metadata?.organization_name,
    metadata?.cloud_name,
    metadata?.site_name,
    metadata?.email,
    metadata?.login,
    metadata?.username,
  ];
  return candidates.find((value) => value?.trim())?.trim() ?? fallback;
}

async function fetchBridgeClients(): Promise<ClientsCacheEntry> {
  const supertryToken = await getSupertryUserToken();
  const bridgeUrl = await getSupertryBridgeBaseUrl();

  const res = await fetch(`${bridgeUrl}/v1/integrations/clients`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${supertryToken}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown error');
    throw new Error(
      `Failed to fetch integration client_ids from Supertry (${res.status}): ${errText}`
    );
  }

  const clients = (await res.json()) as Partial<Record<IntegrationId, string>>;
  return { fetchedAt: Date.now(), clients };
}

/**
 * Resolve the OAuth client_id for an integration.
 *
 * Bridge providers (auth_type='oauth_pkce_via_supertry') fetch from
 * Supertry's /v1/integrations/clients endpoint with a 5-minute in-memory
 * cache. Non-bridge providers read directly from the registry entry.
 *
 * Throws if the bridge fetch fails or if the resolved value is missing —
 * never returns a placeholder string.
 */
export async function getResolvedClientId(
  integrationId: IntegrationId,
  entry: NonNullable<ReturnType<typeof getRegistryEntry>>
): Promise<string> {
  if (entry.auth_type !== BRIDGE_AUTH_TYPE) {
    if (!entry.oauth_client_id) {
      throw new Error(
        `Integration ${integrationId} has no oauth_client_id in the registry`
      );
    }
    return entry.oauth_client_id;
  }

  const now = Date.now();
  if (!clientsCache || now - clientsCache.fetchedAt > CLIENT_ID_CACHE_TTL_MS) {
    clientsCache = await fetchBridgeClients();
  }

  const clientId = clientsCache.clients[integrationId];
  if (!clientId) {
    throw new Error(
      `OAuth not configured for ${integrationId} on Supertry — set ${integrationId.toUpperCase()}_CLIENT_ID in the server env and restart`
    );
  }
  return clientId;
}

/**
 * Fetch Trello's API key from Supertry bridge (same cache as getResolvedClientId).
 * Exported so the Trello adapter can use it for API calls.
 */
export async function fetchTrelloApiKey(): Promise<string> {
  const now = Date.now();
  if (!clientsCache || now - clientsCache.fetchedAt > CLIENT_ID_CACHE_TTL_MS) {
    clientsCache = await fetchBridgeClients();
  }
  const key = clientsCache.clients['trello' as IntegrationId];
  if (!key) {
    throw new Error(
      'Trello API key not configured on Supertry — set TRELLO_CLIENT_ID in the server env and restart'
    );
  }
  return key;
}

// ============================================================================
// OAuth Flow Launch
// ============================================================================

async function launchProviderWebAuthFlow(
  providerName: string,
  authorizationUrl: string,
): Promise<string | undefined> {
  try {
    return await chrome.identity.launchWebAuthFlow({
      url: authorizationUrl,
      interactive: true,
    });
  } catch (error) {
    throw mapOAuthLaunchError(error, providerName);
  }
}

/**
 * Launch the full OAuth flow for an integration.
 *
 * CRITICAL — SW-restart guard (RESEARCH §Pitfall 1):
 * The PKCE verifier MUST be stored in chrome.storage.session BEFORE
 * calling launchWebAuthFlow. Service worker may restart mid-flow
 * (user slow on consent); session storage persists across SW restarts.
 *
 * @returns { accountId, bundle } on success
 * @throws on state mismatch, missing code, or cancelled flow
 */
export async function launchOAuthFlow(
  integrationId: IntegrationId,
  existingAccountId?: string
): Promise<{ accountId: string; bundle: TokenBundle }> {
  const unavailableMessage = getIntegrationUnavailableMessage(integrationId);
  if (unavailableMessage) {
    throw new Error(unavailableMessage);
  }

  const entry = getRegistryEntry(integrationId);
  if (!entry) {
    throw new Error(`Integration ${integrationId} not found in registry`);
  }

  if (entry.auth_type === 'token_paste') {
    throw new Error(`Integration ${integrationId} uses token_paste auth — use the paste UI`);
  }

  if (entry.auth_type === 'oauth_pkce_via_supertry') {
    return launchCloudOAuthFlow(integrationId, entry, existingAccountId);
  }

  const clientId = await getResolvedClientId(integrationId, entry);
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomUUID();
  const redirectUri = resolveRedirectUri(entry.redirect_uri_kind);

  // CRITICAL: store verifier BEFORE launchWebAuthFlow (SW-restart guard)
  await chrome.storage.session.set({
    [`pkce_${state}`]: { verifier, integrationId },
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: (entry.oauth_scopes || []).join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  // Google OAuth uses access_type=offline as a query parameter (not a scope)
  // to issue refresh tokens. prompt=consent ensures a refresh token is always
  // returned, even on re-authorization. See: google-calendar.md.
  if (entry.redirect_uri_kind === 'google-identity') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  }

  let redirectUrl: string | undefined;
  try {
    if (integrationId === 'asana') {
      console.info(
        `[OAuth:asana] launching authorize URL authorizeUrl=${entry.oauth_authorize_url} clientId=${clientId} redirectUri=${redirectUri} scope=${(entry.oauth_scopes || []).join(' ')}`
      );
    }
    redirectUrl = await launchProviderWebAuthFlow(
      entry.display_name,
      `${entry.oauth_authorize_url}?${params}`,
    );
  } catch (err) {
    await chrome.storage.session.remove(`pkce_${state}`);
    throw err;
  }

  if (!redirectUrl) {
    await chrome.storage.session.remove(`pkce_${state}`);
    throw new Error('OAuth flow cancelled or no redirect URL returned');
  }

  // Parse redirect URL — code is in query params (RESEARCH §Pitfall 2: never fragment)
  const url = new URL(redirectUrl);
  const returnedState = url.searchParams.get('state');

  if (returnedState !== state) {
    await chrome.storage.session.remove(`pkce_${state}`);
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const code = url.searchParams.get('code');
  if (!code) {
    await chrome.storage.session.remove(`pkce_${state}`);
    throw new Error('No code in redirect URL');
  }

  // Clean up verifier
  await chrome.storage.session.remove(`pkce_${state}`);

  // Exchange code for token
  const bundle = await exchangeCodeForToken(code, verifier, integrationId, redirectUri, existingAccountId);

  // Persist token bundle — when reconnecting, remove old entry first
  if (existingAccountId) {
    await disconnectAccount(integrationId, existingAccountId);
  }
  await addAccount(integrationId, bundle);

  return { accountId: bundle.account_id, bundle };
}

async function launchCloudOAuthFlow(
  integrationId: IntegrationId,
  entry: NonNullable<ReturnType<typeof getRegistryEntry>>,
  existingAccountId?: string,
): Promise<{ accountId: string; bundle: TokenBundle }> {
  const userToken = await getSupertryUserToken();
  const redirectUri = chrome.identity.getRedirectURL(
    `/v1/integrations/providers/${integrationId}/callback`,
  );
  const baseUrl = await getSupertryBridgeBaseUrl();
  const authorize = await fetch(`${baseUrl}/v1/integrations/${integrationId}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ redirectUri, scopes: entry.oauth_scopes || [] }),
  });
  if (!authorize.ok) throw new Error(`Cloud OAuth authorization failed (${authorize.status})`);
  const started = await authorize.json() as { authorizationUrl: string; state: string };
  const redirectUrl = await launchProviderWebAuthFlow(
    entry.display_name,
    started.authorizationUrl,
  );
  if (!redirectUrl) throw new Error('OAuth flow cancelled or no redirect URL returned');
  const returned = new URL(redirectUrl);
  const state = returned.searchParams.get('state');
  if (!state || state !== started.state) throw new Error('OAuth state mismatch — possible CSRF attack');

  let callbackBody: { code: string; state: string } | {
    oauthToken: string;
    oauthVerifier: string;
    state: string;
  };
  if (integrationId === 'trello') {
    const oauthToken = returned.searchParams.get('oauth_token');
    const oauthVerifier = returned.searchParams.get('oauth_verifier');
    if (!oauthToken) throw new Error('No oauth_token in Trello redirect URL');
    if (!oauthVerifier) throw new Error('No oauth_verifier in Trello redirect URL');
    callbackBody = { oauthToken, oauthVerifier, state };
  } else {
    const code = returned.searchParams.get('code');
    if (!code) throw new Error('No code in redirect URL');
    callbackBody = { code, state };
  }

  const callback = await fetch(`${baseUrl}/v1/integrations/${integrationId}/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: JSON.stringify(callbackBody),
  });
  if (!callback.ok) throw new Error(`Cloud OAuth callback failed (${callback.status})`);
  const connected = await callback.json() as {
    connectionId: string;
    provider: string;
    scopes: string[];
    metadata?: Record<string, string>;
    operationsAvailable: true;
  };
  const now = Date.now();
  const bundle: TokenBundle = {
    integration_id: integrationId,
    account_id: existingAccountId || crypto.randomUUID(),
    account_label: entry.display_name,
    cloud_connection_ref: connected.connectionId,
    expires_at: Number.MAX_SAFE_INTEGER,
    metadata: { cloud_provider: connected.provider, ...(connected.metadata ?? {}) },
    created_at: now,
    last_used_at: now,
  };
  if (existingAccountId) await disconnectAccount(integrationId, existingAccountId);
  await addAccount(integrationId, bundle);
  return { accountId: bundle.account_id, bundle };
}

// ============================================================================
// Code Exchange
// ============================================================================

/**
 * Exchange authorization code for a token bundle.
 *
 * For oauth_pkce: direct POST to entry.oauth_token_url.
 * For oauth_pkce_via_supertry: POST to Supertry bridge endpoint.
 *
 * The bridge spec is at docs/integrations/SUPERTRY-BRIDGE-SPEC.md.
 */
export async function exchangeCodeForToken(
  code: string,
  verifier: string,
  integrationId: IntegrationId,
  redirectUri: string,
  existingAccountId?: string
): Promise<TokenBundle> {
  const entry = getRegistryEntry(integrationId);
  if (!entry) {
    throw new Error(`Integration ${integrationId} not found in registry`);
  }

  const now = Date.now();
  const expiresAt = entry.token_expiry_seconds != null
    ? now + entry.token_expiry_seconds * 1000
    : Number.MAX_SAFE_INTEGER;

  if (entry.auth_type === 'oauth_pkce') {
    // Direct exchange
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: entry.oauth_client_id || '',
      redirect_uri: redirectUri,
    });

    const res = await fetch(entry.oauth_token_url!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown error');
      throw new Error(`Token exchange failed (${res.status}): ${errText}`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    return {
      integration_id: integrationId,
      account_id: existingAccountId || crypto.randomUUID(),
      account_label: 'Personal',
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_in ? now + data.expires_in * 1000 : expiresAt,
      metadata: {},
      created_at: now,
      last_used_at: now,
    };
  } else if (entry.auth_type === 'oauth_pkce_via_supertry') {
    // Supertry bridge exchange (docs/integrations/SUPERTRY-BRIDGE-SPEC.md)
    const supertryToken = await getSupertryUserToken();
    const bridgeUrl = await getSupertryBridgeBaseUrl();

    const res = await fetch(`${bridgeUrl}/v1/integrations/${integrationId}/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supertryToken}`,
      },
      body: JSON.stringify({
        integrationId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: 'unknown' })) as {
        error?: string;
        error_description?: string;
      };
      throw new Error(
        `Supertry bridge exchange failed (${res.status}): ${errData.error_description || errData.error}`
      );
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
      metadata: Record<string, string>;
    };
    const metadata = data.metadata || {};

    return {
      integration_id: integrationId,
      account_id: existingAccountId || crypto.randomUUID(),
      account_label: resolveAccountLabel('Connected account', metadata),
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_in ? now + data.expires_in * 1000 : expiresAt,
      metadata,
      created_at: now,
      last_used_at: now,
    };
  }

  throw new Error(`Unsupported auth_type for code exchange: ${entry.auth_type}`);
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Resolve the redirect URI based on the registry entry's redirect_uri_kind.
 *
 * 'supertry-proxy': Provider rejects chromiumapp.org URLs (e.g. Todoist).
 * The authorize request uses a Supertry endpoint as redirect_uri; Supertry
 * 302-redirects to chromiumapp.org so launchWebAuthFlow still catches it.
 */
function resolveRedirectUri(kind: string): string {
  if (kind === 'supertry-proxy') {
    return `${config.supertry.apiUrl}/v1/oauth/redirect`;
  }
  return chrome.identity.getRedirectURL();
}

async function getSupertryUserToken(): Promise<string> {
  // Read the same token sync-transport.ts uses — chrome.storage.local under
  // config.storage.keys.authToken, decrypted by AuthState.getAccessToken().
  // (Earlier draft incorrectly looked at chrome.storage.session.auth_session,
  // which is never written to by auth-service.)
  const token = await getAccessToken();
  if (!token) {
    throw new Error('No Supertry auth token — user must be logged in to Bluetab');
  }
  return token;
}

async function getSupertryBridgeBaseUrl(): Promise<string> {
  // Earlier draft used a CommonJS require() that does not resolve at runtime
  // in the bundled extension. ES import at the top of the module works.
  return config.supertry.apiUrl;
}
