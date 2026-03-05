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
    label: string
    description: string
    animate?: boolean
  }
> = {
  connected: {
    icon: Cloud,
    color: 'text-green-500',
    bgColor: 'bg-green-500',
    label: 'Synced',
    description: 'Real-time sync active',
  },
  connecting: {
    icon: Cloud,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500',
    label: 'Connecting',
    description: 'Establishing connection...',
    animate: true,
  },
  syncing: {
    icon: Loader2,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500',
    label: 'Syncing',
    description: 'Syncing changes...',
    animate: true,
  },
  disconnected: {
    icon: CloudOff,
    color: 'text-text-muted',
    bgColor: 'bg-text-muted',
    label: 'Disconnected',
    description: 'Sync not active',
  },
  offline: {
    icon: WifiOff,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500',
    label: 'Offline',
    description: 'No internet connection. Changes will sync when online.',
  },
  error: {
    icon: AlertCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500',
    label: 'Error',
    description: 'Sync error occurred',
  },
}

export function SyncStatusIndicator({
  showLabel = false,
  className,
}: SyncStatusIndicatorProps) {
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

  const pendingText =
    state.pendingChanges > 0 ? ` (${state.pendingChanges} pending)` : ''

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
                {config.label}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="font-medium">{config.label}</p>
          <p className="text-xs text-text-muted">
            {config.description}
            {pendingText}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default SyncStatusIndicator
