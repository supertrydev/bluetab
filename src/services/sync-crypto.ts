/**
 * @module services/sync-crypto
 *
 * WHY: Provide sync-specific encryption operations.
 *      Wraps CryptoService with key caching and sync context.
 *
 * WHAT: Provides:
 *       - Sync key derivation and caching
 *       - Auto key derivation from userId (no password needed)
 *       - Delta encryption/decryption
 *       - Salt generation and management
 *
 * HOW: Uses CryptoService for underlying crypto operations.
 *      Caches derived key in memory for active use and stores a wrapped
 *      recovery blob in trusted local storage so service-worker restarts
 *      can restore the key without prompting again.
 *      Salt is stored at user-level on server (shared across devices).
 *      Legacy auto-derived keys use: userId + salt + constant prefix.
 *
 * NOT: Does not persist plaintext passwords.
 *      Does not communicate with the server - that's SyncTransport's job.
 */

import { CryptoService } from '@/utils/crypto-service'
import { getRefreshToken } from '@/utils/auth-state'
import type {
  EncryptedPayload,
  SyncEncryptionConfig,
  CachedSyncKey,
  DeltaPayload,
} from '@/types/sync'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ITERATIONS = CryptoService.DEFAULT_ITERATIONS
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours (longer since auto-derived)
const SESSION_PASSWORD_KEY = 'syncPasswordSession'
const SYNC_KEY_RECOVERY_KEY = 'syncKeyRecovery'
const TRUSTED_CONTEXTS_ACCESS_LEVEL = 'TRUSTED_CONTEXTS'

// ============================================================================
// State
// ============================================================================

/** Cached sync key (in memory only, never persisted) */
let cachedKey: CachedSyncKey | null = null

/** Current encryption config */
let encryptionConfig: SyncEncryptionConfig | null = null
let localStorageAccessLevelPromise: Promise<void> | null = null

interface PersistedSyncKeyRecovery {
  encryptedKey: string
  salt: string
  iv: string
  keySalt: string
  iterations: number
  keySource: 'user-password'
  updatedAt: number
}

function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

async function restrictLocalStorageToTrustedContexts(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local?.setAccessLevel) {
    return
  }

  localStorageAccessLevelPromise ??= Promise
    .resolve(chrome.storage.local.setAccessLevel({ accessLevel: TRUSTED_CONTEXTS_ACCESS_LEVEL }))
    .catch((error) => {
      console.warn('[SyncCrypto] Could not restrict local storage access:', error)
    })

  await localStorageAccessLevelPromise
}

async function getPersistedSyncKeyRecovery(): Promise<PersistedSyncKeyRecovery | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null
  }

  await restrictLocalStorageToTrustedContexts()
  const result = await Promise.resolve(chrome.storage.local.get(SYNC_KEY_RECOVERY_KEY)).catch(() => null)
  return (result?.[SYNC_KEY_RECOVERY_KEY] as PersistedSyncKeyRecovery | undefined) ?? null
}

async function setPersistedSyncKeyRecovery(recovery: PersistedSyncKeyRecovery): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return
  }

  await restrictLocalStorageToTrustedContexts()
  await Promise.resolve(chrome.storage.local.set({ [SYNC_KEY_RECOVERY_KEY]: recovery }))
}

export async function clearPersistedSyncKeyRecovery(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return
  }

  await restrictLocalStorageToTrustedContexts()
  await Promise.resolve(chrome.storage.local.remove(SYNC_KEY_RECOVERY_KEY))
}

async function persistDerivedKeyRecovery(
  rawKey: ArrayBuffer,
  keySalt: string,
  iterations: number
): Promise<void> {
  const recoveryToken = await getRefreshToken()
  if (!recoveryToken) {
    console.warn('[SyncCrypto] Skipping sync key recovery persistence: no auth recovery token available')
    return
  }

  const wrapped = await CryptoService.encryptWithPassword(
    arrayBufferToBase64(rawKey),
    recoveryToken
  )

  await setPersistedSyncKeyRecovery({
    encryptedKey: wrapped.encryptedData,
    salt: wrapped.salt,
    iv: wrapped.iv,
    keySalt,
    iterations,
    keySource: 'user-password',
    updatedAt: Date.now(),
  })
}

async function restoreDerivedKeyFromRecovery(expectedSalt: string): Promise<boolean> {
  const recovery = await getPersistedSyncKeyRecovery()
  if (!recovery || recovery.keySource !== 'user-password' || recovery.keySalt !== expectedSalt) {
    return false
  }

  const recoveryToken = await getRefreshToken()
  if (!recoveryToken) {
    return false
  }

  const decrypted = await CryptoService.decryptWithPassword(
    recovery.encryptedKey,
    recoveryToken,
    recovery.salt,
    recovery.iv
  )

  if (!decrypted.success || !decrypted.data) {
    return false
  }

  const rawKey = base64ToArrayBuffer(decrypted.data)
  const key = await CryptoService.importAesKey(rawKey)

  cachedKey = {
    key,
    derivedAt: Date.now(),
  }

  encryptionConfig = {
    keySalt: recovery.keySalt,
    iterations: recovery.iterations || DEFAULT_ITERATIONS,
    keySource: recovery.keySource,
  }

  return true
}

