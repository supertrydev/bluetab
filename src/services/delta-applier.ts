/**
 * @module services/delta-applier
 *
 * WHY: Apply incoming sync deltas to local storage.
 *      Must prevent triggering re-sync loops when applying remote changes.
 *
 * WHAT: Provides:
 *       - Delta application for all syncable storage keys
 *       - Conflict detection and resolution
 *       - Sync-in-progress flag to prevent loops
 *       - Atomic batch application
 *
 * HOW: Sets sync-applying flag before modifying storage.
 *      Applies deltas based on storage key type (array or object).
 *      Uses last-writer-wins with entity-level granularity.
 *
 * NOT: Does not decrypt deltas - expects decrypted payloads.
 *      Does not fetch deltas from server - that's SyncEngine's job.
 */

import { Storage } from '@/utils/storage'
import type {
  SyncableKey,
  SyncDelta,
  ArrayDeltaPayload,
  ObjectDeltaPayload,
  DeltaPayload,
} from '@/types/sync'
import { registerExpectedSyncWrite, isArrayKey, isObjectKey } from './delta-tracker'
import { decryptDelta } from './sync-crypto'

// ============================================================================
// Types
// ============================================================================

/**
 * Entity with an ID field.
 */
interface IdentifiableEntity {
  id: string
  modified?: number
  [key: string]: unknown
}

/**
 * Result of applying a delta.
 */
export interface ApplyResult {
  success: boolean
  applied: boolean
  skipped: boolean
  reason?: string
}

/**
 * Result of applying a batch of deltas.
 */
export interface BatchApplyResult {
  success: boolean
  applied: number
  skipped: number
  failed: number
  errors: Array<{ seq: number; error: string }>
}

// ============================================================================
// State
// ============================================================================

/** Current device ID (to skip self-originated deltas) */
let localDeviceId: string | null = null

// ============================================================================
// Initialization
// ============================================================================

/**
 * Set the local device ID.
 * Deltas from this device will be skipped during application.
 *
 * @param deviceId - This device's unique identifier
 */
export function setLocalDeviceId(deviceId: string): void {
  localDeviceId = deviceId
}

/**
 * Get the local device ID.
 */
export function getLocalDeviceId(): string | null {
  return localDeviceId
}

// ============================================================================
// Single Delta Application
// ============================================================================

/**
 * Apply a single encrypted delta to local storage.
 *
 * @param delta - The sync delta from the server
 * @returns Apply result
 */
