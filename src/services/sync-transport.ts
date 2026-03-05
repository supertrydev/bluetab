/**
 * @module services/sync-transport
 *
 * WHY: Handle real-time communication with the sync server.
 *      Manages SSE connections and REST API calls.
 *
 * WHAT: Provides:
 *       - SSE connection management with auto-reconnect
 *       - REST API calls for push/pull/setup
 *       - Connection state tracking
 *       - Event callbacks for sync notifications
 *
 * HOW: Uses EventSource for SSE (real-time notifications).
 *      Uses fetch for REST calls (push/pull).
 *      Implements exponential backoff for reconnection.
 *
 * NOT: Does not encrypt/decrypt data - that's SyncCrypto's job.
 *      Does not track deltas - that's DeltaTracker's job.
 */

import * as AuthState from '@/utils/auth-state'
import type {
  SyncSSEEventData,
  SyncSetupRequest,
  SyncSetupResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncPullResponse,
  SyncStatusResponse,
} from '@/types/sync'

// ============================================================================
// Types
// ============================================================================

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export type SSEEventCallback = (event: SyncSSEEventData) => void
export type ConnectionStateCallback = (state: ConnectionState) => void

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  apiBaseUrl: 'https://supertry.net',
  reconnectMinDelay: 1000,
  reconnectMaxDelay: 30000,
  reconnectMultiplier: 2,
}

// ============================================================================
// State
// ============================================================================

let config = { ...DEFAULT_CONFIG }
let eventSource: EventSource | null = null
let connectionState: ConnectionState = 'disconnected'
let reconnectAttempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let deviceId: string | null = null

const eventCallbacks: Set<SSEEventCallback> = new Set()
const stateCallbacks: Set<ConnectionStateCallback> = new Set()

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configure the sync transport.
 */
export function configure(options: Partial<typeof DEFAULT_CONFIG>): void {
  config = { ...config, ...options }
}

/**
 * Set the device ID for SSE connection.
 */
export function setDeviceId(id: string): void {
  deviceId = id
}

// ============================================================================
// SSE Connection
// ============================================================================

/**
 * Connect to the SSE endpoint for real-time notifications.
 */
export async function connect(): Promise<boolean> {
  if (eventSource && connectionState === 'connected') {
    return true
  }

  // Get auth token
  const token = await AuthState.getAccessToken()
  if (!token) {
    updateConnectionState('error')
    return false
  }

  updateConnectionState('connecting')

  return new Promise((resolve) => {
    try {
      // Build SSE URL with auth token as query param
      // Note: EventSource doesn't support custom headers, so we use query param
      const url = new URL(`${config.apiBaseUrl}/api/sync/events`)
      url.searchParams.set('token', token)
      if (deviceId) {
        url.searchParams.set('deviceId', deviceId)
      }

      eventSource = new EventSource(url.toString())

      eventSource.onopen = () => {
        console.log('[SyncTransport] SSE connected')
        reconnectAttempts = 0
        updateConnectionState('connected')
        resolve(true)
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as SyncSSEEventData
          notifyEventCallbacks(data)
        } catch (error) {
          console.error('[SyncTransport] Failed to parse SSE event:', error)
        }
      }

      eventSource.onerror = (error) => {
        console.error('[SyncTransport] SSE error:', error)

        if (eventSource?.readyState === EventSource.CLOSED) {
          updateConnectionState('disconnected')
          eventSource = null
          scheduleReconnect()
        } else {
          updateConnectionState('error')
        }

        resolve(false)
      }

    } catch (error) {
      console.error('[SyncTransport] Failed to create EventSource:', error)
      updateConnectionState('error')
      resolve(false)
    }
  })
}

/**
 * Disconnect from the SSE endpoint.
 */
export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (eventSource) {
    eventSource.close()
    eventSource = null
  }

  reconnectAttempts = 0
  updateConnectionState('disconnected')
}

/**
 * Schedule a reconnection attempt with exponential backoff.
 */
