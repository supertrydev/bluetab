import React from 'react';
import { ArchivedGroup } from '../../types/archive';
import { Button } from '@/components/ui/button';
import { RotateCcw, Trash2 } from 'lucide-react';

interface ArchiveActionsProps {
    archive: ArchivedGroup;
    onRestore: (archive: ArchivedGroup) => void;
    onDelete: (archive: ArchivedGroup) => void;
}

export function ArchiveActions({ archive, onRestore, onDelete }: ArchiveActionsProps) {
    const handleRestore = () => {
        if (window.confirm('Are you sure you want to restore this archive?')) {
            onRestore(archive);
        }
    };

    const handleDelete = () => {
        if (window.confirm('Are you sure you want to permanently delete this archive? This action cannot be undone.')) {
            if (window.confirm('Final confirmation: This will permanently delete the archive. Continue?')) {
                onDelete(archive);
            }
        }
    };

    return (
        <div className="flex gap-2">
            <Button
                onClick={handleRestore}
                variant="default"
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                title="Restore Archive"
            >
                <RotateCcw className="mr-1 h-3 w-3" />
                Restore
            </Button>
            <Button
                onClick={handleDelete}
                variant="destructive"
                size="sm"
                title="Delete Archive"
            >
                <Trash2 className="mr-1 h-3 w-3" />
                Delete
            </Button>
        </div>
    );
}
