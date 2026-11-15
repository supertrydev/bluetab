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
import { Button } from '@/components/ui/button'
import { ModalTemplate, ModalTemplateSection } from '@/components/ui/modal-template'
import { ProBadge } from '@/components/auth/ProBadge'
import { UpgradeToProButton } from '@/components/auth/UpgradeToProButton'
import { useAuth } from '@/components/auth/useAuth'
import { Storage } from '@/utils/storage'
import { SyncStatusIndicator } from './SyncStatusIndicator'
import { SyncSetupDialog } from './SyncSetupDialog'
import { cn } from '@/lib/utils'
import {
  Cloud,
  CloudOff,
  Smartphone,
  Monitor,
  Check,
  Loader2,
  Trash2,
  Info,
} from 'lucide-react'
import { isLegacySyncDevice, type LocalDeviceInfo } from '@/types/sync'
import { useTranslation } from 'react-i18next'

interface SyncSettingsProps {
  className?: string
}

const SYNC_EXCLUSIONS = [
  {
    title: 'integrationsTitle', description: 'integrationsDescription',
  },
  {
    title: 'rssTitle', description: 'rssDescription',
  },
  {
    title: 'archiveTitle', description: 'archiveDescription',
  },
  {
    title: 'runtimeTitle', description: 'runtimeDescription',
  },
  {
    title: 'aiTitle', description: 'aiDescription',
  },
  {
    title: 'browserTitle', description: 'browserDescription',
  },
] as const

