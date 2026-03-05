import React, { useState, useEffect } from 'react';
import { ArchivedGroup, ArchiveFilters } from '../../types/archive';
import { ArchiveHeader } from './ArchiveHeader';
import { ArchiveList } from '../../popup/components/archive/ArchiveList';
import { ArchiveViewModal } from '../../popup/components/archive/ArchiveViewModal';
import { ArchiveRestoreModal } from './ArchiveRestoreModal';
import { ArchiveDeleteModal } from './ArchiveDeleteModal';
import { ArchiveService } from '../../services/archive-service';
import { Storage } from '../../utils/storage';
import { ToastManager } from '../Toast';
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import type { TabGroup } from '../../types/models';

interface ArchiveModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ArchiveModal({ isOpen, onClose }: ArchiveModalProps) {
    const [filters, setFilters] = useState<ArchiveFilters>({
        sortBy: 'date',
        sortOrder: 'desc'
    });
    const [refreshKey, setRefreshKey] = useState(0);
    const [viewModalOpen, setViewModalOpen] = useState(false);
    const [restoreModalOpen, setRestoreModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [selectedArchive, setSelectedArchive] = useState<ArchivedGroup | null>(null);

    const triggerRefresh = () => setRefreshKey(prev => prev + 1);

    const handleArchiveSelect = (archive: ArchivedGroup) => {
        console.log('Selected archive:', archive);
    };

    const handleArchiveRestore = async (archive: ArchivedGroup) => {
        setSelectedArchive(archive);

        // If not password protected, restore directly
        if (!archive.protection.passwordProtected) {
            try {
                await performRestoreDirect(archive);
            } catch (err) {
                ToastManager.getInstance().error('Failed to restore archive: ' + (err as Error).message);
            }
            return;
        }

        // Otherwise, show password modal
        setRestoreModalOpen(true);
    };

    const performRestoreDirect = async (archive: ArchivedGroup) => {
        try {
            const result = await ArchiveService.restoreArchive({
                archiveId: archive.id,
                removeAfterRestore: true
            });
            if (!result.success || !result.restoredGroup) {
                const message = result.error || 'Failed to restore archive.';
                ToastManager.getInstance().error(message);
                throw new Error(message);
            }

            const restoredGroup = result.restoredGroup as TabGroup;
            const storedGroups = await Storage.get<TabGroup[]>('groups') || [];
            const existingIndex = storedGroups.findIndex(g => g.id === restoredGroup.id);
            const updatedGroups = [...storedGroups];

            if (existingIndex >= 0) {
                updatedGroups[existingIndex] = restoredGroup;
            } else {
                updatedGroups.push(restoredGroup);
            }

            await Storage.set('groups', updatedGroups);

            ToastManager.getInstance().success(`Restored "${restoredGroup.name}" to active groups`);
            triggerRefresh();
        } catch (error) {
            console.error('Error restoring archive:', error);
            throw error;
        }
    };

    const performRestore = async (password?: string) => {
        if (!selectedArchive) return;

        try {
            const result = await ArchiveService.restoreArchive({
                archiveId: selectedArchive.id,
                password,
                removeAfterRestore: true
            });
            if (!result.success || !result.restoredGroup) {
                const message = result.error || 'Failed to restore archive.';
                ToastManager.getInstance().error(message);
                console.error('Failed to restore archive:', result.error);
                throw new Error(message);
            }

            const restoredGroup = result.restoredGroup as TabGroup;
            const storedGroups = await Storage.get<TabGroup[]>('groups') || [];
            const existingIndex = storedGroups.findIndex(g => g.id === restoredGroup.id);
            const updatedGroups = [...storedGroups];

            if (existingIndex >= 0) {
                updatedGroups[existingIndex] = restoredGroup;
            } else {
                updatedGroups.push(restoredGroup);
            }

            await Storage.set('groups', updatedGroups);

            ToastManager.getInstance().success(`Restored "${restoredGroup.name}" to active groups`);
            triggerRefresh();
        } catch (error) {
            console.error('Error restoring archive:', error);
            throw error;
        }
    };

    const handleArchiveDelete = (archive: ArchivedGroup) => {
        setSelectedArchive(archive);
        setDeleteModalOpen(true);
    };

    const performDelete = async (password?: string) => {
        if (!selectedArchive) return;

        try {
            const result = await ArchiveService.deleteArchive(selectedArchive.id);
            if (result.success) {
                ToastManager.getInstance().success('Archive deleted successfully');
                triggerRefresh();
            } else {
                ToastManager.getInstance().error(result.error || 'Failed to delete archive');
                throw new Error(result.error || 'Failed to delete archive');
            }
        } catch (error) {
            console.error('Error deleting archive:', error);
            throw error;
        }
    };

    const handleArchiveView = (archive: ArchivedGroup) => {
        setSelectedArchive(archive);
        setViewModalOpen(true);
    };

    const handleCloseViewModal = () => {
        setViewModalOpen(false);
        setSelectedArchive(null);
    };

    const handleCloseRestoreModal = () => {
        setRestoreModalOpen(false);
        setSelectedArchive(null);
    };

    const handleCloseDeleteModal = () => {
        setDeleteModalOpen(false);
        setSelectedArchive(null);
    };

    useEffect(() => {
        if (isOpen) {
            setRefreshKey(prev => prev + 1);
        }
    }, [isOpen]);

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="max-w-2xl h-[70vh] p-0 flex flex-col">
                    <VisuallyHidden>
                        <DialogTitle>Archive Management</DialogTitle>
                    </VisuallyHidden>

                    {/* Modal Header */}
                    <ArchiveHeader
                        filters={filters}
                        onFiltersChange={setFilters}
                    />

                    {/* Modal Content */}
                    <div className="flex-1 overflow-y-auto px-4 pb-4 relative scrollbar-transparent">
                        <ArchiveList
                            onArchiveSelect={handleArchiveSelect}
                            onArchiveRestore={handleArchiveRestore}
                            onArchiveView={handleArchiveView}
                            onArchiveDelete={handleArchiveDelete}
                            filters={filters}
                            onFiltersChange={setFilters}
                            refreshKey={refreshKey}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            <ArchiveViewModal
                isOpen={viewModalOpen}
                onClose={handleCloseViewModal}
                archive={selectedArchive}
            />

            <ArchiveRestoreModal
                isOpen={restoreModalOpen}
                onClose={handleCloseRestoreModal}
                archive={selectedArchive}
                onRestore={performRestore}
            />

            <ArchiveDeleteModal
                isOpen={deleteModalOpen}
                onClose={handleCloseDeleteModal}
                archive={selectedArchive}
                onDelete={performDelete}
            />
        </>
    );
}
