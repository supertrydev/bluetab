import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

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
    const { t } = useTranslation();
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

    const iconSize = size === 'small' ? 14 : 16;

    return (
        <Button
            variant="ghost"
            size={size === 'small' ? 'sm' : 'md'}
            className={cn(
                'transition-all duration-200',
                size === 'small' && 'h-8 w-8 px-0',
                isPinned
                    ? 'text-primary hover:text-primary hover:bg-primary-muted'
                    : 'text-text-muted hover:text-text-strong hover:bg-accent'
            )}
            onClick={handleToggle}
            disabled={disabled || isLoading}
            title={isPinned ? t('components.pinButton.unpin') : t('components.pinButton.pin')}
            aria-label={isPinned ? t('components.pinButton.unpin') : t('components.pinButton.pin')}
        >
            <Pin
                size={iconSize}
                className={cn(
                    'transition-transform',
                    isPinned && 'rotate-45 fill-current'
                )}
            />
        </Button>
    );
}

export default PinButton;
