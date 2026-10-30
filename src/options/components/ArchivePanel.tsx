import { useState } from 'react';
import { Archive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ArchiveModal as CreateArchiveModal, ArchiveOptions } from '@/popup/components/modals/ArchiveModal';
import { ArchiveModal } from '@/components/archive-modal';
import { useModal } from '@/popup/components/modals/ModalWrapper';
import { ToastManager } from '@/components/Toast';
import { Storage } from '@/utils/storage';
import type { TabGroup } from '@/types/models';

export interface UseArchivePanelOptions {
    groups: TabGroup[];
    setGroups: React.Dispatch<React.SetStateAction<TabGroup[]>>;
}

/**
 * Custom hook that owns all archive-related state and renders archive modals.
 * Returns action functions and JSX elements to be placed in the component tree.
 */
export function useArchivePanel({ groups, setGroups }: UseArchivePanelOptions) {
    const { t } = useTranslation();
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [selectedGroupsForArchive, setSelectedGroupsForArchive] = useState<string[]>([]);
    const archiveModal = useModal();

    const handleArchiveGroup = async (options: ArchiveOptions) => {
        try {
            console.log('Archiving groups:', options);

            const { ArchiveService } = await import('@/services/archive-service');

            const groupsToArchive = groups.filter(g => options.groupIds.includes(g.id));

            const archiveResults = [];
            for (const group of groupsToArchive) {
                const archiveOptions = {
                    groupId: group.id,
                    reason: options.reason,
                    password: options.passwordProtected ? options.password : undefined,
                    passwordHint: options.passwordProtected ? options.passwordHint : undefined,
                };

                const result = await ArchiveService.createArchive(group, archiveOptions);
                archiveResults.push(result);

                if (!result.success) {
                    throw new Error(result.error || `Failed to archive group "${group.name}"`);
                }
            }

            const updatedGroups = groups.filter(g => !options.groupIds.includes(g.id));
            await Storage.set('groups', updatedGroups);
            setGroups(updatedGroups);

            const warnings = archiveResults.flatMap(r => r.warnings || []);
            ToastManager.getInstance().success(
                warnings.length > 0
                    ? t('options.archivePanel.archivedWithWarnings', { count: options.groupIds.length, warningsCount: warnings.length })
                    : t('options.archivePanel.archived', { count: options.groupIds.length })
            );

            archiveModal.closeModal();
            setSelectedGroupsForArchive([]);

            if (warnings.length > 0) {
                console.warn('Archive warnings:', warnings);
            }
        } catch (error) {
            console.error('Failed to archive group:', error);
            ToastManager.getInstance().error(t('options.archivePanel.archiveFailed', { message: (error as Error).message }));
            throw error;
        }
    };

    const openArchiveForGroups = (groupIds: string[]) => {
        setSelectedGroupsForArchive(groupIds);
        archiveModal.openModal();
    };

    const openArchiveBrowser = () => {
        setIsArchiveModalOpen(true);
    };

    const ArchiveBrowserModal = (
        <ArchiveModal
            isOpen={isArchiveModalOpen}
            onClose={() => setIsArchiveModalOpen(false)}
        />
    );

    const CreateArchiveModalElement = (
        <CreateArchiveModal
            isOpen={archiveModal.isOpen}
            onClose={archiveModal.closeModal}
            onArchive={handleArchiveGroup}
            groups={groups}
            selectedGroupIds={selectedGroupsForArchive}
        />
    );

    const ArchiveFloatingButton = (
        <button
            onClick={() => setIsArchiveModalOpen(true)}
            className="w-14 h-14 text-white rounded-full shadow-lg transition-all duration-200 hover:shadow-xl flex items-center justify-center"
            style={{ backgroundColor: '#2950D5' }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1e3fa8'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#2950D5'}
            title={t('options.archivePanel.openArchives')}
        >
            <Archive className="w-5 h-5" />
        </button>
    );

    return {
        ArchiveBrowserModal,
        CreateArchiveModalElement,
        ArchiveFloatingButton,
        openArchiveForGroups,
        openArchiveBrowser,
    };
}
