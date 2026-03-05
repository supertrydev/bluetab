/**
 * @module services/sync-engine
 *
 * WHY: Orchestrate all sync operations in a single service.
 *      Provides a clean API for sync setup, push, pull, and state management.
 *
 * WHAT: Main sync orchestrator that:
 *       - Manages sync state and configuration
 *       - Coordinates delta tracking and application
 *       - Handles outbound queue for offline support
 *       - Provides manual push/pull for Phase 1 testing
 *       - Integrates with auth for token management
 *
 * HOW: Listens to delta-tracker for outbound changes.
 *      Uses sync-crypto for encryption/decryption.
 *      Uses delta-applier for incoming changes.
 *      Persists state in chrome.storage.local.
 *
 * NOT: Does not handle UI - that's the React components' job.
 */

import { Storage } from '@/utils/storage'
import { SyncTransport } from './sync-transport'
import { SyncRealtime } from './sync-realtime'
import { AuthService } from './auth-service'
import * as AuthState from '@/utils/auth-state'
import {
  onDeltasGenerated,
  processStorageChange,
  encryptGeneratedDeltas,
  isArrayKey,
  type GeneratedDelta,
} from './delta-tracker'
import {
  deriveSyncKey,
  deriveKeyFromUserId,
  hasCachedKey,
  clearCachedKey,
  generateSalt,
  initializeEncryption,
  getEncryptionConfig,
  encryptSnapshot,
  decryptSnapshot,
  autoRestoreKeyFromSession,
  autoRestoreKeyFromUserId,
  clearPasswordFromSession,
  clearAllSyncSession,
} from './sync-crypto'
import { applyDeltas, applySnapshot, setLocalDeviceId, getLocalDeviceId } from './delta-applier'
import {
  SYNCABLE_KEYS,
  type SyncStatus,
  type SyncEngineState,
  type SyncEngineOptions,
  type OutboundQueueEntry,
  type OutboundQueue,
  type OutboundDelta,
  type LocalDeviceInfo,
  type SyncSetupRequest,
  type SyncSetupResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncPullResponse,
  type SyncDelta,
  type SyncableKey,
  type SyncSnapshotResponse,
  type SyncDevice,
} from '@/types/sync'

// ============================================================================
// Auto-Setup Response Type
// ============================================================================

