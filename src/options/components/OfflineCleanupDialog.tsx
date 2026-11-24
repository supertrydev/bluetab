import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { OfflineReadingService } from '@/services/offline-reading-service';
import type { OfflineArticle } from '@/types/offline-reading';
import { isolateBidi } from '@/i18n/bidi';

export interface OfflineCleanupDialogProps {
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function OfflineCleanupDialog({
  open,
  onClose,
  onDeleted,
}: OfflineCleanupDialogProps): JSX.Element {
  const { t } = useTranslation();
  const [candidates, setCandidates] = React.useState<OfflineArticle[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    void OfflineReadingService.getOldestUnread(50).then(cs => {
      setCandidates(cs);
      setSelected(new Set(cs.map(c => c.id)));
    });
  }, [open]);

  function toggle(id: string): void {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSelected(): Promise<void> {
    setDeleting(true);
    try {
      const ids = Array.from(selected);
      for (const id of ids) {
        await OfflineReadingService.deleteArticle(id);
      }
      onDeleted();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('options.offlineCleanup.title')}</DialogTitle>
          <DialogDescription>
            {t('options.offlineCleanup.description')}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 overflow-y-auto flex flex-col gap-1 py-2">
          {candidates.length === 0 ? (
            <li className="text-sm text-muted-foreground py-2 text-center">
              {t('options.offlineCleanup.empty')}
            </li>
          ) : (
            candidates.map(c => (
              <li key={c.id} className="flex items-center gap-2 text-sm px-1">
                <input
                  type="checkbox"
                  id={`cleanup-${c.id}`}
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  aria-label={t('options.offlineCleanup.deleteAria', {
                    title: isolateBidi(c.title || c.url, c.title ? 'auto' : 'ltr'),
                  })}
                  className="h-4 w-4 rounded border-border shrink-0"
                />
                <label
                  htmlFor={`cleanup-${c.id}`}
                  className="flex-1 truncate cursor-pointer"
                  title={isolateBidi(c.title || c.url, c.title ? 'auto' : 'ltr')}
                >
                  <bdi dir={c.title ? 'auto' : 'ltr'}>{c.title || c.url}</bdi>
                </label>
              </li>
            ))
          )}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={deleting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => { void deleteSelected(); }}
            disabled={selected.size === 0 || deleting}
          >
            {t('options.offlineCleanup.deleteSelected', { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
