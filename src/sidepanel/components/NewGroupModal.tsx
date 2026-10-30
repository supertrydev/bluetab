import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { type TabGroupColor, getGroupColor } from '../hooks/useBrowserGroups';
import type { BrowserTab } from '../hooks/useBrowserTabs';
import { cn } from '@/lib/utils';

interface NewGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedTabs: BrowserTab[];
    onCreateGroup: (tabIds: number[], title: string, color: TabGroupColor) => Promise<void>;
}

const COLORS: TabGroupColor[] = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];

export function NewGroupModal({ isOpen, onClose, selectedTabs, onCreateGroup }: NewGroupModalProps) {
    const { t } = useTranslation();
    const [title, setTitle] = useState('');
    const [color, setColor] = useState<TabGroupColor>('blue');
    const [isCreating, setIsCreating] = useState(false);

    const handleCreate = async () => {
        if (selectedTabs.length === 0) return;

        setIsCreating(true);
        try {
            const tabIds = selectedTabs.map(t => t.id);
            await onCreateGroup(tabIds, title.trim() || t('components.newGroupModal.defaultName'), color);
            handleClose();
        } catch (err) {
            console.error('Failed to create group:', err);
        } finally {
            setIsCreating(false);
        }
    };

    const handleClose = () => {
        setTitle('');
        setColor('blue');
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('components.newGroupModal.title')}</DialogTitle>
                    <DialogDescription>
                        {t('components.newGroupModal.description', { count: selectedTabs.length })}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Group Name */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">{t('components.newGroupModal.nameLabel')}</label>
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={t('components.newGroupModal.namePlaceholder')}
                            autoFocus
                        />
                    </div>

                    {/* Color Selection */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">{t('components.newGroupModal.colorLabel')}</label>
                        <div className="flex flex-wrap gap-2">
                            {COLORS.map((c) => (
                                <button
                                    key={c}
                                    onClick={() => setColor(c)}
                                    className={cn(
                                        "w-6 h-6 rounded-full border-2 transition-all",
                                        color === c ? "border-foreground scale-110" : "border-transparent hover:scale-105"
                                    )}
                                    style={{ backgroundColor: getGroupColor(c) }}
                                    title={c}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Selected Tabs Preview */}
                    {selectedTabs.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">{t('components.newGroupModal.selectedTabs')}</label>
                            <div className="max-h-32 overflow-y-auto space-y-1 text-xs">
                                {selectedTabs.slice(0, 5).map(tab => (
                                    <div key={tab.id} className="flex items-center gap-2 truncate">
                                        <img
                                            src={tab.favIconUrl || '/icons/default-favicon.png'}
                                            alt=""
                                            className="w-3 h-3"
                                            onError={(e) => {
                                                e.currentTarget.src = '/icons/default-favicon.png';
                                            }}
                                        />
                                        <span className="truncate text-muted-foreground">{tab.title}</span>
                                    </div>
                                ))}
                                {selectedTabs.length > 5 && (
                                    <span className="text-muted-foreground">
                                        {t('components.newGroupModal.moreTabs', { count: selectedTabs.length - 5 })}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={handleClose} disabled={isCreating}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        onClick={handleCreate}
                        disabled={selectedTabs.length === 0 || isCreating}
                    >
                        {isCreating ? t('components.newGroupModal.creating') : t('components.newGroupModal.create')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
