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
 *      Caches derived key in memory (never persisted).
 *      Salt is stored at user-level on server (shared across devices).
 *      Key derived from: userId + salt + constant prefix.
 *
 * NOT: Does not store passwords - only the derived key in memory.
 *      Does not communicate with the server - that's SyncTransport's job.
 */

import { CryptoService } from '@/utils/crypto-service'
import type {
  EncryptedPayload,
  SyncEncryptionConfig,
  CachedSyncKey,
  DeltaPayload,
} from '@/types/sync'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ITERATIONS = 100000
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours (longer since auto-derived)
const SESSION_PASSWORD_KEY = 'syncPasswordSession'
const AUTO_SYNC_KEY_PREFIX = 'bluetab-sync-v1' // Prefix for auto key derivation

// ============================================================================
// State
// ============================================================================

/** Cached sync key (in memory only, never persisted) */
let cachedKey: CachedSyncKey | null = null

/** Current encryption config */
let encryptionConfig: SyncEncryptionConfig | null = null

// ============================================================================
// Session Storage (persists until browser closes)
// ============================================================================

const SESSION_USER_ID_KEY = 'syncUserIdSession'

/**
 * Store the sync password in session storage.
 * This persists until the browser closes, surviving service worker restarts.
 * @deprecated Use storeUserIdInSession for auto-sync instead
 */
export async function storePasswordInSession(password: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    await chrome.storage.session.set({ [SESSION_PASSWORD_KEY]: password })
  }
}

/**
 * Retrieve the sync password from session storage.
 * @deprecated Use getUserIdFromSession for auto-sync instead
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
 * @deprecated Use clearUserIdFromSession for auto-sync instead
 */
export async function clearPasswordFromSession(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    await chrome.storage.session.remove(SESSION_PASSWORD_KEY)
  }
}

/**
 * Store the userId in session storage for auto key derivation.
 * This persists until the browser closes, surviving service worker restarts.
 */
export async function storeUserIdInSession(userId: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    await chrome.storage.session.set({ [SESSION_USER_ID_KEY]: userId })
  }
}

/**
 * Retrieve the userId from session storage.
 */
export async function getUserIdFromSession(): Promise<string | null> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    const result = await chrome.storage.session.get(SESSION_USER_ID_KEY)
    return result[SESSION_USER_ID_KEY] || null
  }
  return null
}

/**
 * Clear the userId from session storage.
 */
export async function clearUserIdFromSession(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    await chrome.storage.session.remove(SESSION_USER_ID_KEY)
  }
}

/**
 * Clear all sync session data (password and userId).
 * Call this on logout.
 */
export async function clearAllSyncSession(): Promise<void> {
  await clearPasswordFromSession()
  await clearUserIdFromSession()
}

/**
 * Auto-restore the sync key if password is in session.
 * Call this on sync engine initialization.
 *
 * @param salt - The salt from device info
 * @returns True if key was restored successfully
 * @deprecated Use autoRestoreKeyFromUserId for auto-sync instead
 */
export async function autoRestoreKeyFromSession(salt: string): Promise<boolean> {
  const password = await getPasswordFromSession()
  if (!password) {
    return false
  }

  const success = await deriveSyncKey(password, salt)
  if (success) {
    console.log('[SyncCrypto] Key auto-restored from session')
  }
  return success
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
  return arrayBufferToBase64(salt.buffer)
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
 * @deprecated Use deriveKeyFromUserId for auto-sync instead
 */
export async function deriveSyncKey(
  password: string,
  salt: string,
  iterations: number = DEFAULT_ITERATIONS
): Promise<boolean> {
  try {
    const saltArray = base64ToUint8Array(salt)
    const key = await CryptoService.deriveKey(password, saltArray, iterations)

    cachedKey = {
      key,
      derivedAt: Date.now(),
    }

    encryptionConfig = {
      keySalt: salt,
      iterations,
    }

    // Store password in session for auto-restore after service worker restart
    await storePasswordInSession(password)

    return true
  } catch (error) {
    console.error('[SyncCrypto] Key derivation failed:', error)
    return false
  }
}

/**
 * Derive and cache the sync encryption key automatically from userId.
 * This is the preferred method for auto-sync - no password needed.
 * All devices with the same userId + salt will derive the same key.
 *
 * @param userId - User's unique ID (from auth)
 * @param salt - Base64-encoded salt (from server, shared across all user's devices)
 * @param iterations - PBKDF2 iterations (default: 100000)
 * @returns True if key was derived successfully
 */
export async function deriveKeyFromUserId(
  userId: string,
  salt: string,
  iterations: number = DEFAULT_ITERATIONS
): Promise<boolean> {
  try {
    // Create a deterministic "password" from userId + prefix
    // This ensures all devices derive the same key without user input
    const derivationInput = `${AUTO_SYNC_KEY_PREFIX}:${userId}`

    const saltArray = base64ToUint8Array(salt)
    const key = await CryptoService.deriveKey(derivationInput, saltArray, iterations)

    cachedKey = {
      key,
      derivedAt: Date.now(),
    }

    encryptionConfig = {
      keySalt: salt,
      iterations,
    }

    // Store userId in session for auto-restore after service worker restart
    await storeUserIdInSession(userId)

    console.log('[SyncCrypto] Key derived from userId')
    return true
  } catch (error) {
    console.error('[SyncCrypto] Auto key derivation failed:', error)
    return false
  }
}

/**
 * Auto-restore the sync key from session storage or local storage using userId.
 * Call this on sync engine initialization.
 *
 * @param salt - The salt from user config
 * @param userIdFromDeviceInfo - Optional userId from local device info (fallback)
 * @returns True if key was restored successfully
 */
export async function autoRestoreKeyFromUserId(
  salt: string,
  userIdFromDeviceInfo?: string
): Promise<boolean> {
  // Try session first (survives service worker restarts)
  let userId = await getUserIdFromSession()

  // Fall back to local device info (survives browser restarts)
  if (!userId && userIdFromDeviceInfo) {
    userId = userIdFromDeviceInfo
    // Re-store in session for future use
    await storeUserIdInSession(userId)
  }

  if (!userId) {
    return false
  }

  const success = await deriveKeyFromUserId(userId, salt)
  if (success) {
    console.log('[SyncCrypto] Key auto-restored from userId')
  }
  return success
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
      iv,
      tagLength: 128,
    },
    key,
    encodedData
  )

  return {
    encryptedData: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv.buffer),
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
      iv: ivArray,
      tagLength: 128,
    },
    key,
    encryptedBuffer
  )

  const plaintext = new TextDecoder().decode(decryptedBuffer)
  return JSON.parse(plaintext) as DeltaPayload
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
      iv,
      tagLength: 128,
    },
    key,
    encodedData
  )

  return {
    encryptedData: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv.buffer),
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
      iv: ivArray,
      tagLength: 128,
    },
    key,
    encryptedBuffer
  )

  const plaintext = new TextDecoder().decode(decryptedBuffer)
  return JSON.parse(plaintext) as T
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
          iv: ivArray,
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
  AUTO_SYNC_KEY_PREFIX,
}
