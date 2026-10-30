import { ArchivedGroup } from '../../types/archive';
import { Button } from '@/components/ui/button';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ArchiveActionsProps {
    archive: ArchivedGroup;
    onRestore: (archive: ArchivedGroup) => void;
    onDelete: (archive: ArchivedGroup) => void;
}

export function ArchiveActions({ archive, onRestore, onDelete }: ArchiveActionsProps) {
    const { t } = useTranslation();
    const handleRestore = () => {
        if (window.confirm(t('components.archive.restoreConfirmAction'))) {
            onRestore(archive);
        }
    };

    const handleDelete = () => {
        if (window.confirm(t('components.archive.deleteConfirmAction'))) {
            if (window.confirm(t('components.archive.deleteFinalConfirm'))) {
                onDelete(archive);
            }
        }
    };

    return (
        <div className="flex gap-2">
            <Button
                onClick={handleRestore}
                variant="primary"
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                title={t('archive.item.restoreArchive')}
            >
                <RotateCcw className="me-1 h-3 w-3" />
                {t('common.restore')}
            </Button>
            <Button
                onClick={handleDelete}
                variant="danger"
                size="sm"
                title={t('archive.item.deleteArchive')}
            >
                <Trash2 className="me-1 h-3 w-3" />
                {t('common.delete')}
            </Button>
        </div>
    );
}
