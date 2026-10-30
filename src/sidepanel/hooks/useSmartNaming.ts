/**
 * @module sidepanel/hooks/useSmartNaming
 *
 * WHY:  Smart naming needs to fire asynchronously on group save without
 *       blocking the UI, show a "Thinking..." state while waiting, and
 *       safely discard stale responses if the user types a new name.
 *
 * WHAT: React hook that wraps AIService.suggestGroupName with:
 *       - isThinking flag for "Thinking..." UI placeholder
 *       - suggestion state set on AI response
 *       - Race condition protection via requestId ref
 *       - clearSuggestion for manual reset when user types their own name
 *
 * HOW:  Each suggestName call captures a requestId (Date.now()). When the
 *       async response arrives, it only updates state if the current requestId
 *       still matches (i.e., no newer call was made in the meantime).
 *
 * NOT:  Does not render UI. Does not check isPro — callers must gate on Pro
 *       before calling suggestName. Does not auto-fill the input — callers
 *       use the returned suggestion to pre-fill as they see fit.
 */

import { useState, useRef, useCallback } from 'react';
import { AIService } from '../../services/ai-service';
import type { TabItem } from '../../types/models';

// ============================================================================
// Types
// ============================================================================

export interface UseSmartNamingResult {
  /** Call after saving a group with 2+ tabs. Triggers AI name suggestion. */
  suggestName: (tabs: TabItem[]) => void;
  /** AI-suggested name, or null if not yet available or request was cleared. */
  suggestion: string | null;
  /** True while waiting for the AI response. Show "Thinking..." to the user. */
  isThinking: boolean;
  /** Reset suggestion and isThinking. Call when user types their own name. */
  clearSuggestion: () => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Smart naming hook for AI-powered group name suggestions on save.
 *
 * Usage:
 * ```tsx
 * const { suggestName, suggestion, isThinking, clearSuggestion } = useSmartNaming();
 *
 * // After creating a group:
 * suggestName(tabs);
 *
 * // In the name input:
 * placeholder={isThinking ? 'Thinking...' : 'Group name...'}
 * value={suggestion ?? ''}
 * onChange={() => clearSuggestion()}
 * ```
 */
export function useSmartNaming(): UseSmartNamingResult {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);

  // Tracks the ID of the latest request. Used to discard stale responses.
  const currentRequestId = useRef<number>(0);

  const suggestName = useCallback((tabs: TabItem[]) => {
    // Single-tab groups don't get AI naming
    if (tabs.length < 2) return;

    const requestId = Date.now();
    currentRequestId.current = requestId;

    setIsThinking(true);
    setSuggestion(null);

    const tabsForAI = tabs.map((t) => ({ title: t.title, url: t.url }));

    AIService.suggestGroupName(tabsForAI).then((result) => {
      // Discard response if a newer request was started
      if (currentRequestId.current !== requestId) return;

      setIsThinking(false);
      if (result !== null) {
        setSuggestion(result);
      }
      // null result means timeout/error — caller uses their default name
    });
  }, []);

  const clearSuggestion = useCallback(() => {
    // Invalidate any in-flight request
    currentRequestId.current = 0;
    setSuggestion(null);
    setIsThinking(false);
  }, []);

  return { suggestName, suggestion, isThinking, clearSuggestion };
}
