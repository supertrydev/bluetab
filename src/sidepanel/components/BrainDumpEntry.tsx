/**
 * @module sidepanel/components/BrainDumpEntry
 *
 * WHY:  Phase 9 ADHD-23 — each Inbox entry needs a zero-friction triage
 *       row: see it, edit it in place, convert it to a group, set a
 *       reminder on it, or delete it. Extracted into its own component so
 *       the Dump panel stays a thin list renderer and the per-entry
 *       interaction surface is unit-addressable.
 *
 * WHAT: Functional row component. Renders:
 *       - Relative timestamp (via existing formatRelativeTime)
 *       - Thought text (wrapped, no truncation — users need to read their
 *         whole thought when they come back to triage it). Click the text
 *         to enter inline edit mode; Enter saves, Esc cancels.
 *       - Optional tab-context pill (favicon + title + click-to-open)
 *       - 3-dot dropdown menu with Convert to group (only when a
 *         tabContext URL is present), Convert to reminder, Delete
 *
 * HOW:  - Uses the existing @/components/ui/dropdown-menu wrapper
 *         (Radix-based) to match the 3-dot menu pattern elsewhere in the
 *         sidepanel.
 *       - Tab-context pill click opens the URL in a new tab via
 *         chrome.tabs.create — matches the existing sidepanel "open link"
 *         semantics.
 *       - Edit mode swaps the <p> for a <textarea>; the parent's onSave
 *         prop invokes BrainDumpService.updateEntry (post-ship iteration).
 *
 * NOT:  - Does not call BrainDumpService directly for convert/delete/save;
 *         handlers are props so the parent (BrainDumpPanel) owns the
 *         modal routing for ReminderQuickPicker.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MoreVertical, FolderPlus, Bell, Trash2, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { formatRelativeTime } from '@/utils/format-time';
import type { BrainDumpEntry as BrainDumpEntryType } from '@/types/adhd';

export interface BrainDumpEntryProps {
  entry: BrainDumpEntryType;
  onConvertToGroup: (entry: BrainDumpEntryType) => void;
  onConvertToReminder: (entry: BrainDumpEntryType) => void;
  onDelete: (entry: BrainDumpEntryType) => void;
  /** Post-ship iteration — inline edit. Receives the new trimmed text. */
  onSave: (entry: BrainDumpEntryType, nextText: string) => Promise<void> | void;
}

function openInNewTab(url: string): void {
  chrome.tabs.create({ url, active: true }).catch((err) => {
    console.debug('[BlueTab][BrainDumpEntry] open-in-tab error', err);
  });
}

export function BrainDumpEntry({
  entry,
  onConvertToGroup,
  onConvertToReminder,
  onDelete,
  onSave,
}: BrainDumpEntryProps) {
  const { t } = useTranslation();
  const { tabContext } = entry;
  const hasUrl = Boolean(tabContext?.url);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(entry.text);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync draft back to entry.text when the entry updates from outside
  // (e.g. storage-change listener in the panel).
  useEffect(() => {
    if (!isEditing) setDraft(entry.text);
  }, [entry.text, isEditing]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Select all so typing replaces instantly, or position at end.
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  // Grow the editor with its content so the whole thought stays visible
  // (no inner scrollbar, never shorter than the text).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!isEditing || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, isEditing]);

  const beginEdit = () => {
    setDraft(entry.text);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDraft(entry.text);
    setIsEditing(false);
  };

  const commitEdit = async () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      // Empty is a no-op cancel — thought text is still required.
      cancelEdit();
      return;
    }
    if (trimmed === entry.text) {
      // Nothing to save.
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      await onSave(entry, trimmed);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="group flex gap-2 p-4 rounded-lg border border-border bg-bg-1 hover:border-field/60 transition-colors"
      data-bluetab-brain-dump-entry
    >
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span dir="ltr">{formatRelativeTime(entry.createdAt)}</span>
          {entry.updatedAt ? <span className="opacity-60">· {t('sidepanel.brainDumpEntry.edited')}</span> : null}
        </div>

        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void commitEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
            onBlur={() => {
              // Committing on blur matches common inline-edit UX, but
              // only when there is a real change — cancel otherwise so
              // stray focus shifts do not overwrite with the same text.
              if (!isSaving) void commitEdit();
            }}
            disabled={isSaving}
            dir="auto"
            aria-label={t('sidepanel.brainDumpEntry.editThoughtAria')}
            className="block w-full min-h-[3.25rem] overflow-hidden text-sm text-foreground bg-bg-1 border border-field rounded-md px-3 py-2 leading-snug resize-none"
          />
        ) : (
          <p
            role="button"
            dir="auto"
            tabIndex={0}
            onClick={beginEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                beginEdit();
              }
            }}
            title={t('sidepanel.brainDumpEntry.clickToEdit')}
            className="text-sm text-foreground whitespace-pre-wrap break-words leading-snug cursor-text rounded-sm hover:bg-bg-1/40 px-0.5 -mx-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            {entry.text}
          </p>
        )}

        {tabContext && (
          <button
            type="button"
            onClick={() => openInNewTab(tabContext.url)}
            className="inline-flex items-center gap-1.5 max-w-full px-2 py-1 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            title={isolateBidi(tabContext.url, 'ltr')}
          >
            {tabContext.favicon ? (
              <img
                src={tabContext.favicon}
                alt=""
                className="w-3 h-3 flex-shrink-0"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : null}
            <span className="truncate max-w-[240px]"><bdi dir="auto">{tabContext.title}</bdi></span>
            <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-60" />
          </button>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('sidepanel.brainDumpEntry.entryActions')}
            className="flex-shrink-0 self-start p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors opacity-60 group-hover:opacity-100"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {/*
            Convert-to-group is only meaningful when there's a URL to group.
            Linkless dumps (thought only, no captured tab) hide this action
            — the dump is a note, and a note without a link cannot become
            a Bluetab TabGroup.
           */}
          {hasUrl && (
            <DropdownMenuItem onClick={() => onConvertToGroup(entry)}>
              <FolderPlus className="w-4 h-4" />
              {t('sidepanel.brainDumpEntry.convertToGroup')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => onConvertToReminder(entry)}>
            <Bell className="w-4 h-4" />
            {t('sidepanel.brainDumpEntry.convertToReminder')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onDelete(entry)}
            className="text-danger focus:text-danger"
          >
            <Trash2 className="w-4 h-4" />
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
