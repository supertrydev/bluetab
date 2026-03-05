/**
 * Persistence Testing Framework
 * Provides utilities for testing cross-session state persistence scenarios
 */

import { ChromeStorageMock } from './chrome-storage-mock';
import type { TabGroup } from '../../types/models';

export interface TestSession {
    sessionId: string;
    storage: ChromeStorageMock;
    groups: TabGroup[];
    collapsedStates: Map<string, boolean>;
}

export interface CrossSessionTestScenario {
    name: string;
    description: string;
    sessions: TestSession[];
    expectedFinalState: Map<string, boolean>;
    conflictResolutionExpected?: boolean;
}

export class PersistenceTestFramework {
    private scenarios: CrossSessionTestScenario[] = [];

    // Create a test session with specific configuration
    createTestSession(sessionId: string, groups: TabGroup[], initialStates?: Map<string, boolean>): TestSession {
        const storage = new ChromeStorageMock();
        const collapsedStates = initialStates || new Map();

        return {
            sessionId,
            storage,
            groups,
            collapsedStates
        };
    }

    // Simulate browser restart scenario
    async simulateBrowserRestart(session: TestSession): Promise<TestSession> {
        // Save current state
        await session.storage.set('collapsedGroups', Object.fromEntries(session.collapsedStates));

        // Create new session (simulating restart)
        const newSession = this.createTestSession(
            `${session.sessionId}_restart`,
            session.groups
        );

        // Copy storage data to new session
        const storageData = session.storage.getCurrentData();
        newSession.storage.setData(storageData);

        return newSession;
    }

    // Simulate extension reload scenario
    async simulateExtensionReload(session: TestSession): Promise<TestSession> {
        // Extension reload preserves storage but reinitializes all state
        const newSession = this.createTestSession(
            `${session.sessionId}_reload`,
            session.groups
        );

        // Copy storage data
        const storageData = session.storage.getCurrentData();
        newSession.storage.setData(storageData);

        return newSession;
    }

    // Simulate page refresh scenario
    async simulatePageRefresh(session: TestSession): Promise<TestSession> {
        // Page refresh should preserve all state through storage
        return this.simulateBrowserRestart(session);
    }

    // Simulate multi-window scenario with concurrent changes
    async simulateMultiWindowConflict(
        session1: TestSession,
        session2: TestSession,
        groupId: string,
        state1: boolean,
        state2: boolean,
        delay: number = 100
    ): Promise<{ session1: TestSession, session2: TestSession, winner: TestSession }> {
        // Both sessions make changes to the same group almost simultaneously
        const promise1 = new Promise<void>(resolve => {
            setTimeout(async () => {
                session1.collapsedStates.set(groupId, state1);
                await session1.storage.set('collapsedGroups', {
                    ...Object.fromEntries(session1.collapsedStates),
                    [groupId]: state1
                });
                resolve();
            }, delay);
        });

        const promise2 = new Promise<void>(resolve => {
            setTimeout(async () => {
                session2.collapsedStates.set(groupId, state2);
                await session2.storage.set('collapsedGroups', {
                    ...Object.fromEntries(session2.collapsedStates),
                    [groupId]: state2
                });
                resolve();
            }, delay + 50); // Slightly later
        });

        await Promise.all([promise1, promise2]);

        // Session 2 should win due to later timestamp
        return {
            session1,
            session2,
            winner: session2
        };
    }

    // Generate comprehensive test scenarios
    generateTestScenarios(): CrossSessionTestScenario[] {
        const baseGroups: TabGroup[] = [
            {
                id: 'group-1',
                name: 'Work Tabs',
                tabs: [],
                created: Date.now(),
                modified: Date.now()
            },
            {
                id: 'group-2',
                name: 'Personal Tabs',
                tabs: [],
                created: Date.now(),
                modified: Date.now()
            },
            {
                id: 'group-3',
                name: 'Research Tabs',
                tabs: [],
                created: Date.now(),
                modified: Date.now()
            }
        ];

        return [
            {
                name: 'Browser Restart Persistence',
                description: 'State should persist after browser restart',
                sessions: [
                    this.createTestSession('session-1', baseGroups, new Map([
                        ['group-1', true],
                        ['group-2', false],
                        ['group-3', true]
                    ]))
                ],
                expectedFinalState: new Map([
                    ['group-1', true],
                    ['group-2', false],
                    ['group-3', true]
                ])
            },
            {
                name: 'Extension Reload Recovery',
                description: 'State should recover after extension reload',
                sessions: [
                    this.createTestSession('session-1', baseGroups, new Map([
                        ['group-1', false],
                        ['group-2', true],
                        ['group-3', false]
                    ]))
                ],
                expectedFinalState: new Map([
                    ['group-1', false],
                    ['group-2', true],
                    ['group-3', false]
                ])
            },
            {
                name: 'Multi-Window Sync',
                description: 'Changes in one window should sync to other windows',
                sessions: [
                    this.createTestSession('popup', baseGroups),
                    this.createTestSession('options', baseGroups)
                ],
                expectedFinalState: new Map([
                    ['group-1', true], // Changed in popup
                    ['group-2', false], // Changed in options
                    ['group-3', true] // Changed in popup
                ]),
                conflictResolutionExpected: true
            },
            {
                name: 'Corrupted State Recovery',
                description: 'Should handle corrupted storage gracefully',
                sessions: [
                    this.createTestSession('session-1', baseGroups)
                ],
                expectedFinalState: new Map() // Empty state after corruption recovery
            },
            {
                name: 'Group Rename State Migration',
                description: 'State should migrate when groups are renamed',
                sessions: [
                    this.createTestSession('session-1', baseGroups, new Map([
                        ['group-1', true],
                        ['group-2', false]
                    ]))
                ],
                expectedFinalState: new Map([
                    ['group-1-renamed', true], // State migrated to new ID
                    ['group-2', false]
                ])
            }
        ];
    }

