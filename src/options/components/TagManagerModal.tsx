import { useState } from 'react';
import { Tags, X } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Storage } from '@/utils/storage';
import { TagManager, TAG_COLORS } from '@/utils/tags';
import { ToastManager } from '@/components/Toast';
import type { TabGroup, Tag } from '@/types/models';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';

export interface TagManagerModalProps {
    groups: TabGroup[];
    tags: Tag[];
    setTags: React.Dispatch<React.SetStateAction<Tag[]>>;
    setGroups: React.Dispatch<React.SetStateAction<TabGroup[]>>;
    isOpen: boolean;
    groupId: string | null;
    onClose: () => void;
}

export function TagManagerModal({
    groups,
    tags,
    setTags,
    setGroups,
    isOpen,
    groupId,
    onClose,
}: TagManagerModalProps) {
    const { t } = useTranslation();
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);

    const createTag = async () => {
        const error = TagManager.validateTagName(newTagName, tags);
        if (error) {
            ToastManager.getInstance().error(error);
            return;
        }

        try {
            const newTag = TagManager.createTag(newTagName, newTagColor);
            const updatedTags = [...tags, newTag];
            await Storage.set('tags', updatedTags);
            setTags(updatedTags);
            setNewTagName('');
            setNewTagColor(TAG_COLORS[0]);
        } catch (error) {
            ToastManager.getInstance().error(t('options.tagManager.createFailed', { message: isolateBidi((error as Error).message) }));
        }
    };

    const deleteTag = async (tagId: string) => {
        try {
            const updatedTags = tags.filter(tag => tag.id !== tagId);
            const updatedGroups = groups.map(group => ({
                ...group,
                tags: (group.tags || []).filter(id => id !== tagId),
                tabs: group.tabs.map(tab => ({
                    ...tab,
                    tags: (tab.tags || []).filter(id => id !== tagId)
                }))
            }));

            await Storage.set('tags', updatedTags);
            await Storage.set('groups', updatedGroups);
            setTags(updatedTags);
            setGroups(updatedGroups);
            ToastManager.getInstance().success(t('options.manager.tagDeleted'));
        } catch (error) {
            ToastManager.getInstance().error(t('options.manager.failedToDeleteTag', { message: isolateBidi((error as Error).message) }));
        }
    };

    const addTagToGroup = async (gId: string, tagId: string) => {
        try {
            const updatedGroups = groups.map(group =>
                group.id === gId ? TagManager.addTagToGroup(group, tagId) : group
            );
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
        } catch (error) {
            ToastManager.getInstance().error(t('options.tagManager.addFailed', { message: isolateBidi((error as Error).message) }));
        }
    };

    const removeTagFromGroup = async (gId: string, tagId: string) => {
        try {
            const updatedGroups = groups.map(group =>
                group.id === gId ? TagManager.removeTagFromGroup(group, tagId) : group
            );
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);
        } catch (error) {
            ToastManager.getInstance().error(t('options.tagManager.removeFailed', { message: isolateBidi((error as Error).message) }));
        }
    };

    return (
        <Dialog open={isOpen && !!groupId} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
                    <DialogTitle className="text-text-strong flex items-center gap-2">
                        <Tags className="h-4 w-4 text-primary" />
                        {t('options.tagManager.title')}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        {t('options.tagManager.description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="p-4 space-y-4">
                    {/* Compact Tag Input with Color Picker */}
                    <div className="flex items-center gap-2">
                        {/* Color Picker */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => {
                                    const picker = document.getElementById('color-picker-dropdown');
                                    if (picker) picker.classList.toggle('hidden');
                                }}
                                className="w-8 h-8 rounded-lg flex-shrink-0 border-2 border-border hover:border-primary transition-colors"
                                style={{ backgroundColor: newTagColor }}
                                title={t('options.tagManager.selectColor')}
                            />
                            <div
                                id="color-picker-dropdown"
                                className="hidden absolute top-full start-0 mt-1 p-3 bg-bg-1 border border-border rounded-lg shadow-lg z-50"
                                style={{ minWidth: '180px' }}
                            >
                                <div className="grid grid-cols-5 gap-3">
                                    {TAG_COLORS.map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            onClick={() => {
                                                setNewTagColor(color);
                                                document.getElementById('color-picker-dropdown')?.classList.add('hidden');
                                            }}
                                            className={`w-6 h-6 rounded-full transition-all hover:scale-110 ${newTagColor === color ? 'ring-2 ring-primary' : ''}`}
                                            style={{ backgroundColor: color }}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Tag Name Input */}
                        <Input
                            type="text"
                            placeholder={t('options.tagManager.placeholder')}
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            onKeyDown={(e) => {
                                if ((e.key === 'Enter' || e.key === ' ') && newTagName.trim()) {
                                    e.preventDefault();
                                    createTag();
                                }
                            }}
                            className="flex-1 h-8 text-sm bg-bg-1"
                        />
                    </div>

                    {/* Existing Tags */}
                    <div>
                        <p className="text-xs text-text-muted mb-2">
                            {t('options.tagManager.instructions')}
                        </p>
                        <div className="flex flex-wrap gap-2.5 p-3 rounded-lg bg-bg-0 border border-border min-h-[60px]">
                            {tags.length === 0 ? (
                                <p className="text-xs text-text-muted w-full text-center py-2">
                                    {t('options.tagManager.empty')}
                                </p>
                            ) : (
                                tags.map(tag => {
                                    const group = groups.find(g => g.id === groupId);
                                    const isAssigned = group?.tags?.includes(tag.id) || false;

                                    return (
                                        <button
                                            key={tag.id}
                                            onClick={() => {
                                                if (isAssigned) {
                                                    removeTagFromGroup(groupId!, tag.id);
                                                } else {
                                                    addTagToGroup(groupId!, tag.id);
                                                }
                                            }}
                                            className="group/tag relative px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 hover:scale-105"
                                            style={{
                                                backgroundColor: `${tag.color}33`,
                                                color: tag.color,
                                                border: isAssigned ? `2px solid ${tag.color}` : '2px solid transparent'
                                            }}
                                        >
                                            {isAssigned && (
                                                <span
                                                    className="absolute -top-1 -start-1 w-3 h-3 rounded-full flex items-center justify-center text-white"
                                                    style={{ backgroundColor: tag.color }}
                                                >
                                                    <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                    </svg>
                                                </span>
                                            )}
                                            <bdi dir="auto">{tag.name}</bdi>
                                            {/* Delete on hover */}
                                            <span
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteTag(tag.id);
                                                }}
                                                className="absolute -top-1 -end-1 w-3.5 h-3.5 rounded-full flex items-center justify-center opacity-0 group-hover/tag:opacity-100 transition-opacity bg-danger text-white cursor-pointer"
                                                title={t('common.delete')}
                                            >
                                                <X className="h-2 w-2" />
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter className="px-4 py-3 border-t border-border bg-transparent">
                    <Button
                        onClick={onClose}
                        variant="secondary"
                        size="sm"
                        className="w-full"
                    >
                        {t('common.close')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
