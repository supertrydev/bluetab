/**
 * @module services/integration-token-storage
 *
 * WHY: Single encrypted token bundle CRUD service for all Phase 14 integrations.
 *
 * WHAT: Exports:
 *   - addAccount(integrationId, bundle): Encrypt + persist bundle
 *   - getValidToken(integrationId, accountId): Transparent refresh on near-expiry
 *   - listConnectedAccounts(): Public shape (NO access_token/refresh_token)
 *   - disconnectAccount(integrationId, accountId): Remove bundle + clean settings
 *   - rotateBundle(integrationId, accountId, newBundle): In-place replace
 *
 * TOKEN-01: Tokens are NEVER returned from listConnectedAccounts.
 *           Tokens are NEVER in delta-tracker SYNCABLE_KEYS.
 *           Tokens are NEVER logged to console (redacted via allowlist).
 *
 * HOW: Bundles encrypted at rest using sync-crypto (Phase 13 MCP credential parity).
 *      Storage key: 'integration_tokens' (NOT in SYNCABLE_KEYS — TOKEN-01 contract).
 */

import {
  encryptSnapshot,
  decryptSnapshot,
  hasCachedKey,
  autoRestoreKeyFromSession,
  initializeEncryption,
  getEncryptionConfig,
} from './sync-crypto';
import { Storage } from '../utils/storage';
import { isLegacySyncDevice, type LocalDeviceInfo } from '../types/sync';
import type { TokenBundle, IntegrationAccount } from '../types/integrations';
import type { IntegrationId } from './integrations/registry';
import { getRegistryEntry, INTEGRATION_IDS } from './integrations/registry';
import { getAccessToken } from '../utils/auth-state';
import { AuthService } from './auth-service';
import { createCloudConnectionCredential, deleteCloudConnection } from './integrations/cloud-operation-client';

const TOKENS_KEY = 'integration_tokens';
const SETTINGS_KEY = 'integration_settings';
const REAUTH_KEY_PREFIX = 'integration_reauth_required';
const DEVICE_INFO_KEY = 'syncDeviceInfo';

const inFlightRefreshes = new Map<string, Promise<TokenBundle>>();

class RefreshFailure extends Error {
  readonly requiresReauth: boolean;

  constructor(message: string, requiresReauth: boolean) {
    super(message);
    this.name = 'RefreshFailure';
    this.requiresReauth = requiresReauth;
  }
}

interface TokenErrorResponse {
  error?: string;
  error_description?: string;
}

// ============================================================================
// Types
// ============================================================================