// ============================================================================
// Session Storage (persists until browser closes)
// ============================================================================

const SESSION_USER_ID_KEY = 'syncUserIdSession'

/**
 * Store the sync password in session storage.
 * This persists until the browser closes, surviving service worker restarts.
 */
export async function storePasswordInSession(password: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    await chrome.storage.session.set({ [SESSION_PASSWORD_KEY]: password })
  }
}

/**
 * Retrieve the sync password from session storage.
 */
export async function getPasswordFromSession(): Promise<string | null> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    const result = await chrome.storage.session.get(SESSION_PASSWORD_KEY)
    return result[SESSION_PASSWORD_KEY] || null
  }
  return null
}

/**
 * Clear the sync password from session storage.
 */
export async function clearPasswordFromSession(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    await chrome.storage.session.remove(SESSION_PASSWORD_KEY)
  }
}

/**
 * Clear all sync session data (password and userId).
 * Call this on logout.
 */
export async function clearAllSyncSession(): Promise<void> {
  await clearPasswordFromSession()
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    await chrome.storage.session.remove(SESSION_USER_ID_KEY)
  }
  await clearPersistedSyncKeyRecovery()
}

/**
 * Auto-restore the sync key if password is in session.
 * Call this on sync engine initialization.
 *
 * @param salt - The salt from device info
 * @returns True if key was restored successfully
 */
export async function autoRestoreKeyFromSession(salt: string, iterations = DEFAULT_ITERATIONS): Promise<boolean> {
  const password = await getPasswordFromSession()
  if (password) {
    const success = await deriveSyncKey(password, salt, iterations)
    if (success) {
      console.log('[SyncCrypto] Key auto-restored from session')
    }
    return success
  }

  const restoredFromRecovery = await restoreDerivedKeyFromRecovery(salt)
  if (restoredFromRecovery) {
    console.log('[SyncCrypto] Key auto-restored from local recovery')
    return true
  }

  return false
}

// ============================================================================
// Key Management
// ============================================================================

/**
 * Generate a new random salt for key derivation.
 * Call this when setting up sync on a new device.
 *
 * @returns Base64-encoded salt
 */
export function generateSalt(): string {
  const salt = CryptoService.generateSalt(16)
  return arrayBufferToBase64(asBufferSource(salt).buffer)
}

/**
 * Initialize sync encryption with an existing config.
 * Call this on startup to restore encryption config from storage.
 *
 * @param config - Encryption config (salt, iterations)
 */
export function initializeEncryption(config: SyncEncryptionConfig): void {
  encryptionConfig = config
}

/**
 * Get the current encryption config.
 *
 * @returns Current config or null if not initialized
 */
export function getEncryptionConfig(): SyncEncryptionConfig | null {
  return encryptionConfig
}

/**
 * Derive and cache the sync encryption key from the user's password.
 * Must be called before any encrypt/decrypt operations.
 *
 * @param password - User's sync password
 * @param salt - Base64-encoded salt (from config or newly generated)
 * @param iterations - PBKDF2 iterations (default: 100000)
 * @returns True if key was derived successfully
 */
export async function deriveSyncKey(
  password: string,
  salt: string,
  iterations: number = DEFAULT_ITERATIONS
): Promise<boolean> {
  try {
    const saltArray = base64ToUint8Array(salt)
    const rawKey = await CryptoService.deriveKeyMaterial(password, saltArray, iterations)
    const key = await CryptoService.importAesKey(rawKey)

    cachedKey = {
      key,
      derivedAt: Date.now(),
    }

    encryptionConfig = {
      keySalt: salt,
      iterations,
      keySource: 'user-password',
    }

    // Store password in session for auto-restore after service worker restart
    await storePasswordInSession(password)
    await persistDerivedKeyRecovery(rawKey, salt, iterations)

    return true
  } catch (error) {
    console.error('[SyncCrypto] Key derivation failed:', error)
    return false
  }
}

/**
 * Check if a sync key is currently cached and valid.
 *
 * @returns True if a valid key is cached
 */
export function hasCachedKey(): boolean {
  if (!cachedKey) return false

  // Check if key has expired
  const age = Date.now() - cachedKey.derivedAt
  if (age > KEY_CACHE_TTL_MS) {
    clearCachedKey()
    return false
  }

  return true
}

/**
 * Clear the cached sync key.
 * Call this on logout or when sync is disabled.
 */
export function clearCachedKey(): void {
  cachedKey = null
}

/**
 * Get the cached CryptoKey for direct use.
 * Throws if no key is cached.
 *
 * @returns The cached CryptoKey
 */
function getCachedCryptoKey(): CryptoKey {
  if (!hasCachedKey() || !cachedKey) {
    throw new Error('No sync key cached. Call deriveSyncKey first.')
  }
  return cachedKey.key
}

