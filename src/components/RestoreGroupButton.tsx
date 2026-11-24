import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';

interface RestoreGroupButtonProps {
  locked?: boolean;
  onRestore: () => void;
}

/** Opens all tabs of a saved group. The manager and the side panel share it. */
export function RestoreGroupButton({ locked, onRestore }: RestoreGroupButtonProps) {
  const { t } = useTranslation();
  const label = locked ? t('components.masonry.unlockRestore') : t('components.masonry.restoreTabs');
  return (
    <Button
      onClick={(e) => {
        e.stopPropagation();
        if (!locked) onRestore();
      }}
      disabled={locked}
      variant="soft"
      size="sm"
      title={label}
      aria-label={label}
    >
      <ExternalLink className="w-4 h-4" />
    </Button>
  );
}
