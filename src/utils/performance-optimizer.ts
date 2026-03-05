/**
 * Performance Optimizer for Large State Datasets
 * Implements advanced caching, debouncing, and lazy loading strategies
 */

export class PerformanceOptimizer {
    private writeQueue = new Map<string, any>();
    private writeTimer: NodeJS.Timeout | null = null;
    private cache = new LRUCache<string, any>(100); // Cache last 100 operations
    private readonly DEBOUNCE_DELAY = 250; // ms
    private readonly BATCH_SIZE = 10;
    private metrics = {
        cacheHits: 0,
        cacheMisses: 0,
        batchedWrites: 0,
        totalOperations: 0
    };

    /**
     * Debounced write operation
     */
    queueWrite(key: string, value: any): Promise<void> {
        return new Promise((resolve, reject) => {
            this.writeQueue.set(key, { value, resolve, reject });

            if (this.writeTimer) {
                clearTimeout(this.writeTimer);
            }

            this.writeTimer = setTimeout(() => {
                this.flushWrites();
            }, this.DEBOUNCE_DELAY);
        });
    }

    /**
     * Cached read operation
     */
    cachedRead<T>(key: string, loader: () => Promise<T>): Promise<T> {
        this.metrics.totalOperations++;

        const cached = this.cache.get(key);
        if (cached !== undefined) {
            this.metrics.cacheHits++;
            return Promise.resolve(cached as T);
        }

        this.metrics.cacheMisses++;
        return loader().then(value => {
            this.cache.set(key, value);
            return value;
        });
    }

    /**
     * Batch process large arrays
     */
    async batchProcess<T, R>(
        items: T[],
        processor: (batch: T[]) => Promise<R[]>,
        batchSize: number = this.BATCH_SIZE
    ): Promise<R[]> {
        const results: R[] = [];

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const batchResults = await processor(batch);
            results.push(...batchResults);

            // Yield control to prevent blocking UI
            if (i + batchSize < items.length) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return results;
    }

    /**
     * Throttled function executor
     */
    throttle<T extends (...args: any[]) => any>(
        func: T,
        delay: number
    ): (...args: Parameters<T>) => void {
        let lastCall = 0;
        let timeoutId: NodeJS.Timeout | null = null;

        return (...args: Parameters<T>) => {
            const now = Date.now();

            if (now - lastCall >= delay) {
                lastCall = now;
                func(...args);
            } else {
                if (timeoutId) clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    lastCall = Date.now();
                    func(...args);
                }, delay - (now - lastCall));
            }
        };
    }

    /**
     * Measure async operation performance
     */
    async measure<T>(
        name: string,
        operation: () => Promise<T>
    ): Promise<{ result: T; duration: number }> {
        const start = performance.now();
        const result = await operation();
        const duration = performance.now() - start;

        console.log(`Performance [${name}]: ${duration.toFixed(2)}ms`);

        return { result, duration };
    }

    /**
     * Get performance metrics
     */
    getMetrics() {
        const hitRate = this.metrics.totalOperations > 0
            ? (this.metrics.cacheHits / this.metrics.totalOperations) * 100
            : 0;

        return {
            ...this.metrics,
            cacheHitRate: hitRate.toFixed(2) + '%'
        };
    }

    /**
     * Reset metrics
     */
    resetMetrics(): void {
        this.metrics = {
            cacheHits: 0,
            cacheMisses: 0,
            batchedWrites: 0,
            totalOperations: 0
        };
    }

    // Private methods

    private async flushWrites(): Promise<void> {
        const writes = Array.from(this.writeQueue.entries());
        this.writeQueue.clear();
        this.metrics.batchedWrites++;

        try {
            // Process writes in batches
            await this.batchProcess(writes, async (batch) => {
                const promises = batch.map(async ([key, { value, resolve, reject }]) => {
                    try {
                        // Actual write operation would go here
                        // For now, we just resolve
                        resolve();
                        return { key, success: true };
                    } catch (error) {
                        reject(error);
                        return { key, success: false, error };
                    }
                });

                return Promise.all(promises);
            });
        } catch (error) {
            console.error('Batch write failed:', error);
        }
    }
}

