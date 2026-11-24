import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isolateBidi } from '@/i18n/bidi';

interface OAuthNetworkErrorModalProps {
  isOpen: boolean;
  providerName: string;
  onRetry: () => void;
  onLearnMore: () => void;
  onDismiss: () => void;
}

export function OAuthNetworkErrorModal({
  isOpen,
  providerName,
  onRetry,
  onLearnMore,
  onDismiss,
}: OAuthNetworkErrorModalProps) {
  const { t } = useTranslation();
  const isolatedProviderName = isolateBidi(providerName);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <Info className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-2">
              <DialogTitle>
                {t('settings.integrations.oauthNetworkErrorTitle', { name: isolatedProviderName })}
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                {t('settings.integrations.oauthNetworkErrorDescription', { name: isolatedProviderName })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="mt-6 gap-2 sm:gap-3">
          <Button type="button" variant="secondary" onClick={onLearnMore}>
            {t('settings.integrations.oauthNetworkErrorLearnMore')}
          </Button>
          <Button type="button" onClick={onRetry}>
            {t('settings.integrations.oauthNetworkErrorTryAgain')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
