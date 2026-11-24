import { matchesSearch, normalizeForSearch } from '@/utils/search-text';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDate } from '@/i18n/format';
import { PROJECT_COLORS, type Project, type TabGroup } from '../types/models';
import { PROJECT_ICONS } from './ProjectModal';
import { Check, Search } from 'lucide-react';
import { isolateBidi } from '@/i18n/bidi';

interface AddGroupToProjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    project: Project;
    groups: TabGroup[];
    onAddGroups: (groupIds: string[]) => void;
}

export function AddGroupToProjectModal({
    isOpen,
    onClose,
    project,
    groups,
    onAddGroups,
}: AddGroupToProjectModalProps) {
    const { t } = useTranslation();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

    // Filter groups that are not already in this project
    const availableGroups = useMemo(() => {
        return groups.filter(g => g.projectId !== project.id);
    }, [groups, project.id]);

    // Filter by search query
    const filteredGroups = useMemo(() => {
        if (!searchQuery.trim()) return availableGroups;
        const query = normalizeForSearch(searchQuery);
        return availableGroups.filter(g =>
            matchesSearch(g.name, query) ||
            g.tabs.some(t => matchesSearch(t.title, query) || matchesSearch(t.url, query))
        );
    }, [availableGroups, searchQuery]);

    const handleToggleGroup = (groupId: string) => {
        setSelectedGroupIds(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    };

    const handleSelectAll = () => {
        if (selectedGroupIds.size === filteredGroups.length) {
            setSelectedGroupIds(new Set());
        } else {
            setSelectedGroupIds(new Set(filteredGroups.map(g => g.id)));
        }
    };

    const handleSubmit = () => {
        if (selectedGroupIds.size > 0) {
            onAddGroups(Array.from(selectedGroupIds));
            setSelectedGroupIds(new Set());
            setSearchQuery('');
            onClose();
        }
    };

    const handleClose = () => {
        setSelectedGroupIds(new Set());
        setSearchQuery('');
        onClose();
    };

    const ProjectIcon = PROJECT_ICONS[project.icon];
    const totalTabCount = filteredGroups
        .filter(g => selectedGroupIds.has(g.id))
        .reduce((sum, g) => sum + g.tabs.length, 0);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="sm:max-w-[500px] max-h-[80vh] p-0 gap-0 overflow-clip flex flex-col focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-border pe-12">
                    <DialogTitle className="flex items-center gap-2">
                        <ProjectIcon
                            className="w-5 h-5"
                            style={{ color: PROJECT_COLORS[project.color] }}
                        />
                        {t('options.addGroupToProject.title', { name: isolateBidi(project.name, 'auto') })}
                    </DialogTitle>
                    <DialogDescription>
                        {t('options.addGroupToProject.description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 min-h-0 overflow-clip px-6 py-4">
                    <div className="space-y-4 flex min-h-0 flex-col">
                        {/* Group Selection Header with Search */}
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <label className="text-sm font-medium text-text-strong">
                                {t('options.addGroupToProject.selectionLabel', {
                                    selected: selectedGroupIds.size,
                                    details: selectedGroupIds.size > 0
                                        ? t('options.addGroupToProject.selectionDetails', { tabs: totalTabCount })
                                        : '',
                                })}
                            </label>
                            <div className="relative">
                                <Search className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted w-3 h-3" />
                                <input
                                    type="text"
                                    placeholder={t('options.addGroupToProject.searchPlaceholder')}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    dir="auto"
                                    className="ps-8 pe-3 py-1.5 text-sm border border-field rounded-input bg-bg-1 text-text w-40"
                                />
                            </div>
                        </div>

                        {/* Group List */}
                        <div className="max-h-[min(24rem,calc(80vh-16rem))] overflow-y-auto overscroll-contain border border-border rounded-xl bg-bg-1 scrollbar-transparent">
                            {filteredGroups.length === 0 ? (
                                <div className="p-4 text-center text-text-muted text-sm">
                                    {availableGroups.length === 0
                                        ? t('options.addGroupToProject.allInProject')
                                        : t('options.addGroupToProject.noMatches')}
                                </div>
                            ) : (
                                <>
                                    {/* Select All */}
                                    <label
                                        className={`flex items-center gap-3 p-3 cursor-pointer select-none border-s-3 transition-colors duration-150 focus-within:outline-none ${
                                            selectedGroupIds.size === filteredGroups.length
                                                ? 'border-s-primary bg-primary-muted/30'
                                                : 'border-s-transparent hover:bg-accent'
                                        } border-b border-border`}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={handleSelectAll}
                                    >
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors duration-150 ${
                                            selectedGroupIds.size === filteredGroups.length && filteredGroups.length > 0
                                                ? 'bg-primary border-primary'
                                                : 'border-border bg-bg-1'
                                        }`}>
                                            {selectedGroupIds.size === filteredGroups.length && filteredGroups.length > 0 && (
                                                <Check className="w-3 h-3 text-white" />
                                            )}
                                        </div>
                                        <span className="text-sm font-medium text-text-strong">
                                            {t('options.addGroupToProject.selectAll', { count: filteredGroups.length })}
                                        </span>
                                    </label>

                                    {/* Group Items */}
                                    {filteredGroups.map(group => {
                                        const isSelected = selectedGroupIds.has(group.id);
                                        return (
                                            <label
                                                key={group.id}
                                                onMouseDown={(event) => event.preventDefault()}
                                                className={`flex items-center gap-3 p-3 cursor-pointer select-none border-s-3 transition-colors duration-150 focus-within:outline-none ${
                                                    isSelected
                                                        ? 'border-s-primary bg-primary-muted/30'
                                                        : 'border-s-transparent hover:bg-accent'
                                                } border-b border-border last:border-b-0`}
                                            >
                                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors duration-150 ${
                                                    isSelected
                                                        ? 'bg-primary border-primary'
                                                        : 'border-border bg-bg-1'
                                                }`}>
                                                    {isSelected && (
                                                        <Check className="w-3 h-3 text-white" />
                                                    )}
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => handleToggleGroup(group.id)}
                                                    className="sr-only focus:outline-none"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium text-text-strong truncate">
                                                            <bdi dir="auto">{group.name}</bdi>
                                                        </span>
                                                        {isSelected && (
                                                            <span className="px-2 py-0.5 text-xs font-medium bg-primary text-white rounded-full">
                                                                {t('options.addGroupToProject.selectedBadge')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-text-muted mt-0.5">
                                                        {t('options.addGroupToProject.tabs', { count: group.tabs.length })} • {t('options.addGroupToProject.createdAt', { date: isolateBidi(formatDate(group.created), 'ltr') })}
                                                        {group.projectId && ` • ${t('options.addGroupToProject.inAnotherProject')}`}
                                                    </div>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter className="shrink-0 px-6 py-4 border-t border-border bg-bg-1">
                    <Button variant="outline" onClick={handleClose}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={selectedGroupIds.size === 0}
                        style={{
                            backgroundColor: PROJECT_COLORS[project.color],
                        }}
                        className="text-white hover:brightness-110"
                    >
                        {selectedGroupIds.size > 0
                            ? t('options.addGroupToProject.addGroups', { count: selectedGroupIds.size })
                            : t('options.addGroupToProject.addGroupsFallback')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
