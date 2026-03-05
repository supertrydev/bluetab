import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pin, ChevronDown, ChevronUp } from 'lucide-react';

export interface PinnedGroupIndicatorProps {
    isPinned: boolean;
    showLabel?: boolean;
    size?: 'small' | 'medium';
}

export function PinnedGroupIndicator({
    isPinned,
    showLabel = false,
    size = 'medium'
}: PinnedGroupIndicatorProps) {
    if (!isPinned) return null;

    return (
        <Badge variant="secondary" className={size === 'small' ? 'text-xs' : 'text-sm'}>
            <Pin className="h-3 w-3 mr-1" />
            {showLabel && <span>Pinned</span>}
        </Badge>
    );
}

export interface PinnedSectionHeaderProps {
    count: number;
    collapsed?: boolean;
    onToggle?: () => void;
}

export function PinnedSectionHeader({
    count,
    collapsed = false,
    onToggle
}: PinnedSectionHeaderProps) {
    if (count === 0) return null;

    return (
        <div className="flex items-center justify-between px-2 py-2 bg-gray-100 dark:bg-gray-800 rounded-md mb-2">
            <div className="flex items-center gap-2">
                <Pin className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Pinned ({count})</span>
            </div>
            {onToggle && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onToggle}
                    aria-label={collapsed ? 'Expand pinned groups' : 'Collapse pinned groups'}
                >
                    {collapsed ? (
                        <ChevronDown className="h-3 w-3" />
                    ) : (
                        <ChevronUp className="h-3 w-3" />
                    )}
                </Button>
            )}
        </div>
    );
}

export interface GroupPinIndicatorProps {
    isPinned: boolean;
    className?: string;
}

export function GroupPinIndicator({
    isPinned,
    className = ''
}: GroupPinIndicatorProps) {
    if (!isPinned) return null;

    return (
        <Badge variant="secondary" className={className}>
            <Pin className="h-3 w-3" />
        </Badge>
    );
}

export default PinnedGroupIndicator;
