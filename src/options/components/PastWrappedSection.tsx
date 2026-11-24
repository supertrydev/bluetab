/**
 * @module options/components/PastWrappedSection
 *
 * WHY:  After the seasonal window closes the sidebar badge disappears, but users
 *       should still be able to replay previous years. The Past Wrapped section
 *       is the year-round entry point to the history.
 *
 * WHAT: A list of stored Wrapped snapshots (newest first) with year, personality
 *       title, and a Replay button per row. Empty state if no snapshots exist.
 *
 * HOW:  - On mount calls WrappedService.getAllSnapshots() to load history
 *       - Replay button calls onReplay(year) prop to open the Wrapped overlay
 *       - Styled with Gift/Sparkles icon in heading
 *
 * NOT:  Does not generate new snapshots — read-only history view.
 */

import { useEffect, useState } from 'react';
import { Gift, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WrappedService } from '../../services/wrapped-service';
import type { WrappedSnapshot } from '../../types/wrapped';

interface PastWrappedSectionProps {
  /** Called when the user clicks Replay on a past year */
  onReplay: (year: number) => void;
}

export function PastWrappedSection({ onReplay }: PastWrappedSectionProps) {
  const { t } = useTranslation();
  const [snapshots, setSnapshots] = useState<WrappedSnapshot[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    WrappedService.getAllSnapshots()
      .then(setSnapshots)
      .catch(() => setSnapshots([]))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  return (
    <section className="mt-8 px-4 pb-8">
      {/* Heading */}
      <div className="flex items-center gap-2 mb-4">
        <Gift className="w-5 h-5 text-violet-400" strokeWidth={1.5} />
        <h2 className="text-base font-semibold text-foreground tracking-tight">{t('options.pastWrapped.title')}</h2>
      </div>

      {snapshots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('options.pastWrapped.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {snapshots.map((snap) => (
            <li
              key={snap.year}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
            >
              <div className="flex flex-col">
                <span dir="ltr" className="font-semibold text-foreground text-sm">{snap.year}</span>
                {snap.personalityTitle ? (
                  <span className="text-xs text-violet-500 font-medium mt-0.5">
                    <bdi dir="auto">{snap.personalityTitle.title}</bdi>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground mt-0.5">
                    {t('options.pastWrapped.tabsSaved', { count: snap.totalTabsSaved })}
                  </span>
                )}
              </div>
              <button
                onClick={() => onReplay(snap.year)}
                className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-500 transition-colors bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 dark:hover:bg-violet-900/40 px-3 py-1.5 rounded-full"
              >
                <RotateCcw className="w-3 h-3" />
                {t('options.pastWrapped.replay')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
