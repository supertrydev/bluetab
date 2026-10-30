import { useEffect, useRef, useCallback } from 'react';

interface UseClickOutsideOptions {
  enabled: boolean;
  excludeSelectors?: string[];
  onClickOutside: () => void;
}

export function useClickOutside({
  enabled,
  excludeSelectors = [],
  onClickOutside,
}: UseClickOutsideOptions) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (!enabled) return;

      const target = event.target as HTMLElement;

      // Check if click is inside the container
      if (containerRef.current?.contains(target)) return;

      // Check exclusion selectors with data attributes (more robust than CSS classes)
      const defaultExclusions = [
        '[data-tab-selectable]',
        '[data-selection-toolbar]',
        '[data-selection-checkbox]',
        '[data-drop-zone]',
        '[data-group-card]',
      ];

      const allExclusions = [...defaultExclusions, ...excludeSelectors];

      for (const selector of allExclusions) {
        if (target.closest(selector)) return;
      }

      onClickOutside();
    },
    [enabled, excludeSelectors, onClickOutside]
  );

  useEffect(() => {
    if (!enabled) return;

    // Use capture phase for more reliable detection
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [enabled, handleClickOutside]);

  return containerRef;
}
