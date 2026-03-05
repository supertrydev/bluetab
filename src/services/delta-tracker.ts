/**
 * @module services/delta-tracker
 *
 * WHY: Generate minimal deltas from storage changes for efficient sync.
 *      Tracking changes at the entity level reduces bandwidth and conflicts.
 *
 * WHAT: Provides:
 *       - Delta generation from chrome.storage.onChanged events
 *       - Array diff (entity-level) for groups, projects, tags
 *       - Object diff (field-level) for settings, pinSettings, groupMemory
 *       - Change deduplication and batching
 *
 * HOW: Intercepts storage changes via onChanged listener.
 *      Compares old and new values to generate minimal deltas.
 *      Supports both array-type and object-type storage keys.
 *
 * NOT: Does not encrypt deltas - that's SyncCrypto's job.
 *      Does not send deltas to server - that's SyncEngine's job.
 */

import type {
  SyncableKey,
  EntityOperation,
  ArrayDeltaPayload,
  ObjectDeltaPayload,
  DeltaPayload,
  OutboundDelta,
  SYNCABLE_KEYS,
} from '@/types/sync'
import { encryptDelta } from './sync-crypto'

// ============================================================================
// Types
// ============================================================================

/**
 * Entity with an ID field (for array-type storage keys).
 */
interface IdentifiableEntity {
  id: string
  modified?: number
  [key: string]: unknown
}

/**
 * Generated delta before encryption.
 */
export interface GeneratedDelta {
  storageKey: SyncableKey
  entityId?: string
  entityOp?: EntityOperation
  payload: DeltaPayload
  clientTimestamp: number
}

/**
 * Callback when deltas are generated.
 */
export type DeltaCallback = (deltas: GeneratedDelta[]) => void

// ============================================================================
// Constants
// ============================================================================

/**
 * Storage keys that contain arrays of entities with IDs.
 */
const ARRAY_KEYS: SyncableKey[] = ['groups', 'projects', 'tags', 'bluet_shared_refs']

/**
 * Storage keys that contain single objects.
 */
const OBJECT_KEYS: SyncableKey[] = ['settings', 'pinSettings', 'groupMemory', 'collapsedGroups', 'flowSettings', 'bluet_bridge']

/**
 * All syncable keys.
 */
const ALL_SYNCABLE_KEYS: SyncableKey[] = [...ARRAY_KEYS, ...OBJECT_KEYS]

// ============================================================================
// State
// ============================================================================

/** Registered delta callbacks */
const deltaCallbacks: Set<DeltaCallback> = new Set()

/**
 * Expected sync writes: storageKey -> data that sync is about to write.
 * When onChanged fires, we compare newValue against expected data.
 * If they match, the change is from sync (skip it).
 * If they don't match, the change is from the user (process it).
 *
 * This replaces the old boolean isSyncApplying flag which had a race condition:
 * the flag was cleared in `finally` before onChanged fired asynchronously,
 * causing echo deltas and suppressing real user changes.
 */
const expectedSyncWrites: Map<SyncableKey, unknown> = new Map()

/** @deprecated Kept only for backward compatibility. Use expectedSyncWrites instead. */
let isSyncApplying = false

// ============================================================================
// Callback Management
// ============================================================================

/**
 * Register a callback to receive generated deltas.
 *
 * @param callback - Function to call when deltas are generated
 * @returns Unsubscribe function
 */
export function onDeltasGenerated(callback: DeltaCallback): () => void {
  deltaCallbacks.add(callback)
  return () => deltaCallbacks.delete(callback)
}

/**
 * Notify all registered callbacks of new deltas.
 */
function notifyCallbacks(deltas: GeneratedDelta[]): void {
  if (deltas.length === 0) return
  deltaCallbacks.forEach((cb) => {
    try {
      cb(deltas)
    } catch (error) {
      console.error('[DeltaTracker] Callback error:', error)
    }
  })
}

// ============================================================================
// Sync Write Tracking
// ============================================================================

/**
 * Register data that sync is about to write to storage.
 * Call this BEFORE Storage.set() in delta-applier.
 * The corresponding onChanged event will be matched and suppressed.
 *
 * @param storageKey - The storage key being written
 * @param data - The exact data being written
 */
export function registerExpectedSyncWrite(storageKey: SyncableKey, data: unknown): void {
  expectedSyncWrites.set(storageKey, data)
}

