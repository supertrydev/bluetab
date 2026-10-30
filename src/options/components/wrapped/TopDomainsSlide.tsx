/**
 * @module options/components/wrapped/TopDomainsSlide
 *
 * WHY:  Top domains reveal shows users where they actually spend their time —
 *       often surprising and always relatable.
 *
 * WHAT: Slide 3 — ranked list of top 5 domains with animated width bars that
 *       reveal sequentially. Each entry shows rank, domain, visit count, and bar.
 *
 * HOW:  Stagger delay 0.15s per item. Bar width proportional to max visits.
 *       Ocean teal to arctic blue gradient for a cool, data-viz feel.
 *
 * NOT:  Does not fetch live data — uses topDomains from the snapshot.
 */

import { motion } from 'framer-motion';
import type { WrappedSnapshot } from '../../../types/wrapped';
import { useTranslation } from 'react-i18next';
import { getLocaleTag } from '@/i18n';

interface TopDomainsSlideProps {
  snapshot: WrappedSnapshot;
}

export function TopDomainsSlide({ snapshot }: TopDomainsSlideProps) {
  const { t } = useTranslation();
  const rankLabels = [
    t('components.wrapped.rank1'),
    t('components.wrapped.rank2'),
    t('components.wrapped.rank3'),
    t('components.wrapped.rank4'),
    t('components.wrapped.rank5'),
  ];
  const domains = snapshot.topDomains.slice(0, 5);
  const maxVisits = domains.length > 0 ? Math.max(...domains.map(d => d.visits)) : 1;

  return (
    <div
      className="flex flex-col items-center justify-center h-full text-white select-none px-8"
      style={{
        background: 'linear-gradient(160deg, #042f2e 0%, #0d9488 50%, #22d3ee 100%)',
      }}
    >
      <motion.h2
        className="text-3xl font-black tracking-tight text-white mb-2"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5 }}
      >
        {t('components.wrapped.topSites')}
      </motion.h2>

      <motion.p
        className="text-sm text-white/50 tracking-widest uppercase mb-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        {t('components.wrapped.topSitesSubtitle')}
      </motion.p>

      <div className="w-full max-w-sm flex flex-col gap-4">
        {domains.map((item, index) => {
          const widthPercent = maxVisits > 0 ? (item.visits / maxVisits) * 100 : 0;

          return (
            <motion.div
              key={item.domain}
              className="flex flex-col gap-1.5"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                delay: 0.3 + index * 0.15,
                duration: 0.5,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-cyan-300 tracking-widest uppercase w-8">
                    {rankLabels[index]}
                  </span>
                  <span className="text-base font-semibold text-white tracking-tight">
                    <bdi dir={item.title ? 'auto' : 'ltr'}>{item.title || item.domain.replace(/^www\./, '')}</bdi>
                  </span>
                </div>
                <span dir="ltr" className="text-sm font-medium text-white/60 tabular-nums">
                  {item.visits.toLocaleString(getLocaleTag())}
                </span>
              </div>

              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: index === 0
                      ? 'linear-gradient(90deg, #22d3ee, #06b6d4)'
                      : 'rgba(255,255,255,0.5)',
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${widthPercent}%` }}
                  transition={{
                    delay: 0.4 + index * 0.15,
                    duration: 0.7,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                />
              </div>
            </motion.div>
          );
        })}

        {domains.length === 0 && (
          <motion.p
            className="text-center text-white/50 text-base"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {t('components.wrapped.noSiteData')}
          </motion.p>
        )}
      </div>
    </div>
  );
}
