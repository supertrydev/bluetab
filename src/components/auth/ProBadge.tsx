/**
 * @module components/auth/ProBadge
 *
 * WHY: Visual indicator for premium features/users.
 *
 * WHAT: Small badge component showing Pro status.
 *
 * HOW: Simple styled component with gradient background.
 */

import { CircleStar } from 'lucide-react'

interface ProBadgeProps {
    size?: 'sm' | 'md'
    className?: string
}

export function ProBadge({ size = 'sm', className = '' }: ProBadgeProps) {
    const sizeClasses = {
        sm: 'text-[10px] px-1.5 py-0.5 gap-0.5',
        md: 'text-xs px-2 py-1 gap-1',
    }

    const iconSize = {
        sm: 'h-2.5 w-2.5',
        md: 'h-3 w-3',
    }

    return (
        <span
            className={`
        inline-flex items-center font-semibold rounded-full
        bg-primary
        text-white shadow-sm
        ${sizeClasses[size]}
        ${className}
      `}
        >
            <CircleStar className={iconSize[size]} />
            <span>PRO</span>
        </span>
    )
}

/**
 * Feature label with optional Pro badge
 */
interface FeatureLabelProps {
    label: string
    isPro?: boolean
    className?: string
}

export function FeatureLabel({ label, isPro = false, className = '' }: FeatureLabelProps) {
    return (
        <span className={`inline-flex items-center gap-2 ${className}`}>
            <span>{label}</span>
            {isPro && <ProBadge size="sm" />}
        </span>
    )
}