// ============================================================================
// Encryption/Decryption
// ============================================================================

/**
 * Encrypt a delta payload for sync.
 *
 * @param payload - The delta payload to encrypt
 * @returns Encrypted payload with IV
 * @throws If no key is cached
 */
export async function encryptDelta(payload: DeltaPayload): Promise<EncryptedPayload> {
  const key = getCachedCryptoKey()
  const plaintext = JSON.stringify(payload)

  // Generate a random IV for this encryption
  const iv = CryptoService.generateIV(12)

  // Encrypt using AES-GCM
  const encodedData = new TextEncoder().encode(plaintext)
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: asBufferSource(iv),
      tagLength: 128,
    },
    key,
    asBufferSource(encodedData)
  )

  return {
    encryptedData: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(asBufferSource(iv).buffer),
  }
}

/**
 * Decrypt a delta payload from sync.
 *
 * @param encryptedData - Base64-encoded encrypted data
 * @param iv - Base64-encoded initialization vector
 * @returns Decrypted delta payload
 * @throws If decryption fails or no key is cached
 */
export async function decryptDelta(
  encryptedData: string,
  iv: string
): Promise<DeltaPayload> {
  const key = getCachedCryptoKey()

  const encryptedBuffer = base64ToArrayBuffer(encryptedData)
  const ivArray = base64ToUint8Array(iv)

  // Decrypt using AES-GCM
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: asBufferSource(ivArray),
      tagLength: 128,
    },
    key,
    encryptedBuffer
  )

  const plaintext = new TextDecoder().decode(decryptedBuffer)
  let parsed: DeltaPayload
  try {
    parsed = JSON.parse(plaintext) as DeltaPayload
  } catch (err) {
    console.error('[BlueTab][SyncCrypto] JSON.parse failed for delta -- data may be corrupted', err)
    throw new Error('DELTA_PARSE_ERROR: Decrypted payload is not valid JSON')
  }
  return parsed
}

/**
 * Encrypt a full data snapshot for sync.
 *
 * @param data - The data to encrypt (will be JSON stringified)
 * @returns Encrypted payload with IV
 * @throws If no key is cached
 */
export async function encryptSnapshot(data: unknown): Promise<EncryptedPayload> {
  const key = getCachedCryptoKey()
  const plaintext = JSON.stringify(data)

  const iv = CryptoService.generateIV(12)
  const encodedData = new TextEncoder().encode(plaintext)

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: asBufferSource(iv),
      tagLength: 128,
    },
    key,
    asBufferSource(encodedData)
  )

  return {
    encryptedData: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(asBufferSource(iv).buffer),
  }
}

/**
 * Decrypt a full data snapshot from sync.
 *
 * @param encryptedData - Base64-encoded encrypted data
 * @param iv - Base64-encoded initialization vector
 * @returns Decrypted data
 * @throws If decryption fails or no key is cached
 */
export async function decryptSnapshot<T>(encryptedData: string, iv: string): Promise<T> {
  const key = getCachedCryptoKey()

  const encryptedBuffer = base64ToArrayBuffer(encryptedData)
  const ivArray = base64ToUint8Array(iv)

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: asBufferSource(ivArray),
      tagLength: 128,
    },
    key,
    encryptedBuffer
  )

  const plaintext = new TextDecoder().decode(decryptedBuffer)
  let parsed: T
  try {
    parsed = JSON.parse(plaintext) as T
  } catch (err) {
    console.error('[BlueTab][SyncCrypto] JSON.parse failed for snapshot -- data may be corrupted', err)
    throw new Error('SNAPSHOT_PARSE_ERROR: Decrypted snapshot is not valid JSON')
  }
  return parsed
}

// ============================================================================
// Password Validation
// ============================================================================

/**
 * Validate a sync password by attempting to derive a key with it.
 * Uses the existing salt from the server.
 *
 * @param password - Password to validate
 * @param salt - Base64-encoded salt from server
 * @param testData - Optional encrypted test data to verify decryption
 * @param testIv - IV for test data
 * @returns True if password is valid
 */
export async function validatePassword(
  password: string,
  salt: string,
  testData?: string,
  testIv?: string
): Promise<boolean> {
  try {
    // Try to derive a key
    const saltArray = base64ToUint8Array(salt)
    const key = await CryptoService.deriveKey(password, saltArray, DEFAULT_ITERATIONS)

    // If we have test data, try to decrypt it
    if (testData && testIv) {
      const encryptedBuffer = base64ToArrayBuffer(testData)
      const ivArray = base64ToUint8Array(testIv)

      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: asBufferSource(ivArray),
          tagLength: 128,
        },
        key,
        encryptedBuffer
      )
    }

    return true
  } catch {
    return false
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert ArrayBuffer to Base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Convert Base64 string to ArrayBuffer.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Convert Base64 string to Uint8Array.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  return new Uint8Array(base64ToArrayBuffer(base64))
}

// ============================================================================
// Export for testing
// ============================================================================

export const _internal = {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  base64ToUint8Array,
  DEFAULT_ITERATIONS,
}