    // Validation helpers
    validateStateConsistency(session: TestSession, expectedState: Map<string, boolean>): boolean {
        if (session.collapsedStates.size !== expectedState.size) {
            return false;
        }

        for (const [groupId, expectedValue] of expectedState) {
            if (session.collapsedStates.get(groupId) !== expectedValue) {
                return false;
            }
        }

        return true;
    }

    // Storage integrity validation
    async validateStorageIntegrity(session: TestSession): Promise<boolean> {
        try {
            const storageData = await session.storage.get('collapsedGroups');

            if (!storageData.collapsedGroups) {
                return false;
            }

            // Validate that storage data matches in-memory state
            const storedState = new Map(Object.entries(storageData.collapsedGroups));
            return this.validateStateConsistency({ ...session, collapsedStates: storedState }, session.collapsedStates);
        } catch (error) {
            return false;
        }
    }

    // Performance testing helpers
    async measureStoragePerformance(session: TestSession, iterations: number = 100): Promise<{
        averageWriteTime: number;
        averageReadTime: number;
        totalTime: number;
    }> {
        const writeTimes: number[] = [];
        const readTimes: number[] = [];
        const totalStartTime = performance.now();

        for (let i = 0; i < iterations; i++) {
            // Measure write performance
            const writeStart = performance.now();
            await session.storage.set('collapsedGroups', Object.fromEntries(session.collapsedStates));
            const writeEnd = performance.now();
            writeTimes.push(writeEnd - writeStart);

            // Measure read performance
            const readStart = performance.now();
            await session.storage.get('collapsedGroups');
            const readEnd = performance.now();
            readTimes.push(readEnd - readStart);
        }

        const totalEndTime = performance.now();

        return {
            averageWriteTime: writeTimes.reduce((a, b) => a + b) / writeTimes.length,
            averageReadTime: readTimes.reduce((a, b) => a + b) / readTimes.length,
            totalTime: totalEndTime - totalStartTime
        };
    }

    // Memory leak detection
    detectMemoryLeaks(session: TestSession): {
        listenerCount: number;
        storageDataSize: number;
        potentialLeaks: string[];
    } {
        const potentialLeaks: string[] = [];
        const listenerCount = session.storage.getChangeListenerCount();
        const storageData = session.storage.getCurrentData();
        const storageDataSize = JSON.stringify(storageData).length;

        if (listenerCount > 5) {
            potentialLeaks.push(`Too many storage listeners: ${listenerCount}`);
        }

        if (storageDataSize > 10240) { // 10KB
            potentialLeaks.push(`Storage data too large: ${storageDataSize} bytes`);
        }

        return {
            listenerCount,
            storageDataSize,
            potentialLeaks
        };
    }

    // Stress testing
    async stressTestStorage(session: TestSession, operationCount: number = 1000): Promise<{
        successfulOperations: number;
        failedOperations: number;
        averageLatency: number;
        errors: string[];
    }> {
        const latencies: number[] = [];
        const errors: string[] = [];
        let successfulOperations = 0;
        let failedOperations = 0;

        for (let i = 0; i < operationCount; i++) {
            try {
                const start = performance.now();

                // Randomly perform different operations
                const operation = Math.random();
                if (operation < 0.5) {
                    // Write operation
                    await session.storage.set('collapsedGroups', {
                        [`group-${i}`]: Math.random() > 0.5
                    });
                } else {
                    // Read operation
                    await session.storage.get('collapsedGroups');
                }

                const end = performance.now();
                latencies.push(end - start);
                successfulOperations++;
            } catch (error) {
                failedOperations++;
                errors.push((error as Error).message);
            }
        }

        return {
            successfulOperations,
            failedOperations,
            averageLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
            errors
        };
    }
}

// Factory function for tests
export function createPersistenceTestFramework(): PersistenceTestFramework {
    return new PersistenceTestFramework();
}