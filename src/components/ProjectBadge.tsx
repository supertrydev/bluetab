import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isolateBidi } from '@/i18n/bidi';
import { projectTintVars } from '@/config/project-tints';
import type { Project } from '../types/models';
import { PROJECT_ICONS } from './project-icons';

/** Colors of a group card that belongs to a project; needs the `project-tint` class. */
export function projectTint(project: Pick<Project, 'color'> | undefined): CSSProperties | undefined {
  return project
    ? { ...projectTintVars(project.color), backgroundColor: 'var(--tint-bg)' } as CSSProperties
    : undefined;
}

interface ProjectBadgeProps {
  project: Project;
  className?: string;
  /** The project name, isolated for bidi text. */
  children: ReactNode;
}

/**
 * Label that sits over the top inline-start corner of a group card. Decorative
 * metadata: hidden under Default Simplify, hover-revealed under Aggressive.
 */
export function ProjectBadge({ project, className, children }: ProjectBadgeProps) {
  const { t } = useTranslation();
  const Icon = PROJECT_ICONS[project.icon] ?? PROJECT_ICONS.folder;
  return (
    <div
      className={cn(
        'bt-decor bt-aggressive-hide absolute -start-3 -top-[10px] flex items-center gap-1.5 px-2 py-1 rounded-full shadow-md z-10 bg-background border border-border',
        className,
      )}
      style={{ color: 'var(--tint-text)' }}
      title={`${t('components.groupInfo.project')}: ${isolateBidi(project.name)}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="text-xs font-medium max-w-[80px] truncate">{children}</span>
    </div>
  );
}
