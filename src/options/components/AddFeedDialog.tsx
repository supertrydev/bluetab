/**
 * @module options/components/AddFeedDialog
 *
 * WHY:  Users need to subscribe to new RSS feeds with a preview step to confirm
 *       the feed title and sample articles before committing.
 *
 * WHAT: Dialog with URL input -> Preview fetch -> confirm Subscribe flow.
 *       Uses RSSService.previewFeed (added as a thin wrapper) for preview without
 *       persisting. Falls back gracefully if fetch fails.
 *
 * NOT:  Does not call subscribeFeed directly — parent onSubscribe prop owns
 *       the actual subscription and state reload.
 */

import { useMemo, useState } from 'react';
import { Rss, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ensureFeedHostAccess } from '@/services/rss-host-permissions';
import { RSSService } from '@/services/rss-service';
import { FEED_TEMPLATES, type FeedTemplateRegion } from '@/config/feed-templates';
import type { ParsedFeed } from '@/types/rss';
import { isolateBidi } from '@/i18n/bidi';

interface AddFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubscribe: (url: string, category?: string) => void;
  categories?: string[];
}

type DialogStep = 'input' | 'preview' | 'subscribing';

export function AddFeedDialog({ open, onOpenChange, onSubscribe, categories = [] }: AddFeedDialogProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [step, setStep] = useState<DialogStep>('input');
  const [preview, setPreview] = useState<ParsedFeed | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categorySuggestions = useMemo(() => {
    const values = new Set<string>();
    categories.forEach((cat) => {
      const trimmed = cat.trim();
      if (trimmed) values.add(trimmed);
    });
    FEED_TEMPLATES.forEach((template) => values.add(template.category));
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [categories]);

  const templatesByRegion = useMemo(() => ({
    english: FEED_TEMPLATES.filter((template) => template.region === 'english'),
    turkish: FEED_TEMPLATES.filter((template) => template.region === 'turkish'),
  }), []);
  const templateRegionLabels: Record<FeedTemplateRegion, string> = {
    english: t('common.english'),
    turkish: t('common.turkish'),
  };

  const handleClose = () => {
    setUrl('');
    setCategory('');
    setSelectedTemplateId(null);
    setStep('input');
    setPreview(null);
    setError(null);
    onOpenChange(false);
  };

  const handlePreview = async () => {
    if (!url.trim()) {
      setError(t('options.addFeedDialog.enterUrl'));
      return;
    }

    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    setError(null);
    setStep('preview');
    setPreview(null);

    try {
      const granted = await ensureFeedHostAccess([normalizedUrl]);
      if (!granted) {
        throw new Error(t('options.addFeedDialog.siteAccessRequired'));
      }

      const parsed = await RSSService.previewFeed(normalizedUrl);
      setPreview(parsed);
      setUrl(normalizedUrl);
    } catch (err) {
      setError(
        err instanceof Error
          ? t('options.addFeedDialog.fetchFailedWithMessage', { message: isolateBidi(err.message) })
          : t('options.addFeedDialog.fetchFailed'),
      );
      setStep('input');
    }
  };

  const handleSubscribe = async () => {
    setStep('subscribing');
    onSubscribe(url, category);
    handleClose();
  };

  const handleSelectTemplate = (templateId: string) => {
    const template = FEED_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;

    setUrl(template.url);
    setCategory(template.category);
    setSelectedTemplateId(template.id);
    setStep('input');
    setPreview(null);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && step === 'input') {
      handlePreview();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Rss className="h-4 w-4 text-primary" />
            {t('options.addFeedDialog.title')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('options.addFeedDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 space-y-4 max-h-[68vh] overflow-y-auto">
          {/* URL input row */}
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setSelectedTemplateId(null);
                setError(null);
                if (step === 'preview') {
                  setStep('input');
                  setPreview(null);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('options.addFeedDialog.urlPlaceholder')}
              className="flex-1"
              dir="ltr"
              disabled={step === 'subscribing'}
              autoFocus
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={step === 'subscribing' || !url.trim()}
            >
              {step === 'preview' && !preview ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('options.addFeedDialog.preview')
              )}
            </Button>
          </div>

          {/* Optional category assignment */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="feed-category">
                {t('settings.rss.category')}
              </label>
              <span className="text-caption text-muted-foreground">{t('options.addFeedDialog.optional')}</span>
            </div>
            <Input
              id="feed-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={t('options.addFeedDialog.categoryPlaceholder')}
              className="h-8 text-xs"
              disabled={step === 'subscribing'}
            />
            {categorySuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {categorySuggestions.slice(0, 8).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setCategory(suggestion)}
                    className={`h-6 rounded-full border px-2 text-caption transition-colors ${
                      category === suggestion
                        ? 'border-primary/60 bg-primary/15 text-primary'
                        : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <bdi dir="auto">{suggestion}</bdi>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Starter templates */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">{t('options.addFeedDialog.starterTemplates')}</p>
                <p className="text-caption text-muted-foreground">
                  {t('options.addFeedDialog.starterTemplatesDescription')}
                </p>
              </div>
            </div>

            {(Object.keys(templatesByRegion) as FeedTemplateRegion[]).map((region) => (
              <div key={region} className="space-y-1.5">
                <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                  {templateRegionLabels[region]}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {templatesByRegion[region].map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => handleSelectTemplate(template.id)}
                      className={`min-w-0 rounded-md border px-2.5 py-2 text-start transition-colors ${
                        selectedTemplateId === template.id
                          ? 'border-primary/70 bg-primary/10'
                          : 'border-border bg-background/50 hover:border-primary/40 hover:bg-muted/40'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-xs font-medium text-foreground">
                          <bdi dir="auto">{template.title}</bdi>
                        </span>
                        <span className="ms-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">
                          <bdi dir="auto">{template.category}</bdi>
                        </span>
                      </div>
                      <p dir="auto" className="mt-0.5 truncate text-caption text-muted-foreground">
                        {template.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Error state */}
          {error && (
            <div className="flex items-start gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span dir="auto">{error}</span>
            </div>
          )}

          {/* Loading state */}
          {step === 'preview' && !preview && !error && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('options.addFeedDialog.fetchingPreview')}
            </div>
          )}

          {/* Preview panel */}
          {preview && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Rss className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate"><bdi dir="auto">{preview.title || t('options.addFeedDialog.untitledFeed')}</bdi></p>
                  {preview.description && (
                    <p dir="auto" className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {preview.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                {t('options.addFeedDialog.articlesFound', { count: preview.items.length })}
              </div>

              {preview.items.length > 0 && (
                <div className="space-y-1 pt-1">
                  <p className="text-xs font-medium text-muted-foreground">{t('options.addFeedDialog.sampleArticles')}</p>
                  <ul className="space-y-0.5">
                    {preview.items.slice(0, 3).map((item, i) => (
                      <li key={i} className="text-xs text-foreground truncate ps-2 border-s-2 border-primary/30">
                        <bdi dir="auto">{item.title || t('options.addFeedDialog.untitledArticle')}</bdi>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-4 py-3 border-t border-border bg-transparent">
          <Button variant="outline" size="sm" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleSubscribe}
            disabled={!preview || step === 'subscribing'}
          >
            {step === 'subscribing' ? (
              <><Loader2 className="h-3 w-3 me-1.5 animate-spin" />{t('options.addFeedDialog.subscribing')}</>
            ) : (
              t('options.addFeedDialog.subscribe')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
