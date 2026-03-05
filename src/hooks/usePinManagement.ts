import { useState, useEffect, useCallback } from 'react';
import { TabGroup } from '../types/models';
import { Storage } from '../utils/storage';
import { ToastManager } from '../components/Toast';

export interface PinManagementState {
    pinnedGroups: Set<string>;
    isLoading: boolean;
    error: string | null;
}

export function usePinManagement(groups: TabGroup[]) {
    const [state, setState] = useState<PinManagementState>({
        pinnedGroups: new Set(),
        isLoading: true,
        error: null
    });

    const toastManager = ToastManager.getInstance();

    const loadPinSettings = useCallback(async () => {
        try {
            setState(prev => ({ ...prev, isLoading: true, error: null }));
            const pinSettings = await Storage.getPinSettings();
            const pinnedIds = new Set(
                Object.keys(pinSettings.pinnedGroups).filter(
                    id => pinSettings.pinnedGroups[id].isPinned
                )
            );
            setState(prev => ({ ...prev, pinnedGroups: pinnedIds, isLoading: false }));
        } catch (error) {
            console.error('Failed to load pin settings:', error);
            setState(prev => ({
                ...prev,
                isLoading: false,
                error: 'Failed to load pin settings'
            }));
        }
    }, []);

    // Load pin settings on mount and listen for external changes
    useEffect(() => {
        loadPinSettings();

        // Listen for external pin settings changes
        const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.pinSettings) {
                console.debug('Pin settings changed externally, reloading...', changes.pinSettings);
                // Reload pin settings when they change externally
                loadPinSettings();
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);

        return () => {
            chrome.storage.onChanged.removeListener(handleStorageChange);
        };
    }, [loadPinSettings]);

    const togglePin = useCallback(async (groupId: string) => {
        const isPinned = state.pinnedGroups.has(groupId);
        const newPinnedState = !isPinned;

        try {
            // Optimistic update
            setState(prev => {
                const newPinnedGroups = new Set(prev.pinnedGroups);
                if (newPinnedState) {
                    newPinnedGroups.add(groupId);
                } else {
                    newPinnedGroups.delete(groupId);
                }
                return { ...prev, pinnedGroups: newPinnedGroups, error: null };
            });

            // Persist to storage
            await Storage.setPinStatus(groupId, newPinnedState);

            // Find group name for toast
            const group = groups.find(g => g.id === groupId);
            const groupName = group?.name || 'Group';

            // Show success toast
            if (newPinnedState) {
                toastManager.success(`📌 ${groupName} pinned to top`);
            } else {
                toastManager.info(`📌 ${groupName} unpinned`);
            }
        } catch (error) {
            console.error('Failed to toggle pin status:', error);

            // Revert optimistic update
            setState(prev => {
                const newPinnedGroups = new Set(prev.pinnedGroups);
                if (isPinned) {
                    newPinnedGroups.add(groupId);
                } else {
                    newPinnedGroups.delete(groupId);
                }
                return {
                    ...prev,
                    pinnedGroups: newPinnedGroups,
                    error: 'Failed to update pin status'
                };
            });

            toastManager.error('Failed to update pin status');
        }
    }, [state.pinnedGroups, groups, toastManager]);

    const isPinned = useCallback((groupId: string) => {
        return state.pinnedGroups.has(groupId);
    }, [state.pinnedGroups]);

    const getPinnedGroups = useCallback(() => {
        return groups.filter(group => state.pinnedGroups.has(group.id));
    }, [groups, state.pinnedGroups]);

    const getUnpinnedGroups = useCallback(() => {
        return groups.filter(group => !state.pinnedGroups.has(group.id));
    }, [groups, state.pinnedGroups]);

    const getPinnedCount = useCallback(() => {
        return state.pinnedGroups.size;
    }, [state.pinnedGroups]);

    return {
        ...state,
        togglePin,
        isPinned,
        getPinnedGroups,
        getUnpinnedGroups,
        getPinnedCount,
        reload: loadPinSettings
    };
}

export default usePinManagement;