/**
 * Check if a storage change matches an expected sync write.
 * If it matches, consumes the registration and returns true (skip this change).
 * If it doesn't match, consumes the registration and returns false (process it).
 */
function consumeExpectedSyncWrite(storageKey: SyncableKey, newValue: unknown): boolean {
  if (!expectedSyncWrites.has(storageKey)) return false

  const expectedData = expectedSyncWrites.get(storageKey)
  expectedSyncWrites.delete(storageKey)

  if (deepEqual(newValue, expectedData)) {
    return true // This onChanged is from our sync write - skip it
  }

  // newValue differs from what sync wrote - a user change happened in between
  return false
}

/**
 * Set the sync applying flag.
 * @deprecated Use registerExpectedSyncWrite() instead. Kept for backward compatibility.
 */
export function setSyncApplying(applying: boolean): void {
  isSyncApplying = applying
}

/**
 * Check if sync is currently applying changes.
 * @deprecated Use expectedSyncWrites tracking instead.
 */
export function isSyncCurrentlyApplying(): boolean {
  return isSyncApplying || expectedSyncWrites.size > 0
}

// ============================================================================
// Storage Change Handler
// ============================================================================

/**
 * Process a chrome.storage.onChanged event and generate deltas.
 *
 * @param changes - The changes object from onChanged
 * @param areaName - The storage area ('local', 'sync', etc.)
 */
export function processStorageChange(
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
): void {
  // Only process local storage
  if (areaName !== 'local') return

  // Debug: Log all storage changes for syncable keys
  const syncableChanges = Object.keys(changes).filter(k => ALL_SYNCABLE_KEYS.includes(k as SyncableKey))
  if (syncableChanges.length > 0) {
    console.log(`[DeltaTracker] Storage change detected: keys=[${syncableChanges.join(', ')}], pendingSyncWrites=${expectedSyncWrites.size}`)
  }

  const deltas: GeneratedDelta[] = []
  const timestamp = Date.now()

  for (const [key, change] of Object.entries(changes)) {
    // Check if this is a syncable key
    if (!ALL_SYNCABLE_KEYS.includes(key as SyncableKey)) continue

    const storageKey = key as SyncableKey
    const { oldValue, newValue } = change

    // Check if this change matches an expected sync write
    if (consumeExpectedSyncWrite(storageKey, newValue)) {
      console.log(`[DeltaTracker] Skipping sync-applied change for ${storageKey}`)
      continue
    }

    // Generate deltas based on key type
    if (ARRAY_KEYS.includes(storageKey)) {
      const arrayDeltas = generateArrayDeltas(
        storageKey,
        (oldValue as IdentifiableEntity[]) || [],
        (newValue as IdentifiableEntity[]) || [],
        timestamp
      )
      if (arrayDeltas.length > 0) {
        console.log(`[DeltaTracker] Generated ${arrayDeltas.length} delta(s) for ${storageKey}:`,
          arrayDeltas.map(d => `${d.entityOp} ${d.entityId?.slice(0, 8)}...`))
      }
      deltas.push(...arrayDeltas)
    } else if (OBJECT_KEYS.includes(storageKey)) {
      const objectDelta = generateObjectDelta(
        storageKey,
        (oldValue as Record<string, unknown>) || {},
        (newValue as Record<string, unknown>) || {},
        timestamp
      )
      if (objectDelta) {
        console.log(`[DeltaTracker] Generated object delta for ${storageKey}`)
        deltas.push(objectDelta)
      }
    }
  }

  if (deltas.length === 0 && syncableChanges.length > 0) {
    console.log('[DeltaTracker] No deltas generated despite storage change')
  }

  // Notify callbacks
  notifyCallbacks(deltas)
}

// ============================================================================
// Array Diff (Entity-Level)
// ============================================================================

/**
 * Generate deltas for array-type storage keys (groups, projects, tags).
 * Compares entities by ID and detects add, update, delete operations.
 *
 * @param storageKey - The storage key
 * @param oldArray - Previous array state
 * @param newArray - New array state
 * @param timestamp - Client timestamp
 * @returns Array of generated deltas
 */
