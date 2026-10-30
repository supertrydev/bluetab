import { useState, useEffect, useCallback } from 'react';
import { GroupMemoryStorageService } from '../../utils/group-memory-storage';

interface UseGroupMemoryReturn {
    memoryUrls: Set<string>;
    loading: boolean;
    refreshMemory: () => Promise<void>;
    isUrlInMemory: (url: string) => boolean;
}

export function useGroupMemory(): UseGroupMemoryReturn {
    const [memoryUrls, setMemoryUrls] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);

    const fetchMemory = useCallback(async () => {
        try {
            const memory = await GroupMemoryStorageService.getMemory();
            const urls = new Set<string>(Object.keys(memory.urlIndex));
            setMemoryUrls(urls);
        } catch (err) {
            console.error('Failed to load group memory:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshMemory = useCallback(async () => {
        setLoading(true);
        await fetchMemory();
    }, [fetchMemory]);

    const isUrlInMemory = useCallback((url: string): boolean => {
        return memoryUrls.has(url);
    }, [memoryUrls]);

    // Initial fetch
    useEffect(() => {
        fetchMemory();
    }, [fetchMemory]);

    // Listen for storage changes
    useEffect(() => {
        const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.groupMemory) {
                fetchMemory();
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);

        return () => {
            chrome.storage.onChanged.removeListener(handleStorageChange);
        };
    }, [fetchMemory]);

    return {
        memoryUrls,
        loading,
        refreshMemory,
        isUrlInMemory
    };
}
