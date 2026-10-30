/**
 * @module components/ai/AINoticeDialog
 *
 * WHY:  Chrome Web Store user data policy asks for clear in-product disclosure
 *       before data leaves the device. The first Bluetab AI use on a device
 *       shows what each AI feature sends and who processes it.
 *
 * WHAT: - AINoticeDialog: Radix Dialog with the disclosure and one "Got it" button.
 *       - useAINotice(): `showNoticeOnce()` resolves right away when the notice
 *         was already seen, otherwise after the user closes it.
 *         `showNotice()` always opens it (e.g. from AI settings).
 *         Render `noticeDialog` once in the component that calls it.
 *
 * HOW:  "Seen" is stored by services/ai-notice (local, not synced). Closing the
 *       dialog any way (button, X, Esc, outside click) counts as seen.
 *
 * NOT:  Not an opt-in: AI features work after the notice. Calls no AI endpoint.
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { hasSeenAINotice, markAINoticeSeen } from '@/services/ai-notice';

const PRIVACY_POLICY_URL = 'https://supertry.net/privacy';

const ITEM_KEYS = ['chat', 'naming', 'summary', 'history'] as const;

interface AINoticeDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AINoticeDialog({ open, onClose }: AINoticeDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden" data-testid="ai-notice-dialog">
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border pe-12">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            {t('aiNotice.title')}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {t('aiNotice.intro')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-3 text-sm">
          <ul className="list-disc ps-5 space-y-1.5 text-text-default">
            {ITEM_KEYS.map((key) => (
              <li key={key}>{t(`aiNotice.items.${key}`)}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('aiNotice.processing')}{' '}
            <a
              href={PRIVACY_POLICY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-text-strong"
            >
              {t('aiNotice.privacyLink')}
            </a>
          </p>
        </div>

        <DialogFooter className="px-5 py-4 border-t border-border bg-transparent">
          <Button variant="primary" onClick={onClose} data-testid="ai-notice-got-it">
            {t('aiNotice.gotIt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useAINotice() {
  const [open, setOpen] = useState(false);
  const waitersRef = useRef<Array<() => void>>([]);

  const close = useCallback(() => {
    setOpen(false);
    void markAINoticeSeen().catch((err) => {
      console.warn('[BlueTab][AINotice] could not save notice state:', err);
    });
    const waiters = waitersRef.current;
    waitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, []);

  const showNotice = useCallback(() => {
    setOpen(true);
  }, []);

  const showNoticeOnce = useCallback(async (): Promise<void> => {
    if (await hasSeenAINotice()) return;
    await new Promise<void>((resolve) => {
      waitersRef.current.push(resolve);
      setOpen(true);
    });
  }, []);

  const noticeDialog = <AINoticeDialog open={open} onClose={close} />;

  return { showNotice, showNoticeOnce, noticeDialog };
}
