/**
 * Chrome Storage API Mock for Testing
 * Provides comprehensive mocking for chrome.storage.local and chrome.storage.onChanged
 */

export interface StorageChange {
    oldValue?: any;
    newValue?: any;
}

export interface MockStorageData {
    [key: string]: any;
}

export class ChromeStorageMock {
    private data: MockStorageData = {};
    private changeListeners: Array<(changes: { [key: string]: StorageChange }) => void> = [];

    // Mock for chrome.storage.local.get
    get = jest.fn().mockImplementation(async (key?: string | string[] | null): Promise<MockStorageData> => {
        if (!key) {
            return { ...this.data };
        }

        if (typeof key === 'string') {
            return { [key]: this.data[key] };
        }

        if (Array.isArray(key)) {
            const result: MockStorageData = {};
            key.forEach(k => {
                result[k] = this.data[k];
            });
            return result;
        }

        return {};
    });

    // Mock for chrome.storage.local.set
    set = jest.fn().mockImplementation(async (items: MockStorageData): Promise<void> => {
        const changes: { [key: string]: StorageChange } = {};

        for (const [key, newValue] of Object.entries(items)) {
            const oldValue = this.data[key];
            changes[key] = { oldValue, newValue };
            this.data[key] = newValue;
        }

        // Trigger change listeners
        this.changeListeners.forEach(listener => {
            listener(changes);
        });
    });

    // Mock for chrome.storage.local.remove
    remove = jest.fn().mockImplementation(async (keys: string | string[]): Promise<void> => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        const changes: { [key: string]: StorageChange } = {};

        keysArray.forEach(key => {
            if (key in this.data) {
                changes[key] = { oldValue: this.data[key], newValue: undefined };
                delete this.data[key];
            }
        });

        // Trigger change listeners
        if (Object.keys(changes).length > 0) {
            this.changeListeners.forEach(listener => {
                listener(changes);
            });
        }
    });

    // Mock for chrome.storage.local.clear
    clear = jest.fn().mockImplementation(async (): Promise<void> => {
        const changes: { [key: string]: StorageChange } = {};

        for (const key of Object.keys(this.data)) {
            changes[key] = { oldValue: this.data[key], newValue: undefined };
        }

        this.data = {};

        // Trigger change listeners
        this.changeListeners.forEach(listener => {
            listener(changes);
        });
    });

    // Mock for chrome.storage.onChanged
    onChanged = {
        addListener: jest.fn().mockImplementation((callback: (changes: { [key: string]: StorageChange }) => void) => {
            this.changeListeners.push(callback);
        }),

        removeListener: jest.fn().mockImplementation((callback: (changes: { [key: string]: StorageChange }) => void) => {
            const index = this.changeListeners.indexOf(callback);
            if (index > -1) {
                this.changeListeners.splice(index, 1);
            }
        }),

        hasListener: jest.fn().mockImplementation((callback: (changes: { [key: string]: StorageChange }) => void) => {
            return this.changeListeners.includes(callback);
        })
    };

    // Utility methods for testing
    getCurrentData(): MockStorageData {
        return { ...this.data };
    }

    setData(data: MockStorageData): void {
        this.data = { ...data };
    }

    clearData(): void {
        this.data = {};
        this.changeListeners = [];
    }

    getChangeListenerCount(): number {
        return this.changeListeners.length;
    }

    // Simulate storage errors for testing error handling
    simulateStorageError(method: 'get' | 'set' | 'remove' | 'clear', errorMessage: string = 'Storage error'): void {
        const originalMethod = this[method];
        this[method] = jest.fn().mockRejectedValue(new Error(errorMessage));

        // Restore original method after one call
        setTimeout(() => {
            this[method] = originalMethod;
        }, 0);
    }

    // Simulate storage quota exceeded
    simulateQuotaExceeded(): void {
        this.simulateStorageError('set', 'QUOTA_BYTES quota exceeded');
    }

    // Advanced mocking: Simulate network delays
    addLatency(ms: number): void {
        const originalSet = this.set;
        const originalGet = this.get;
        const originalRemove = this.remove;

        this.set = jest.fn().mockImplementation(async (items: MockStorageData) => {
            await new Promise(resolve => setTimeout(resolve, ms));
            return originalSet(items);
        });

        this.get = jest.fn().mockImplementation(async (key?: string | string[] | null) => {
            await new Promise(resolve => setTimeout(resolve, ms));
            return originalGet(key);
        });

        this.remove = jest.fn().mockImplementation(async (keys: string | string[]) => {
            await new Promise(resolve => setTimeout(resolve, ms));
            return originalRemove(keys);
        });
    }
}

// Global mock setup for tests
export function setupChromeStorageMock(): ChromeStorageMock {
    const mockStorage = new ChromeStorageMock();

    // Mock the global chrome object
    (global as any).chrome = {
        storage: {
            local: mockStorage,
            onChanged: mockStorage.onChanged
        }
    };

    return mockStorage;
}

// Cleanup after tests
export function cleanupChromeStorageMock(): void {
    delete (global as any).chrome;
}