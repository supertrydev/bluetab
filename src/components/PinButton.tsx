import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Pin } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PinButtonProps {
    groupId: string;
    isPinned: boolean;
    onToggle: (groupId: string) => void;
    size?: 'small' | 'medium';
    disabled?: boolean;
}

export function PinButton({
    groupId,
    isPinned,
    onToggle,
    size = 'medium',
    disabled = false
}: PinButtonProps) {
    const [isLoading, setIsLoading] = useState(false);

    const handleToggle = async () => {
        if (disabled || isLoading) return;

        setIsLoading(true);
        try {
            onToggle(groupId);
        } finally {
            setIsLoading(false);
        }
    };

    const iconSize = size === 'small' ? 12 : 16;

    return (
        <Button
            variant="ghost"
            size={size === 'small' ? 'sm' : 'default'}
            className={cn(
                'transition-all duration-200',
                isPinned
                    ? 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
            )}
            onClick={handleToggle}
            disabled={disabled || isLoading}
            title={isPinned ? 'Unpin group' : 'Pin group'}
            aria-label={isPinned ? 'Unpin group' : 'Pin group'}
        >
            <Pin
                size={iconSize}
                className={cn(
                    'transition-transform',
                    isPinned && 'rotate-45'
                )}
            />
        </Button>
    );
}

export default PinButton;
