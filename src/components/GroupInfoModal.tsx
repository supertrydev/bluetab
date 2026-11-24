import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Calendar,
    Clock,
    Eye,
    Hash,
    Info,
    Layers,
    Lock,
    Pin,
    Tag,
    FolderOpen,
    FileText,
    BarChart2,
} from 'lucide-react';
import type { TabGroup, Tag as TagType, Project } from '../types/models';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatDateTime as formatLocalizedDateTime } from '@/i18n/format';

interface GroupInfoModalProps {
    group: TabGroup | null;
    tags: TagType[];
    projects: Project[];
    onClose: () => void;
}

// App language + Settings > Time format (was the browser default locale).
function formatDateTime(ts: number): string {
    return formatLocalizedDateTime(ts);
}

function timeAgo(ts: number, t: TFunction): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return t('time.justNow');
    if (diff < 3600) return t('components.groupInfo.minutesAgo', { count: Math.floor(diff / 60) });
    if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) });
    if (diff < 2592000) return t('components.groupInfo.daysAgo', { count: Math.floor(diff / 86400) });
    return t('components.groupInfo.monthsAgo', { count: Math.floor(diff / 2592000) });
}

interface RowProps {
    icon: React.ReactNode;
    label: string;
    children: React.ReactNode;
}

function Row({ icon, label, children }: RowProps) {
    return (
        <div className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="mt-0.5 flex w-4 shrink-0 justify-center text-muted-foreground">{icon}</div>
            <div className="flex-1 min-w-0">
                <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
                <div className="text-sm leading-5 text-foreground">{children}</div>
            </div>
        </div>
    );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
                {title}
            </p>
            <div className="rounded-lg bg-bg-1/50 px-3 py-2">
                {children}
            </div>
        </section>
    );
}

export function GroupInfoModal({ group, tags, projects, onClose }: GroupInfoModalProps) {
    const { t } = useTranslation();
    if (!group) return null;

    const groupTags = tags.filter(t => group.tags?.includes(t.id));
    const project = projects.find(p => p.id === group.projectId);

    return (
        <Dialog open={!!group} onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader className="pe-8">
                    <DialogTitle className="flex items-center gap-2">
                        <Info className="w-4 h-4 text-primary flex-shrink-0" />
                        <span className="truncate"><bdi dir="auto">{group.name}</bdi></span>
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-5 pt-1">
                    {/* Dates */}
                    <InfoSection title={t('components.groupInfo.dates')}>
                        <Row icon={<Calendar className="w-4 h-4" />} label={t('components.groupInfo.created')}>
                            <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                <span dir="ltr">{formatDateTime(group.created)}</span>
                                <span dir="ltr" className="text-xs text-muted-foreground">({timeAgo(group.created, t)})</span>
                            </span>
                        </Row>
                        <Row icon={<Clock className="w-4 h-4" />} label={t('components.groupInfo.lastModified')}>
                            <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                <span dir="ltr">{formatDateTime(group.modified)}</span>
                                <span dir="ltr" className="text-xs text-muted-foreground">({timeAgo(group.modified, t)})</span>
                            </span>
                        </Row>
                        {group.lastAccessed && (
                            <Row icon={<Eye className="w-4 h-4" />} label={t('components.groupInfo.lastAccessed')}>
                                <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <span dir="ltr">{formatDateTime(group.lastAccessed)}</span>
                                    <span dir="ltr" className="text-xs text-muted-foreground">({timeAgo(group.lastAccessed, t)})</span>
                                </span>
                            </Row>
                        )}
                        {group.isPinned && group.pinnedAt && (
                            <Row icon={<Pin className="w-4 h-4" />} label={t('components.groupInfo.pinnedAt')}>
                                <span dir="ltr">{formatDateTime(group.pinnedAt)}</span>
                            </Row>
                        )}
                    </InfoSection>

                    {/* Stats & status */}
                    <InfoSection title={t('components.groupInfo.stats')}>
                        <Row icon={<Layers className="w-4 h-4" />} label={t('sidepanel.tabs')}>
                            {t('components.groupInfo.tab', { count: group.tabs.length })}
                        </Row>
                        {group.accessCount !== undefined && group.accessCount > 0 && (
                            <Row icon={<BarChart2 className="w-4 h-4" />} label={t('components.groupInfo.restoreCount')}>
                                {t('components.groupInfo.time', { count: group.accessCount })}
                            </Row>
                        )}
                        <Row icon={<Lock className="w-4 h-4" />} label={t('sidepanel.aiUpgradePrompt.locked')}>
                            {group.locked
                                ? <span className="font-medium text-warning">{t('components.groupInfo.yes')}</span>
                                : <span className="text-muted-foreground">{t('components.groupInfo.no')}</span>
                            }
                        </Row>
                        <Row icon={<Pin className="w-4 h-4" />} label={t('sidepanel.pinned.label')}>
                            {group.isPinned
                                ? <span className="font-medium text-primary">{t('components.groupInfo.yes')}</span>
                                : <span className="text-muted-foreground">{t('components.groupInfo.no')}</span>
                            }
                        </Row>
                    </InfoSection>

                    {/* Organization — only when there's something to show */}
                    {(groupTags.length > 0 || project || group.notes) && (
                        <InfoSection title={t('components.groupInfo.organization')}>
                            {groupTags.length > 0 && (
                                <Row icon={<Tag className="w-4 h-4" />} label={t('components.groupInfo.tags')}>
                                    <div className="flex flex-wrap gap-1.5">
                                        {groupTags.map(tag => (
                                            <span
                                                key={tag.id}
                                                className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium"
                                                style={{
                                                    backgroundColor: `${tag.color}33`,
                                                    color: tag.color,
                                                    border: `1px solid ${tag.color}55`,
                                                }}
                                            >
                                                <bdi dir="auto">{tag.name}</bdi>
                                            </span>
                                        ))}
                                    </div>
                                </Row>
                            )}
                            {project && (
                                <Row icon={<FolderOpen className="w-4 h-4" />} label={t('components.groupInfo.project')}>
                                    <bdi dir="auto">{project.name}</bdi>
                                </Row>
                            )}
                            {group.notes && (
                                <Row icon={<FileText className="w-4 h-4" />} label={t('components.groupInfo.notes')}>
                                    <p dir="auto" className="whitespace-pre-wrap text-muted-foreground">{group.notes}</p>
                                </Row>
                            )}
                        </InfoSection>
                    )}

                    {/* ID — useful for support/debugging */}
                    <InfoSection title={t('components.groupInfo.support')}>
                        <Row icon={<Hash className="w-4 h-4" />} label={t('components.groupInfo.groupId')}>
                            <span dir="ltr" className="break-all font-mono text-xs text-muted-foreground select-all">
                                {group.id}
                            </span>
                        </Row>
                    </InfoSection>
                </div>
            </DialogContent>
        </Dialog>
    );
}
