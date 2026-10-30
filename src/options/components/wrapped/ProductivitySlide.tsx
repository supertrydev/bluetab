/**
 * @module options/components/wrapped/ProductivitySlide
 *
 * WHY:  Productivity stats (Pomodoro, focus hours, reminders) are a core Bluetab
 *       differentiator — users who use these features deserve to see the impact.
 *
 * WHAT: Slide 4 — three AnimatedStat components for pomodoroSessionsCompleted,
 *       focusHoursTotal, remindersSet. Zero stats show friendly nudge messages.
 *       Streak highlight if streakDays > 0.
 *
 * HOW:  Forest to emerald gradient. Stats animate in with stagger. Streak badge
 *       appears below if > 0 streak days.
 *
 * NOT:  Does not show session details — aggregate counts only.
 */

import { motion } from 'framer-motion';
import { AnimatedStat } from './AnimatedStat';
import type { WrappedSnapshot } from '../../../types/wrapped';
import { useTranslation } from 'react-i18next';

interface ProductivitySlideProps {
  snapshot: WrappedSnapshot;
}

export function ProductivitySlide({ snapshot }: ProductivitySlideProps) {
  const { t } = useTranslation();
  const hasSessions = snapshot.pomodoroSessionsCompleted > 0;
  const hasFocusHours = snapshot.focusHoursTotal > 0;
  const hasReminders = snapshot.remindersSet > 0;
  const hasStreak = snapshot.streakDays > 0;

  return (
    <div
      className="flex flex-col items-center justify-center h-full text-white select-none"
      style={{
        background: 'linear-gradient(160deg, #052e16 0%, #15803d 50%, #4ade80 100%)',
      }}
    >
      <motion.h2
        className="text-lg font-semibold tracking-widest uppercase text-white/60 mb-10"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5 }}
      >
        {t('components.wrapped.productivity')}
      </motion.h2>

      <div className="flex flex-col items-center gap-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {hasSessions ? (
            <AnimatedStat
              target={snapshot.pomodoroSessionsCompleted}
              label={t('components.wrapped.pomodoroSessions')}
              duration={1.8}
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className="text-5xl font-black text-white/40">--</span>
              <span className="text-sm font-semibold text-white/40 tracking-widest uppercase">
                {t('components.wrapped.noPomodoros')}
              </span>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {hasFocusHours ? (
            <AnimatedStat
              target={Math.round(snapshot.focusHoursTotal)}
              label={t('components.wrapped.focusHours')}
              duration={1.5}
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className="text-5xl font-black text-white/40">--</span>
              <span className="text-sm font-semibold text-white/40 tracking-widest uppercase">
                {t('components.wrapped.focusHoursUntracked')}
              </span>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {hasReminders ? (
            <AnimatedStat
              target={snapshot.remindersSet}
              label={t('components.wrapped.remindersSet')}
              duration={1.3}
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className="text-5xl font-black text-white/40">--</span>
              <span className="text-sm font-semibold text-white/40 tracking-widest uppercase">
                {t('components.wrapped.remindersSet')}
              </span>
            </div>
          )}
        </motion.div>
      </div>

      {hasStreak && (
        <motion.div
          className="mt-10 flex items-center gap-2 bg-white/10 rounded-full px-5 py-2.5"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1.6, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <span className="text-lg">*</span>
          <span className="text-sm font-bold text-white tracking-wide">
            {t('components.wrapped.longestStreak', { count: snapshot.streakDays })}
          </span>
        </motion.div>
      )}
    </div>
  );
}
