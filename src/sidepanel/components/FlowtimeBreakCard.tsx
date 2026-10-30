/**
 * @module sidepanel/components/FlowtimeBreakCard
 *
 * WHY:  After stopFlowtime() writes a break proposal to storage, PomodoroBar
 *       swaps this card into the timer slot. The card lets the user start,
 *       edit, or skip the proposed break.
 *
 * WHAT: Inline card (no modal) with three actions:
 *       - Start break  → PomodoroService.startProposedBreak(currentMinutes)
 *       - Edit         → reveals inline number input; Start then uses edited value
 *       - Skip         → PomodoroService.skipProposedBreak()
 *
 * HOW:  - Receives the FlowtimeBreakProposal as a prop (easier to test; value
 *         comes from PomodoroBar's storage subscription)
 *       - Edit mode is local component state (no storage needed)
 *       - Glass-token surface matching Phase 8.1 patterns
 *
 * NOT:  Does not read from storage itself — PomodoroBar passes the proposal.
 *       Does not render modal or full-screen overlays (ADHD-29).
 *
 * SAFETY-02: All copy is neutral + action-focused. No forbidden words.
 *   "Start break" / "Edit" / "Skip" / "Break: N min" / "after N min of work"
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PomodoroService } from '@/services/pomodoro-service';
import type { FlowtimeBreakProposal } from '@/services/flowtime-helpers';

interface FlowtimeBreakCardProps {
  proposal: FlowtimeBreakProposal;
}

export function FlowtimeBreakCard({ proposal }: FlowtimeBreakCardProps) {
  const { t } = useTranslation();
  const [editMode, setEditMode] = useState(false);
  const [editedMinutes, setEditedMinutes] = useState(proposal.proposedBreakMinutes);

  const handleStartBreak = useCallback(async () => {
    await PomodoroService.startProposedBreak(editMode ? editedMinutes : proposal.proposedBreakMinutes);
  }, [editMode, editedMinutes, proposal.proposedBreakMinutes]);

  const handleSkip = useCallback(async () => {
    await PomodoroService.skipProposedBreak();
  }, []);

  const handleEditToggle = useCallback(() => {
    if (!editMode) {
      setEditedMinutes(proposal.proposedBreakMinutes);
    }
    setEditMode((prev) => !prev);
  }, [editMode, proposal.proposedBreakMinutes]);

  const handleEditedMinutesChange = useCallback((value: number) => {
    const clamped = Math.max(1, Math.min(60, Math.round(value)));
    setEditedMinutes(clamped);
  }, []);

  return (
    <div
      className="mb-2 mx-1 px-3 py-2.5 rounded-lg bg-bg-0/80 backdrop-blur-md border border-border-glass space-y-2"
      data-testid="flowtime-break-card"
    >
      {/* Header */}
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-foreground" data-testid="break-duration">
          {t('sidepanel.flowtimeBreak.breakDuration', {
            count: editMode ? editedMinutes : proposal.proposedBreakMinutes,
          })}
        </span>
        <span className="text-micro text-muted-foreground" data-testid="work-duration">
          {t('sidepanel.flowtimeBreak.afterWork', { count: proposal.workMinutes })}
        </span>
      </div>

      {/* Edit inline input */}
      {editMode && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleEditedMinutesChange(editedMinutes - 1)}
            className="w-6 h-6 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors text-sm"
            aria-label={t('sidepanel.flowtimeBreak.decreaseMinutes')}
          >
            −
          </button>
          <input
            type="number"
            min={1}
            max={60}
            value={editedMinutes}
            onChange={(e) => handleEditedMinutesChange(Number(e.target.value))}
            className="w-16 px-2 py-1 text-sm text-center border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
            aria-label={t('sidepanel.flowtimeBreak.breakMinutes')}
            data-testid="edit-input"
          />
          <button
            type="button"
            onClick={() => handleEditedMinutesChange(editedMinutes + 1)}
            className="w-6 h-6 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors text-sm"
            aria-label={t('sidepanel.flowtimeBreak.increaseMinutes')}
          >
            +
          </button>
          <span className="text-micro text-muted-foreground">{t('common.minuteShort')}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleStartBreak}
          className="flex-1 py-1.5 text-xs font-medium text-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          data-testid="start-break-btn"
        >
          {t('sidepanel.flowtimeBreak.startBreak')}
        </button>
        <button
          type="button"
          onClick={handleEditToggle}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          data-testid="edit-btn"
          aria-pressed={editMode}
        >
          {editMode ? t('sidepanel.flowtimeBreak.done') : t('common.edit')}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          data-testid="skip-btn"
        >
          {t('sidepanel.flowtimeBreak.skip')}
        </button>
      </div>
    </div>
  );
}