interface AutoSetupResponse {
  success: boolean
  userId?: string
  keySalt?: string
  currentSeq?: number
  isNewUser?: boolean
  isNewDevice?: boolean
  devices?: SyncDevice[]
  error?: string
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEYS = {
  DEVICE_INFO: 'syncDeviceInfo',
  OUTBOUND_QUEUE: 'syncOutboundQueue',
  LAST_SEQ: 'syncLastSeq',
  STATE: 'syncState',
  PENDING_DEVICE_ID: 'syncPendingDeviceId',
} as const

const DEFAULT_OPTIONS: SyncEngineOptions = {
  apiBaseUrl: 'https://supertry.net',
  pollIntervalMinutes: 1,
  maxDeltaAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  batchSize: 50,
  debounceMs: 500,
}

// ============================================================================
// State
// ============================================================================

let options: SyncEngineOptions = DEFAULT_OPTIONS
let isInitialized = false
let currentStatus: SyncStatus = 'disconnected'
let pendingDeltas: GeneratedDelta[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribeDeltas: (() => void) | null = null

/** Mutex to prevent concurrent push() calls from corrupting the outbound queue */
let pushInProgress: Promise<{ success: boolean; pushed: number; error?: string }> | null = null

/** When true, sync operations are paused until the user re-authenticates */
let authSuspended = false

/** When true, sync is paused (no delta generation, no push/pull, no SSE) */
let syncPaused = false

/**
 * Async mutex for outbound queue access.
 * Serialises all read-modify-write operations on the queue so concurrent
 * processPendingDeltas / pushInternal / flushOutboundQueue never clobber
 * each other's writes to chrome.storage.local.
 */
let _queueMutex: Promise<void> = Promise.resolve()

async function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _queueMutex
  let release!: () => void
  _queueMutex = new Promise<void>((r) => {
    release = r
  })
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

/**
 * Handle a 401/auth error from the server.
 * Always attempts a force-refresh regardless of local token expiry.
 * Only suspends sync if the session is truly invalid (refresh endpoint returns 401).
 * Transient errors (5xx, network) do NOT suspend — sync will retry on next cycle.
 * Returns true if token was refreshed successfully and the caller should retry.
 */
async function handleAuthError(): Promise<boolean> {
  if (authSuspended) return false

  console.log('[SyncEngine] Auth error, attempting force token refresh...')
  try {
    const result = await AuthService.forceRefreshToken()
    if (result.success) {
      console.log('[SyncEngine] Token force-refreshed, retrying')
      return true
    }
    if (!result.sessionInvalid) {
      // Transient server/network error — do not suspend, let next sync cycle retry
      console.warn('[SyncEngine] Token refresh failed (transient error), will retry later')
      return false
    }
  } catch {
    // Network error — transient, do not suspend
    console.warn('[SyncEngine] Token refresh threw (transient), will retry later')
    return false
  }

  // Session is definitively invalid (refresh endpoint returned 401)
  console.warn('[SyncEngine] Session invalid, suspending sync until re-login')
  authSuspended = true
  await updateState({ status: 'disconnected' })
  SyncRealtime.shutdownRealtime()
  return false
}

/**
 * Clear auth suspension so sync can resume.
 * Call this after a successful login or token refresh from outside the engine.
 */
export function clearAuthSuspension(): void {
  if (authSuspended) {
    authSuspended = false
    console.log('[SyncEngine] Auth suspension cleared')
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the sync engine.
 * Must be called before any other sync operations.
 *
 * @param opts - Sync engine options (optional, uses defaults)
 */
export async function initialize(opts?: Partial<SyncEngineOptions>): Promise<void> {
  if (isInitialized) return

  options = { ...DEFAULT_OPTIONS, ...opts }

  // Load device info if exists
  const deviceInfo = await Storage.get<LocalDeviceInfo>(STORAGE_KEYS.DEVICE_INFO)
  if (deviceInfo) {
    setLocalDeviceId(deviceInfo.deviceId)
    initializeEncryption({
      keySalt: deviceInfo.keySalt,
      iterations: 100000,
    })

    // Try to auto-restore key from session storage (userId-based first, then password-based)
    // Pass userId from deviceInfo as fallback (survives browser restarts)
    let keyRestored = await autoRestoreKeyFromUserId(deviceInfo.keySalt, deviceInfo.userId)
    if (!keyRestored) {
      // Fallback to legacy password-based restore
      keyRestored = await autoRestoreKeyFromSession(deviceInfo.keySalt)
    }
    if (keyRestored) {
      console.log('[SyncEngine] Key auto-restored from session')
    }
  }

  // Subscribe to delta generation
  unsubscribeDeltas = onDeltasGenerated(handleGeneratedDeltas)

  // Register storage change listener
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener(processStorageChange)
  }

  // Initialize real-time sync (SSE + polling)
  SyncRealtime.initializeRealtime({
    onDeltaAvailable: handleDeltaAvailable,
    onConnectionChange: handleConnectionChange,
  })

  // Set device ID for transport
  if (deviceInfo) {
    SyncTransport.setDeviceId(deviceInfo.deviceId)
  }

  // Initialize connectivity listeners
  initializeConnectivityListeners()

  isInitialized = true

  // Check if sync was paused by the user
  const wasPaused = await Storage.get<boolean>('syncPaused')
  if (wasPaused) {
    syncPaused = true
    // Undo the listeners we just registered — keep engine "initialized" but dormant
    if (unsubscribeDeltas) {
      unsubscribeDeltas()
      unsubscribeDeltas = null
    }
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.onChanged.removeListener(processStorageChange)
    }
    SyncRealtime.shutdownRealtime()
    await updateState({ status: 'disconnected' })
    console.log('[SyncEngine] Sync is paused by user, skipping auto-connect')
    return
  }

  await updateState({ status: isOnlineState ? 'disconnected' : 'offline' })

  // If no device info exists but user is logged in with Pro, auto-setup
  if (!deviceInfo) {
    const token = await AuthState.getAccessToken()
    if (token) {
      // Check if user has Pro subscription
      const authState = await AuthState.getAuthState()
      if (authState.isPro) {
        console.log('[SyncEngine] No device info, attempting auto-setup for Pro user')
        autoSetup().then((result) => {
          if (result.success) {
            console.log('[SyncEngine] Auto-setup completed on initialize:', result.devices?.length, 'devices')
            // Do initial bilateral sync after setup
            handleOnline(true)
          } else {
            console.warn('[SyncEngine] Auto-setup failed on initialize:', result.error)
          }
        }).catch((error) => {
          console.error('[SyncEngine] Auto-setup error on initialize:', error)
        })
      }
    }
  } else if (isReady() && isOnlineState) {
    // Device already set up and key ready - do bilateral sync
    console.log('[SyncEngine] Doing initial bilateral sync')
    handleOnline(true).catch((error) => {
      console.error('[SyncEngine] Initial sync error:', error)
    })
  }
}

/**
 * Shutdown the sync engine.
 * Call this on extension unload or when disabling sync.
 */
export async function shutdown(): Promise<void> {
  if (!isInitialized) return

  // Shutdown real-time sync
  SyncRealtime.shutdownRealtime()

  // Unsubscribe from deltas
  if (unsubscribeDeltas) {
    unsubscribeDeltas()
    unsubscribeDeltas = null
  }

  // Remove storage listener
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.removeListener(processStorageChange)
  }

  // Clear debounce timer
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  clearCachedKey()
  isInitialized = false
  currentStatus = 'disconnected'
}

/**
 * Pause sync without destroying the engine.
 * Stops delta generation, push/pull, and SSE but keeps the key cached.
 */
export async function pause(): Promise<void> {
  syncPaused = true
  await Storage.set('syncPaused', true)

  // Stop listening for storage changes
  if (unsubscribeDeltas) {
    unsubscribeDeltas()
    unsubscribeDeltas = null
  }
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.removeListener(processStorageChange)
  }

  // Stop real-time sync
  SyncRealtime.shutdownRealtime()

  // Clear pending deltas and debounce
  pendingDeltas = []
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  await updateState({ status: 'disconnected' })
  console.log('[SyncEngine] Sync paused by user')
}

/**
 * Resume sync after a pause.
 * Re-registers listeners, reconnects SSE, and does a bilateral sync.
 */
export async function resume(): Promise<void> {
  syncPaused = false
  await Storage.set('syncPaused', false)

  if (!isInitialized) {
    await initialize()
    return
  }

  // Re-subscribe to delta generation
  unsubscribeDeltas = onDeltasGenerated(handleGeneratedDeltas)

  // Re-register storage change listener
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener(processStorageChange)
  }

  // Re-initialize real-time sync
  SyncRealtime.initializeRealtime({
    onDeltaAvailable: handleDeltaAvailable,
    onConnectionChange: handleConnectionChange,
  })

  console.log('[SyncEngine] Sync resumed by user')

  // Do bilateral sync to catch up
  if (isReady() && isOnlineState) {
    await handleOnline(true).catch((err) => {
      console.error('[SyncEngine] Resume sync error:', err)
    })
  }
}

/**
 * Check if sync is paused by the user.
 */
export function isPaused(): boolean {
  return syncPaused
}

// ============================================================================
// Real-time Event Handlers
// ============================================================================

/**
 * Handle delta_available event from SSE.
 * Triggers a pull to get new changes.
 */
async function handleDeltaAvailable(): Promise<void> {
  if (!isReady()) return

  console.log('[SyncEngine] Delta available, pulling...')
  await pull()
}

/**
 * Handle connection state changes.
 */
function handleConnectionChange(connected: boolean): void {
  if (connected) {
    updateState({ status: 'connected' })
  } else if (currentStatus === 'connected') {
    updateState({ status: 'disconnected' })
  }
}

/**
 * Notify that UI is active (enables SSE).
 * Also triggers bilateral sync to ensure UI shows latest data.
 */
