/**
 * Test Helpers Index
 * Exports all testing utilities for persistence and Chrome Storage testing
 */

export {
    ChromeStorageMock,
    setupChromeStorageMock,
    cleanupChromeStorageMock,
    type StorageChange,
    type MockStorageData
} from './chrome-storage-mock';

export {
    PersistenceTestFramework,
    createPersistenceTestFramework,
    type TestSession,
    type CrossSessionTestScenario
} from './persistence-test-framework';

// Test data generators
export function generateTestGroups(count: number = 5): import('../../types/models').TabGroup[] {
    const groups: import('../../types/models').TabGroup[] = [];

    for (let i = 1; i <= count; i++) {
        groups.push({
            id: `test-group-${i}`,
            name: `Test Group ${i}`,
            tabs: [
                {
                    id: `tab-${i}-1`,
                    url: `https://example.com/page${i}`,
                    title: `Test Tab ${i}`,
                    timestamp: Date.now(),
                    groupId: `test-group-${i}`
                }
            ],
            created: Date.now() - (i * 1000),
            modified: Date.now() - (i * 500)
        });
    }

    return groups;
}

export function generateTestCollapsedStates(groupIds: string[]): Map<string, boolean> {
    const states = new Map<string, boolean>();

    groupIds.forEach((id, index) => {
        // Alternate between collapsed and expanded for variety
        states.set(id, index % 2 === 0);
    });

    return states;
}

// Common test assertions
export function assertStorageContains(
    storage: ChromeStorageMock,
    key: string,
    expectedValue: any
): void {
    const data = storage.getCurrentData();
    expect(data[key]).toEqual(expectedValue);
}

export function assertStateEquals(
    actual: Map<string, boolean>,
    expected: Map<string, boolean>
): void {
    expect(actual.size).toBe(expected.size);

    for (const [key, value] of expected) {
        expect(actual.get(key)).toBe(value);
    }
}

// Test scenario builders
export interface TestScenarioBuilder {
    withGroups(groups: import('../../types/models').TabGroup[]): TestScenarioBuilder;
    withInitialStates(states: Map<string, boolean>): TestScenarioBuilder;
    withStorageLatency(ms: number): TestScenarioBuilder;
    withStorageErrors(errorType: 'quota' | 'network' | 'corruption'): TestScenarioBuilder;
    build(): {
        groups: import('../../types/models').TabGroup[];
        initialStates: Map<string, boolean>;
        storageConfig: StorageTestConfig;
    };
}

export interface StorageTestConfig {
    latency?: number;
    errorType?: 'quota' | 'network' | 'corruption';
    errorProbability?: number;
}

export class TestScenarioBuilderImpl implements TestScenarioBuilder {
    private groups: import('../../types/models').TabGroup[] = [];
    private initialStates = new Map<string, boolean>();
    private storageConfig: StorageTestConfig = {};

    withGroups(groups: import('../../types/models').TabGroup[]): TestScenarioBuilder {
        this.groups = groups;
        return this;
    }

    withInitialStates(states: Map<string, boolean>): TestScenarioBuilder {
        this.initialStates = states;
        return this;
    }

    withStorageLatency(ms: number): TestScenarioBuilder {
        this.storageConfig.latency = ms;
        return this;
    }

    withStorageErrors(errorType: 'quota' | 'network' | 'corruption'): TestScenarioBuilder {
        this.storageConfig.errorType = errorType;
        this.storageConfig.errorProbability = 0.1; // 10% chance
        return this;
    }

    build() {
        return {
            groups: this.groups,
            initialStates: this.initialStates,
            storageConfig: this.storageConfig
        };
    }
}

export function createTestScenario(): TestScenarioBuilder {
    return new TestScenarioBuilderImpl();
}

// Performance test helpers
export async function measureAsyncOperation<T>(
    operation: () => Promise<T>
): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await operation();
    const end = performance.now();

    return {
        result,
        duration: end - start
    };
}

export function createPerformanceReport(
    operations: { name: string; duration: number }[]
): {
    totalTime: number;
    averageTime: number;
    slowestOperation: { name: string; duration: number };
    fastestOperation: { name: string; duration: number };
} {
    const totalTime = operations.reduce((sum, op) => sum + op.duration, 0);
    const averageTime = totalTime / operations.length;

    const slowestOperation = operations.reduce((prev, current) =>
        current.duration > prev.duration ? current : prev
    );

    const fastestOperation = operations.reduce((prev, current) =>
        current.duration < prev.duration ? current : prev
    );

    return {
        totalTime,
        averageTime,
        slowestOperation,
        fastestOperation
    };
}