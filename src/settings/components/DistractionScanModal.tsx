/**
 * @module settings/components/DistractionScanModal
 *
 * WHY:  Pro users need a review surface to act on AI-suggested domains "for review".
 *       The modal persists the last scan result so closing and reopening shows cached
 *       results — consistent with the Phase 10 offline reading persistence pattern.
 *
 * WHAT: Radix Dialog modal with:
 *       - Empty-state: "No scan yet — click Scan" with explainer
 *       - Loading state: skeleton list during scan
 *       - Cached-results state: candidate cards + batch approve/decline footer
 *       - Block-state: inline error per reason (kill switch, allowance, rate limit…)
 *
 * HOW:  - On open: loads cached results via DistractionDetectorService.loadCachedResults()
 *       - Scan/Rescan button: calls DistractionDetectorService.scan(token)
 *       - Each candidate card has a checkbox for batch selection
 *       - Footer: "Add N to blocklist" → approve(); "Suppress N for 30 days" → decline()
 *       - TimeOfDayHeatmap: 24-bucket bar strip inline in each card
 *
 * COPY DISCIPLINE (DETECT-06, SAFETY-02):
 *   Candidates are always labeled "For review" — never "distraction" / "distracting".
 *   Phase 9 CI grep enforces banned copy patterns in this file — keep all
 *   user-facing text neutral and forward-looking.
 *
 * NOT:  Does not show raw URLs (DETECT-03 — only domain-level aggregates surfaced).
 *       Does not render for Free users — FocusSettings routes Free users to upgrade page.
 */

import { siteFaviconUrl } from '@/platform/extension-platform';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';
import { t as translate } from '@/i18n';
import * as Dialog from '@radix-ui/react-dialog';
import { X, ScanSearch, RefreshCcw, AlertCircle } from 'lucide-react';
import { toast } from '@/components/Toast';
import { formatRelativeTimeFromPast } from '@/i18n/format';
import { DistractionDetectorService, type ScanBlockReason } from '../../services/distraction-detector-service';
import { useAuth } from '../../components/auth/useAuth';
import { getAccessToken } from '../../utils/auth-state';
import { useAINotice } from '@/components/ai/AINoticeDialog';
import type { DistractionCandidate, ScanCache } from '../../types/distraction';

// ─── TimeOfDayHeatmap ────────────────────────────────────────────────────────

interface TimeOfDayHeatmapProps {
  timeOfDay: number[];
}

