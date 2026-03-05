/**
 * @module types/sync
 *
 * WHY: Define all TypeScript interfaces for the real-time encrypted sync feature.
 *      Centralizes sync-related types for both client-side operations and API communication.
 *
 * WHAT: Contains interfaces for:
 *       - Sync deltas (changes to be synchronized)
 *       - Device management
 *       - Encryption metadata
 *       - Queue management for offline support
 *       - API request/response types
 *
 * NOT: Does not contain implementation logic - purely type definitions.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Storage keys that are synchronized across devices.
 * These correspond to chrome.storage.local keys.
 */
export type SyncableKey =
  | 'groups'
  | 'projects'
  | 'tags'
  | 'settings'
  | 'pinSettings'
  | 'groupMemory'
  | 'collapsedGroups'
  | 'flowSettings'
  | 'bluet_shared_refs'
  | 'bluet_bridge'

/**
 * Operations that can be performed on synced entities.
 */
export type EntityOperation = 'add' | 'update' | 'delete'

/**
 * Sync connection status for UI display.
 */
export type SyncStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error'
  | 'offline'

// ============================================================================
// Delta Types
// ============================================================================

/**
 * Represents a single change to be synchronized.
 * The payload is encrypted client-side before transmission.
 */
export interface SyncDelta {
  /** Unique identifier for this delta */
  id: string
  /** User ID (server-assigned) */
  userId: string
  /** Device that originated this change */
  deviceId: string
  /** Which storage key was modified */
  storageKey: SyncableKey
  /** Server-assigned monotonic sequence number */
  seq: number
  /** Timestamp from the originating device */
  clientTimestamp: number
  /** Timestamp when server received the delta */
  serverTimestamp: number
  /** For array keys: ID of the specific entity (group, project, tag) */
  entityId?: string
  /** For array keys: what operation was performed */
  entityOp?: EntityOperation
  /** Base64-encoded AES-GCM encrypted payload */
  encryptedPayload: string
  /** Base64-encoded initialization vector for decryption */
  payloadIv: string
}

/**
 * Unencrypted delta payload for array-type keys (groups, projects, tags).
 * This is what gets encrypted before transmission.
 */
export interface ArrayDeltaPayload {
  /** The entity ID */
  entityId: string
  /** Operation type */
  entityOp: EntityOperation
  /** Full entity data for add/update, null for delete */
  data: Record<string, unknown> | null
}

/**
 * Unencrypted delta payload for object-type keys (settings, pinSettings, groupMemory).
 * Contains only the changed fields (partial update).
 */
export interface ObjectDeltaPayload {
  /** Changed fields with their new values */
  data: Record<string, unknown>
}

/**
 * Union type for delta payloads before encryption.
 */
export type DeltaPayload = ArrayDeltaPayload | ObjectDeltaPayload

/**
 * Delta ready to be sent to the server (encrypted).
 */
export interface OutboundDelta {
  storageKey: SyncableKey
  entityId?: string
  entityOp?: EntityOperation
  encryptedPayload: string
  payloadIv: string
  clientTimestamp: number
}

// ============================================================================
// Encryption Types
// ============================================================================

/**
 * Result of encrypting data with AES-GCM.
 */
export interface EncryptedPayload {
  /** Base64-encoded encrypted data */
  encryptedData: string
  /** Base64-encoded initialization vector */
  iv: string
}

/**
 * Encryption configuration stored per device.
 */
export interface SyncEncryptionConfig {
  /** Base64-encoded salt for PBKDF2 key derivation */
  keySalt: string
  /** Number of PBKDF2 iterations (default: 100000) */
  iterations: number
}

/**
 * Cached sync key in memory (never persisted).
 */
export interface CachedSyncKey {
  /** The derived CryptoKey for AES-GCM operations */
  key: CryptoKey
  /** When the key was derived (for potential expiry) */
  derivedAt: number
}

// ============================================================================
// Device Types
// ============================================================================