function scheduleReconnect(): void {
  if (reconnectTimer) return

  const delay = Math.min(
    config.reconnectMinDelay * Math.pow(config.reconnectMultiplier, reconnectAttempts),
    config.reconnectMaxDelay
  )

  console.log(`[SyncTransport] Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})`)

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    reconnectAttempts++
    await connect()
  }, delay)
}

/**
 * Update connection state and notify callbacks.
 */
function updateConnectionState(state: ConnectionState): void {
  if (connectionState === state) return
  connectionState = state
  stateCallbacks.forEach((cb) => {
    try {
      cb(state)
    } catch (error) {
      console.error('[SyncTransport] State callback error:', error)
    }
  })
}

/**
 * Notify event callbacks of new SSE event.
 */
function notifyEventCallbacks(event: SyncSSEEventData): void {
  eventCallbacks.forEach((cb) => {
    try {
      cb(event)
    } catch (error) {
      console.error('[SyncTransport] Event callback error:', error)
    }
  })
}

// ============================================================================
// Event Subscriptions
// ============================================================================

/**
 * Subscribe to SSE events.
 */
export function onEvent(callback: SSEEventCallback): () => void {
  eventCallbacks.add(callback)
  return () => eventCallbacks.delete(callback)
}

/**
 * Subscribe to connection state changes.
 */
export function onStateChange(callback: ConnectionStateCallback): () => void {
  stateCallbacks.add(callback)
  return () => stateCallbacks.delete(callback)
}

/**
 * Get current connection state.
 */
export function getConnectionState(): ConnectionState {
  return connectionState
}

// ============================================================================
// REST API Calls
// ============================================================================

/**
 * Make an authenticated API request.
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = await AuthState.getAccessToken()
  if (!token) {
    return { ok: false, error: 'Not authenticated' }
  }

  try {
    const response = await fetch(`${config.apiBaseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return { ok: false, error: data.error || `HTTP ${response.status}` }
    }

    return { ok: true, data }
  } catch (error) {
    console.error(`[SyncTransport] API request failed: ${endpoint}`, error)
    return { ok: false, error: error instanceof Error ? error.message : 'Request failed' }
  }
}

/**
 * Setup sync for this device.
 */
export async function setupDevice(request: SyncSetupRequest): Promise<SyncSetupResponse> {
  const result = await apiRequest<SyncSetupResponse>('/api/sync/setup', {
    method: 'POST',
    body: JSON.stringify(request),
  })

  if (!result.ok) {
    return { success: false, error: result.error }
  }

  return result.data!
}

/**
 * Push deltas to the server.
 */
export async function pushDeltas(request: SyncPushRequest): Promise<SyncPushResponse> {
  const result = await apiRequest<SyncPushResponse>('/api/sync/push', {
    method: 'POST',
    body: JSON.stringify(request),
  })

  if (!result.ok) {
    return { success: false, error: result.error }
  }

  return result.data!
}

/**
 * Pull deltas from the server.
 */
export async function pullDeltas(
  since: number,
  limit = 50
): Promise<SyncPullResponse> {
  const params = new URLSearchParams({
    since: since.toString(),
    limit: limit.toString(),
  })
  if (deviceId) {
    params.set('deviceId', deviceId)
  }

  const result = await apiRequest<SyncPullResponse>(`/api/sync/pull?${params}`)

  if (!result.ok) {
    return { success: false, error: result.error }
  }

  return result.data!
}

/**
 * Get sync status.
 */
export async function getStatus(): Promise<SyncStatusResponse> {
  const result = await apiRequest<SyncStatusResponse>('/api/sync/setup')

  if (!result.ok) {
    return { success: false, error: result.error }
  }

  return result.data!
}

// ============================================================================
// Export
// ============================================================================

export const SyncTransport = {
  configure,
  setDeviceId,
  connect,
  disconnect,
  onEvent,
  onStateChange,
  getConnectionState,
  setupDevice,
  pushDeltas,
  pullDeltas,
  getStatus,
}

export default SyncTransport
