/**
 * @module options/components/WrappedExperience
 *
 * WHY:  The Wrapped experience is the core user-facing feature of Phase 7 — a
 *       "Spotify Wrapped moment" that shows personalized yearly stats as an
 *       animated story. It must feel polished, fast, and delightful.
 *
 * WHAT: Full-screen overlay with 6 story slides, AnimatePresence transitions,
 *       click/tap navigation, keyboard shortcuts (arrows, space, escape), and
 *       a top progress bar. Loading and empty states included.
 *
 * HOW:  - On mount: WrappedService.getSnapshot(year) -> if null, generateSnapshot
 *       - AnimatePresence mode="wait" with custom direction variants
 *       - Click/tap advances slides (except on Slide 6 interactive elements)
 *       - Keyboard: ArrowRight/Space=next, ArrowLeft=prev, Escape=close
 *       - Slide 6 click propagation stopped on the slide itself
 *
 * NOT:  Does not perform image export — onExport stub passed to ShareCardSlide,
 *       Plan 03 will replace with real WrappedExportService logic.
 */

import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ChevronLeft, Loader2, CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDirection } from '@radix-ui/react-direction';
import { WrappedService } from '../../services/wrapped-service';
import { Storage } from '../../utils/storage';
import type { WrappedSnapshot } from '../../types/wrapped';

import { SlideProgress } from './wrapped/SlideProgress';
import { WelcomeSlide } from './wrapped/WelcomeSlide';
import { TabsGroupsSlide } from './wrapped/TabsGroupsSlide';
import { TopDomainsSlide } from './wrapped/TopDomainsSlide';
import { ProductivitySlide } from './wrapped/ProductivitySlide';
import { PersonalitySlide } from './wrapped/PersonalitySlide';
import { ShareCardSlide } from './wrapped/ShareCardSlide';

const TOTAL_SLIDES = 6;

interface WrappedExperienceProps {
  year: number;
  onClose: () => void;
}

type SlideDirection = 1 | -1;

const slideVariants = {
  enter: (direction: SlideDirection) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: SlideDirection) => ({
    x: direction > 0 ? '-100%' : '100%',
    opacity: 0,
  }),
};

const slideTransition = {
  duration: 0.4,
  ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
};