/**
 * LRU Cache implementation
 */
class LRUCache<K, V> {
    private cache = new Map<K, V>();
    private maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Remove least recently used (first entry)
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, value);
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

/**
 * Performance monitoring utilities
 */
export class PerformanceMonitor {
    private static instance: PerformanceMonitor | null = null;
    private measurements = new Map<string, number[]>();

    static getInstance(): PerformanceMonitor {
        if (!PerformanceMonitor.instance) {
            PerformanceMonitor.instance = new PerformanceMonitor();
        }
        return PerformanceMonitor.instance;
    }

    /**
     * Record a timing measurement
     */
    record(name: string, duration: number): void {
        if (!this.measurements.has(name)) {
            this.measurements.set(name, []);
        }

        const measurements = this.measurements.get(name)!;
        measurements.push(duration);

        // Keep only last 100 measurements
        if (measurements.length > 100) {
            measurements.shift();
        }
    }

    /**
     * Get performance statistics
     */
    getStats(name: string): {
        count: number;
        average: number;
        min: number;
        max: number;
        latest: number;
    } | null {
        const measurements = this.measurements.get(name);
        if (!measurements || measurements.length === 0) {
            return null;
        }

        const sum = measurements.reduce((a, b) => a + b, 0);
        const average = sum / measurements.length;
        const min = Math.min(...measurements);
        const max = Math.max(...measurements);
        const latest = measurements[measurements.length - 1];

        return {
            count: measurements.length,
            average: Number(average.toFixed(2)),
            min: Number(min.toFixed(2)),
            max: Number(max.toFixed(2)),
            latest: Number(latest.toFixed(2))
        };
    }

    /**
     * Get all performance data
     */
    getAllStats(): { [name: string]: any } {
        const result: { [name: string]: any } = {};

        for (const [name] of this.measurements) {
            result[name] = this.getStats(name);
        }

        return result;
    }

    /**
     * Clear all measurements
     */
    clear(): void {
        this.measurements.clear();
    }
}

// Singleton instances
let performanceOptimizer: PerformanceOptimizer | null = null;

export function getPerformanceOptimizer(): PerformanceOptimizer {
    if (!performanceOptimizer) {
        performanceOptimizer = new PerformanceOptimizer();
    }
    return performanceOptimizer;
}

// Utility functions for common performance patterns

/**
 * Debounce function calls
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | null = null;

    return (...args: Parameters<T>) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), delay);
    };
}

/**
 * Memoize expensive function calls
 */
export function memoize<T extends (...args: any[]) => any>(
    func: T,
    keyGenerator?: (...args: Parameters<T>) => string
): T {
    const cache = new Map<string, ReturnType<T>>();

    return ((...args: Parameters<T>): ReturnType<T> => {
        const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args);

        if (cache.has(key)) {
            return cache.get(key)!;
        }

        const result = func(...args);
        cache.set(key, result);
        return result;
    }) as T;
}

/**
 * Lazy loading wrapper
 */
export class LazyLoader<T> {
    private value: T | null = null;
    private loader: () => Promise<T>;
    private loading = false;
    private loadPromise: Promise<T> | null = null;

    constructor(loader: () => Promise<T>) {
        this.loader = loader;
    }

    async get(): Promise<T> {
        if (this.value !== null) {
            return this.value;
        }

        if (this.loading) {
            return this.loadPromise!;
        }

        this.loading = true;
        this.loadPromise = this.loader().then(value => {
            this.value = value;
            this.loading = false;
            return value;
        }).catch(error => {
            this.loading = false;
            throw error;
        });

        return this.loadPromise;
    }

    reset(): void {
        this.value = null;
        this.loading = false;
        this.loadPromise = null;
    }

    isLoaded(): boolean {
        return this.value !== null;
    }
}