/** 24-bucket horizontal bar strip showing when visits cluster across the day. */
function TimeOfDayHeatmap({ timeOfDay }: TimeOfDayHeatmapProps) {
  const { t } = useTranslation();
  const max = Math.max(...timeOfDay, 1);
  const tickHours = [0, 6, 12, 18];

  return (
    <div dir="ltr" className="mt-2">
      <div className="flex items-end gap-px h-8 relative">
        {timeOfDay.map((count, hour) => {
          const opacity = count === 0 ? 0.05 : 0.15 + 0.85 * (count / max);
          return (
            <div
              key={hour}
              title={t('settings.distractionScan.visitTooltip', { hour, count })}
              className="flex-1 rounded-sm"
              style={{
                height: `${Math.max(4, Math.round((count / max) * 32))}px`,
                backgroundColor: `hsl(var(--primary) / ${opacity})`,
              }}
            />
          );
        })}
      </div>
      {/* Tick marks at 00, 06, 12, 18 */}
      <div className="relative flex mt-0.5">
        {tickHours.map(hour => (
          <span
            key={hour}
            className="absolute text-xs text-muted-foreground"
            style={{ left: `${(hour / 24) * 100}%` }}
          >
            {String(hour).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── CandidateCard ───────────────────────────────────────────────────────────

interface CandidateCardProps {
  candidate: DistractionCandidate;
  selected: boolean;
  onToggle: (domain: string) => void;
}

function CandidateCard({ candidate, selected, onToggle }: CandidateCardProps) {
  const { t } = useTranslation();
  const { domain, rationale, aggregate } = candidate;
  const faviconUrl = siteFaviconUrl(`https://${domain}`, 16);

  return (
    <div
      className={`
        relative flex gap-3 p-3 rounded-lg border transition-colors cursor-pointer
        ${selected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-background hover:bg-accent/30'
        }
      `}
      onClick={() => onToggle(domain)}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(domain)}
        onClick={e => e.stopPropagation()}
        className="mt-1 h-4 w-4 rounded border-border text-primary cursor-pointer shrink-0"
      />

      <div className="flex-1 min-w-0">
        {/* Header row: favicon + domain + "For review" badge */}
        <div className="flex items-center gap-2 mb-1">
          <img
            src={faviconUrl}
            alt=""
            className="w-4 h-4 shrink-0"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <bdi dir="ltr" className="text-sm font-medium text-foreground truncate">{domain}</bdi>
          <span className="ms-auto shrink-0 inline-flex items-center text-xs font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {t('settings.distractionScan.forReview')}
          </span>
        </div>

        {/* Rationale from AI */}
        <p dir="auto" className="text-xs text-muted-foreground line-clamp-2 mb-1">{rationale}</p>

        {/* Concrete numbers (DETECT-05) */}
        <p className="text-xs text-foreground/80">
          {t('settings.distractionScan.summary', {
            visits: t('settings.distractionScan.visitCount', { count: aggregate.visitCount }),
            sessions: t('settings.distractionScan.sessionCount', { count: aggregate.sessionCount }),
          })}
        </p>

        {/* Time-of-day heatmap */}
        <TimeOfDayHeatmap timeOfDay={aggregate.timeOfDay} />
      </div>
    </div>
  );
}

// ─── Block-reason messages ───────────────────────────────────────────────────

function getBlockMessage(reason: ScanBlockReason, t: (key: string) => string): string {
  switch (reason) {
    case 'kill_switch':
      return t('settings.distractionScan.blockReasons.kill_switch');
    case 'backend_error':
      return t('settings.distractionScan.blockReasons.backend_error');
    case 'budget':
      return t('settings.distractionScan.blockReasons.budget');
    case 'rate_limit':
      return t('settings.distractionScan.blockReasons.rate_limit');
    case 'no_permission':
      return t('settings.distractionScan.blockReasons.no_permission');
    case 'insufficient_history':
      return t('settings.distractionScan.blockReasons.insufficient_history');
  }
}

// ─── DistractionScanModal ────────────────────────────────────────────────────

interface DistractionScanModalProps {
  open: boolean;
  onClose: () => void;
}

type ModalState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'results'; cache: ScanCache }
  | { phase: 'error'; reason: ScanBlockReason; cache: ScanCache | null };

export function DistractionScanModal({ open, onClose }: DistractionScanModalProps) {
  const { t } = useTranslation();
  // user is unused directly but kept for potential future reads
  useAuth();

  const [modalState, setModalState] = useState<ModalState>({ phase: 'idle' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { showNoticeOnce, noticeDialog } = useAINotice();

  // Load cached results on open
  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      return;
    }
    DistractionDetectorService.loadCachedResults().then((cache: ScanCache | null) => {
      if (cache) {
        setModalState({ phase: 'results', cache });
      } else {
        setModalState({ phase: 'idle' });
      }
    }).catch(() => {
      setModalState({ phase: 'idle' });
    });
  }, [open]);

  const handleScan = useCallback(async () => {
    // Site visit totals go to Bluetab AI: one-time data notice first.
    await showNoticeOnce();

    setModalState({ phase: 'loading' });
    setSelected(new Set());

    // Decrypt the Supertry access token before each request — it lives
    // AES-GCM-encrypted in chrome.storage.local, so we cannot read it as a
    // plain string via useAuth().user.
    const token = await getAccessToken();
    if (!token) {
      const existingCache = await DistractionDetectorService.loadCachedResults();
      setModalState({ phase: 'error', reason: 'no_permission', cache: existingCache });
      return;
    }

    try {
      const result = await DistractionDetectorService.scan(token);
      if (result.status === 'blocked') {
        const existingCache = await DistractionDetectorService.loadCachedResults();
        setModalState({ phase: 'error', reason: result.reason, cache: existingCache });
      } else {
        setModalState({ phase: 'results', cache: result.scanCache });
      }
    } catch {
      // Unexpected synchronous throw from the service (not an HTTP/network path,
      // which the service now maps to 'backend_error' explicitly). Treat as a
      // backend error rather than the misleading kill-switch copy.
      const existingCache = await DistractionDetectorService.loadCachedResults();
      setModalState({ phase: 'error', reason: 'backend_error', cache: existingCache });
    }
  }, [showNoticeOnce]);

  const handleToggleSelect = useCallback((domain: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  }, []);

  const handleApprove = useCallback(async () => {
    if (selected.size === 0) return;
    const domains = Array.from(selected);

    try {
      await DistractionDetectorService.approve(domains);
      toast.success(t('settings.distractionScan.approvedToast', { count: domains.length }));

      // Optimistic remove from UI
      setModalState(prev => {
        if (prev.phase !== 'results') return prev;
        const approvedSet = new Set(domains);
        return {
          phase: 'results',
          cache: {
            ...prev.cache,
            candidates: prev.cache.candidates.filter(c => !approvedSet.has(c.domain)),
          },
        };
      });
      setSelected(new Set());
    } catch {
      toast.error(t('settings.distractionScan.approveError'));
    }
  }, [selected, t]);

  const handleDecline = useCallback(async () => {
    if (selected.size === 0) return;
    const domains = Array.from(selected);

    try {
      await DistractionDetectorService.decline(domains);
      toast.success(t('settings.distractionScan.suppressedToast', { count: domains.length }));

      // Optimistic remove from UI
      setModalState(prev => {
        if (prev.phase !== 'results') return prev;
        const declinedSet = new Set(domains);
        return {
          phase: 'results',
          cache: {
            ...prev.cache,
            candidates: prev.cache.candidates.filter(c => !declinedSet.has(c.domain)),
          },
        };
      });
      setSelected(new Set());
    } catch {
      toast.error(t('settings.distractionScan.suppressError'));
    }
  }, [selected, t]);

  const handleClear = useCallback(async () => {
    await DistractionDetectorService.clearCache();
    setModalState({ phase: 'idle' });
    setSelected(new Set());
  }, []);

  const selectedCount = selected.size;
  const cachedAt = modalState.phase === 'results' ? modalState.cache.scannedAt : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          className="
            fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2
            w-full max-w-lg max-h-[85vh] flex flex-col
            rounded-2xl border border-border-glass
            bg-bg-0/90 backdrop-blur-xl shadow-2xl
            p-0 overflow-hidden
          "
        >
          {noticeDialog}
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border-glass shrink-0">
            <div className="flex items-center gap-2">
              <ScanSearch className="w-5 h-5 text-primary" />
              <Dialog.Title className="text-base font-semibold text-foreground">
                {t('settings.distractionScan.title')}
              </Dialog.Title>
              {cachedAt && (
                <time dir="auto" className="text-xs text-muted-foreground ms-1">
                  {t('settings.distractionScan.lastScanned', {
                    time: isolateBidi(formatRelativeTimeFromPast(cachedAt), 'ltr'),
                  })}
                </time>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Rescan button (shown only when there's a cached result) */}
              {modalState.phase === 'results' && (
                <button
                  onClick={handleScan}
                  title={t('settings.distractionScan.rescanTitle')}
                  className="
                    inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg
                    border border-border text-foreground
                    hover:bg-accent transition-colors
                    disabled:opacity-40 disabled:cursor-not-allowed
                  "
                >
                  <RefreshCcw className="w-3.5 h-3.5" />
                  {t('settings.distractionScan.rescan')}
                </button>
              )}
              <Dialog.Close asChild>
                <button
                  className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label={t('common.close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
            {/* Loading state */}
            {modalState.phase === 'loading' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center py-2">
                  {t('settings.distractionScan.loading')}
                </p>
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-24 rounded-lg border border-border bg-muted/30 animate-pulse" />
                ))}
              </div>
            )}

            {/* Idle / empty state */}
            {modalState.phase === 'idle' && (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-4">
                <ScanSearch className="w-10 h-10 text-muted-foreground/50" />
                <div>
                  <p className="text-sm font-medium text-foreground mb-1">{t('settings.distractionScan.idleTitle')}</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    {t('settings.distractionScan.idleDescription')}
                  </p>
                </div>
                <button
                  onClick={handleScan}
                  className="
                    inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
                    bg-primary text-primary-foreground
                    hover:bg-primary/90 transition-colors
                  "
                >
                  <ScanSearch className="w-4 h-4" />
                  {t('settings.distractionScan.scanNow')}
                </button>
              </div>
            )}

            {/* Error / blocked state */}
            {modalState.phase === 'error' && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-warning/30 bg-warning-muted">
                <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                <p className="text-sm text-warning">
                  {getBlockMessage(modalState.reason, translate)}
                </p>
              </div>
            )}

            {/* Results state */}
            {modalState.phase === 'results' && (
              <>
                {modalState.cache.candidates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                    <p className="text-sm font-medium text-foreground">{t('settings.distractionScan.emptyTitle')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.distractionScan.emptyDescription')}
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-2">
                      {t('settings.distractionScan.reviewDescription')}
                    </p>
                    {modalState.cache.candidates.map(candidate => (
                      <CandidateCard
                        key={candidate.domain}
                        candidate={candidate}
                        selected={selected.has(candidate.domain)}
                        onToggle={handleToggleSelect}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer (shown only in results state with candidates) */}
          {modalState.phase === 'results' && modalState.cache.candidates.length > 0 && (
            <div className="shrink-0 border-t border-border-glass px-5 py-3 flex items-center justify-between gap-2 bg-bg-0/50">
              <button
                onClick={handleClear}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('settings.distractionScan.clearList')}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDecline}
                  disabled={selectedCount === 0}
                  className="
                    px-3 py-1.5 text-xs font-medium rounded-lg border border-border
                    text-foreground hover:bg-accent transition-colors
                    disabled:opacity-40 disabled:cursor-not-allowed
                  "
                >
                  {t('settings.distractionScan.suppressButton', { count: selectedCount })}
                </button>
                <button
                  onClick={handleApprove}
                  disabled={selectedCount === 0}
                  className="
                    px-3 py-1.5 text-xs font-medium rounded-lg
                    bg-primary text-primary-foreground
                    hover:bg-primary/90 transition-colors
                    disabled:opacity-40 disabled:cursor-not-allowed
                  "
                >
                  {t('settings.distractionScan.addButton', { count: selectedCount })}
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