export async function notifyUIActive(): Promise<void> {
  SyncRealtime.onUIActive()

  // Bilateral sync when UI becomes active
  if (isReady() && isOnlineState) {
    handleOnline(true).catch((error) => {
      console.error('[SyncEngine] UI active sync error:', error)
    })
  }
}

/**
 * Notify that UI is inactive (disables SSE).
 */
export function notifyUIInactive(): void {
  SyncRealtime.onUIInactive()
}

// ============================================================================
// Setup
// ============================================================================

/**
 * Set up sync for this device.
 * Call this when the user enables sync for the first time.
 *
 * @param password - User's sync password
 * @param deviceName - Human-readable device name
 * @returns Setup result
 */
export async function setupSync(
  password: string,
  deviceName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateState({ status: 'connecting' })

    // Get auth token
    const token = await AuthState.getAccessToken()
    if (!token) {
      return { success: false, error: 'Not authenticated. Please login first.' }
    }

    // Generate device ID and salt
    const deviceId = generateDeviceId()
    const keySalt = generateSalt()

    // Derive the sync key
    const keyDerived = await deriveSyncKey(password, keySalt)
    if (!keyDerived) {
      return { success: false, error: 'Failed to derive encryption key.' }
    }

    // Register device with server
    const request: SyncSetupRequest = {
      deviceId,
      deviceName: deviceName || getDefaultDeviceName(),
      keySalt,
    }

    const response = await fetch(`${options.apiBaseUrl}/api/sync/setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    })

    const data: SyncSetupResponse = await response.json()

    if (!response.ok || !data.success) {
      return { success: false, error: data.error || 'Setup failed.' }
    }

    // Save device info locally
    const deviceInfo: LocalDeviceInfo = {
      deviceId,
      deviceName: deviceName || getDefaultDeviceName(),
      keySalt,
      lastSeq: data.currentSeq || 0,
      setupAt: Date.now(),
    }

    await Storage.set(STORAGE_KEYS.DEVICE_INFO, deviceInfo)
    await Storage.set(STORAGE_KEYS.LAST_SEQ, data.currentSeq || 0)

    setLocalDeviceId(deviceId)
    await updateState({ status: 'connected' })

    return { success: true }
  } catch (error) {
    console.error('[SyncEngine] Setup failed:', error)
    await updateState({ status: 'error' })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Setup failed.',
    }
  }
}

/**
 * Restore sync on an existing device.
 * Call this when the user opens the extension after previous setup.
 *
 * @param password - User's sync password
 * @returns Restore result
 * @deprecated Use autoSetup for automatic sync instead
 */
export async function restoreSync(
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const deviceInfo = await Storage.get<LocalDeviceInfo>(STORAGE_KEYS.DEVICE_INFO)
    if (!deviceInfo) {
      return { success: false, error: 'No sync setup found. Please set up sync first.' }
    }

    // Derive key with stored salt
    const keyDerived = await deriveSyncKey(password, deviceInfo.keySalt)
    if (!keyDerived) {
      return { success: false, error: 'Invalid password.' }
    }

    setLocalDeviceId(deviceInfo.deviceId)
    await updateState({ status: 'connected' })

    return { success: true }
  } catch (error) {
    console.error('[SyncEngine] Restore failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Restore failed.',
    }
  }
}

/**
 * Automatically set up sync when user logs in.
 * No password required - key is derived from userId + server salt.
 * Call this after successful authentication.
 *
 * @param deviceName - Optional human-readable device name
 * @returns Setup result with device list
 */
export async function autoSetup(
  deviceName?: string
): Promise<{ success: boolean; devices?: SyncDevice[]; error?: string }> {
  try {
    // Clear auth suspension on fresh setup attempt (user re-authenticated)
    authSuspended = false
    await updateState({ status: 'connecting' })

    // Get auth token
    const token = await AuthState.getAccessToken()
    if (!token) {
      await updateState({ status: 'disconnected' })
      return { success: false, error: 'Not authenticated. Please login first.' }
    }

    // Check if we already have a device ID, otherwise generate one.
    // Also check pending ID from an interrupted previous setup to avoid
    // creating a new device on every service worker restart.
    let existingDeviceInfo = await Storage.get<LocalDeviceInfo>(STORAGE_KEYS.DEVICE_INFO)
    const pendingDeviceId = await Storage.get<string>(STORAGE_KEYS.PENDING_DEVICE_ID)
    const deviceId = existingDeviceInfo?.deviceId || pendingDeviceId || generateDeviceId()

    // Persist deviceId early so a SW restart mid-setup reuses the same ID
    if (!existingDeviceInfo) {
      await Storage.set(STORAGE_KEYS.PENDING_DEVICE_ID, deviceId)
    }

    // Call auto-setup endpoint
    const response = await fetch(`${options.apiBaseUrl}/api/sync/auto-setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        deviceId,
        deviceName: deviceName || getDefaultDeviceName(),
      }),
    })

    const data: AutoSetupResponse = await response.json()

    if (!response.ok || !data.success) {
      if (response.status === 401) {
        await handleAuthError()
      }
      await updateState({ status: 'error' })
      return { success: false, error: data.error || 'Auto-setup failed.' }
    }

    // Derive the sync key from userId + salt
    const keyDerived = await deriveKeyFromUserId(data.userId!, data.keySalt!)
    if (!keyDerived) {
      await updateState({ status: 'error' })
      return { success: false, error: 'Failed to derive encryption key.' }
    }

    // Save device info locally
    const deviceInfo: LocalDeviceInfo = {
      deviceId,
      deviceName: deviceName || getDefaultDeviceName(),
      keySalt: data.keySalt!,
      lastSeq: data.currentSeq || 0,
      setupAt: Date.now(),
      userId: data.userId,
    }

    await Storage.set(STORAGE_KEYS.DEVICE_INFO, deviceInfo)
    await Storage.set(STORAGE_KEYS.LAST_SEQ, data.currentSeq || 0)
    await Storage.remove(STORAGE_KEYS.PENDING_DEVICE_ID)

    setLocalDeviceId(deviceId)
    SyncTransport.setDeviceId(deviceId)

    // Initialize encryption config
    initializeEncryption({
      keySalt: data.keySalt!,
      iterations: 100000,
    })

    await updateState({ status: 'connected' })

    console.log('[SyncEngine] Auto-setup complete', {
      isNewUser: data.isNewUser,
      isNewDevice: data.isNewDevice,
      deviceCount: data.devices?.length,
    })

    // If this is not a new user, do an initial sync to get existing data
    if (!data.isNewUser && data.isNewDevice) {
      console.log('[SyncEngine] New device, downloading snapshots...')
      await downloadSnapshots()
    }

    return { success: true, devices: data.devices }
  } catch (error) {
    console.error('[SyncEngine] Auto-setup failed:', error)
    await updateState({ status: 'error' })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Auto-setup failed.',
    }
  }
}

