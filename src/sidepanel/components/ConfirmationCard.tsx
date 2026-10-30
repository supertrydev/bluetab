/**
 * @module sidepanel/components/ConfirmationCard
 *
 * WHY:  Destructive AI tool calls require explicit user confirmation.
 *
 * WHAT: Context-aware confirmation card that adapts to the action type:
 *       - delete_tabs: "Close N tabs?" with tab list
 *       - manage_projects delete: "Delete project X?" with project info
 *       - manage_groups delete: "Delete group X?" with group info
 *       - manage_brain_dump delete: "Delete N notes?" with note snippets
 *       - integration_action: "Run this in <app>?" with Allow / Always allow
 *
 * HOW:  Pure presentation, props-driven. Becomes non-interactive after resolve.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Trash2, Check, FolderOpen, Send } from 'lucide-react';
import type { AIConfirmationState } from '@/types/ai';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';

// ============================================================================
// Project color map
// ============================================================================

const PROJECT_COLORS: Record<string, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
};

// ============================================================================
// Props
// ============================================================================

export interface ConfirmationCardProps {
  tabs: AIConfirmationState['affectedItems'];
  toolName: AIConfirmationState['toolName'];
  projectMeta?: AIConfirmationState['projectMeta'];
  integrationName?: string;
  onConfirm: () => void;
  /** integration_action only: allow now and stop asking for app actions. */
  onAlwaysAllow?: () => void;
  onCancel: () => void;
  isResolved: boolean;
  resolvedStatus?: 'confirmed' | 'cancelled';
}

// ============================================================================
// Component
// ============================================================================