export async function applyDelta(delta: SyncDelta): Promise<ApplyResult> {
  // Skip deltas from this device
  if (delta.deviceId === localDeviceId) {
    return {
      success: true,
      applied: false,
      skipped: true,
      reason: 'Self-originated delta',
    }
  }

  try {
    // Decrypt the payload
    const payload = await decryptDelta(delta.encryptedPayload, delta.payloadIv)

    // Apply based on storage key type
    // registerExpectedSyncWrite is called inside applyArrayDelta/applyObjectDelta
    // before each Storage.set(), so onChanged will match and skip the echo.
    if (isArrayKey(delta.storageKey)) {
      await applyArrayDelta(delta.storageKey, payload as ArrayDeltaPayload)
    } else if (isObjectKey(delta.storageKey)) {
      await applyObjectDelta(delta.storageKey, payload as ObjectDeltaPayload)
    } else {
      return {
        success: false,
        applied: false,
        skipped: false,
        reason: `Unknown storage key: ${delta.storageKey}`,
      }
    }

    return {
      success: true,
      applied: true,
      skipped: false,
    }
  } catch (error) {
    console.error('[DeltaApplier] Apply failed:', error)
    return {
      success: false,
      applied: false,
      skipped: false,
      reason: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================================================
// Batch Delta Application
// ============================================================================

/**
 * Apply multiple deltas in order.
 * Deltas should be sorted by sequence number.
 *
 * @param deltas - Array of sync deltas (sorted by seq)
 * @returns Batch apply result
 */
export async function applyDeltas(deltas: SyncDelta[]): Promise<BatchApplyResult> {
  const result: BatchApplyResult = {
    success: true,
    applied: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }

  // Group deltas by storage key for batching
  const deltasByKey = new Map<SyncableKey, SyncDelta[]>()
  for (const delta of deltas) {
    const existing = deltasByKey.get(delta.storageKey) || []
    existing.push(delta)
    deltasByKey.set(delta.storageKey, existing)
  }

  // No global setSyncApplying flag needed.
  // Each applyArrayDelta/applyObjectDelta call registers its expected write
  // via registerExpectedSyncWrite() before Storage.set(). The onChanged handler
  // in processStorageChange matches and suppresses echo deltas per-key.

  // Apply deltas for each storage key
  for (const [storageKey, keyDeltas] of deltasByKey) {
    // Sort by sequence within each key
    keyDeltas.sort((a, b) => a.seq - b.seq)

    for (const delta of keyDeltas) {
      // Skip self-originated deltas
      if (delta.deviceId === localDeviceId) {
        result.skipped++
        continue
      }

      try {
        const payload = await decryptDelta(delta.encryptedPayload, delta.payloadIv)

        if (isArrayKey(storageKey)) {
          await applyArrayDelta(storageKey, payload as ArrayDeltaPayload)
        } else if (isObjectKey(storageKey)) {
          await applyObjectDelta(storageKey, payload as ObjectDeltaPayload)
        }

        result.applied++
      } catch (error) {
        result.failed++
        result.success = false
        result.errors.push({
          seq: delta.seq,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }

  return result
}

// ============================================================================
// Array Delta Application
// ============================================================================

/**
 * Apply a delta to an array-type storage key.
 *
 * @param storageKey - The storage key
 * @param payload - The decrypted array delta payload
 */
async function applyArrayDelta(
  storageKey: SyncableKey,
  payload: ArrayDeltaPayload
): Promise<void> {
  // Get current data
  const current = (await Storage.get<IdentifiableEntity[]>(storageKey)) || []

  let updated: IdentifiableEntity[]

  switch (payload.entityOp) {
    case 'add': {
      // Check if entity already exists (idempotency)
      const exists = current.some((item) => item.id === payload.entityId)
      if (exists) {
        // Update instead of add (handle out-of-order deltas)
        updated = current.map((item) =>
          item.id === payload.entityId ? (payload.data as IdentifiableEntity) : item
        )
      } else {
        updated = [...current, payload.data as IdentifiableEntity]
      }
      break
    }

    case 'update': {
      const index = current.findIndex((item) => item.id === payload.entityId)

      // Debug: Log incoming payload data
      const remoteEntity = payload.data as IdentifiableEntity
      console.log(`[DeltaApplier] Update for ${payload.entityId}:`, {
        remoteTags: (remoteEntity as any).tags,
        remoteModified: remoteEntity.modified,
        payloadKeys: Object.keys(payload.data || {})
      })

      if (index === -1) {
        // Entity doesn't exist - add it (handle out-of-order deltas)
        console.log(`[DeltaApplier] Entity not found, adding as new`)
        updated = [...current, payload.data as IdentifiableEntity]
      } else {
        // Check for conflict (local modification newer than delta)
        const localEntity = current[index]

        console.log(`[DeltaApplier] Local entity:`, {
          localTags: (localEntity as any).tags,
          localModified: localEntity.modified
        })

        // Last-writer-wins based on modified timestamp
        if (
          localEntity.modified &&
          remoteEntity.modified &&
          localEntity.modified > remoteEntity.modified
        ) {
          // Local is newer, skip this delta
          console.log(
            `[DeltaApplier] Skipping update for ${payload.entityId}: local is newer (local=${localEntity.modified}, remote=${remoteEntity.modified})`
          )
          return
        }

        // Apply the update
        console.log(`[DeltaApplier] Applying update, replacing entity`)
        updated = [...current]
        updated[index] = payload.data as IdentifiableEntity
      }
      break
    }

    case 'delete': {
      updated = current.filter((item) => item.id !== payload.entityId)
      break
    }

    default:
      throw new Error(`Unknown entity operation: ${payload.entityOp}`)
  }

  // Register expected write so onChanged handler skips this sync-applied change
  registerExpectedSyncWrite(storageKey, updated)
  // Save updated data
  await Storage.set(storageKey, updated)
}

// ============================================================================
// Object Delta Application
// ============================================================================

/**
 * Apply a delta to an object-type storage key.
 * Merges changed fields into the existing object.
 *
 * @param storageKey - The storage key
 * @param payload - The decrypted object delta payload
 */
async function applyObjectDelta(
  storageKey: SyncableKey,
  payload: ObjectDeltaPayload
): Promise<void> {
  // Get current data
  const current = (await Storage.get<Record<string, unknown>>(storageKey)) || {}

  // Merge the changed fields
  const updated = {
    ...current,
    ...payload.data,
  }

  // Register expected write so onChanged handler skips this sync-applied change
  registerExpectedSyncWrite(storageKey, updated)
  // Save updated data
  await Storage.set(storageKey, updated)
}

// ============================================================================
// Full State Application
// ============================================================================

/**
 * Apply a full state snapshot (for initial sync or recovery).
 * Replaces the entire storage key with the snapshot data.
 *
 * @param storageKey - The storage key
 * @param data - The full state data
 */
export async function applySnapshot(
  storageKey: SyncableKey,
  data: unknown
): Promise<void> {
  registerExpectedSyncWrite(storageKey, data)
  await Storage.set(storageKey, data)
}

/**
 * Apply multiple snapshots at once.
 *
 * @param snapshots - Map of storage keys to their data
 */
export async function applySnapshots(
  snapshots: Map<SyncableKey, unknown>
): Promise<void> {
  for (const [key, data] of snapshots) {
    registerExpectedSyncWrite(key, data)
    await Storage.set(key, data)
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if sync is currently applying changes.
 * Re-exported from delta-tracker for convenience.
 */
export { isSyncCurrentlyApplying } from './delta-tracker'