interface EncryptedTokenMap {
  encryptedData: string;
  iv: string;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Make sure sync-crypto's in-memory key cache is populated for this JS realm.
 *
 * The service worker derives the key on startup, but the Settings page lives
 * in a separate JS realm with its own (empty) cache, so a Connect-button
 * flow that runs entirely on the Settings side hits "No sync key cached"
 * the first time it tries to encrypt. This guard mirrors what sync-engine
 * does at SW startup: read syncDeviceInfo and restore the password-backed
 * session key for password-backed devices.
 */
async function ensureCryptoKeyAvailable(): Promise<void> {
  if (hasCachedKey()) return;

  const deviceInfo = await Storage.get<LocalDeviceInfo>(DEVICE_INFO_KEY);
  if (!deviceInfo?.keySalt) {
    throw new Error(
      'Sync not set up — cannot encrypt integration tokens. Sign in to Bluetab and finish initial sync setup first.'
    );
  }

  if (isLegacySyncDevice(deviceInfo)) {
    throw new Error('Reconnect sync with a sync password before connecting integrations.');
  }

  const iterations = deviceInfo.iterations || 100000;
  if (!getEncryptionConfig()) {
    initializeEncryption({ keySalt: deviceInfo.keySalt, iterations, keySource: 'user-password' });
  }

  if (!(await autoRestoreKeyFromSession(deviceInfo.keySalt, iterations))) {
    throw new Error(
      'Could not restore sync encryption key — enter your sync password before connecting integrations, then retry.'
    );
  }
}

async function loadTokenMap(): Promise<Record<string, TokenBundle>> {
  const raw = await Storage.get<EncryptedTokenMap>(TOKENS_KEY);
  if (!raw) return {};
  await ensureCryptoKeyAvailable();
  try {
    const decrypted = await decryptSnapshot<Record<string, TokenBundle>>(raw.encryptedData, raw.iv);
    return decrypted || {};
  } catch {
    return {};
  }
}

async function saveTokenMap(map: Record<string, TokenBundle>): Promise<void> {
  await ensureCryptoKeyAvailable();
  const encrypted = await encryptSnapshot(map);
  await Storage.set(TOKENS_KEY, encrypted);
}

function bundleKey(integrationId: string, accountId: string): string {
  return `${integrationId}:${accountId}`;
}

function keysForCloudConnection(map: Record<string, TokenBundle>, connectionId: string | undefined): string[] {
  if (!connectionId) return [];
  return Object.keys(map).filter((key) => map[key].cloud_connection_ref === connectionId);
}

/**
 * Older builds let "Add account" create several local bundles for the single
 * cloud connection a provider has per user. Show only the most recently used.
 */
function collapseCloudDuplicates(bundles: TokenBundle[]): TokenBundle[] {
  const newest = new Map<string, TokenBundle>();
  for (const bundle of bundles) {
    const ref = bundle.cloud_connection_ref;
    if (!ref) continue;
    const current = newest.get(ref);
    if (!current || bundle.last_used_at > current.last_used_at) newest.set(ref, bundle);
  }
  return bundles.filter((bundle) => !bundle.cloud_connection_ref || newest.get(bundle.cloud_connection_ref) === bundle);
}

function isPermanentRefreshFailure(errorCode?: string): boolean {
  return errorCode === 'invalid_grant';
}

async function readTokenError(res: Response): Promise<TokenErrorResponse> {
  return (await res.json().catch(() => ({}))) as TokenErrorResponse;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check whether this page can use the existing Sync encryption key.
 *
 * This deliberately reuses the same restoration path as encrypted token
 * storage. Callers can offer setup guidance before OAuth without weakening
 * ensureCryptoKeyAvailable(), which remains the final write-time guard.
 */
export async function isIntegrationEncryptionReady(): Promise<boolean> {
  try {
    await ensureCryptoKeyAvailable();
    return true;
  } catch {
    return false;
  }
}

/**
 * Add or update a connected account token bundle.
 * Encrypts at rest before writing.
 */
export async function addAccount(
  integrationId: IntegrationId,
  bundle: TokenBundle
): Promise<void> {
  const map = await loadTokenMap();
  const key = bundleKey(integrationId, bundle.account_id);
  // The cloud keeps one connection per provider and user, so a second local
  // bundle for the same connection would be a duplicate of this one.
  for (const otherKey of keysForCloudConnection(map, bundle.cloud_connection_ref)) {
    if (otherKey !== key) delete map[otherKey];
  }
  map[key] = bundle;
  await saveTokenMap(map);
}

/**
 * Get a valid access token, transparently refreshing if near expiry.
 * Throws if bundle not found or refresh fails.
 *
 * TOKEN-01: access_token is returned as a string scalar — never logged.
 */
export async function getValidToken(
  integrationId: IntegrationId,
  accountId: string
): Promise<string> {
  console.log(`[TokenStorage] Getting token for ${integrationId}:${accountId}`);

  const map = await loadTokenMap();
  const key = bundleKey(integrationId, accountId);
  const bundle = map[key];

  if (!bundle) {
    console.error(`[TokenStorage] No token bundle found for ${integrationId}:${accountId}`);
    throw new Error(`No token bundle found for ${integrationId}:${accountId}`);
  }

  if (bundle.cloud_connection_ref) {
    return createCloudConnectionCredential(bundle.cloud_connection_ref);
  }
  if (!bundle.access_token) {
    throw new Error('integration_credential_unavailable');
  }

  console.log(`[TokenStorage] Found bundle, expires_at: ${bundle.expires_at === Number.MAX_SAFE_INTEGER ? 'never' : new Date(bundle.expires_at).toISOString()}`);

  // Non-expiring tokens (Number.MAX_SAFE_INTEGER) never refresh
  if (bundle.expires_at === Number.MAX_SAFE_INTEGER) {
    console.log(`[TokenStorage] Non-expiring token, returning access_token`);
    return bundle.access_token;
  }

  // Return cached token if more than 60 seconds before expiry
  if (bundle.expires_at - 60_000 > Date.now()) {
    console.log(`[TokenStorage] Token still valid, returning cached access_token`);
    return bundle.access_token;
  }

  // Refresh needed
  console.log(`[TokenStorage] Token near expiry, refreshing...`);
  const existingRefresh = inFlightRefreshes.get(key);
  if (existingRefresh) {
    console.log(`[TokenStorage] Reusing in-flight refresh for ${integrationId}:${accountId}`);
    const newBundle = await existingRefresh;
    return newBundle.access_token!;
  }

  const refreshPromise = (async () => {
    const latestMap = await loadTokenMap();
    const latestBundle = latestMap[key] || bundle;

    if (latestBundle.expires_at === Number.MAX_SAFE_INTEGER || latestBundle.expires_at - 60_000 > Date.now()) {
      return latestBundle;
    }

    const newBundle = await refreshBundle(latestBundle);

    // Persist refreshed bundle
    latestMap[key] = newBundle;
    await saveTokenMap(latestMap);

    console.log(`[TokenStorage] Token refreshed successfully`);
    return newBundle;
  })();

  inFlightRefreshes.set(key, refreshPromise);
  try {
    const newBundle = await refreshPromise;
    return newBundle.access_token!;
  } finally {
    inFlightRefreshes.delete(key);
  }
}

/**
 * List all connected accounts, stripped of secrets (TOKEN-01 contract).
 * Returns integrationId, accountId, accountLabel, metadata, lastUsedAt only.
 * NEVER returns access_token or refresh_token.
 */
const KNOWN_INTEGRATION_IDS: ReadonlySet<string> = new Set(INTEGRATION_IDS);

export async function listConnectedAccounts(): Promise<IntegrationAccount[]> {
  const map = await loadTokenMap();
  // Bundles of removed integrations (Gmail, Google Keep) stay inert in storage:
  // never surface them to menus, AI tools or Brain Dump destinations.
  const bundles = Object.values(map).filter((bundle) => KNOWN_INTEGRATION_IDS.has(bundle.integration_id));
  return collapseCloudDuplicates(bundles).map((bundle) => ({
    integrationId: bundle.integration_id as IntegrationId,
    accountId: bundle.account_id,
    accountLabel: bundle.account_label,
    metadata: bundle.metadata,
    lastUsedAt: bundle.last_used_at,
    connectionKind: bundle.cloud_connection_ref ? 'cloud_reference' : 'device_token',
  }));
}

/**
 * Remove a connected account bundle.
 * Clears the default-account setting if this was the default.
 */
export async function disconnectAccount(
  integrationId: IntegrationId,
  accountId: string
): Promise<void> {
  const map = await loadTokenMap();
  const key = bundleKey(integrationId, accountId);
  delete map[key];
  await saveTokenMap(map);

  // Clear default account setting if applicable
  const settings = await Storage.get<Record<string, unknown>>(SETTINGS_KEY) || {};
  const defaultKey = `default_account_${integrationId}`;
  if (settings[defaultKey] === accountId) {
    delete settings[defaultKey];
    await Storage.set(SETTINGS_KEY, settings);
  }

  // Clear reauth flag if any
  await Storage.remove(`${REAUTH_KEY_PREFIX}:${integrationId}:${accountId}`);
}

/**
 * User-initiated disconnect. For a cloud connection the server first revokes
 * the grant at the provider and deletes the stored tokens; the local bundle is
 * removed only after that succeeds, so a failure never leaves a live token
 * behind silently. Not used when reconnecting: revoking the old grant there
 * could also kill the new one (Google revokes every token of a user + client).
 */
export async function disconnectAccountEverywhere(
  integrationId: IntegrationId,
  accountId: string
): Promise<void> {
  const map = await loadTokenMap();
  const connectionId = map[bundleKey(integrationId, accountId)]?.cloud_connection_ref;
  if (connectionId) await deleteCloudConnection(connectionId);
  await disconnectAccount(integrationId, accountId);
  // Drop leftover duplicates of the same (now deleted) cloud connection.
  for (const otherKey of keysForCloudConnection(map, connectionId)) {
    const duplicate = map[otherKey];
    if (otherKey !== bundleKey(integrationId, accountId)) {
      await disconnectAccount(duplicate.integration_id as IntegrationId, duplicate.account_id);
    }
  }
}

/**
 * Replace a bundle in-place (used after token rotation or re-auth).
 */
export async function rotateBundle(
  integrationId: IntegrationId,
  accountId: string,
  newBundle: TokenBundle
): Promise<void> {
  const map = await loadTokenMap();
  const key = bundleKey(integrationId, accountId);
  map[key] = newBundle;
  await saveTokenMap(map);
}

// ============================================================================
// Internal refresh
// ============================================================================

async function refreshBundle(bundle: TokenBundle): Promise<TokenBundle> {
  console.log(`[TokenStorage] Refreshing bundle for ${bundle.integration_id}`);

  const entry = getRegistryEntry(bundle.integration_id);
  if (!entry) {
    console.error(`[TokenStorage] Registry entry not found for ${bundle.integration_id}`);
    throw new Error(`Registry entry not found for ${bundle.integration_id}`);
  }

  console.log(`[TokenStorage] Registry entry found, auth_type: ${entry.auth_type}`);

  if (!bundle.refresh_token) {
    console.error(`[TokenStorage] No refresh_token for ${bundle.integration_id}`);
    // Set reauth flag — no refresh token available
    await Storage.set(
      `${REAUTH_KEY_PREFIX}:${bundle.integration_id}:${bundle.account_id}`,
      true
    );
    throw new Error(`No refresh_token for ${bundle.integration_id} — reconnect required`);
  }

  const now = Date.now();

  try {
    let data: { access_token: string; refresh_token?: string; expires_in?: number };

    if (entry.auth_type === 'oauth_pkce' && entry.oauth_token_url) {
      console.log(`[TokenStorage] Using direct refresh for ${entry.auth_type}`);
      // Direct refresh
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: bundle.refresh_token,
        client_id: entry.oauth_client_id || '',
      });
      const res = await fetch(entry.oauth_token_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        const errorBody = await readTokenError(res);
        const requiresReauth = isPermanentRefreshFailure(errorBody.error);
        console.error(`[TokenStorage] Direct refresh failed with status ${res.status}: ${errorBody.error || 'unknown_error'}`);
        throw new RefreshFailure(
          errorBody.error_description || errorBody.error || `Refresh failed with status ${res.status}`,
          requiresReauth
        );
      }
      data = await res.json();
    } else if (entry.auth_type === 'oauth_pkce_via_supertry') {
      console.log(`[TokenStorage] Using Supertry bridge refresh`);
      // Supertry bridge refresh — ensure Supertry session token is fresh first
      const { config } = await import('../config/config');
      await AuthService.refreshTokenIfNeeded();
      const supertryToken = await getAccessToken();
      if (!supertryToken) {
        console.error(`[TokenStorage] No Supertry auth token found`);
        throw new Error('No Supertry auth token — user must be logged in to Bluetab');
      }
      console.log(`[TokenStorage] Making Supertry refresh request to ${config.supertry.apiUrl}`);
      const res = await fetch(
        `${config.supertry.apiUrl}/v1/integrations/${bundle.integration_id}/refresh`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${supertryToken}`,
          },
          body: JSON.stringify({ refresh_token: bundle.refresh_token }),
        }
      );
      if (!res.ok) {
        const errorBody = await readTokenError(res);
        const requiresReauth = isPermanentRefreshFailure(errorBody.error);
        console.error(`[TokenStorage] Supertry refresh failed with status ${res.status}: ${errorBody.error || 'unknown_error'}`);
        throw new RefreshFailure(
          errorBody.error_description || errorBody.error || `Supertry refresh failed with status ${res.status}`,
          requiresReauth
        );
      }
      console.log(`[TokenStorage] Supertry refresh successful`);
      data = await res.json();
    } else {
      throw new Error(`Cannot refresh ${entry.auth_type} integrations automatically`);
    }

    const expiresAt = data.expires_in
      ? now + data.expires_in * 1000
      : entry.token_expiry_seconds != null
        ? now + entry.token_expiry_seconds * 1000
        : Number.MAX_SAFE_INTEGER;

    return {
      ...bundle,
      access_token: data.access_token,
      cloud_connection_ref: undefined,
      refresh_token: data.refresh_token || bundle.refresh_token,
      expires_at: expiresAt,
      last_used_at: now,
    };
  } catch (err) {
    if (err instanceof RefreshFailure && err.requiresReauth) {
      await Storage.set(
        `${REAUTH_KEY_PREFIX}:${bundle.integration_id}:${bundle.account_id}`,
        true
      );
    }
    throw err;
  }
}