export function ConfirmationCard({
  tabs,
  toolName,
  projectMeta,
  integrationName,
  onConfirm,
  onAlwaysAllow,
  onCancel,
  isResolved,
  resolvedStatus,
}: ConfirmationCardProps) {
  const { t } = useTranslation();
  const isProjectDelete = toolName === 'manage_projects';
  const isSingleProjectDelete = isProjectDelete && projectMeta;
  const isBatchProjectDelete = isProjectDelete && !projectMeta;
  const isGroupDelete = toolName === 'manage_groups';
  const isBrainDumpDelete = toolName === 'manage_brain_dump';
  const count = tabs.length;

  // Connected-app action card (create event, issue, task, message...)
  if (toolName === 'integration_action') {
    return (
      <Card className="shadow-lg">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-text-muted shrink-0" />
            <p className="text-sm font-medium text-text-strong">
              {t('components.confirmation.integrationActionQuestion', { name: isolateBidi(integrationName ?? '') })}
            </p>
          </div>

          {tabs.length > 0 && (
            <ul className="text-xs text-text-muted space-y-1">
              {tabs.map((item) => (
                <li key={item.id} className="break-words leading-5"><bdi dir="auto">{item.title}</bdi></li>
              ))}
            </ul>
          )}

          {!isResolved ? (
            <div className="flex flex-wrap gap-2 pt-0.5">
              <Button size="sm" variant="primary" onClick={onConfirm} className="h-7 text-xs">
                <Check className="w-3 h-3 me-1" />
                {t('components.confirmation.allow')}
              </Button>
              {onAlwaysAllow && (
                <Button size="sm" variant="ghost" onClick={onAlwaysAllow} className="h-7 text-xs">
                  {t('components.confirmation.alwaysAllowIntegrations')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onCancel}
                className="h-7 text-xs text-text-muted">
                <X className="w-3 h-3 me-1" />
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-text-muted pt-0.5">
              {resolvedStatus === 'confirmed' ? t('components.confirmation.allowed') : t('components.confirmation.cancelled')}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Brain Dump note delete card
  if (isBrainDumpDelete) {
    return (
      <Card className="shadow-lg border-danger/30">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-danger shrink-0" />
            <p className="text-sm font-medium text-text-strong">
              {t('components.confirmation.deleteNotesQuestion', { count })}
            </p>
          </div>

          <ScrollArea className="max-h-24">
            <ul className="text-xs text-text-muted space-y-1 pe-2">
              {tabs.map((item) => (
                <li key={item.id} className="truncate leading-5"><bdi dir="auto">{item.title}</bdi></li>
              ))}
            </ul>
          </ScrollArea>

          {!isResolved ? (
            <div className="flex gap-2 pt-0.5">
              <Button size="sm" variant="ghost" onClick={onConfirm}
                className="h-7 text-xs text-danger hover:text-danger hover:bg-danger-muted">
                <Trash2 className="w-3 h-3 me-1" />
                {t('components.confirmation.deleteNotes', { count })}
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}
                className="h-7 text-xs text-text-muted">
                <X className="w-3 h-3 me-1" />
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-text-muted pt-0.5">
              {resolvedStatus === 'confirmed' ? t('components.confirmation.notesDeleted', { count }) : t('components.confirmation.cancelled')}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Batch project delete card (multiple projects, no projectMeta)
  if (isBatchProjectDelete) {
    return (
      <Card className="shadow-lg border-danger/30">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-danger shrink-0" />
            <p className="text-sm font-medium text-text-strong">
              {t('components.confirmation.deleteProjectsQuestion', { count })}
            </p>
          </div>

          <ScrollArea className="max-h-24">
            <ul className="text-xs text-text-muted space-y-1 pe-2">
              {tabs.map((item, i) => (
                <li key={i} className="truncate leading-5"><bdi dir="auto">{item.title}</bdi></li>
              ))}
            </ul>
          </ScrollArea>

          {!isResolved ? (
            <div className="flex gap-2 pt-0.5">
              <Button size="sm" variant="ghost" onClick={onConfirm}
                className="h-7 text-xs text-danger hover:text-danger hover:bg-danger-muted">
                <Trash2 className="w-3 h-3 me-1" />
                {t('components.confirmation.deleteProjects', { count })}
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}
                className="h-7 text-xs text-text-muted">
                <X className="w-3 h-3 me-1" />
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-text-muted pt-0.5">
              {resolvedStatus === 'confirmed' ? t('components.confirmation.projectsDeleted', { count }) : t('components.confirmation.cancelled')}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Single project delete card
  if (isSingleProjectDelete) {
    const colorClass = PROJECT_COLORS[projectMeta.color] ?? 'bg-blue-500';

    return (
      <Card className="shadow-lg border-danger/30">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg ${colorClass} flex items-center justify-center`}>
              <FolderOpen className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-strong">
                {t('components.confirmation.deleteNamed', { name: isolateBidi(projectMeta.name) })}
              </p>
              <p className="text-caption text-text-muted">
                {projectMeta.groupCount > 0
                  ? t('components.confirmation.groupsUnassigned', { count: projectMeta.groupCount })
                  : t('components.confirmation.noGroupsAssigned')}
              </p>
            </div>
          </div>

          {!isResolved ? (
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={onConfirm}
                className="h-7 text-xs text-danger hover:text-danger hover:bg-danger-muted">
                <Trash2 className="w-3 h-3 me-1" />
                {t('components.confirmation.deleteProject')}
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}
                className="h-7 text-xs text-text-muted">
                <X className="w-3 h-3 me-1" />
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-text-muted pt-0.5">
              {resolvedStatus === 'confirmed'
                ? t('components.confirmation.namedDeleted', { name: isolateBidi(projectMeta.name) })
                : t('components.confirmation.cancelled')}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Group delete / tab delete card
  const headerText = isGroupDelete
    ? t('components.confirmation.deleteNamed', { name: isolateBidi(tabs[0]?.title ?? '') })
    : t('components.confirmation.closeTabsQuestion', { count });

  const ToolIcon = Trash2;

  return (
    <Card className="shadow-lg">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <ToolIcon className="w-4 h-4 text-text-muted shrink-0" />
          <p className="text-sm font-medium text-text-strong">{headerText}</p>
        </div>

        <ScrollArea className="max-h-24">
          <ul className="text-xs text-text-muted space-y-1 pe-2">
            {tabs.map((tab) => (
              <li key={tab.id} className="truncate leading-5">
                <bdi dir="auto">{tab.title || t('components.confirmation.fallbackTab', { id: isolateBidi(tab.id, 'ltr') })}</bdi>
              </li>
            ))}
          </ul>
        </ScrollArea>

        {!isResolved ? (
          <div className="flex gap-2 pt-0.5">
            <Button size="sm" variant="primary" onClick={onConfirm} className="h-7 text-xs">
              <Check className="w-3 h-3 me-1" />
              {isGroupDelete ? t('components.confirmation.deleteGroup') : t('components.confirmation.closeTabs')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}
              className="h-7 text-xs text-text-muted">
              <X className="w-3 h-3 me-1" />
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-text-muted pt-0.5">
            {resolvedStatus === 'confirmed'
              ? isGroupDelete
                ? t('components.confirmation.groupDeleted')
                : t('components.confirmation.closedTabs', { count })
              : t('components.confirmation.cancelled')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
