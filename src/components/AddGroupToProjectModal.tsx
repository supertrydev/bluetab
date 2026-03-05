import { useState, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PROJECT_COLORS, type Project, type TabGroup } from '../types/models';
import { PROJECT_ICONS } from './ProjectModal';
import { Check, Search } from 'lucide-react';

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
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

    // Filter groups that are not already in this project
    const availableGroups = useMemo(() => {
        return groups.filter(g => g.projectId !== project.id);
    }, [groups, project.id]);

    // Filter by search query
    const filteredGroups = useMemo(() => {
        if (!searchQuery.trim()) return availableGroups;
        const query = searchQuery.toLowerCase();
        return availableGroups.filter(g =>
            g.name.toLowerCase().includes(query) ||
            g.tabs.some(t => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query))
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
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[500px] max-h-[80vh] flex flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ProjectIcon
                            className="w-5 h-5"
                            style={{ color: PROJECT_COLORS[project.color] }}
                        />
                        Add Groups to "{project.name}"
                    </DialogTitle>
                    <DialogDescription>
                        Select groups to add to this project. Groups already in the project are not shown.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 flex-1 flex flex-col">
                    {/* Group Selection Header with Search */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <label className="text-sm font-medium text-text-strong">
                                Select Groups ({selectedGroupIds.size} selected{selectedGroupIds.size > 0 ? `, ${totalTabCount} tabs` : ''})
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted w-3 h-3" />
                                <input
                                    type="text"
                                    placeholder="Search groups..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-8 pr-3 py-1.5 text-sm border border-border rounded-lg bg-bg-1 text-text focus:ring-2 focus:ring-primary focus:border-primary w-40"
                                />
                            </div>
                        </div>

                        {/* Group List */}
                        <div className="max-h-64 overflow-y-auto border border-border rounded-xl bg-bg-1 scrollbar-transparent">
                            {filteredGroups.length === 0 ? (
                                <div className="p-4 text-center text-text-muted text-sm">
                                    {availableGroups.length === 0 ? 'All groups are already in this project' : 'No groups match your search'}
                                </div>
                            ) : (
                                <>
                                    {/* Select All */}
                                    <label
                                        className={`flex items-center gap-3 p-3 cursor-pointer border-l-3 transition-all ${
                                            selectedGroupIds.size === filteredGroups.length
                                                ? 'border-l-primary bg-primary-muted/30'
                                                : 'border-l-transparent hover:bg-bg-2'
                                        } border-b border-border`}
                                        onClick={handleSelectAll}
                                    >
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                                            selectedGroupIds.size === filteredGroups.length && filteredGroups.length > 0
                                                ? 'bg-primary border-primary'
                                                : 'border-border bg-bg-1'
                                        }`}>
                                            {selectedGroupIds.size === filteredGroups.length && filteredGroups.length > 0 && (
                                                <Check className="w-3 h-3 text-white" />
                                            )}
                                        </div>
                                        <span className="text-sm font-medium text-text-strong">
                                            Select All ({filteredGroups.length})
                                        </span>
                                    </label>

                                    {/* Group Items */}
                                    {filteredGroups.map(group => {
                                        const isSelected = selectedGroupIds.has(group.id);
                                        return (
                                            <label
                                                key={group.id}
                                                className={`flex items-center gap-3 p-3 cursor-pointer border-l-3 transition-all ${
                                                    isSelected
                                                        ? 'border-l-primary bg-primary-muted/30'
                                                        : 'border-l-transparent hover:bg-bg-2'
                                                } border-b border-border last:border-b-0`}
                                            >
                                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
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
                                                    className="sr-only"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium text-text-strong truncate">
                                                            {group.name}
                                                        </span>
                                                        {isSelected && (
                                                            <span className="px-2 py-0.5 text-xs font-medium bg-primary text-white rounded-full">
                                                                Selected
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-text-muted mt-0.5">
                                                        {group.tabs.length} tab{group.tabs.length !== 1 ? 's' : ''} • Created {new Date(group.created).toLocaleDateString()}
                                                        {group.projectId && ' • In another project'}
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

                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={selectedGroupIds.size === 0}
                        style={{
                            backgroundColor: PROJECT_COLORS[project.color],
                        }}
                        className="text-white hover:brightness-110"
                    >
                        Add {selectedGroupIds.size > 0 ? `${selectedGroupIds.size} Group${selectedGroupIds.size > 1 ? 's' : ''}` : 'Groups'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
