/**
 * @module options/components/wrapped/SlideProgress
 *
 * WHY:  Users need a visual indicator of how many slides remain in the Wrapped
 *       story, similar to Instagram/Snapchat story progress bars.
 *
 * WHAT: Horizontal bar segments at the top of the screen — filled for completed
 *       and active, dimmed for upcoming slides.
 *
 * HOW:  Renders total segments, applies full opacity to completed/active, low
 *       opacity to upcoming. Thin bars with rounded ends and gaps between them.
 *
 * NOT:  Does not animate individual bar fill — static segments only.
 */

interface SlideProgressProps {
  current: number; // 0-indexed
  total: number;
}

export function SlideProgress({ current, total }: SlideProgressProps) {
  return (
    <div className="flex gap-1.5 w-full px-4 pt-3">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="flex-1 h-0.5 rounded-full transition-opacity duration-300"
          style={{
            backgroundColor: 'white',
            opacity: i <= current ? 0.9 : 0.3,
          }}
        />
      ))}
    </div>
  );
}