/**
 * Get the list of devices for the current user.
 * Requires authentication.
 */
export async function getDevices(_authRetried = false): Promise<{ success: boolean; devices?: SyncDevice[]; error?: string }> {
  if (authSuspended) {
    return { success: false, error: 'Auth suspended. Please re-login.' }
  }
  try {
    const token = await AuthState.getAccessToken()
    if (!token) {
      return { success: false, error: 'Not authenticated.' }
    }

    const response = await fetch(`${options.apiBaseUrl}/api/sync/auto-setup`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const data: AutoSetupResponse = await response.json()

    if (!response.ok || !data.success) {
      if (response.status === 401 && !_authRetried) {
        const retryable = await handleAuthError()
        if (retryable) return getDevices(true)
        return { success: false, error: 'Session expired. Please re-login.' }
      }
      return { success: false, error: data.error || 'Failed to get devices.' }
    }

    return { success: true, devices: data.devices }
  } catch (error) {
    console.error('[SyncEngine] Get devices failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get devices.',
    }
  }
}

/**
 * Clear sync data on logout.
 * Call this when user logs out.
 */
export async function clearSyncOnLogout(): Promise<void> {
  // Clear session data
  await clearAllSyncSession()

  // Clear cached key
  clearCachedKey()

  // Update status
  await updateState({ status: 'disconnected' })

  console.log('[SyncEngine] Sync cleared on logout')
}

/**
 * Check if sync is set up on this device.
 */
export async function isSetup(): Promise<boolean> {
  const deviceInfo = await Storage.get<LocalDeviceInfo>(STORAGE_KEYS.DEVICE_INFO)
  return deviceInfo !== null
}

/**
 * Check if sync key is available (user has entered password this session).
 */
export function isReady(): boolean {
  return hasCachedKey()
}

// ============================================================================
// Push (Send Changes to Server)
// ============================================================================

/**
 * Push pending deltas to the server.
 * Uses a mutex to prevent concurrent pushes from corrupting the outbound queue.
 *
 * @returns Push result
 */
export async function push(): Promise<{ success: boolean; pushed: number; error?: string }> {
  // Mutex: if a push is already in progress, wait for it to finish then retry
  if (pushInProgress) {
    console.log('[SyncEngine] Push already in progress, waiting...')
    try {
      await pushInProgress
    } catch {
      // Previous push failed, continue with our attempt
    }
  }

  const pushPromise = pushInternal()
  pushInProgress = pushPromise

  try {
    return await pushPromise
  } finally {
    // Clear mutex only if this is still the active push
    if (pushInProgress === pushPromise) {
      pushInProgress = null
    }
  }
}

/**
 * Internal push implementation (no mutex).
 * @param _authRetried - Internal flag to prevent infinite 401 retry loops
 */
async function pushInternal(_authRetried = false): Promise<{ success: boolean; pushed: number; error?: string }> {
  if (authSuspended) {
    return { success: false, pushed: 0, error: 'Auth suspended. Please re-login.' }
  }
  if (!isReady()) {
    return { success: false, pushed: 0, error: 'Sync key not available.' }
  }

  const deviceId = getLocalDeviceId()
  if (!deviceId) {
    return { success: false, pushed: 0, error: 'Device not set up.' }
  }

  try {
    await updateState({ status: 'syncing' })

    // Read queue under lock to get a consistent snapshot
    const entries = await withQueueLock(async () => {
      const queue = await Storage.get<OutboundQueue>(STORAGE_KEYS.OUTBOUND_QUEUE)
      return queue?.entries || []
    })

    if (entries.length === 0) {
      await updateState({ status: 'connected' })
      return { success: true, pushed: 0 }
    }

    // Get auth token
    const token = await AuthState.getAccessToken()
    if (!token) {
      await updateState({ status: 'error' })
      return { success: false, pushed: 0, error: 'Not authenticated.' }
    }

    // Prepare request
    const deltas: OutboundDelta[] = entries.map((e) => e.delta)
    const request: SyncPushRequest = { deviceId, deltas }

    console.log(`[SyncEngine] Pushing ${deltas.length} delta(s)...`)

    // Send to server (NOT under lock - we don't hold the lock during network I/O)
    const response = await fetch(`${options.apiBaseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    })

    const data: SyncPushResponse = await response.json()

    if (!response.ok || !data.success) {
      // On 401, try refreshing the token (only once to avoid infinite loop)
      if (response.status === 401 && !_authRetried) {
        const retryable = await handleAuthError()
        if (retryable) return pushInternal(true)
        return { success: false, pushed: 0, error: 'Session expired. Please re-login.' }
      }
      console.error(`[SyncEngine] Push rejected: ${data.error || 'Unknown error'} (status=${response.status})`)
      await updateState({ status: 'error' })
      return { success: false, pushed: 0, error: data.error || 'Push failed.' }
    }

    // Remove pushed entries from queue under lock.
    // Re-read the queue: new entries may have been appended by processPendingDeltas
    // while the network request was in flight.
    const pushedCount = data.accepted?.length || 0
    const pushedIndices = new Set(data.accepted?.map((a) => a.index) || [])
    const pushedIds = new Set(entries.filter((_, i) => pushedIndices.has(i)).map((e) => e.id))

    await withQueueLock(async () => {
      const currentQueue = await Storage.get<OutboundQueue>(STORAGE_KEYS.OUTBOUND_QUEUE)
      const remainingEntries = (currentQueue?.entries || []).filter((e) => !pushedIds.has(e.id))

      console.log(`[SyncEngine] Push complete: ${pushedCount} accepted, ${remainingEntries.length} remaining in queue`)

      await Storage.set(STORAGE_KEYS.OUTBOUND_QUEUE, {
        entries: remainingEntries,
        lastProcessedAt: Date.now(),
      } as OutboundQueue)
    })

    // Upload snapshot so other devices can verify against us.
    // Awaited to ensure snapshot is on server before SSE triggers pull on other devices.
    if (pushedCount > 0) {
      try {
        await uploadSnapshots()
      } catch (err) {
        console.error('[SyncEngine] Post-push snapshot upload failed:', err)
      }
    }

    await updateState({ status: 'connected' })
    return { success: true, pushed: pushedCount }
  } catch (error) {
    console.error('[SyncEngine] Push failed:', error)
    await updateState({ status: 'error' })
    return {
      success: false,
      pushed: 0,
      error: error instanceof Error ? error.message : 'Push failed.',
    }
  }
}

// ============================================================================
// Pull (Get Changes from Server)
// ============================================================================

/**
 * Pull deltas from the server since last sync.
 * Call this manually for Phase 1, or triggered by real-time in Phase 2.
 *
 * @returns Pull result
 */
export async function pull(_authRetried = false): Promise<{
  success: boolean
  applied: number
  error?: string
}> {
  if (authSuspended) {
    return { success: false, applied: 0, error: 'Auth suspended. Please re-login.' }
  }
  if (!isReady()) {
    return { success: false, applied: 0, error: 'Sync key not available.' }
  }

  const deviceId = getLocalDeviceId()
  if (!deviceId) {
    return { success: false, applied: 0, error: 'Device not set up.' }
  }

  try {
    await updateState({ status: 'syncing' })

    // Get last sequence
    const lastSeq = (await Storage.get<number>(STORAGE_KEYS.LAST_SEQ)) || 0

    // Get auth token
    const token = await AuthState.getAccessToken()
    if (!token) {
      await updateState({ status: 'error' })
      return { success: false, applied: 0, error: 'Not authenticated.' }
    }

    // Fetch deltas
    const url = new URL(`${options.apiBaseUrl}/api/sync/pull`)
    url.searchParams.set('since', lastSeq.toString())
    url.searchParams.set('limit', options.batchSize.toString())
    url.searchParams.set('deviceId', deviceId)

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const data: SyncPullResponse = await response.json()

    if (!response.ok || !data.success) {
      if (response.status === 401 && !_authRetried) {
        const retryable = await handleAuthError()
        if (retryable) return pull(true)
        return { success: false, applied: 0, error: 'Session expired. Please re-login.' }
      }
      await updateState({ status: 'error' })
      return { success: false, applied: 0, error: data.error || 'Pull failed.' }
    }

    const deltas = data.deltas || []

    console.log(`[SyncEngine] Pull response: ${deltas.length} deltas, lastSeq=${lastSeq}`)

    if (deltas.length === 0) {
      console.log('[SyncEngine] No new deltas to apply')
      await updateState({ status: 'connected' })
      return { success: true, applied: 0 }
    }

    // Log delta details for debugging
    deltas.forEach((d, i) => {
      console.log(`[SyncEngine] Delta ${i}: key=${d.storageKey}, entityId=${d.entityId}, op=${d.entityOp}, seq=${d.seq}`)
    })

    // Apply deltas
    const applyResult = await applyDeltas(deltas as SyncDelta[])

    console.log(`[SyncEngine] Pull complete: ${applyResult.applied} applied, ${applyResult.skipped} skipped, ${applyResult.failed} failed`)

    // Update last sequence
    const maxSeq = Math.max(...deltas.map((d) => d.seq))
    await Storage.set(STORAGE_KEYS.LAST_SEQ, maxSeq)

    // Update device info
    const deviceInfo = await Storage.get<LocalDeviceInfo>(STORAGE_KEYS.DEVICE_INFO)
    if (deviceInfo) {
      deviceInfo.lastSeq = maxSeq
      await Storage.set(STORAGE_KEYS.DEVICE_INFO, deviceInfo)
    }

    await updateState({ status: 'connected' })

    // If there are more deltas, pull again
    if (data.hasMore) {
      const moreResult = await pull()
      return {
        success: moreResult.success,
        applied: applyResult.applied + moreResult.applied,
        error: moreResult.error,
      }
    }

    // After applying deltas, check if we're missing anything from the remote device
    if (applyResult.applied > 0) {
      addMissingFromSnapshot()
        .then((result) => {
          if (result.added > 0) {
            console.log(`[SyncEngine] Added ${result.added} missing items from snapshot`)
          }
        })
        .catch((err) => {
          console.error('[SyncEngine] Missing data check failed:', err)
        })
    }

    return { success: true, applied: applyResult.applied }
  } catch (error) {
    console.error('[SyncEngine] Pull failed:', error)
    await updateState({ status: 'error' })
    return {
      success: false,
      applied: 0,
      error: error instanceof Error ? error.message : 'Pull failed.',
    }
  }
}

/**
 * Full sync: push local changes, then pull remote changes.
 */
export async function sync(): Promise<{
  success: boolean
  pushed: number
  applied: number
  error?: string
}> {
  const pushResult = await push()
  if (!pushResult.success) {
    return { success: false, pushed: 0, applied: 0, error: pushResult.error }
  }

  const pullResult = await pull()
  return {
    success: pullResult.success,
    pushed: pushResult.pushed,
    applied: pullResult.applied,
    error: pullResult.error,
  }
}

// ============================================================================
// Delta Queue Management
// ============================================================================

/**
 * Handle newly generated deltas from storage changes.
 */
async function handleGeneratedDeltas(deltas: GeneratedDelta[]): Promise<void> {
  if (!isReady()) {
    // Can't encrypt without key - discard deltas
    console.warn('[SyncEngine] Deltas generated but no key available')
    return
  }

  // Add to pending deltas
  pendingDeltas.push(...deltas)

  // Debounce: wait for activity to settle before processing
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(async () => {
    await processPendingDeltas()
  }, options.debounceMs)
}

/**
 * Process and queue pending deltas.
 */
async function processPendingDeltas(): Promise<void> {
  if (pendingDeltas.length === 0) return

  const toProcess = [...pendingDeltas]
  pendingDeltas = []

  try {
    // Encrypt deltas (outside lock - no queue access needed)
    const encrypted = await encryptGeneratedDeltas(toProcess)

    const newEntries: OutboundQueueEntry[] = encrypted.map((delta) => ({
      id: generateId(),
      delta,
      createdAt: Date.now(),
      retryCount: 0,
    }))

    // Append to outbound queue under lock so we don't race with pushInternal
    await withQueueLock(async () => {
      const queue = (await Storage.get<OutboundQueue>(STORAGE_KEYS.OUTBOUND_QUEUE)) || {
        entries: [],
        lastProcessedAt: 0,
      }
      queue.entries.push(...newEntries)
      await Storage.set(STORAGE_KEYS.OUTBOUND_QUEUE, queue)
    })

    // Auto-push if connected (real-time sync)
    if (SyncRealtime.getConnectionState() === 'connected' || SyncRealtime.isUIOpen()) {
      console.log('[SyncEngine] Auto-pushing deltas...')
      push().then((result) => {
        if (!result.success) {
          console.error(`[SyncEngine] Auto-push failed: ${result.error}`)
        } else if (result.pushed === 0) {
          console.warn('[SyncEngine] Auto-push sent 0 deltas (queue may have been cleared by concurrent push)')
        }
      }).catch((error) => {
        console.error('[SyncEngine] Auto-push exception:', error)
      })
    }
  } catch (error) {
    console.error('[SyncEngine] Failed to process deltas:', error)
    // Put deltas back for retry
    pendingDeltas.unshift(...toProcess)
  }
}

// ============================================================================
// State Management
// ============================================================================

/**
 * Get current sync state.
 */
export async function getState(): Promise<SyncEngineState> {
  const queue = await Storage.get<OutboundQueue>(STORAGE_KEYS.OUTBOUND_QUEUE)
  const deviceInfo = await Storage.get<LocalDeviceInfo>(STORAGE_KEYS.DEVICE_INFO)

  return {
    initialized: isInitialized,
    status: currentStatus,
    isSyncing: currentStatus === 'syncing',
    lastSyncAt: lastSyncAtTimestamp,
    pendingChanges: (queue?.entries.length || 0) + pendingDeltas.length,
    lastError: null,
    paused: syncPaused,
  }
}

/**
 * Get current sync status.
 */
export function getStatus(): SyncStatus {
  return currentStatus
}

/**
 * Update sync state.
 */
async function updateState(updates: Partial<SyncEngineState>): Promise<void> {
  if (updates.status) {
    currentStatus = updates.status
  }
  // Persist state if needed
}

// ============================================================================
// Offline Support (Phase 3)
// ============================================================================

/** Track online/offline state */
let isOnlineState = typeof navigator !== 'undefined' ? navigator.onLine : true
let lastSyncAtTimestamp: number | null = null

/**
 * Check if we're currently online.
 */
export function isOnline(): boolean {
  return isOnlineState
}

/**
 * Handle coming online.
 * Flushes outbound queue and catches up on missed deltas.
 *
 * @param force - Force sync even if already online (for initial sync)
 */
export async function handleOnline(force = false): Promise<void> {
  const wasOffline = !isOnlineState
  isOnlineState = true

  // Skip if already online and not forced
  if (!wasOffline && !force) return

  console.log('[SyncEngine] Coming online', force ? '(forced)' : '')

  if (authSuspended) {
    console.log('[SyncEngine] Auth suspended, skipping online sync')
    return
  }

  if (!isReady()) {
    console.log('[SyncEngine] Not ready, skipping online sync')
    return
  }

  // Bilateral sync: push local changes, then pull remote changes
  await flushOutboundQueue()
  await catchUp()
}

/**
 * Handle going offline.
 */
export function handleOffline(): void {
  if (!isOnlineState) return

  isOnlineState = false
  updateState({ status: 'offline' })
  console.log('[SyncEngine] Going offline')
}

/**
 * Flush the outbound queue with retry logic.
 * Called when coming online or manually triggered.
 *
 * @param maxRetries - Maximum retries per entry (default: 3)
 */
export async function flushOutboundQueue(maxRetries = 3): Promise<{
  success: boolean
  flushed: number
  failed: number
}> {
  if (!isReady() || !isOnlineState) {
    return { success: false, flushed: 0, failed: 0 }
  }

  // Read queue under lock
  const entriesToFlush = await withQueueLock(async () => {
    const queue = await Storage.get<OutboundQueue>(STORAGE_KEYS.OUTBOUND_QUEUE)
    return queue?.entries || []
  })

  if (entriesToFlush.length === 0) {
    return { success: true, flushed: 0, failed: 0 }
  }

  console.log(`[SyncEngine] Flushing ${entriesToFlush.length} queued entries`)

  let flushed = 0
  let failed = 0
  const flushedIds = new Set<string>()
  const updatedEntries: Map<string, OutboundQueueEntry> = new Map()

  // Push entries one by one (NOT under lock - network I/O)
  for (const entry of entriesToFlush) {
    if (entry.retryCount >= maxRetries) {
      // Too many retries, discard
      console.warn(`[SyncEngine] Entry ${entry.id} exceeded max retries, discarding`)
      failed++
      flushedIds.add(entry.id) // treat as consumed so it's removed from queue
      continue
    }

    try {
      // Try to push this single delta
      const result = await pushSingleDelta(entry.delta)

      if (result.success) {
        flushed++
        flushedIds.add(entry.id)
      } else {
        // Increment retry count and keep in queue
        entry.retryCount++
        entry.lastError = result.error
        updatedEntries.set(entry.id, entry)
      }
    } catch (error) {
      entry.retryCount++
      entry.lastError = error instanceof Error ? error.message : 'Unknown error'
      updatedEntries.set(entry.id, entry)
    }
  }

  // Update queue under lock: re-read to preserve entries added during the flush
  const remainingCount = await withQueueLock(async () => {
    const currentQueue = await Storage.get<OutboundQueue>(STORAGE_KEYS.OUTBOUND_QUEUE)
    const remainingEntries = (currentQueue?.entries || [])
      .filter((e) => !flushedIds.has(e.id))
      .map((e) => updatedEntries.get(e.id) ?? e)

    await Storage.set(STORAGE_KEYS.OUTBOUND_QUEUE, {
      entries: remainingEntries,
      lastProcessedAt: Date.now(),
    } as OutboundQueue)

    return remainingEntries.length
  })

  console.log(`[SyncEngine] Flush complete: ${flushed} sent, ${failed} failed, ${remainingCount} remaining`)

  return {
    success: remainingCount === 0,
    flushed,
    failed,
  }
}

/**
 * Push a single delta to the server.
 */
async function pushSingleDelta(
  delta: OutboundDelta
): Promise<{ success: boolean; error?: string }> {
  const deviceId = getLocalDeviceId()
  if (!deviceId) {
    return { success: false, error: 'Device not set up' }
  }

  const token = await AuthState.getAccessToken()
  if (!token) {
    return { success: false, error: 'Not authenticated' }
  }

  try {
    const response = await fetch(`${options.apiBaseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        deviceId,
        deltas: [delta],
      }),
    })

    const data = await response.json()

    if (!response.ok || !data.success) {
      if (response.status === 401) {
        await handleAuthError()
      }
      return { success: false, error: data.error || 'Push failed' }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    }
  }
}

