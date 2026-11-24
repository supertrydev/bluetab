import { useState, useEffect } from 'react';
import { StickyNote } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TabGroup } from '@/types/models';
import { useTranslation } from 'react-i18next';

export interface NotesModalProps {
    groups: TabGroup[];
    groupId: string | null;
    onSave: (groupId: string, notes: string) => void;
    onClose: () => void;
}

export function NotesModal({ groups, groupId, onSave, onClose }: NotesModalProps) {
    const { t } = useTranslation();
    const [notesText, setNotesText] = useState('');

    const group = groupId ? groups.find(g => g.id === groupId) : null;

    useEffect(() => {
        if (groupId && group) {
            setNotesText(group.notes || '');
        }
    }, [groupId, group]);

    const handleSave = () => {
        if (!groupId) return;
        onSave(groupId, notesText);
        setNotesText('');
    };

    const handleClose = () => {
        setNotesText('');
        onClose();
    };

    return (
        <Dialog open={!!groupId} onOpenChange={(open) => { if (!open) handleClose(); }}>
            <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
                    <DialogTitle className="text-text-strong flex items-center gap-2">
                        <StickyNote className="h-4 w-4 text-primary" />
                        {group?.notes ? t('options.groupMenu.editNote') : t('options.groupMenu.addNote')}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        <bdi dir="auto">{group?.name}</bdi>
                    </DialogDescription>
                </DialogHeader>
                <div className="p-4">
                    <textarea
                        value={notesText}
                        onChange={(e) => setNotesText(e.target.value)}
                        placeholder={t('options.notesModal.placeholder')}
                        className="w-full min-h-[120px] p-3 rounded-lg border border-field bg-bg-1 text-sm text-text-strong placeholder:text-text-muted resize-y"
                        dir="auto"
                        autoFocus
                    />
                </div>
                <DialogFooter className="px-4 py-3 border-t border-border bg-transparent">
                    <Button variant="outline" size="sm" onClick={handleClose}>
                        {t('common.cancel')}
                    </Button>
                    <Button size="sm" onClick={handleSave}>
                        {t('common.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
