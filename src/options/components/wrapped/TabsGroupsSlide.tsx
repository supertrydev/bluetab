/**
 * @module options/components/wrapped/TabsGroupsSlide
 *
 * WHY:  Tab saving is the core Bluetab behavior — users deserve to see their
 *       total saved tabs and groups as a proud count-up moment.
 *
 * WHAT: Slide 2 — two AnimatedStat components for totalTabsSaved and
 *       totalGroupsCreated, with a contextual comparison line below based
 *       on the tab count tier.
 *
 * HOW:  Comparison thresholds: > 1000 = lifetime, > 500 = impressive,
 *       > 100 = steady, else = quality. Warm coral-to-amber gradient.
 *
 * NOT:  Does not show individual group names — that's for the archive/groups page.
 */

import { motion } from 'framer-motion';
import { AnimatedStat } from './AnimatedStat';
import type { WrappedSnapshot } from '../../../types/wrapped';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface TabsGroupsSlideProps {
  snapshot: WrappedSnapshot;
}

function getComparisonText(tabsSaved: number, t: TFunction): string {
  if (tabsSaved > 1000) {
    return t('components.wrapped.comparisonLifetime');
  } else if (tabsSaved > 500) {
    return t('components.wrapped.comparisonImpressive');
  } else if (tabsSaved > 100) {
    return t('components.wrapped.comparisonSteady');
  }
  return t('components.wrapped.comparisonQuality');
}

export function TabsGroupsSlide({ snapshot }: TabsGroupsSlideProps) {
  const { t } = useTranslation();
  const comparisonText = getComparisonText(snapshot.totalTabsSaved, t);

  return (
    <div
      className="flex flex-col items-center justify-center h-full text-white select-none"
      style={{
        background: 'linear-gradient(160deg, #7f1d1d 0%, #dc2626 50%, #f59e0b 100%)',
      }}
    >
      <motion.h2
        className="text-lg font-semibold tracking-widest uppercase text-white/60 mb-10"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5 }}
      >
        {t('components.wrapped.thisYear')}
      </motion.h2>

      <div className="flex flex-col items-center gap-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <AnimatedStat
            target={snapshot.totalTabsSaved}
            label={t('options.wrappedShare.tabsSaved')}
            duration={1.8}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <AnimatedStat
            target={snapshot.totalGroupsCreated}
            label={t('components.wrapped.groupsCreated')}
            duration={1.5}
          />
        </motion.div>
      </div>

      <motion.p
        className="mt-12 text-base font-medium text-white/70 text-center max-w-xs px-6 leading-relaxed"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 0.8 }}
      >
        {comparisonText}
      </motion.p>
    </div>
  );
}
