/**
 * @module services/sync-realtime
 *
 * WHY: Manage real-time sync connection lifecycle.
 *      Chrome extension service workers die after 5 minutes idle.
 *      This module handles the hybrid SSE + polling approach.
 *
 * WHAT: Provides:
 *       - SSE connection when UI is open (sidepanel/options)
 *       - Alarm-based polling when background only
 *       - Automatic reconnection on disconnects
 *       - Event forwarding to sync engine
 *
 * HOW: Uses SyncTransport for SSE connection.
 *      Registers chrome.alarms for background polling.
 *      Coordinates between foreground and background modes.
 */

import { SyncTransport, type ConnectionState } from './sync-transport'
import { getLocalDeviceId } from './delta-applier'
import { ALARM_NAMES } from '@/config/alarms'
import type { SyncSSEEventData } from '@/types/sync'

// ============================================================================
// Constants
// ============================================================================

const POLL_INTERVAL_MINUTES = 1

// ============================================================================
// State
// ============================================================================

let isUIActive = false
let onDeltaAvailable: (() => Promise<void>) | null = null
let onConnectionChange: ((connected: boolean) => void) | null = null

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize real-time sync.
 * Sets up SSE event handlers and polling alarm.
 *
 * @param callbacks - Callbacks for sync events
 */
export function initializeRealtime(callbacks: {
  onDeltaAvailable: () => Promise<void>
  onConnectionChange?: (connected: boolean) => void
}): void {
  onDeltaAvailable = callbacks.onDeltaAvailable
  onConnectionChange = callbacks.onConnectionChange || null

  // Set up SSE event handler
  SyncTransport.onEvent(handleSSEEvent)

  // Set up connection state handler
  SyncTransport.onStateChange(handleConnectionStateChange)

  // Set up polling alarm for background sync
  setupPollingAlarm()

  console.log('[SyncRealtime] Initialized')
}

/**
 * Shutdown real-time sync.
 */
export function shutdownRealtime(): void {
  SyncTransport.disconnect()
  onDeltaAvailable = null
  onConnectionChange = null

  // Remove polling alarm
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.clear(ALARM_NAMES.SYNC_POLL)
  }

  console.log('[SyncRealtime] Shutdown')
}

// ============================================================================
// UI Lifecycle
// ============================================================================

/**
 * Notify that UI is now active (sidepanel or options opened).
 * Connects to SSE for real-time updates.
 */
export async function onUIActive(): Promise<void> {
  if (isUIActive) return

  isUIActive = true
  console.log('[SyncRealtime] UI active, connecting to SSE')

  // Connect to SSE
  await SyncTransport.connect()
}

/**
 * Notify that UI is now inactive (all UI closed).
 * Disconnects SSE and relies on polling.
 */
export function onUIInactive(): void {
  if (!isUIActive) return

  isUIActive = false
  console.log('[SyncRealtime] UI inactive, disconnecting SSE')

  // Disconnect SSE (polling will continue)
  SyncTransport.disconnect()
}

/**
 * Check if UI is currently active.
 */
export function isUIOpen(): boolean {
  return isUIActive
}

// ============================================================================
// SSE Event Handling
// ============================================================================

/**
 * Handle SSE events from the server.
 */
function handleSSEEvent(event: SyncSSEEventData): void {
  console.log('[SyncRealtime] SSE event:', event.type)

  switch (event.type) {
    case 'connected':
      console.log('[SyncRealtime] Connected to sync server')
      break

    case 'delta_available': {
      // Skip notifications from our own device - we already have the data
      const localId = getLocalDeviceId()
      if (localId && event.deviceId === localId) {
        console.log('[SyncRealtime] Ignoring own device SSE notification')
        break
      }
      // New delta available from another device, trigger pull
      if (onDeltaAvailable) {
        onDeltaAvailable().catch((error) => {
          console.error('[SyncRealtime] Error handling delta_available:', error)
        })
      }
      break
    }

    case 'full_sync_required':
      // Full sync needed (too many missed deltas)
      console.warn('[SyncRealtime] Full sync required:', event.reason)
      // TODO: Trigger full sync in Phase 3
      break

    case 'heartbeat':
      // Just a keepalive, ignore
      break

    case 'error':
      console.error('[SyncRealtime] Server error:', event.message)
      break

    default:
      console.warn('[SyncRealtime] Unknown event type:', event)
  }
}

/**
 * Handle connection state changes.
 */
function handleConnectionStateChange(state: ConnectionState): void {
  const connected = state === 'connected'

  console.log('[SyncRealtime] Connection state:', state)

  if (onConnectionChange) {
    onConnectionChange(connected)
  }
}

// ============================================================================
// Polling
// ============================================================================

/**
 * Set up the polling alarm for background sync.
 */
function setupPollingAlarm(): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) {
    console.warn('[SyncRealtime] chrome.alarms not available')
    return
  }

  // Create polling alarm
  chrome.alarms.create(ALARM_NAMES.SYNC_POLL, {
    periodInMinutes: POLL_INTERVAL_MINUTES,
  })

  console.log(`[SyncRealtime] Polling alarm set for every ${POLL_INTERVAL_MINUTES} minute(s)`)
}

/**
 * Handle the polling alarm.
 * Called from service worker's alarm listener.
 * Does bilateral sync: push local changes, then pull remote changes.
 */
export async function handlePollAlarm(): Promise<void> {
  // Don't poll if SSE is connected (real-time sync is active)
  if (isUIActive && SyncTransport.getConnectionState() === 'connected') {
    console.log('[SyncRealtime] Skipping poll, SSE connected')
    return
  }

  console.log('[SyncRealtime] Polling - bilateral sync')

  // Trigger bilateral sync (push + pull) via callback
  if (onDeltaAvailable) {
    await onDeltaAvailable()
  }
}

/**
 * Get the alarm name for external reference.
 */
export function getPollAlarmName(): string {
  return ALARM_NAMES.SYNC_POLL
}

// ============================================================================
// Manual Triggers
// ============================================================================

/**
 * Manually trigger a sync check.
 * Useful for immediate sync when user requests it.
 */
export async function triggerSyncNow(): Promise<void> {
  console.log('[SyncRealtime] Manual sync triggered')

  if (onDeltaAvailable) {
    await onDeltaAvailable()
  }
}

/**
 * Get current connection state.
 */
export function getConnectionState(): ConnectionState {
  return SyncTransport.getConnectionState()
}

// ============================================================================
// Export
// ============================================================================

export const SyncRealtime = {
  initializeRealtime,
  shutdownRealtime,
  onUIActive,
  onUIInactive,
  isUIOpen,
  handlePollAlarm,
  getPollAlarmName,
  triggerSyncNow,
  getConnectionState,
}

export default SyncRealtime
