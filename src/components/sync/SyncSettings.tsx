/**
 * @module components/sync/SyncSettings
 *
 * WHY: Show sync status in settings page.
 *
 * WHAT: Simple panel showing:
 *       - Sync status (auto-enabled for Pro users)
 *       - Device list (this device + other devices)
 *       - Everything is automatic, no manual actions needed
 */

import { useState, useEffect } from 'react'
import { useSync } from '@/hooks/useSync'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/components/auth/useAuth'
import { Storage } from '@/utils/storage'
import { SyncStatusIndicator } from './SyncStatusIndicator'
import { cn } from '@/lib/utils'
import {
  Cloud,
  CloudOff,
  Smartphone,
  Monitor,
  Check,
} from 'lucide-react'
import type { LocalDeviceInfo } from '@/types/sync'

interface SyncSettingsProps {
  className?: string
}

export function SyncSettings({ className }: SyncSettingsProps) {
  const { state, devices, setSyncPaused } = useSync()
  const { isPro } = useAuth()
  const [deviceInfo, setDeviceInfo] = useState<LocalDeviceInfo | null>(null)

  // Load device info when state changes
  useEffect(() => {
    const loadDeviceInfo = async () => {
      const info = await Storage.get<LocalDeviceInfo>('syncDeviceInfo')
      setDeviceInfo(info)
    }
    loadDeviceInfo()
  }, [state?.status])

  // Don't show sync section for non-Pro users
  if (!isPro) return null

  const isPaused = state?.paused ?? false
  const isConnected = state?.status === 'connected'
  const isSyncingStatus = state?.status === 'syncing'
  const isSetUp = deviceInfo !== null || isConnected || isSyncingStatus

  const formatRelativeTime = (timestamp: string | Date | null) => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  const getDeviceIcon = (deviceName: string | null) => {
    if (!deviceName) return Smartphone
    const name = deviceName.toLowerCase()
    if (name.includes('windows') || name.includes('mac') || name.includes('linux')) {
      return Monitor
    }
    return Smartphone
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center',
            isPaused ? 'bg-muted' : 'bg-primary/10'
          )}>
            {isPaused
              ? <CloudOff className="w-5 h-5 text-muted-foreground" />
              : <Cloud className="w-5 h-5 text-primary" />
            }
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-strong">Cloud Sync</h3>
            <p className="text-sm text-text-muted">
              {isPaused
                ? 'Sync is paused — no changes will be sent or received'
                : isSetUp
                  ? 'Your tabs sync automatically across devices'
                  : 'Log in with Pro to enable sync'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isSetUp && !isPaused && <SyncStatusIndicator showLabel />}
          {isSetUp && (
            <Switch
              checked={!isPaused}
              onCheckedChange={(checked) => setSyncPaused(!checked)}
              aria-label={isPaused ? 'Enable sync' : 'Disable sync'}
            />
          )}
        </div>
      </div>

      {/* Not set up state */}
      {!isSetUp && (
        <div className="p-6 rounded-lg border border-border bg-bg-1">
          <div className="flex flex-col items-center text-center gap-4">
            <CloudOff className="w-12 h-12 text-text-muted" />
            <div>
              <h4 className="font-medium text-text-strong">Sync Not Active</h4>
              <p className="text-sm text-text-muted mt-1">
                Sync enables automatically when you log in with a Pro account.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Set up state - just show devices */}
      {isSetUp && (
        <div className="p-4 rounded-lg border border-border bg-bg-1">
          <h4 className="font-medium text-text-strong mb-3 flex items-center gap-2">
            <Smartphone className="w-4 h-4" />
            Your Devices ({devices.length})
          </h4>

          <div className="space-y-3">
            {devices.length === 0 ? (
              <p className="text-sm text-text-muted">Loading devices...</p>
            ) : (
              devices.map((device) => {
                const DeviceIcon = getDeviceIcon(device.deviceName)
                const isCurrent = device.deviceId === deviceInfo?.deviceId || device.isCurrentDevice

                return (
                  <div
                    key={device.deviceId}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-md',
                      isCurrent ? 'bg-primary/5 border border-primary/20' : 'bg-bg-2'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <DeviceIcon className={cn(
                        'w-5 h-5',
                        isCurrent ? 'text-primary' : 'text-text-muted'
                      )} />
                      <div>
                        <p className="font-medium text-text-strong flex items-center gap-2">
                          {device.deviceName || 'Unknown Device'}
                          {isCurrent && (
                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                              This device
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-text-muted">
                          Last seen: {formatRelativeTime(device.lastSeen)}
                          {device.createdAt && (
                            <span className="ml-2 before:content-['·'] before:mr-2">
                              Added {formatRelativeTime(device.createdAt)}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-text-muted/60 font-mono mt-0.5">
                          {device.deviceId.slice(-12)}
                          {device.lastSeq != null && (
                            <span className="ml-2 font-sans not-italic">
                              · seq {device.lastSeq}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    {isCurrent && isConnected && (
                      <Check className="w-4 h-4 text-green-500" />
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SyncSettings
