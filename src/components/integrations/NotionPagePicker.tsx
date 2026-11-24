/**
 * NotionPagePicker — modal that lists pages the integration has access to
 * and lets the user pick one as the parent for a Save-to auto-mirror
 * database. Used by the group 3-dot menus (sidepanel + Manager) and, in
 * Batch 4, by the IntegrationCard footer for the brain-dump router.
 *
 * Props are intentionally minimal — the parent decides what to do with
 * the chosen pageId + databaseTitle. Reusable for any Notion auto-mirror
 * flow, not just group save.
 */

import { useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listNotionPages, type NotionPageOption } from '@/services/integration-service';

interface NotionPagePickerProps {
  open: boolean;
  /** Notion account id whose pages are listed. */
  accountId: string | null;
  /** Default text for the new database title (e.g. group name). */
  defaultDatabaseTitle?: string;
  /** Override the dialog heading (defaults to "Mirror to Notion"). */
  title?: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: (args: { pageId: string; databaseTitle: string }) => Promise<void> | void;
  onClose: () => void;
}

export function NotionPagePicker({
  open,
  accountId,
  defaultDatabaseTitle = '',
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: NotionPagePickerProps) {
  const { t } = useTranslation();
  const [pages, setPages] = useState<NotionPageOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [databaseTitle, setDatabaseTitle] = useState(defaultDatabaseTitle);
  const [submitting, setSubmitting] = useState(false);
  const resolvedTitle = title ?? t('components.notionPagePicker.title');
  const resolvedDescription = description ?? t('components.notionPagePicker.description');
  const resolvedConfirmLabel = confirmLabel ?? t('components.notionPagePicker.confirm');

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setPages(null);
    setSelectedPageId('');
    setDatabaseTitle(defaultDatabaseTitle);

    listNotionPages(accountId)
      .then((result) => {
        if (cancelled) return;
        setPages(result);
        if (result.length === 1) {
          setSelectedPageId(result[0].id);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : t('components.notionPagePicker.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, accountId, defaultDatabaseTitle]);

  async function handleConfirm() {
    if (!selectedPageId || !databaseTitle.trim()) return;
    setSubmitting(true);
    try {
      await onConfirm({
        pageId: selectedPageId,
        databaseTitle: databaseTitle.trim(),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onClose(); }}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
          <DialogTitle className="text-text-strong">{resolvedTitle}</DialogTitle>
          <DialogDescription className="text-xs leading-5">{resolvedDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-4 py-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="notion-page">
              {t('components.notionPagePicker.parentPage')}
            </label>
            {loading && (
              <div className="text-xs text-muted-foreground">{t('components.notionPagePicker.loadingPages')}</div>
            )}
            {loadError && (
              <div className="text-xs text-destructive">{loadError}</div>
            )}
            {pages && pages.length === 0 && !loadError && (
              <div className="text-xs text-muted-foreground">
                {t('components.notionPagePicker.noPages')}
              </div>
            )}
            {pages && pages.length > 0 && (
              <Select
                value={selectedPageId || undefined}
                onValueChange={setSelectedPageId}
                disabled={submitting}
              >
                <SelectTrigger className="h-11 w-full rounded-lg border-border bg-bg-0 text-sm text-text-strong data-[placeholder]:text-text-muted">
                  <SelectValue placeholder={t('components.notionPagePicker.selectPage')} />
                </SelectTrigger>
                <SelectContent>
                  {pages.map((page) => (
                    <SelectItem key={page.id} value={page.id}>
                      {page.title || t('components.notionPagePicker.untitled')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="notion-db-title">
              {t('components.notionPagePicker.databaseName')}
            </label>
            <Input
              id="notion-db-title"
              type="text"
              value={databaseTitle}
              onChange={(e) => setDatabaseTitle(e.target.value)}
              placeholder={t('components.notionPagePicker.databasePlaceholder')}
              disabled={submitting}
              className="h-11 rounded-lg border-border bg-bg-0 text-sm text-text-strong placeholder:text-text-muted focus-visible:ring-primary/50 focus-visible:ring-offset-0"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="px-4 py-3 border-t border-border bg-transparent">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            {t('components.notionPagePicker.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!selectedPageId || !databaseTitle.trim() || submitting}
          >
            {submitting ? t('components.notionPagePicker.creating') : resolvedConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
