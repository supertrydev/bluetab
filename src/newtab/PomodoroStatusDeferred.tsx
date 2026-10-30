import { Suspense, lazy, useEffect, useState } from 'react';

const LazyPomodoroStatus = lazy(async () => {
  const module = await import('@/components/PomodoroStatus');
  return { default: module.PomodoroStatus };
});

export function PomodoroStatusDeferred() {
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setShouldRender(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  if (!shouldRender) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LazyPomodoroStatus />
    </Suspense>
  );
}
