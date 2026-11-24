/** The small windows of the feeds page: folder name, feed settings, confirmations. */

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Folder, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ModalTemplate } from '@/components/ui/modal-template';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '@/i18n/format';
import { isolateBidi } from '@/i18n/bidi';
import { POLL_INTERVALS, type PollInterval, type RSSFeed, type RSSFeedError, type RSSFolder } from '@/types/rss';
import { NO_FOLDER } from '../feed-view';

export function useFeedErrorText(): (error: RSSFeedError) => string {
  const { t } = useTranslation();
  return (error) => {
    switch (error.code) {
      case 'access': return t('options.feeds.errorAccess');
      case 'http': return t('options.feeds.errorHttp', { status: error.status ?? '' });
      case 'format': return t('options.feeds.errorFormat');
      default: return t('options.feeds.errorNetwork');
    }
  };
}

interface FolderDialogProps {
  open: boolean;
  /** Absent when a new folder is made. */
  folder?: RSSFolder;
  onClose: () => void;
  /** Returns a message when the name cannot be used. */
  onSubmit: (name: string) => Promise<string | undefined>;
}

export function FolderDialog({ open, folder, onClose, onSubmit }: FolderDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setName(folder?.name ?? '');
      setError(undefined);
    }
  }, [open, folder]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const problem = await onSubmit(name.trim());
    if (problem) setError(problem);
    else onClose();
  };

  return (
    <ModalTemplate
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      className="sm:max-w-sm"
      heading={folder ? t('options.feeds.renameFolder') : t('options.feeds.newFolder')}
      titleIcon={<Folder className="h-5 w-5 text-primary" />}
      footer={(
        <>
          <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" type="submit" form="feed-folder-form" disabled={!name.trim()}>{t('common.save')}</Button>
        </>
      )}
    >
      <form id="feed-folder-form" onSubmit={submit} className="space-y-2">
        <Label htmlFor="feed-folder-name">{t('options.feeds.folderName')}</Label>
        <Input
          id="feed-folder-name"
          dir="auto"
          autoFocus
          maxLength={60}
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'feed-folder-error' : undefined}
          onChange={(event) => { setName(event.target.value); setError(undefined); }}
        />
        {error && <p id="feed-folder-error" role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </ModalTemplate>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  heading: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ open, heading, description, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <ModalTemplate
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      className="sm:max-w-sm"
      heading={heading}
      description={description}
      titleIcon={<Trash2 className="h-5 w-5 text-danger" />}
      footer={(
        <>
          <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" size="sm" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
        </>
      )}
    />
  );
}

export interface FeedSettingsValues {
  title: string;
  folderId: string | undefined;
  pollIntervalMinutes: PollInterval;
  notificationsEnabled: boolean;
}

interface FeedSettingsDialogProps {
  feed: RSSFeed | null;
  folders: RSSFolder[];
  onClose: () => void;
  onSave: (feed: RSSFeed, values: FeedSettingsValues) => void;
  onUnsubscribe: (feed: RSSFeed) => void;
}

export function FeedSettingsDialog({ feed, folders, onClose, onSave, onUnsubscribe }: FeedSettingsDialogProps) {
  const { t } = useTranslation();
  const errorText = useFeedErrorText();
  const [values, setValues] = useState<FeedSettingsValues | null>(null);

  useEffect(() => {
    setValues(feed && {
      title: feed.title,
      folderId: folders.some((folder) => folder.id === feed.folderId) ? feed.folderId : undefined,
      pollIntervalMinutes: feed.pollIntervalMinutes,
      notificationsEnabled: feed.notificationsEnabled,
    });
    // The form starts from the feed it was opened for; later refreshes must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed?.id]);

  const intervalLabels: Record<PollInterval, string> = {
    15: t('options.feedSettings.interval15m'),
    30: t('options.feedSettings.interval30m'),
    60: t('options.feedSettings.interval1h'),
    240: t('options.feedSettings.interval4h'),
    1440: t('options.feedSettings.intervalDaily'),
  };
  const set = (patch: Partial<FeedSettingsValues>) => setValues((prev) => prev && { ...prev, ...patch });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!feed || !values) return;
    onSave(feed, { ...values, title: values.title.trim() || feed.title });
    onClose();
  };

  return (
    <ModalTemplate
      open={feed !== null}
      onOpenChange={(next) => { if (!next) onClose(); }}
      className="sm:max-w-md"
      heading={t('options.feedSettings.title')}
      titleIcon={<Settings2 className="h-5 w-5 text-primary" />}
      footer={feed && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="me-auto text-danger hover:text-danger"
            onClick={() => { onClose(); onUnsubscribe(feed); }}
          >
            {t('options.feedList.unsubscribe')}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" type="submit" form="feed-settings-form">{t('common.save')}</Button>
        </>
      )}
    >
      {feed && values && (
        <form id="feed-settings-form" onSubmit={submit} className="space-y-4">
          {feed.lastError && (
            <p className="flex gap-2 rounded-md bg-warning-muted p-3 text-sm text-text-strong">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{errorText(feed.lastError)} {t('options.feeds.errorSince', { date: isolateBidi(formatDateTime(feed.lastError.since)) })}</span>
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="feed-title">{t('options.feeds.feedName')}</Label>
            <Input id="feed-title" dir="auto" value={values.title} onChange={(event) => set({ title: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="feed-folder">{t('options.feeds.folderShort')}</Label>
            <Select value={values.folderId ?? NO_FOLDER} onValueChange={(value) => set({ folderId: value === NO_FOLDER ? undefined : value })}>
              <SelectTrigger id="feed-folder"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FOLDER}>{t('options.feeds.noFolder')}</SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}><bdi dir="auto">{folder.name}</bdi></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="feed-interval">{t('options.feedSettings.checkEvery')}</Label>
            <Select value={String(values.pollIntervalMinutes)} onValueChange={(value) => set({ pollIntervalMinutes: Number(value) as PollInterval })}>
              <SelectTrigger id="feed-interval"><SelectValue /></SelectTrigger>
              <SelectContent>
                {POLL_INTERVALS.map((interval) => <SelectItem key={interval} value={String(interval)}>{intervalLabels[interval]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="feed-notifications">{t('options.feedSettings.notifications')}</Label>
            <Switch id="feed-notifications" checked={values.notificationsEnabled} onCheckedChange={(notificationsEnabled) => set({ notificationsEnabled })} />
          </div>
          <dl className="space-y-1 border-t border-border pt-4 text-xs text-text-muted">
            <div className="flex gap-2">
              <dt className="shrink-0">{t('options.feeds.feedAddress')}</dt>
              <dd dir="ltr" className="min-w-0 break-all text-text">{feed.url}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0">{t('options.feeds.lastChecked')}</dt>
              <dd className="text-text">{feed.lastFetchedAt ? formatDateTime(feed.lastFetchedAt) : t('options.feeds.never')}</dd>
            </div>
          </dl>
        </form>
      )}
    </ModalTemplate>
  );
}