/**
 * Represents a device registered for sync.
 */
export interface SyncDevice {
  /** Unique device identifier (UUID) */
  id: string
  /** User ID this device belongs to (optional for API response) */
  userId?: string
  /** Unique device identifier (persisted in chrome.storage.local) */
  deviceId: string
  /** Human-readable device name (e.g., "Chrome - MacBook Pro") */
  deviceName: string | null
  /** When the device was last active (ISO string from API) */
  lastSeen: string | Date | null
  /** Last sequence number this device received */
  lastSeq: number | null
  /** When the device was registered (ISO string from API) */
  createdAt: string | Date | null
  /** Whether this is the current device (from auto-setup response) */
  isCurrentDevice?: boolean
}

/**
 * Local device information stored in chrome.storage.local.
 */
export interface LocalDeviceInfo {
  /** Unique device ID (generated on first sync setup) */
  deviceId: string
  /** Device name for display */
  deviceName: string
  /** Salt for key derivation (user-level, shared across devices) */
  keySalt: string
  /** Last processed sequence number */
  lastSeq: number
  /** When sync was first set up on this device */
  setupAt: number
  /** User ID (for auto key derivation) */
  userId?: string
}

// ============================================================================
// Queue Types (Offline Support)
// ============================================================================

/**
 * Entry in the outbound queue for offline changes.
 */
export interface OutboundQueueEntry {
  /** Unique ID for this queue entry */
  id: string
  /** The delta to send */
  delta: OutboundDelta
  /** When the entry was created */
  createdAt: number
  /** Number of send attempts */
  retryCount: number
  /** Last error message if failed */
  lastError?: string
}

/**
 * The outbound queue stored in chrome.storage.local.
 */
