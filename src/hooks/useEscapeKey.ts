import { useEffect, useCallback } from 'react';

interface UseEscapeKeyOptions {
  enabled: boolean;
  onEscape: () => void;
}

export function useEscapeKey({ enabled, onEscape }: UseEscapeKeyOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
      }
    },
    [enabled, onEscape]
  );

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
}
