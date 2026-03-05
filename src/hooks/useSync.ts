/**
 * @module hooks/useSync
 *
 * WHY: Provide React components easy access to sync state and operations.
 *      Abstracts away message passing to service worker.
 *
 * WHAT: Provides:
 *       - Sync state (status, pending changes, etc.)
 *       - Sync operations (setup, restore, manual sync)
 *       - Automatic UI lifecycle management
 *
 * HOW: Uses chrome.runtime.sendMessage to communicate with service worker.
 *      Manages SSE connection lifecycle based on component mount.
 */

import { useState, useEffect, useCallback } from 'react'
import type { SyncStatus, SyncEngineState, SyncDevice } from '@/types/sync'

// ============================================================================
// Types
// ============================================================================

export interface UseSyncReturn {
  /** Current sync state */
  state: SyncEngineState | null
  /** List of devices */
  devices: SyncDevice[]
  /** Whether sync data is loading */
  isLoading: boolean
  /** Last error message */
  error: string | null
  /** Set up sync for the first time (deprecated - use autoSetup) */
  setupSync: (password: string, deviceName?: string) => Promise<boolean>
  /** Restore sync with password (deprecated - use autoSetup) */
  restoreSync: (password: string) => Promise<boolean>
  /** Trigger manual sync */
  triggerSync: () => Promise<void>
  /** Refresh state from service worker */
  refreshState: () => Promise<void>
  /** Get device list */
  getDevices: () => Promise<SyncDevice[]>
  /** Pause sync (stops delta generation, push/pull, SSE) */
  setSyncPaused: (paused: boolean) => Promise<void>
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for managing sync state and operations in React components.
 *
 * Automatically notifies service worker when UI mounts/unmounts
 * to enable/disable SSE connection.
 */
export function useSync(): UseSyncReturn {
  const [state, setState] = useState<SyncEngineState | null>(null)
  const [devices, setDevices] = useState<SyncDevice[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * Refresh state from service worker.
   */
  const refreshState = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SYNC_GET_STATE' })
      if (response.success) {
        setState(response.state)
        setError(null)
      } else {
        setError(response.error || 'Failed to get sync state')
      }
    } catch (err) {
      console.error('[useSync] Failed to get state:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }, [])

  /**
   * Set up sync for the first time.
   */
  const setupSync = useCallback(async (password: string, deviceName?: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_SETUP',
        password,
        deviceName,
      })

      if (response.success) {
        await refreshState()
        return true
      } else {
        setError(response.error || 'Setup failed')
        return false
      }
    } catch (err) {
      console.error('[useSync] Setup failed:', err)
      setError(err instanceof Error ? err.message : 'Setup failed')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [refreshState])

  /**
   * Restore sync with password.
   */
  const restoreSync = useCallback(async (password: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_RESTORE',
        password,
      })

      if (response.success) {
        await refreshState()
        return true
      } else {
        setError(response.error || 'Restore failed')
        return false
      }
    } catch (err) {
      console.error('[useSync] Restore failed:', err)
      setError(err instanceof Error ? err.message : 'Restore failed')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [refreshState])

  /**
   * Trigger manual sync.
   */
  const triggerSync = useCallback(async (): Promise<void> => {
    setError(null)

    try {
      const response = await chrome.runtime.sendMessage({ type: 'SYNC_MANUAL_TRIGGER' })

      if (!response.success) {
        setError(response.error || 'Sync failed')
      }

      await refreshState()
    } catch (err) {
      console.error('[useSync] Manual sync failed:', err)
      setError(err instanceof Error ? err.message : 'Sync failed')
    }
  }, [refreshState])

  /**
   * Get device list from server.
   */
  const getDevices = useCallback(async (): Promise<SyncDevice[]> => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SYNC_GET_DEVICES' })

      if (response.success && response.devices) {
        setDevices(response.devices)
        return response.devices
      } else {
        console.warn('[useSync] Failed to get devices:', response.error)
        return []
      }
    } catch (err) {
      console.error('[useSync] Get devices failed:', err)
      return []
    }
  }, [])

  /**
   * Pause or resume sync.
   */
  const setSyncPaused = useCallback(async (paused: boolean): Promise<void> => {
    try {
      await chrome.runtime.sendMessage({ type: 'SYNC_SET_PAUSED', paused })
      await refreshState()
    } catch (err) {
      console.error('[useSync] Set paused failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to toggle sync')
    }
  }, [refreshState])

  // Notify service worker when UI mounts/unmounts
  useEffect(() => {
    // Notify UI is active
    chrome.runtime.sendMessage({ type: 'SYNC_UI_ACTIVE' }).catch((err) => {
      console.error('[useSync] Failed to notify UI active:', err)
    })

    // Initial state and devices fetch
    Promise.all([refreshState(), getDevices()]).finally(() => {
      setIsLoading(false)
    })

    // Poll sync state frequently (lightweight, local only)
    const stateIntervalId = setInterval(refreshState, 5000)

    // Poll device list much less frequently (hits the API)
    const devicesIntervalId = setInterval(getDevices, 60000)

    // Cleanup on unmount
    return () => {
      clearInterval(stateIntervalId)
      clearInterval(devicesIntervalId)
      chrome.runtime.sendMessage({ type: 'SYNC_UI_INACTIVE' }).catch((err) => {
        console.error('[useSync] Failed to notify UI inactive:', err)
      })
    }
  }, [refreshState, getDevices])

  return {
    state,
    devices,
    isLoading,
    error,
    setupSync,
    restoreSync,
    triggerSync,
    refreshState,
    getDevices,
    setSyncPaused,
  }
}

export default useSync
