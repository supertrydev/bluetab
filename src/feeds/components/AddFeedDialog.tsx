import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, FileUp, Loader2, Plus, Rss, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ModalTemplate } from '@/components/ui/modal-template';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToastManager } from '@/components/Toast';
import { getFeedTemplates, type FeedTemplate, type FeedTopic } from '@/config/feed-templates';
import { isolateBidi } from '@/i18n/bidi';
import { cn } from '@/lib/utils';
import { ensureFeedHostAccess } from '@/services/rss-host-permissions';
import { RSSError, RSSService } from '@/services/rss-service';
import type { DiscoveredFeed, OPMLFeed, RSSFeed, RSSFolder } from '@/types/rss';
import { NO_FOLDER, toFeedAddress, withWwwTwin } from '../feed-view';
import { hostOf, readOpmlFile, subscribeAll, type PendingImport } from '../opml';
import { useFeedErrorText } from './FeedDialogs';

const NEW_FOLDER = '__new__';
const TOPICS: FeedTopic[] = ['news', 'technology', 'development'];

interface AddFeedPanelProps {
  feeds: RSSFeed[];
  folders: RSSFolder[];
  /** The folder the user is looking at. */
  initialFolderId?: string;
  onAdded: (feed?: RSSFeed) => void;
}

/** Address box, suggestions and file import. Fills the dialog and the empty page. */
export function AddFeedPanel({ feeds, folders, initialFolderId, onAdded }: AddFeedPanelProps) {
  const { t, i18n } = useTranslation();
  const errorText = useFeedErrorText();
  const fileRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [isFinding, setIsFinding] = useState(false);
  const [found, setFound] = useState<DiscoveredFeed[] | null>(null);
  const [error, setError] = useState<string>();
  const [addingUrl, setAddingUrl] = useState<string>();
  const [folderId, setFolderId] = useState(initialFolderId ?? NO_FOLDER);
  const [newFolder, setNewFolder] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pendingFile, setPendingFile] = useState<PendingImport | null>(null);
  const [isAddingMany, setIsAddingMany] = useState(false);

  const subscribed = useMemo(() => new Set(feeds.map((feed) => feed.url)), [feeds]);
  const templates = useMemo(() => getFeedTemplates(i18n.resolvedLanguage ?? i18n.language), [i18n.resolvedLanguage, i18n.language]);
  const topicLabels: Record<FeedTopic, string> = {
    news: t('options.feeds.topicNews'),
    technology: t('options.feeds.topicTechnology'),
    development: t('options.feeds.topicDevelopment'),
  };

  const explain = (problem: unknown): string =>
    errorText({ code: problem instanceof RSSError ? problem.code : 'network', status: problem instanceof RSSError ? problem.status : undefined, since: 0 });

  const handleFind = async (event: FormEvent) => {
    event.preventDefault();
    const address = toFeedAddress(input);
    setFound(null);
    if (!address) {
      setError(t('options.feeds.invalidAddress'));
      return;
    }
    setError(undefined);
    setIsFinding(true);
    try {
      // First, while this is still the user's click.
      if (!await ensureFeedHostAccess(withWwwTwin(address))) {
        setError(t('options.addFeedDialog.siteAccessRequired'));
        return;
      }
      const results = await RSSService.discoverFeeds(address);
      setFound(results);
      if (results.length === 0) setError(t('options.feeds.noneFound'));
    } catch (problem) {
      setError(explain(problem));
    } finally {
      setIsFinding(false);
    }
  };

  const handleAdd = async (candidate: DiscoveredFeed) => {
    setAddingUrl(candidate.url);
    setError(undefined);
    try {
      if (!await ensureFeedHostAccess([candidate.url])) {
        setError(t('options.addFeedDialog.siteAccessRequired'));
        return;
      }
      const name = newFolder.trim();
      const target = folderId === NEW_FOLDER
        ? (name ? (await RSSService.createFolder(name)).id : undefined)
        : folderId === NO_FOLDER ? undefined : folderId;
      const feed = await RSSService.subscribeFeed(candidate.url, { folderId: target });
      ToastManager.getInstance().success(t('options.feedsPage.feedAdded'));
      onAdded(feed);
    } catch (problem) {
      setError(problem instanceof RSSError && problem.code === 'duplicate' ? t('options.feeds.allPresent') : explain(problem));
    } finally {
      setAddingUrl(undefined);
    }
  };

  const addMany = async (list: OPMLFeed[]) => {
    setIsAddingMany(true);
    try {
      if (await subscribeAll(list)) onAdded();
      setPicked(new Set());
      setPendingFile(null);
    } finally {
      setIsAddingMany(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const pending = await readOpmlFile(file);
      if (pending.feeds.length === 0) ToastManager.getInstance().warning(t('options.opml.noFeedsFound'));
      else setPendingFile(pending);
    } catch {
      ToastManager.getInstance().error(t('options.opml.importFailed'));
    }
  };

  const toggle = (template: FeedTemplate) => setPicked((prev) => {
    const next = new Set(prev);
    if (!next.delete(template.id)) next.add(template.id);
    return next;
  });

  const pickedFeeds = templates
    .filter((template) => picked.has(template.id))
    .map((template) => ({ title: template.title, xmlUrl: template.url, folder: topicLabels[template.topic] }));

  return (
    <div className="space-y-6">
      <form onSubmit={handleFind} className="space-y-2">
        <Label htmlFor="feed-address">{t('options.feeds.address')}</Label>
        <div className="flex gap-2">
          <Input
            id="feed-address"
            dir="ltr"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={input}
            placeholder="theverge.com"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'feed-address-error' : 'feed-address-hint'}
            onChange={(event) => { setInput(event.target.value); setError(undefined); setFound(null); }}
            className="min-w-0 flex-1"
          />
          <Button type="submit" disabled={isFinding || !input.trim()}>
            {isFinding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t('options.feeds.find')}
          </Button>
        </div>
        {error ? (
          <p id="feed-address-error" role="alert" className="flex items-start gap-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
          </p>
        ) : (
          <p id="feed-address-hint" className="text-xs text-text-muted">{t('options.feeds.addressHint')}</p>
        )}
      </form>

      {found && found.length > 0 && (
        <section className="space-y-3 rounded-md border border-border p-4">
          <ul className="space-y-3">
            {found.map((candidate) => {
              const isPresent = subscribed.has(candidate.url);
              return (
                <li key={candidate.url} className="flex items-start gap-3">
                  <Rss className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-strong"><bdi dir="auto">{candidate.title || hostOf(candidate.url)}</bdi></p>
                    <p dir="ltr" className="truncate text-start text-xs text-text-muted">{candidate.url}</p>
                    {candidate.sampleTitles?.map((title) => (
                      <p key={title} className="mt-1 truncate text-xs text-text"><bdi dir="auto">{title}</bdi></p>
                    ))}
                  </div>
                  <Button size="sm" variant={isPresent ? 'ghost' : 'primary'} disabled={isPresent || addingUrl !== undefined} onClick={() => { void handleAdd(candidate); }}>
                    {addingUrl === candidate.url ? <Loader2 className="h-4 w-4 animate-spin" /> : isPresent ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {isPresent ? t('options.feeds.added') : t('common.add')}
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Label htmlFor="feed-add-folder" className="text-sm">{t('options.feeds.addInto')}</Label>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger id="feed-add-folder" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FOLDER}>{t('options.feeds.noFolder')}</SelectItem>
                {folders.map((folder) => <SelectItem key={folder.id} value={folder.id}><bdi dir="auto">{folder.name}</bdi></SelectItem>)}
                <SelectItem value={NEW_FOLDER}>{t('options.feeds.newFolder')}</SelectItem>
              </SelectContent>
            </Select>
            {folderId === NEW_FOLDER && (
              <Input dir="auto" value={newFolder} maxLength={60} onChange={(event) => setNewFolder(event.target.value)} placeholder={t('options.feeds.folderName')} aria-label={t('options.feeds.folderName')} className="w-48" />
            )}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-text-strong">{t('options.feeds.suggestions')}</h3>
          <p className="text-xs text-text-muted">{t('options.feeds.suggestionsDescription')}</p>
        </div>
        {TOPICS.map((topic) => (
          <div key={topic} className="space-y-1.5">
            <h4 className="text-xs font-medium text-text-muted">{topicLabels[topic]}</h4>
            <div className="flex flex-wrap gap-2">
              {templates.filter((template) => template.topic === topic).map((template) => {
                const isPresent = subscribed.has(template.url);
                const isPicked = picked.has(template.id);
                return (
                  <button
                    key={template.id}
                    type="button"
                    disabled={isPresent}
                    aria-pressed={isPicked}
                    title={hostOf(template.url)}
                    onClick={() => toggle(template)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors disabled:opacity-60',
                      isPicked ? 'border-primary bg-primary-muted text-primary' : 'border-border text-text-strong hover:bg-accent',
                    )}
                  >
                    {(isPresent || isPicked) && <Check className="h-3.5 w-3.5" />}
                    <bdi dir="auto">{template.title}</bdi>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {pickedFeeds.length > 0 && (
          <Button size="sm" disabled={isAddingMany} onClick={() => { void addMany(pickedFeeds); }}>
            {isAddingMany ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('options.feeds.addSelected', { count: pickedFeeds.length })}
          </Button>
        )}
      </section>

      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
        <input ref={fileRef} type="file" accept=".opml,.xml" className="hidden" onChange={(event) => { void handleFile(event.target.files?.[0]); event.target.value = ''; }} />
        {pendingFile ? (
          <>
            <p className="min-w-0 flex-1 text-sm text-text">
              {t('options.feeds.fileReady', { count: pendingFile.feeds.length, file: isolateBidi(pendingFile.fileName) })}
            </p>
            <Button size="sm" variant="outline" onClick={() => setPendingFile(null)}>{t('common.cancel')}</Button>
            <Button size="sm" disabled={isAddingMany} onClick={() => { void addMany(pendingFile.feeds); }}>{t('options.feeds.importNow')}</Button>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-sm text-text-muted">{t('options.feeds.importHint')}</p>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <FileUp className="h-4 w-4" />{t('options.feeds.importFile')}
            </Button>
          </>
        )}
      </section>
    </div>
  );
}

interface AddFeedDialogProps extends AddFeedPanelProps {
  open: boolean;
  onClose: () => void;
}

export function AddFeedDialog({ open, onClose, onAdded, ...panel }: AddFeedDialogProps) {
  const { t } = useTranslation();
  // A fresh panel each time it opens.
  const [openCount, setOpenCount] = useState(0);
  useEffect(() => { if (open) setOpenCount((count) => count + 1); }, [open]);

  return (
    <ModalTemplate
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      className="sm:max-w-xl"
      heading={t('options.addFeedDialog.title')}
      titleIcon={<Rss className="h-5 w-5 text-primary" />}
    >
      <AddFeedPanel key={openCount} {...panel} onAdded={(feed) => { onClose(); onAdded(feed); }} />
    </ModalTemplate>
  );
}
