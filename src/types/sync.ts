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
 *       - MCP-replay SSE event (Phase 13 MCP-07 — async write queue)
 *
 * NOT: Does not contain implementation logic - purely type definitions.
 */

import { z } from 'zod'

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
  | 'adhd_settings'
  | 'brain_dump_inbox'
  | 'bluetab_text_size_settings'
  | 'pomodoroSettings'
  | 'focusSettings'
  | 'brain_dump_prefs'
  | 'ai_settings'
  | 'reminderSettings'
  | 'reminders'
  | 'rssSettings'
  | 'backupSettings'

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
  | 'restore-required'
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
  /** Number of PBKDF2 iterations (new default: 600000) */
  iterations: number
  /** Source of the local sync key. user-password is the only E2EE source. */
  keySource?: 'user-password'
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

export type SyncDeviceLimitErrorCode = 'sync_device_limit_reached'

export interface SyncDeviceLimitMetadata {
  /** Maximum registered devices allowed for this sync account */
  deviceLimit?: number
  /** Current number of registered devices */
  deviceCount?: number
  /** Whether the server will allow another device to be registered */
  canAddDevice?: boolean
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
  /** Local key source. Missing with userId means a legacy user-id-derived key. */
  keySource?: 'user-password' | 'legacy-user-id'
  /** PBKDF2 iteration count used for this device's current key. */
  iterations?: number
}

export function isLegacySyncDevice(device: Pick<LocalDeviceInfo, 'keySource' | 'userId'>): boolean {
  return device.keySource === 'legacy-user-id' || (!device.keySource && Boolean(device.userId))
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
  /** Maximum registered devices allowed for this sync account */
  deviceLimit?: number
  /** Current number of registered devices */
  deviceCount?: number
  /** Whether the server will allow another device to be registered */
  canAddDevice?: boolean
  /** Registered devices returned by setup responses */
  devices?: SyncDevice[]
  /** Stable error code for device limit failures */
  code?: SyncDeviceLimitErrorCode
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
  /** Maximum registered devices allowed for this sync account */
  deviceLimit?: number
  /** Number of registered devices */
  deviceCount?: number
  /** Whether the server will allow another device to be registered */
  canAddDevice?: boolean
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
 * Phase 13 (MCP-07) — Async-queue replay event.
 *
 * When an external agent issues a write while Bluetab is offline,
 * Supertry queues the call and pushes it back over the SSE channel
 * once Bluetab reconnects. The `queuedAt` timestamp drives per-record
 * LWW conflict resolution at the replay site.
 */
export interface SyncSSEMCPReplay extends SyncSSEEvent {
  type: 'mcp-replay'
  /** Source MCP client (set at OAuth authorization) */
  clientId: string
  /** One of MCP_TOOL_NAMES — write tools only */
  toolName: string
  /** Tool arguments — validated against MCP_TOOL_REGISTRY[toolName].args */
  args: unknown
  /** Epoch ms when Supertry first received the queued call (LWW source of truth) */
  queuedAt: number
  /** Supertry-assigned invocation id (for invocation-log dedup) */
  invocationId: string
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
  | SyncSSEMCPReplay

/**
 * Zod schema for `SyncSSEMCPReplay`. Used at the SSE-event ingress in
 * sync-realtime.ts to validate untrusted Supertry payloads BEFORE they
 * dispatch through MCPServerService.replayWrite. A malformed event
 * never reaches the dispatcher — it's logged and dropped.
 */
export const MCPReplayEventSchema = z
  .object({
    type: z.literal('mcp-replay'),
    // Accept both camelCase (Bluetab convention) and snake_case (Supertry wire format)
    clientId: z.string().min(1).optional(),
    client_id: z.string().min(1).optional(),
    toolName: z.string().min(1).optional(),
    tool_name: z.string().min(1).optional(),
    args: z.unknown(),
    queuedAt: z.number().int().nonnegative().optional(),
    queued_at: z.number().int().nonnegative().optional(),
    invocationId: z.string().min(1).optional(),
    invocation_id: z.string().min(1).optional(),
    timestamp: z.number().optional(),
  })
  .transform((raw) => ({
    type: raw.type,
    clientId: raw.clientId ?? raw.client_id ?? '',
    toolName: raw.toolName ?? raw.tool_name ?? '',
    args: raw.args,
    queuedAt: raw.queuedAt ?? raw.queued_at ?? raw.timestamp ?? 0,
    invocationId: raw.invocationId ?? raw.invocation_id ?? '',
  }))
  .refine((event) => event.clientId.length > 0 && event.toolName.length > 0, {
    message: 'clientId and toolName are required',
  })

export type MCPReplayEvent = z.infer<typeof MCPReplayEventSchema>

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
  // 'bluet_bridge' is intentionally absent: the bridge token stays on the device that connected.
  'adhd_settings',
  'brain_dump_inbox',
  'bluetab_text_size_settings',
  'pomodoroSettings',
  'focusSettings',
  'brain_dump_prefs',
  'ai_settings',
  'reminderSettings',
  'reminders',
  'rssSettings',
  'backupSettings',
]