export function WrappedExperience({ year, onClose }: WrappedExperienceProps) {
  const { t } = useTranslation();
  const localeDirection = useDirection();
  const [slideIndex, setSlideIndex] = useState(0);
  const [direction, setDirection] = useState<SlideDirection>(1);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<WrappedSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        let snap = await WrappedService.getSnapshot(year);
        if (!snap) {
          snap = await WrappedService.generateSnapshot(year);
          if (snap) {
            await WrappedService.saveSnapshot(snap);
          }
        }
        // Enrich topDomains with titles from stored groups if missing
        if (snap && snap.topDomains.some(d => !d.title)) {
          try {
            const groups = (await Storage.get<Array<{ tabs: Array<{ url: string; title: string }> }>>('groups')) || [];
            const allTabs = groups.flatMap(g => g.tabs);
            for (const td of snap.topDomains) {
              if (!td.title) {
                const cleanDomain = td.domain.replace(/^www\./, '');
                const match = allTabs.find(tab => {
                  try {
                    return new URL(tab.url).hostname.replace(/^www\./, '') === cleanDomain;
                  } catch { return false; }
                });
                if (match?.title) {
                  const parts = match.title.split(/\s[-|–]\s/);
                  td.title = parts.length > 1 ? parts[parts.length - 1].trim() : match.title.trim();
                  if (td.title.length > 30) td.title = td.title.slice(0, 27) + '...';
                }
              }
            }
          } catch { /* non-critical */ }
        }
        if (!cancelled) {
          setSnapshot(snap);
        }
      } catch (err) {
        if (!cancelled) {
          setError(t('options.wrappedExperience.loadError'));
          console.error('[WrappedExperience] Load error:', err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [t, year]);

  const goNext = useCallback(() => {
    if (slideIndex < TOTAL_SLIDES - 1) {
      setDirection(1);
      setSlideIndex(i => i + 1);
    }
  }, [slideIndex]);

  const goPrev = useCallback(() => {
    if (slideIndex > 0) {
      setDirection(-1);
      setSlideIndex(i => i - 1);
    }
  }, [slideIndex]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          if (localeDirection === 'rtl') goPrev();
          else goNext();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (localeDirection === 'rtl') goNext();
          else goPrev();
          break;
        case ' ':
          e.preventDefault();
          goNext();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, localeDirection, onClose]);

  const handleSlideClick = useCallback(() => {
    // Slide 6 (ShareCardSlide) stops its own click propagation — only advance for slides 0-4
    if (slideIndex < TOTAL_SLIDES - 1) {
      goNext();
    }
  }, [slideIndex, goNext]);

  function renderSlide(snapshot: WrappedSnapshot) {
    switch (slideIndex) {
      case 0: return <WelcomeSlide snapshot={snapshot} />;
      case 1: return <TabsGroupsSlide snapshot={snapshot} />;
      case 2: return <TopDomainsSlide snapshot={snapshot} />;
      case 3: return <ProductivitySlide snapshot={snapshot} />;
      case 4: return <PersonalitySlide snapshot={snapshot} />;
      case 5: return (
        <ShareCardSlide
          snapshot={snapshot}
        />
      );
      default: return null;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden">
      {/* Loading state */}
      {loading && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'linear-gradient(160deg, #0f0720 0%, #3b0764 50%, #6d28d9 100%)' }}
        >
          <Loader2 className="w-10 h-10 text-white/60 animate-spin" />
        </div>
      )}

      {/* Error / empty state */}
      {!loading && (snapshot === null || error) && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-6 text-white px-8"
          style={{ background: 'linear-gradient(160deg, #0f0720 0%, #3b0764 50%, #6d28d9 100%)' }}
        >
          <CalendarDays className="w-16 h-16 text-violet-400 opacity-70" strokeWidth={1} />
          <h2 className="text-2xl font-black tracking-tight text-center">
            {t('options.wrappedExperience.emptyTitle')}
          </h2>
          <p className="text-base text-white/60 text-center leading-relaxed max-w-xs">
            {t('options.wrappedExperience.emptyDescription')}
          </p>
          <button
            onClick={onClose}
            className="mt-4 bg-white/10 hover:bg-white/20 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
          >
            {t('options.wrappedExperience.goBack')}
          </button>
        </div>
      )}

      {/* Story experience */}
      {!loading && snapshot !== null && (
        <>
          {/* Slides — clickable area */}
          <div
            className="relative flex-1 cursor-pointer overflow-hidden"
            onClick={handleSlideClick}
          >
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={slideIndex}
                className="absolute inset-0"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={slideTransition}
              >
                {renderSlide(snapshot)}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Overlay controls — rendered above slides */}
          <div className="absolute inset-0 pointer-events-none z-10">
            {/* Progress bar */}
            <SlideProgress current={slideIndex} total={TOTAL_SLIDES} />

            {/* Back button (top-left) */}
            {slideIndex > 0 && (
              <button
                className="absolute top-6 start-3 pointer-events-auto p-2 rounded-full bg-black/20 hover:bg-black/40 transition-colors"
                onClick={(e) => { e.stopPropagation(); goPrev(); }}
                aria-label={t('options.wrappedExperience.previousSlideAria')}
              >
                <ChevronLeft className="w-5 h-5 text-white rtl:rotate-180" />
              </button>
            )}

            {/* Close button (top-right) */}
            <button
              className="absolute top-6 end-3 pointer-events-auto p-2 rounded-full bg-black/20 hover:bg-black/40 transition-colors"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              aria-label={t('options.wrappedExperience.closeAria')}
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
