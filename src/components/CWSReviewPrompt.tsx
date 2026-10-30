import { ExternalLink, MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CWSReviewPromptService } from '@/services/cws-review-prompt-service';

interface CWSReviewPromptProps {
  open: boolean;
  onClose: () => void;
}

export function CWSReviewPrompt({ open, onClose }: CWSReviewPromptProps) {
  const { t } = useTranslation();

  const handleReview = async () => {
    const url = CWSReviewPromptService.buildReviewUrl();
    await CWSReviewPromptService.completeReview();
    try {
      await chrome.tabs.create({ url, active: true });
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    onClose();
  };

  const handleDismiss = async () => {
    await CWSReviewPromptService.dismiss();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          void handleDismiss();
        }
      }}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border pe-12">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageSquareText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <DialogTitle>{t('dialogs.cwsReview.title')}</DialogTitle>
              <DialogDescription className="mt-1 leading-relaxed">
                {t('dialogs.cwsReview.description')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 text-sm text-muted-foreground">
          {t('dialogs.cwsReview.body')}
        </div>

        <DialogFooter className="px-5 py-4 border-t border-border bg-transparent">
          <Button type="button" variant="ghost" onClick={handleDismiss}>
            {t('dialogs.cwsReview.dismiss')}
          </Button>
          <Button type="button" onClick={handleReview}>
            <ExternalLink className="h-4 w-4" />
            {t('dialogs.cwsReview.review')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
