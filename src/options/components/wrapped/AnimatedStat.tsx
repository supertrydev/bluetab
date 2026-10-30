/**
 * @module options/components/wrapped/AnimatedStat
 *
 * WHY:  Wrapped slides need count-up animation for stats to create delight and
 *       give the feeling that numbers are racing to their final value.
 *
 * WHAT: Reusable count-up component using framer-motion useMotionValue + animate.
 *       Displays a large bold number with a label below.
 *
 * HOW:  useMotionValue(0) starts at 0, animate() drives it to target with
 *       easeOutExpo-like easing ([0.16, 1, 0.3, 1]). useTransform rounds to integer.
 *
 * NOT:  Does not handle string formatting beyond prefix/suffix — callers control that.
 */

import { useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';

interface AnimatedStatProps {
  target: number;
  label: string;
  prefix?: string;
  suffix?: string;
  duration?: number;
}

export function AnimatedStat({
  target,
  label,
  prefix = '',
  suffix = '',
  duration = 1.8,
}: AnimatedStatProps) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, Math.round);

  useEffect(() => {
    const controls = animate(count, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    });
    return controls.stop;
  }, [count, target, duration]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-baseline gap-0.5">
        {prefix && (
          <span className="text-4xl font-black text-white/80 tracking-tight">{prefix}</span>
        )}
        <motion.span className="text-7xl font-black tabular-nums text-white tracking-tight leading-none">
          {rounded}
        </motion.span>
        {suffix && (
          <span className="text-4xl font-black text-white/80 tracking-tight">{suffix}</span>
        )}
      </div>
      <span className="text-sm font-semibold text-white/60 tracking-widest uppercase">
        {label}
      </span>
    </div>
  );
}