function generateArrayDeltas(
  storageKey: SyncableKey,
  oldArray: IdentifiableEntity[],
  newArray: IdentifiableEntity[],
  timestamp: number
): GeneratedDelta[] {
  const deltas: GeneratedDelta[] = []

  // Create maps for O(1) lookup
  const oldMap = new Map(oldArray.map((item) => [item.id, item]))
  const newMap = new Map(newArray.map((item) => [item.id, item]))

  // Detect additions and updates
  for (const [id, newItem] of newMap) {
    const oldItem = oldMap.get(id)

    if (!oldItem) {
      // Entity was added
      deltas.push({
        storageKey,
        entityId: id,
        entityOp: 'add',
        payload: {
          entityId: id,
          entityOp: 'add',
          data: newItem,
        } as ArrayDeltaPayload,
        clientTimestamp: timestamp,
      })
    } else if (!deepEqual(oldItem, newItem)) {
      // Entity was updated - send the full entity (simpler than computing diff)
      deltas.push({
        storageKey,
        entityId: id,
        entityOp: 'update',
        payload: {
          entityId: id,
          entityOp: 'update',
          data: newItem,
        } as ArrayDeltaPayload,
        clientTimestamp: timestamp,
      })
    }
  }

  // Detect deletions
  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) {
      deltas.push({
        storageKey,
        entityId: id,
        entityOp: 'delete',
        payload: {
          entityId: id,
          entityOp: 'delete',
          data: null,
        } as ArrayDeltaPayload,
        clientTimestamp: timestamp,
      })
    }
  }

  return deltas
}

// ============================================================================
// Object Diff (Field-Level)
// ============================================================================

/**
 * Generate a delta for object-type storage keys (settings, pinSettings, groupMemory).
 * Computes a shallow diff of changed fields.
 *
 * @param storageKey - The storage key
 * @param oldObj - Previous object state
 * @param newObj - New object state
 * @param timestamp - Client timestamp
 * @returns Generated delta or null if no changes
 */
function generateObjectDelta(
  storageKey: SyncableKey,
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  timestamp: number
): GeneratedDelta | null {
  const diff: Record<string, unknown> = {}
  let hasChanges = false

  // Get all keys from both objects
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])

  for (const key of allKeys) {
    const oldVal = oldObj[key]
    const newVal = newObj[key]

    if (!deepEqual(oldVal, newVal)) {
      diff[key] = newVal
      hasChanges = true
    }
  }

  if (!hasChanges) return null

  return {
    storageKey,
    payload: {
      data: diff,
    } as ObjectDeltaPayload,
    clientTimestamp: timestamp,
  }
}

// ============================================================================
// Delta Encryption
// ============================================================================

/**
 * Encrypt a generated delta for transmission.
 *
 * @param delta - The generated delta
 * @returns Encrypted outbound delta ready for API
 */
export async function encryptGeneratedDelta(
  delta: GeneratedDelta
): Promise<OutboundDelta> {
  const encrypted = await encryptDelta(delta.payload)

  return {
    storageKey: delta.storageKey,
    entityId: delta.entityId,
    entityOp: delta.entityOp,
    encryptedPayload: encrypted.encryptedData,
    payloadIv: encrypted.iv,
    clientTimestamp: delta.clientTimestamp,
  }
}

/**
 * Encrypt multiple generated deltas.
 *
 * @param deltas - Array of generated deltas
 * @returns Array of encrypted outbound deltas
 */
export async function encryptGeneratedDeltas(
  deltas: GeneratedDelta[]
): Promise<OutboundDelta[]> {
  return Promise.all(deltas.map(encryptGeneratedDelta))
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Deep equality check for objects.
 * Used to detect if an entity has actually changed.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false

  if (typeof a === 'object') {
    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>

    const aKeys = Object.keys(aObj)
    const bKeys = Object.keys(bObj)

    if (aKeys.length !== bKeys.length) return false

    for (const key of aKeys) {
      if (!deepEqual(aObj[key], bObj[key])) return false
    }

    return true
  }

  return false
}

/**
 * Check if a storage key is syncable.
 */
export function isSyncableKey(key: string): key is SyncableKey {
  return ALL_SYNCABLE_KEYS.includes(key as SyncableKey)
}

/**
 * Check if a storage key is an array type.
 */
export function isArrayKey(key: SyncableKey): boolean {
  return ARRAY_KEYS.includes(key)
}

/**
 * Check if a storage key is an object type.
 */
export function isObjectKey(key: SyncableKey): boolean {
  return OBJECT_KEYS.includes(key)
}