export function SyncSettings({ className }: SyncSettingsProps) {
  const { t } = useTranslation()
  const {
    state,
    devices,
    deviceLimit,
    deviceCount,
    canAddDevice,
    hasCloudSyncData,
    setSyncPaused,
    deleteDevice,
    disconnectCurrentDevice,
  } = useSync()
  const { isPro } = useAuth()
  const [deviceInfo, setDeviceInfo] = useState<LocalDeviceInfo | null>(null)
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null)
  const [setupDialogOpen, setSetupDialogOpen] = useState(false)
  const [exclusionsDialogOpen, setExclusionsDialogOpen] = useState(false)

  // Load device info when state changes
  useEffect(() => {
    const loadDeviceInfo = async () => {
      const info = await Storage.get<LocalDeviceInfo>('syncDeviceInfo')
      setDeviceInfo(info)
    }
    loadDeviceInfo()
  }, [state?.status])

  if (!isPro) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary/10">
            <Cloud className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-text-strong">{t('onboarding.extended.sync.title')}</h3>
              <ProBadge size="sm" />
            </div>
            <p className="text-sm text-text-muted">
              {t('components.sync.tagline')}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border-glass bg-bg-0/80 backdrop-blur-sm p-6 text-center">
          <CloudOff className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="mb-1 text-sm font-medium text-text-strong">{t('components.sync.proTitle')}</p>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('components.sync.proDescription')}
          </p>
          <UpgradeToProButton size="sm" />
        </div>
      </div>
    )
  }

  const isPaused = state?.paused ?? false
  const isConnected = state?.status === 'connected'
  const requiresPasswordRestore = state?.status === 'restore-required'
  const hasLocalDeviceInfo = deviceInfo !== null
  const needsLegacyReconnect = deviceInfo !== null && isLegacySyncDevice(deviceInfo)
  const currentDeviceInList = hasLocalDeviceInfo && devices.some((device) =>
    device.deviceId === deviceInfo.deviceId || device.isCurrentDevice
  )
  const needsDeviceConnection = needsLegacyReconnect || requiresPasswordRestore || !hasLocalDeviceInfo || (devices.length > 0 && !currentDeviceInList)
  const isSetUp = !needsDeviceConnection
  const visibleDeviceCount = deviceCount || devices.length
  const deviceCountLabel = deviceLimit == null
    ? String(visibleDeviceCount)
    : `${visibleDeviceCount}/${deviceLimit}`
  const deviceLimitReached = needsDeviceConnection && deviceLimit != null && !canAddDevice
  const setupMode = requiresPasswordRestore || devices.length > 0 || hasCloudSyncData ? 'restore' : 'setup'

  const formatRelativeTime = (timestamp: string | Date | null) => {
    if (!timestamp) return t('components.sync.never')
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return t('components.sync.unknown')
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return t('components.sync.justNow')
    if (diffMins < 60) return t('components.sync.minutesAgo', { count: diffMins })
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return t('time.hoursAgo', { count: diffHours })
    const diffDays = Math.floor(diffHours / 24)
    return t('components.sync.daysAgo', { count: diffDays })
  }

  const formatAbsoluteTime = (timestamp: string | Date | null) => {
    if (!timestamp) return t('components.sync.never')
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return t('components.sync.unknown')
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  const getDeviceIcon = (deviceName: string | null) => {
    if (!deviceName) return Smartphone
    const name = deviceName.toLowerCase()
    if (name.includes('windows') || name.includes('mac') || name.includes('linux')) {
      return Monitor
    }
    return Smartphone
  }

  const handleDeleteDevice = async (deviceId: string, isCurrent: boolean) => {
    if (isCurrent) return

    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm(t('components.sync.removeConfirm'))

    if (!confirmed) return

    setDeletingDeviceId(deviceId)
    try {
      await deleteDevice(deviceId)
    } finally {
      setDeletingDeviceId(null)
    }
  }

  const handleDisconnectCurrentDevice = async (deviceId: string) => {
    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm(
        t('components.sync.disconnectConfirm')
      )

    if (!confirmed) return

    setDeletingDeviceId(deviceId)
    try {
      const success = await disconnectCurrentDevice()
      if (success) {
        setDeviceInfo(null)
      }
    } finally {
      setDeletingDeviceId(null)
    }
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
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-text-strong">{t('onboarding.extended.sync.title')}</h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-info hover:text-info hover:bg-info/10"
                aria-label={t('components.sync.exclusions')}
                title={t('components.sync.exclusions')}
                onClick={() => setExclusionsDialogOpen(true)}
              >
                <Info className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-sm text-text-muted">
              {isPaused
                ? t('components.sync.paused')
                : requiresPasswordRestore
                  ? t('components.sync.restorePrompt')
                : isSetUp
                  ? t('components.sync.active')
                  : t('components.sync.connectPrompt')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isSetUp && !isPaused && <SyncStatusIndicator showLabel />}
          {isSetUp && (
            <Switch
              checked={!isPaused}
              onCheckedChange={(checked) => setSyncPaused(!checked)}
              aria-label={isPaused ? t('components.sync.enable') : t('components.sync.disable')}
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
                <h4 className="font-medium text-text-strong">
                  {requiresPasswordRestore
                    ? t('components.sync.restoreAccess')
                    : devices.length > 0 ? t('components.sync.connectDeviceTitle') : t('components.sync.notActive')}
                </h4>
                <p className="text-sm text-text-muted mt-1">
                  {needsLegacyReconnect
                    ? t('components.sync.legacyReconnect')
                    : requiresPasswordRestore
                    ? t('components.sync.restoreDescription')
                    : devices.length > 0
                    ? t('components.sync.joinDescription')
                    : hasCloudSyncData
                      ? t('components.sync.encryptedExists')
                    : t('components.sync.connectDescription')}
                </p>
                {deviceLimitReached && (
                  <p className="text-sm text-yellow-500 mt-3">
                  {t('components.sync.deviceLimit')}
                </p>
              )}
            </div>
            {needsLegacyReconnect ? (
              <Button
                type="button"
                size="sm"
                disabled={deletingDeviceId === deviceInfo.deviceId}
                onClick={() => void handleDisconnectCurrentDevice(deviceInfo.deviceId)}
              >
                {t('components.sync.disconnectDevice')}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => setSetupDialogOpen(true)}
                disabled={deviceLimitReached}
              >
                {requiresPasswordRestore ? t('components.sync.enterPassword') : t('components.sync.connectDevice')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Device list */}
      {(isSetUp || devices.length > 0) && (
        <div className="p-4 rounded-lg border border-border bg-bg-1">
          <h4 className="font-medium text-text-strong mb-3 flex items-center gap-2">
            <Smartphone className="w-4 h-4" />
            {t('components.sync.devices', { label: deviceCountLabel })}
          </h4>

          <div className="space-y-3">
            {devices.length === 0 ? (
              <p className="text-sm text-text-muted">{t('components.sync.loadingDevices')}</p>
            ) : (
              devices.map((device) => {
                const DeviceIcon = getDeviceIcon(device.deviceName)
                const isCurrent = hasLocalDeviceInfo && Boolean(
                  device.deviceId === deviceInfo.deviceId || device.isCurrentDevice
                )

                const isDeleting = deletingDeviceId === device.deviceId

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
                          <bdi dir="auto">{device.deviceName || t('components.sync.unknownDevice')}</bdi>
                          {isCurrent && (
                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                              {t('components.sync.thisDevice')}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-text-muted">
                          {t('components.sync.lastActive', { time: formatRelativeTime(device.lastSeen) })}
                          {device.lastSeen && (
                            <span className="ms-2 before:content-['·'] before:me-2">
                              <bdi dir="ltr">{formatAbsoluteTime(device.lastSeen)}</bdi>
                            </span>
                          )}
                          {device.createdAt && (
                            <span className="ms-2 before:content-['·'] before:me-2">
                              {t('components.sync.added', { time: formatRelativeTime(device.createdAt) })}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-text-muted/60 font-mono mt-0.5">
                          <bdi dir="ltr">{device.deviceId.slice(-12)}</bdi>
                          {device.lastSeq != null && (
                            <span dir="ltr" className="ms-2 font-sans not-italic">
                              · seq {device.lastSeq}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                          {isCurrent && isConnected && (
                            <Check className="w-4 h-4 text-green-500" />
                          )}
                      {isCurrent && (
                        <button
                          type="button"
                          title={t('components.sync.disconnectDevice')}
                          aria-label={t('components.sync.disconnectDevice')}
                          disabled={isDeleting}
                          onClick={() => handleDisconnectCurrentDevice(device.deviceId)}
                          className={cn(
                            'px-2.5 py-1.5 rounded-md text-xs font-medium text-text-muted transition-colors',
                            'hover:text-amber-300 hover:bg-amber-500/10',
                            'disabled:opacity-50 disabled:cursor-not-allowed'
                          )}
                        >
                          {isDeleting ? t('components.sync.disconnecting') : t('components.sync.disconnectDevice')}
                        </button>
                      )}
                      {!isCurrent && (
                        <button
                          type="button"
                          title={t('components.sync.removeDevice')}
                          aria-label={t('components.sync.removeNamedDevice', { name: device.deviceName || t('components.sync.unknownDevice') })}
                          disabled={isDeleting}
                          onClick={() => handleDeleteDevice(device.deviceId, isCurrent)}
                          className={cn(
                            'p-2 rounded-md text-text-muted transition-colors',
                            'hover:text-red-400 hover:bg-red-500/10',
                            'disabled:opacity-50 disabled:cursor-not-allowed'
                          )}
                        >
                          {isDeleting
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />
                          }
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      <SyncSetupDialog
        open={setupDialogOpen}
        onOpenChange={setSetupDialogOpen}
        mode={setupMode}
      />

      <ModalTemplate
        open={exclusionsDialogOpen}
        onOpenChange={setExclusionsDialogOpen}
        className="sm:max-w-xl"
        heading={t('components.sync.notSyncedTitle')}
        description={t('components.sync.notSyncedDescription')}
        titleIcon={<Info className="h-5 w-5 text-info" />}
      >
        {SYNC_EXCLUSIONS.map((item) => (
          <ModalTemplateSection
            key={item.title}
            heading={t(`components.sync.exclusionsItems.${item.title}`)}
            description={t(`components.sync.exclusionsItems.${item.description}`)}
            className="rounded-lg"
          />
        ))}
      </ModalTemplate>
    </div>
  )
}

export default SyncSettings
