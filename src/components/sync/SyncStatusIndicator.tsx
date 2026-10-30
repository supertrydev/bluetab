/**
 * @module components/sync/SyncStatusIndicator
 *
 * WHY: Show sync connection status to users.
 *      Visual feedback for real-time sync state.
 *
 * WHAT: Small indicator showing:
 *       - Connected (green dot)
 *       - Syncing (animated blue dot)
 *       - Disconnected (gray dot)
 *       - Error (red dot)
 *       - Offline (yellow dot)
 */

import { useSync } from '@/hooks/useSync'
import { useAuth } from '@/components/auth/useAuth'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Cloud, CloudOff, Loader2, AlertCircle, WifiOff } from 'lucide-react'
import type { SyncStatus } from '@/types/sync'
import { useTranslation } from 'react-i18next'

interface SyncStatusIndicatorProps {
  /** Show text label next to icon */
  showLabel?: boolean
  /** Additional class names */
  className?: string
}

const STATUS_CONFIG: Record<
  SyncStatus,
  {
    icon: typeof Cloud
    color: string
    bgColor: string
    labelKey: string
    descriptionKey: string
    animate?: boolean
  }
> = {
  connected: {
    icon: Cloud,
    color: 'text-green-500',
    bgColor: 'bg-green-500',
    labelKey: 'components.syncStatus.synced',
    descriptionKey: 'components.syncStatus.syncedDescription',
  },
  connecting: {
    icon: Cloud,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500',
    labelKey: 'components.syncStatus.connecting',
    descriptionKey: 'components.syncStatus.connectingDescription',
    animate: true,
  },
  syncing: {
    icon: Loader2,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500',
    labelKey: 'components.syncStatus.syncing',
    descriptionKey: 'components.syncStatus.syncingDescription',
    animate: true,
  },
  disconnected: {
    icon: CloudOff,
    color: 'text-text-muted',
    bgColor: 'bg-text-muted',
    labelKey: 'components.syncStatus.disconnected',
    descriptionKey: 'components.syncStatus.disconnectedDescription',
  },
  offline: {
    icon: WifiOff,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500',
    labelKey: 'components.syncStatus.offline',
    descriptionKey: 'components.syncStatus.offlineDescription',
  },
  error: {
    icon: AlertCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500',
    labelKey: 'components.syncStatus.error',
    descriptionKey: 'components.syncStatus.errorDescription',
  },
  'restore-required': {
    icon: AlertCircle,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500',
    labelKey: 'components.syncStatus.restoreRequired',
    descriptionKey: 'components.syncStatus.restoreRequiredDescription',
  },
}

export function SyncStatusIndicator({
  showLabel = false,
  className,
}: SyncStatusIndicatorProps) {
  const { t } = useTranslation()
  const { state, isLoading } = useSync()
  const { isPro } = useAuth()

  if (!isPro || isLoading || !state) {
    return null
  }

  // If not initialized, don't show
  if (!state.initialized) {
    return null
  }

  const status = state.status
  const config = STATUS_CONFIG[status]
  const Icon = config.icon

  const pendingText = state.pendingChanges > 0
    ? t('components.syncStatus.pending', { count: state.pendingChanges })
    : ''

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex items-center gap-1.5 cursor-default',
              className
            )}
          >
            {/* Status dot */}
            <div className="relative">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  config.bgColor,
                  config.animate && 'animate-pulse'
                )}
              />
              {config.animate && (
                <div
                  className={cn(
                    'absolute inset-0 w-2 h-2 rounded-full',
                    config.bgColor,
                    'animate-ping opacity-75'
                  )}
                />
              )}
            </div>

            {/* Icon */}
            <Icon
              className={cn(
                'w-4 h-4',
                config.color,
                config.animate && status === 'syncing' && 'animate-spin'
              )}
            />

            {/* Label */}
            {showLabel && (
              <span className={cn('text-xs', config.color)}>
                {t(config.labelKey as never) as unknown as string}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="font-medium">{t(config.labelKey as never) as unknown as string}</p>
          <p className="text-xs text-text-muted">
            {t(config.descriptionKey as never) as unknown as string}
            {pendingText}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default SyncStatusIndicator
