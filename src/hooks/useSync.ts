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
import type { SyncEngineState, SyncDevice } from '@/types/sync'
import { t as translate } from '@/i18n'

// ============================================================================
// Types
// ============================================================================

export interface UseSyncReturn {
  /** Current sync state */
  state: SyncEngineState | null
  /** List of devices */
  devices: SyncDevice[]
  /** Maximum registered sync devices allowed by the server */
  deviceLimit: number | null
  /** Current registered sync device count */
  deviceCount: number
  /** Whether the server will allow another device to be registered */
  canAddDevice: boolean
  /** Whether server-side encrypted sync data/config already exists */
  hasCloudSyncData: boolean
  /** Whether sync data is loading */
  isLoading: boolean
  /** Last error message */
  error: string | null
  /** Password-backed auto-setup for a new or restored device */
  autoSetupSync: (password: string, deviceName?: string, resetCloudData?: boolean) => Promise<boolean>
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
  /** Remove a stale device from the user's sync account */
  deleteDevice: (deviceId: string) => Promise<boolean>
  /** Disconnect this browser from sync while keeping local Bluetab data */
  disconnectCurrentDevice: () => Promise<boolean>
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
  const [deviceLimit, setDeviceLimit] = useState<number | null>(null)
  const [deviceCount, setDeviceCount] = useState(0)
  const [canAddDevice, setCanAddDevice] = useState(true)
  const [hasCloudSyncData, setHasCloudSyncData] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const applyDeviceMetadata = useCallback((response: {
    devices?: SyncDevice[]
    deviceLimit?: number
    deviceCount?: number
    canAddDevice?: boolean
    hasCloudSyncData?: boolean
  }) => {
    if (response.devices) {
      setDevices(response.devices)
    }
    if (typeof response.deviceLimit === 'number') {
      setDeviceLimit(response.deviceLimit)
    }
    if (typeof response.deviceCount === 'number') {
      setDeviceCount(response.deviceCount)
    } else if (response.devices) {
      setDeviceCount(response.devices.length)
    }
    if (typeof response.canAddDevice === 'boolean') {
      setCanAddDevice(response.canAddDevice)
    }
    if (typeof response.hasCloudSyncData === 'boolean') {
      setHasCloudSyncData(response.hasCloudSyncData)
    }
  }, [])

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
        setError(response.error || translate('components.sync.getStateFailed'))
      }
    } catch (err) {
      console.error('[useSync] Failed to get state:', err)
      setError(err instanceof Error ? err.message : translate('components.linearMirror.unknownError'))
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
        setError(response.error || translate('components.sync.setupFailed'))
        return false
      }
    } catch (err) {
      console.error('[useSync] Setup failed:', err)
      setError(err instanceof Error ? err.message : translate('components.sync.setupFailed'))
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
        setError(response.error || translate('components.sync.restoreFailed'))
        return false
      }
    } catch (err) {
      console.error('[useSync] Restore failed:', err)
      setError(err instanceof Error ? err.message : translate('components.sync.restoreFailed'))
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
        setError(response.error || translate('components.sync.syncFailed'))
      }

      await refreshState()
    } catch (err) {
      console.error('[useSync] Manual sync failed:', err)
      setError(err instanceof Error ? err.message : translate('components.sync.syncFailed'))
    }
  }, [refreshState])

  /**
   * Get device list from server.
   */
  const getDevices = useCallback(async (): Promise<SyncDevice[]> => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SYNC_GET_DEVICES' })

      if (response.success && response.devices) {
        applyDeviceMetadata(response)
        return response.devices
      } else {
        console.warn('[useSync] Failed to get devices:', response.error)
        return []
      }
    } catch (err) {
      console.error('[useSync] Get devices failed:', err)
      return []
    }
  }, [applyDeviceMetadata])

  /**
   * Set up or restore sync through the password-backed auto-setup endpoint.
   */
  const autoSetupSync = useCallback(async (
    password: string,
    deviceName?: string,
    resetCloudData = false
  ): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_AUTO_SETUP',
        password,
        deviceName,
        resetCloudData,
      })

      applyDeviceMetadata(response)

      if (response.success) {
        await refreshState()
        await getDevices()
        return true
      }

      setError(response.error || translate('components.sync.syncSetupFailed'))
      return false
    } catch (err) {
      console.error('[useSync] Auto setup failed:', err)
      setError(err instanceof Error ? err.message : translate('components.sync.syncSetupFailed'))
      return false
    } finally {
      setIsLoading(false)
    }
  }, [applyDeviceMetadata, getDevices, refreshState])

  /**
   * Remove a stale device from the server-side sync device registry.
   */
  const deleteDevice = useCallback(async (deviceId: string): Promise<boolean> => {
    setError(null)

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_DELETE_DEVICE',
        deviceId,
      })

      if (response.success) {
        await getDevices()
        return true
      }

      setError(response.error || translate('components.sync.removeDeviceFailed'))
      return false
    } catch (err) {
      console.error('[useSync] Delete device failed:', err)
      setError(err instanceof Error ? err.message : translate('components.sync.removeDeviceFailed'))
      return false
    }
  }, [getDevices])

  /**
   * Disconnect this browser from the server-side sync device registry.
   */
  const disconnectCurrentDevice = useCallback(async (): Promise<boolean> => {
    setError(null)

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_DISCONNECT_CURRENT_DEVICE',
      })

      if (response.success) {
        await refreshState()
        await getDevices()
        return true
      }

      setError(response.error || translate('components.sync.disconnectDeviceFailed'))
      return false
    } catch (err) {
      console.error('[useSync] Disconnect current device failed:', err)
      setError(err instanceof Error ? err.message : translate('components.sync.disconnectDeviceFailed'))
      return false
    }
  }, [getDevices, refreshState])

  /**
   * Pause or resume sync.
   */
  const setSyncPaused = useCallback(async (paused: boolean): Promise<void> => {
    try {
      await chrome.runtime.sendMessage({ type: 'SYNC_SET_PAUSED', paused })
      await refreshState()
    } catch (err) {
      console.error('[useSync] Set paused failed:', err)
      setError(err instanceof Error ? err.message : translate('components.sync.toggleFailed'))
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
    deviceLimit,
    deviceCount,
    canAddDevice,
    hasCloudSyncData,
    isLoading,
    error,
    autoSetupSync,
    setupSync,
    restoreSync,
    triggerSync,
    refreshState,
    getDevices,
    deleteDevice,
    disconnectCurrentDevice,
    setSyncPaused,
  }
}

export default useSync
