/**
 * @module options/components/wrapped/WelcomeSlide
 *
 * WHY:  The opening slide sets the tone for the entire Wrapped experience.
 *       It should feel like an invitation to discover your year in Bluetab.
 *
 * WHAT: Slide 1 — year reveal with staggered text animations on a deep
 *       midnight-to-violet gradient. "Your" fades in, year scales up dramatically,
 *       "in Bluetab" and subtitle fade in after.
 *
 * HOW:  motion.div with sequential delays for stagger. Year uses scale spring
 *       from 0 to 1 for dramatic reveal.
 *
 * NOT:  Does not handle navigation — parent WrappedExperience controls slides.
 */

import { motion } from 'framer-motion';
import type { WrappedSnapshot } from '../../../types/wrapped';
import { useTranslation } from 'react-i18next';

interface WelcomeSlideProps {
  snapshot: WrappedSnapshot;
}

export function WelcomeSlide({ snapshot }: WelcomeSlideProps) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col items-center justify-center h-full text-white select-none"
      style={{
        background: 'linear-gradient(160deg, #0f0720 0%, #3b0764 50%, #6d28d9 100%)',
      }}
    >
      <div className="flex flex-col items-center gap-3">
        <motion.span
          className="text-2xl font-semibold tracking-wide text-white/70"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {t('components.wrapped.your')}
        </motion.span>

        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            delay: 0.35,
            duration: 0.7,
            ease: [0.34, 1.56, 0.64, 1],
          }}
        >
          <span className="text-[7rem] font-black tracking-tight leading-none text-white">
            {snapshot.year}
          </span>
        </motion.div>

        <motion.span
          className="text-2xl font-bold tracking-widest text-violet-300"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {t('components.wrapped.inBluetab')}
        </motion.span>

        <motion.p
          className="text-base text-white/50 tracking-wide mt-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1, duration: 0.8 }}
        >
          {t('components.wrapped.intro')}
        </motion.p>
      </div>

      <motion.p
        className="absolute bottom-20 text-sm text-white/30 tracking-wide"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.6 }}
      >
        {t('components.wrapped.continue')}
      </motion.p>
    </div>
  );
}
