import { ConfirmModal } from '@/components/ConfirmModal';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface DeleteConfirmModalProps {
    isOpen: boolean;
    type: 'group' | 'selected' | 'tag';
    selectedCount: number;
    /** Number of groups with active Bluet shares (group or selected mode) */
    bluet_linkedCount?: number;
    onConfirm: () => void;
    onCancel: () => void;
}

export function DeleteConfirmModal({
    isOpen,
    type,
    selectedCount,
    bluet_linkedCount = 0,
    onConfirm,
    onCancel,
}: DeleteConfirmModalProps) {
    const { t } = useTranslation();
    const title =
        type === 'group'
            ? t('popup.deleteGroupTitle')
            : type === 'selected'
                ? t('components.deleteConfirm.selectedTitle')
                : t('components.deleteConfirm.tagTitle');

    const baseMessage =
        type === 'group'
            ? t('components.deleteConfirm.groupMessage')
            : type === 'selected'
                ? t('components.deleteConfirm.selectedMessage', { count: selectedCount })
                : t('components.deleteConfirm.tagMessage');

    const bluetWarning = bluet_linkedCount > 0 && (type === 'group' || type === 'selected');

    const message = (
        <div className="space-y-3">
            <p>{baseMessage}</p>
            {bluetWarning && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-warning-muted border border-warning/30 text-sm">
                    <ExternalLink className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <p className="text-warning">
                        {bluet_linkedCount === 1
                            ? t('components.deleteConfirm.bluetOne')
                            : t('components.deleteConfirm.bluetMany', { count: bluet_linkedCount })
                        }
                    </p>
                </div>
            )}
        </div>
    );

    return (
        <ConfirmModal
            isOpen={isOpen}
            title={title}
            message={message}
            confirmText={t('common.delete')}
            cancelText={t('common.cancel')}
            onConfirm={onConfirm}
            onCancel={onCancel}
            type="danger"
        />
    );
}