/**
 * Catch up on missed deltas since last sync.
 * Called when coming online after being offline.
 */
export async function catchUp(): Promise<{
  success: boolean
  applied: number
  error?: string
}> {
  if (!isReady() || !isOnlineState) {
    return { success: false, applied: 0, error: 'Not ready or offline' }
  }

  console.log('[SyncEngine] Catching up on missed deltas...')

  try {
    const result = await pull()

    if (result.success) {
      lastSyncAtTimestamp = Date.now()
      console.log(`[SyncEngine] Catch-up complete: ${result.applied} deltas applied`)
    }

    return result
  } catch (error) {
    console.error('[SyncEngine] Catch-up failed:', error)
    return {
      success: false,
      applied: 0,
      error: error instanceof Error ? error.message : 'Catch-up failed',
    }
  }
}

/**
 * Get the timestamp of last successful sync.
 */
export function getLastSyncAt(): number | null {
  return lastSyncAtTimestamp
}

// ============================================================================
// Snapshot Support (Full State Backup/Restore)
// ============================================================================

/**
 * Upload full state snapshots to the server.
 * Used for initial sync or periodic full backups.
 */
export async function uploadSnapshots(): Promise<{
  success: boolean
  uploaded: number
  error?: string
}> {
  if (!isReady()) {
    return { success: false, uploaded: 0, error: 'Sync key not available' }
  }

  const deviceId = getLocalDeviceId()
  if (!deviceId) {
    return { success: false, uploaded: 0, error: 'Device not set up' }
  }

  const token = await AuthState.getAccessToken()
  if (!token) {
    return { success: false, uploaded: 0, error: 'Not authenticated' }
  }

  try {
    const snapshots: Array<{
      storageKey: string
      encryptedData: string
      dataIv: string
    }> = []

    // Encrypt each syncable key
    for (const key of SYNCABLE_KEYS) {
      const data = await Storage.get(key)
      if (data === null || data === undefined) continue

      const encrypted = await encryptSnapshot(data)
      if (!encrypted) {
        console.warn(`[SyncEngine] Failed to encrypt ${key}`)
        continue
      }

      snapshots.push({
        storageKey: key,
        encryptedData: encrypted.encryptedData,
        dataIv: encrypted.iv,
      })
    }

    if (snapshots.length === 0) {
      return { success: true, uploaded: 0 }
    }

    const response = await fetch(`${options.apiBaseUrl}/api/sync/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ deviceId, snapshots }),
    })

    const result = await response.json()

    if (!response.ok || !result.success) {
      if (response.status === 401) {
        await handleAuthError()
      }
      return { success: false, uploaded: 0, error: result.error || 'Upload failed' }
    }

    console.log(`[SyncEngine] Uploaded ${result.inserted} snapshots`)
    return { success: true, uploaded: result.inserted }
  } catch (error) {
    console.error('[SyncEngine] Snapshot upload failed:', error)
    return {
      success: false,
      uploaded: 0,
      error: error instanceof Error ? error.message : 'Upload failed',
    }
  }
}

/**
 * Download and restore snapshots from the server.
 * Used for new device setup or recovery.
 *
 * @param keys - Optional list of storage keys to restore (default: all)
 */
export async function downloadSnapshots(keys?: SyncableKey[]): Promise<{
  success: boolean
  restored: number
  error?: string
}> {
  if (!isReady()) {
    return { success: false, restored: 0, error: 'Sync key not available' }
  }

  const token = await AuthState.getAccessToken()
  if (!token) {
    return { success: false, restored: 0, error: 'Not authenticated' }
  }

  try {
    const url = new URL(`${options.apiBaseUrl}/api/sync/snapshot`)
    if (keys && keys.length > 0) {
      url.searchParams.set('keys', keys.join(','))
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const result: SyncSnapshotResponse = await response.json()

    if (!response.ok || !result.success) {
      if (response.status === 401) {
        await handleAuthError()
      }
      return { success: false, restored: 0, error: result.error || 'Download failed' }
    }

    const snapshots = result.snapshots || []
    let restored = 0

    // Decrypt and restore each snapshot
    for (const snapshot of snapshots) {
      try {
        const data = await decryptSnapshot(snapshot.encryptedData, snapshot.dataIv)
        if (!data) {
          console.warn(`[SyncEngine] Failed to decrypt ${snapshot.storageKey}`)
          continue
        }
        await Storage.set(snapshot.storageKey, data)
        restored++

        console.log(`[SyncEngine] Restored ${snapshot.storageKey}`)
      } catch (error) {
        console.error(`[SyncEngine] Failed to restore ${snapshot.storageKey}:`, error)
      }
    }

    // Update last seq from snapshots
    if (snapshots.length > 0) {
      const maxSeq = Math.max(...snapshots.map((s) => s.seq))
      await Storage.set(STORAGE_KEYS.LAST_SEQ, maxSeq)
    }

    console.log(`[SyncEngine] Restored ${restored} snapshots`)
    return { success: true, restored }
  } catch (error) {
    console.error('[SyncEngine] Snapshot download failed:', error)
    return {
      success: false,
      restored: 0,
      error: error instanceof Error ? error.message : 'Download failed',
    }
  }
}

/**
 * Initialize online/offline listeners.
 */
function initializeConnectivityListeners(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('online', () => {
    handleOnline().catch((error) => {
      console.error('[SyncEngine] Online handler error:', error)
    })
  })

  window.addEventListener('offline', () => {
    handleOffline()
  })
}

// ============================================================================
// Post-Pull Missing Data Check
// ============================================================================

/**
 * Entity with an ID field.
 */
interface IdentifiableEntity {
  id: string
  [key: string]: unknown
}

/**
 * After applying deltas, download the pushing device's full snapshot
 * and add any items that exist on remote but are missing locally.
 *
 * Only ADDS missing data - never modifies or removes existing local data.
 */
async function addMissingFromSnapshot(): Promise<{ added: number }> {
  // Download latest snapshot from server
  const snapshots = await downloadSnapshotsForVerification()
  if (!snapshots) return { added: 0 }

  let totalAdded = 0

  for (const snapshot of snapshots) {
    const key = snapshot.storageKey as SyncableKey

    // Decrypt snapshot data
    const remoteData = await decryptSnapshot(snapshot.encryptedData, snapshot.dataIv)
    if (!remoteData) continue

    // Read local data
    const localData = await Storage.get(key)

    if (isArrayKey(key)) {
      const result = addMissingEntities(key, localData, remoteData)
      if (result) {
        await applySnapshot(key, result.data)
        totalAdded += result.added
        console.log(`[SyncEngine] Added ${result.added} missing items to ${key}`)
      }
    } else {
      const result = addMissingFields(localData, remoteData)
      if (result) {
        await applySnapshot(key, result.data)
        totalAdded += result.added
        console.log(`[SyncEngine] Added ${result.added} missing fields to ${key}`)
      }
    }
  }

  return { added: totalAdded }
}

/**
 * Find entities in remote array that don't exist locally (by ID) and add them.
 * Existing local entities are never touched.
 */
function addMissingEntities(
  key: SyncableKey,
  local: unknown,
  remote: unknown
): { data: IdentifiableEntity[]; added: number } | null {
  const localArr = (local as IdentifiableEntity[]) || []
  const remoteArr = (remote as IdentifiableEntity[]) || []

  const localIds = new Set(localArr.map((e) => e.id))
  const missing = remoteArr.filter((e) => !localIds.has(e.id))

  if (missing.length === 0) return null

  return { data: [...localArr, ...missing], added: missing.length }
}

/**
 * Find fields in remote object that don't exist locally and add them.
 * Existing local fields are never touched.
 */
function addMissingFields(
  local: unknown,
  remote: unknown
): { data: Record<string, unknown>; added: number } | null {
  const localObj = (local as Record<string, unknown>) || {}
  const remoteObj = (remote as Record<string, unknown>) || {}

  let added = 0
  const merged = { ...localObj }

  for (const field of Object.keys(remoteObj)) {
    if (!(field in localObj)) {
      merged[field] = remoteObj[field]
      added++
    }
  }

  if (added === 0) return null

  return { data: merged, added }
}

/**
 * Download snapshots from server for verification (without applying).
 * Returns raw snapshot data for comparison.
 */
async function downloadSnapshotsForVerification(): Promise<
  Array<{ storageKey: string; encryptedData: string; dataIv: string; seq: number }> | null
> {
  const token = await AuthState.getAccessToken()
  if (!token) return null

  try {
    const response = await fetch(`${options.apiBaseUrl}/api/sync/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    const result: SyncSnapshotResponse = await response.json()
    if (!response.ok || !result.success || !result.snapshots) return null

    return result.snapshots
  } catch (error) {
    console.error('[SyncEngine] Snapshot download for verification failed:', error)
    return null
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique device ID.
 */
function generateDeviceId(): string {
  return `bt-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

/**
 * Generate a unique ID for queue entries.
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Get a default device name based on browser/OS.
 */
function getDefaultDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Unknown Device'

  const ua = navigator.userAgent
  let browser = 'Browser'
  let os = 'Unknown'

  if (ua.includes('Chrome')) browser = 'Chrome'
  else if (ua.includes('Firefox')) browser = 'Firefox'
  else if (ua.includes('Safari')) browser = 'Safari'
  else if (ua.includes('Edge')) browser = 'Edge'

  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Mac')) os = 'Mac'
  else if (ua.includes('Linux')) os = 'Linux'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'

  return `${browser} - ${os}`
}

// ============================================================================
// Export for external use
// ============================================================================

export const SyncEngine = {
  initialize,
  shutdown,
  // Pause / resume (user toggle)
  pause,
  resume,
  isPaused,
  // Auto-sync (recommended)
  autoSetup,
  getDevices,
  clearSyncOnLogout,
  clearAuthSuspension,
  // Legacy manual setup (deprecated)
  setupSync,
  restoreSync,
  // State
  isSetup,
  isReady,
  push,
  pull,
  sync,
  getState,
  getStatus,
  notifyUIActive,
  notifyUIInactive,
  // Offline support (Phase 3)
  isOnline,
  handleOnline,
  handleOffline,
  flushOutboundQueue,
  catchUp,
  getLastSyncAt,
  // Snapshot support
  uploadSnapshots,
  downloadSnapshots,
}

export default SyncEngine