export interface OutboundQueue {
  /** Queued entries awaiting send */
  entries: OutboundQueueEntry[]
  /** When the queue was last processed */
  lastProcessedAt: number
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Request body for POST /api/sync/setup
 */
export interface SyncSetupRequest {
  /** Unique device identifier */
  deviceId: string
  /** Human-readable device name */
  deviceName: string
  /** Base64-encoded salt for key derivation */
  keySalt: string
}

/**
 * Response from POST /api/sync/setup
 */
export interface SyncSetupResponse {
  success: boolean
  /** Server-assigned device record ID */
  deviceRecordId?: string
  /** Current sequence number for this user */
  currentSeq?: number
  /** Error message if failed */
  error?: string
}

/**
 * Request body for POST /api/sync/push
 */
export interface SyncPushRequest {
  /** Device sending the deltas */
  deviceId: string
  /** Array of encrypted deltas */
  deltas: OutboundDelta[]
}

/**
 * Response from POST /api/sync/push
 */
export interface SyncPushResponse {
  success: boolean
  /** Accepted deltas with their assigned sequence numbers */
  accepted?: Array<{
    /** Client-provided index in the request array */
    index: number
    /** Server-assigned sequence number */
    seq: number
  }>
  /** Error message if failed */
  error?: string
}

/**
 * Response from GET /api/sync/pull
 */
export interface SyncPullResponse {
  success: boolean
  /** Array of deltas since the requested sequence */
  deltas?: SyncDelta[]
  /** Current maximum sequence number */
  currentSeq?: number
  /** Whether there are more deltas to fetch */
  hasMore?: boolean
  /** Error message if failed */
  error?: string
}

/**
 * Response from GET /api/sync/status
 */
export interface SyncStatusResponse {
  success: boolean
  /** Whether sync is enabled for this user */
  syncEnabled?: boolean
  /** Current sequence number */
  currentSeq?: number
  /** Number of registered devices */
  deviceCount?: number
  /** List of registered devices */
  devices?: Array<{
    deviceId: string
    deviceName: string | null
    lastSeen: string
  }>
  /** Error message if failed */
  error?: string
}

/**
 * Request body for POST /api/sync/snapshot
 */
export interface SyncSnapshotUploadRequest {
  deviceId: string
  snapshots: Array<{
    storageKey: SyncableKey
    encryptedData: string
    dataIv: string
  }>
}

/**
 * Response from GET /api/sync/snapshot
 */
export interface SyncSnapshotResponse {
  success: boolean
  snapshots?: Array<{
    storageKey: SyncableKey
    encryptedData: string
    dataIv: string
    seq: number
  }>
  error?: string
}

// ============================================================================
// SSE Event Types
// ============================================================================

/**
 * Base SSE event structure.
 */
export interface SyncSSEEvent {
  type: string
}

/**
 * Connected event when SSE connection is established.
 */
export interface SyncSSEConnected extends SyncSSEEvent {
  type: 'connected'
  userId: string
  timestamp: number
}

/**
 * Heartbeat event to keep connection alive.
 */
export interface SyncSSEHeartbeat extends SyncSSEEvent {
  type: 'heartbeat'
  timestamp: number
}

/**
 * Notification that a new delta is available.
 */
export interface SyncSSEDeltaAvailable extends SyncSSEEvent {
  type: 'delta_available'
  seq?: number
  storageKey?: SyncableKey
  deviceId?: string
  timestamp: number
}

/**
 * Notification that a full sync is required (too far behind).
 */
export interface SyncSSEFullSyncRequired extends SyncSSEEvent {
  type: 'full_sync_required'
  reason?: 'delta_expired' | 'no_snapshot' | 'version_mismatch'
  timestamp?: number
}

/**
 * Error event from the server.
 */
export interface SyncSSEError extends SyncSSEEvent {
  type: 'error'
  message: string
}

/**
 * Union of all SSE event types.
 */
export type SyncSSEEventData =
  | SyncSSEConnected
  | SyncSSEHeartbeat
  | SyncSSEDeltaAvailable
  | SyncSSEFullSyncRequired
  | SyncSSEError

// ============================================================================
// Sync Engine Types
// ============================================================================

/**
 * Options for initializing the sync engine.
 */
export interface SyncEngineOptions {
  /** Supertry API base URL */
  apiBaseUrl: string
  /** Polling interval in minutes (for alarm-based fallback) */
  pollIntervalMinutes: number
  /** Maximum age of deltas before requiring full sync (ms) */
  maxDeltaAge: number
  /** Maximum deltas to fetch per pull request */
  batchSize: number
  /** Debounce time for outbound changes (ms) */
  debounceMs: number
}

/**
 * Sync engine state.
 */
export interface SyncEngineState {
  /** Whether sync is initialized and ready */
  initialized: boolean
  /** Current connection status */
  status: SyncStatus
  /** Whether currently processing inbound/outbound deltas */
  isSyncing: boolean
  /** Last successful sync timestamp */
  lastSyncAt: number | null
  /** Number of pending outbound changes */
  pendingChanges: number
  /** Last error message */
  lastError: string | null
  /** Whether sync is paused by the user */
  paused: boolean
}

// ============================================================================
// Storage Keys
// ============================================================================

/**
 * Chrome storage keys used by the sync system.
 */
export const SYNC_STORAGE_KEYS = {
  /** Local device information */
  DEVICE_INFO: 'syncDeviceInfo',
  /** Outbound queue for offline changes */
  OUTBOUND_QUEUE: 'syncOutboundQueue',
  /** Last processed sequence number */
  LAST_SEQ: 'syncLastSeq',
  /** Sync engine state */
  STATE: 'syncState',
  /** Cached password hash for session (chrome.storage.session) */
  PASSWORD_HASH: 'syncPasswordHash',
} as const

/**
 * List of storage keys that should be synchronized.
 */
export const SYNCABLE_KEYS: SyncableKey[] = [
  'groups',
  'projects',
  'tags',
  'settings',
  'pinSettings',
  'groupMemory',
  'collapsedGroups',
  'flowSettings',
  'bluet_shared_refs',
  'bluet_bridge',
]
