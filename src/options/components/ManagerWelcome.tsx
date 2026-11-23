import { useTranslation } from 'react-i18next';
import { useDirection } from '@radix-ui/react-direction';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ManagerWelcome({ kind, onDone }: { kind: 'sample' | 'existing' | null; onDone: () => void }) {
  const { t } = useTranslation();
  const direction = useDirection();
  const [beforeShortcut, afterShortcut] = t(kind === 'sample' ? 'managerWelcome.body' : 'managerWelcome.existingBody').split('Alt+S');
  return <Dialog open={kind !== null} onOpenChange={open => { if (!open) onDone(); }}>
    <DialogContent dir={direction} showCloseButton={false} className="max-w-md">
      <DialogHeader>
        <DialogTitle>{t('managerWelcome.title')}</DialogTitle>
        <DialogDescription>{beforeShortcut}<bdi dir="ltr">Alt+S</bdi>{afterShortcut}</DialogDescription>
      </DialogHeader>
      <DialogFooter className="mt-4"><Button onClick={onDone}>{t('managerWelcome.done')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
