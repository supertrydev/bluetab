/**
 * @module options/components/wrapped/PersonalitySlide
 *
 * WHY:  The personality title is the shareable hook — the moment users screenshot
 *       and send to friends. It must feel dramatic and personal.
 *
 * WHAT: Slide 5 — category label fades in, title scales up dramatically with
 *       spring physics (the hero moment), description fades in below. Trophy icon
 *       accent. Royal purple to hot pink gradient.
 *
 * HOW:  Staggered reveal: category (delay 0.1) -> trophy icon (delay 0.4) ->
 *       title scale spring (delay 0.55) -> description (delay 1.0).
 *       Fallback for null personalityTitle shows Explorer message.
 *
 * NOT:  Does not handle share action — that's ShareCardSlide (Slide 6).
 */

import { motion } from 'framer-motion';
import { Trophy } from 'lucide-react';
import type { WrappedSnapshot } from '../../../types/wrapped';
import { useTranslation } from 'react-i18next';

interface PersonalitySlideProps {
  snapshot: WrappedSnapshot;
}

export function PersonalitySlide({ snapshot }: PersonalitySlideProps) {
  const { t } = useTranslation();
  const personality = snapshot.personalityTitle;

  return (
    <div
      className="flex flex-col items-center justify-center h-full text-white select-none px-8"
      style={{
        background: 'linear-gradient(160deg, #4a044e 0%, #a21caf 50%, #ec4899 100%)',
      }}
    >
      {personality ? (
        <>
          <motion.span
            className="text-xs font-bold tracking-widest uppercase text-pink-300 mb-6"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
          >
            {personality.category}
          </motion.span>

          <motion.div
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: 0.4,
              duration: 0.6,
              ease: [0.34, 1.56, 0.64, 1],
            }}
          >
            <Trophy className="w-14 h-14 text-yellow-300 mb-6" strokeWidth={1.5} />
          </motion.div>

          <motion.h2
            className="text-5xl font-black tracking-tight text-white text-center leading-tight mb-6"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: 0.55,
              duration: 0.8,
              ease: [0.34, 1.56, 0.64, 1],
            }}
          >
            <bdi dir="auto">{personality.title}</bdi>
          </motion.h2>

          <motion.p
            className="text-base text-white/70 text-center leading-relaxed max-w-xs"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.0, duration: 0.6 }}
          >
            <bdi dir="auto">{personality.description}</bdi>
          </motion.p>
        </>
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: 0.3,
              duration: 0.6,
              ease: [0.34, 1.56, 0.64, 1],
            }}
          >
            <Trophy className="w-14 h-14 text-pink-300 mb-6" strokeWidth={1.5} />
          </motion.div>

          <motion.h2
            className="text-5xl font-black tracking-tight text-white text-center leading-tight mb-4"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: 0.5,
              duration: 0.8,
              ease: [0.34, 1.56, 0.64, 1],
            }}
          >
            {t('components.wrapped.explorer')}
          </motion.h2>

          <motion.p
            className="text-base text-white/70 text-center leading-relaxed max-w-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.0, duration: 0.6 }}
          >
            {t('components.wrapped.explorerDescription')}
          </motion.p>
        </>
      )}
    </div>
  );
}
