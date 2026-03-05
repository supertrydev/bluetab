import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
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

interface GroupInfoModalProps {
    group: TabGroup | null;
    tags: TagType[];
    projects: Project[];
    onClose: () => void;
}

function formatDateTime(ts: number): string {
    return new Date(ts).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function timeAgo(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return `${Math.floor(diff / 2592000)}mo ago`;
}

interface RowProps {
    icon: React.ReactNode;
    label: string;
    children: React.ReactNode;
}

function Row({ icon, label, children }: RowProps) {
    return (
        <div className="flex items-start gap-3 py-2.5">
            <div className="text-muted-foreground flex-shrink-0 w-4 mt-0.5">{icon}</div>
            <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                <div className="text-sm text-foreground">{children}</div>
            </div>
        </div>
    );
}

export function GroupInfoModal({ group, tags, projects, onClose }: GroupInfoModalProps) {
    if (!group) return null;

    const groupTags = tags.filter(t => group.tags?.includes(t.id));
    const project = projects.find(p => p.id === group.projectId);

    return (
        <Dialog open={!!group} onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Info className="w-4 h-4 text-primary flex-shrink-0" />
                        <span className="truncate">{group.name}</span>
                    </DialogTitle>
                </DialogHeader>

                {/* Dates */}
                <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                        Dates
                    </p>
                    <Row icon={<Calendar className="w-4 h-4" />} label="Created">
                        <span>{formatDateTime(group.created)}</span>
                        <span className="text-muted-foreground text-xs ml-2">({timeAgo(group.created)})</span>
                    </Row>
                    <Row icon={<Clock className="w-4 h-4" />} label="Last modified">
                        <span>{formatDateTime(group.modified)}</span>
                        <span className="text-muted-foreground text-xs ml-2">({timeAgo(group.modified)})</span>
                    </Row>
                    {group.lastAccessed && (
                        <Row icon={<Eye className="w-4 h-4" />} label="Last accessed">
                            <span>{formatDateTime(group.lastAccessed)}</span>
                            <span className="text-muted-foreground text-xs ml-2">({timeAgo(group.lastAccessed)})</span>
                        </Row>
                    )}
                    {group.isPinned && group.pinnedAt && (
                        <Row icon={<Pin className="w-4 h-4" />} label="Pinned at">
                            <span>{formatDateTime(group.pinnedAt)}</span>
                        </Row>
                    )}
                </div>

                <Separator />

                {/* Stats & status */}
                <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                        Stats
                    </p>
                    <Row icon={<Layers className="w-4 h-4" />} label="Tabs">
                        {group.tabs.length} tab{group.tabs.length !== 1 ? 's' : ''}
                    </Row>
                    {group.accessCount !== undefined && group.accessCount > 0 && (
                        <Row icon={<BarChart2 className="w-4 h-4" />} label="Restore count">
                            {group.accessCount} time{group.accessCount !== 1 ? 's' : ''}
                        </Row>
                    )}
                    <Row icon={<Lock className="w-4 h-4" />} label="Locked">
                        {group.locked
                            ? <span className="text-amber-600 dark:text-amber-400 font-medium">Yes</span>
                            : <span className="text-muted-foreground">No</span>
                        }
                    </Row>
                    <Row icon={<Pin className="w-4 h-4" />} label="Pinned">
                        {group.isPinned
                            ? <span className="text-blue-600 dark:text-blue-400 font-medium">Yes</span>
                            : <span className="text-muted-foreground">No</span>
                        }
                    </Row>
                </div>

                {/* Organization — only when there's something to show */}
                {(groupTags.length > 0 || project || group.notes) && (
                    <>
                        <Separator />
                        <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                                Organization
                            </p>
                            {groupTags.length > 0 && (
                                <Row icon={<Tag className="w-4 h-4" />} label="Tags">
                                    <div className="flex flex-wrap gap-1 mt-0.5">
                                        {groupTags.map(tag => (
                                            <span
                                                key={tag.id}
                                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                                                style={{
                                                    backgroundColor: `${tag.color}33`,
                                                    color: tag.color,
                                                    border: `1px solid ${tag.color}55`,
                                                }}
                                            >
                                                {tag.name}
                                            </span>
                                        ))}
                                    </div>
                                </Row>
                            )}
                            {project && (
                                <Row icon={<FolderOpen className="w-4 h-4" />} label="Project">
                                    {project.name}
                                </Row>
                            )}
                            {group.notes && (
                                <Row icon={<FileText className="w-4 h-4" />} label="Notes">
                                    <p className="whitespace-pre-wrap text-muted-foreground">{group.notes}</p>
                                </Row>
                            )}
                        </div>
                    </>
                )}

                <Separator />

                {/* ID — useful for support/debugging */}
                <Row icon={<Hash className="w-4 h-4" />} label="Group ID">
                    <span className="font-mono text-xs text-muted-foreground break-all select-all">
                        {group.id}
                    </span>
                </Row>
            </DialogContent>
        </Dialog>
    );
}
