import { 
    cacheSize, 
    cacheHits, 
    cacheMisses, 
    cacheOperations, 
    cacheLatency,
    recordCacheOperation
} from "./metrics.ts";
import { LRU } from "https://deno.land/x/lru@1.0.2/mod.ts";
import type { CacheStats, CacheConfig } from "./types.ts";
import { measureTime, formatLogMessage } from "./utils.ts";

export class InstrumentedLRU<T> extends LRU<T> {
    private hits: number = 0;
    private misses: number = 0;
    private operations: number = 0;
    private errors: number = 0;
    private lastCleanup: number = Date.now();
    private cleanupInterval: number;
    private ttl: number;
    private entries: Map<string, { value: T; timestamp: number }> = new Map();

    constructor(
        private cacheName: string, 
        maxSize: number,
        config: Partial<CacheConfig> = {}
    ) {
        super(maxSize);
        this.cleanupInterval = config.cleanupInterval || 300000; // 5 minutes default
        this.ttl = config.ttl || 3600000; // 1 hour default
        this.startCleanupTimer();
    }

    private startCleanupTimer() {
        setInterval(() => {
            this.cleanup();
        }, this.cleanupInterval);
    }

    private cleanup() {
        const now = Date.now();
        const expiredKeys: string[] = [];
        
        for (const [key, entry] of this.entries.entries()) {
            if (now - entry.timestamp > this.ttl) {
                expiredKeys.push(key);
            }
        }
        
        for (const key of expiredKeys) {
            this.delete(key);
        }
        
        this.lastCleanup = now;
        
        if (expiredKeys.length > 0) {
            console.log(formatLogMessage('info', `Cache cleanup completed`, {
                cacheName: this.cacheName,
                expiredKeys: expiredKeys.length,
                remainingSize: this.size
            }));
        }
    }

    private recordOperation(operation: string, success: boolean, duration: number) {
        this.operations++;
        if (!success) this.errors++;
        
        recordCacheOperation(this.cacheName, operation, success ? 'success' : 'error', duration);
        cacheOperations.labels({ 
            cache_name: this.cacheName, 
            operation, 
            status: success ? 'success' : 'error' 
        }).inc();
    }

    private updateMetrics() {
        cacheSize.labels({ cache_name: this.cacheName, cache_type: 'lru' }).set(this.size);
        cacheHits.labels({ cache_name: this.cacheName, cache_type: 'lru' }).inc(this.hits);
        cacheMisses.labels({ cache_name: this.cacheName, cache_type: 'lru' }).inc(this.misses);
    }

    override get(key: string): T | undefined {
        const { result, duration } = measureTime(() => {
            // Check TTL first
            const entry = this.entries.get(key);
            if (entry) {
                const now = Date.now();
                if (now - entry.timestamp > this.ttl) {
                    this.delete(key);
                    return undefined;
                }
            }
            
            return super.get(key);
        });

        if (result !== undefined) {
            this.hits++;
            cacheHits.labels({ cache_name: this.cacheName, cache_type: 'lru' }).inc();
        } else {
            this.misses++;
            cacheMisses.labels({ cache_name: this.cacheName, cache_type: 'lru' }).inc();
        }

        this.recordOperation('get', true, duration);
        return result;
    }

    override set(key: string, value: T): this {
        const { duration } = measureTime(() => {
            const now = Date.now();
            this.entries.set(key, { value, timestamp: now });
            super.set(key, value);
        });

        this.recordOperation('set', true, duration);
        this.updateMetrics();
        return this;
    }

    delete(key: string): boolean {
        const { result, duration } = measureTime(() => {
            this.entries.delete(key);
            return super.remove(key);
        });

        this.recordOperation('delete', true, duration);
        this.updateMetrics();
        return Boolean(result);
    }

    override clear(): void {
        const { duration } = measureTime(() => {
            this.entries.clear();
            this.hits = 0;
            this.misses = 0;
            this.operations = 0;
            this.errors = 0;
            super.clear();
        });

        this.recordOperation('clear', true, duration);
        this.updateMetrics();
    }

    override has(key: string): boolean {
        const { result, duration } = measureTime(() => {
            // Check TTL first
            const entry = this.entries.get(key);
            if (entry) {
                const now = Date.now();
                if (now - entry.timestamp > this.ttl) {
                    this.delete(key);
                    return false;
                }
            }
            
            return super.has(key);
        });

        this.recordOperation('has', true, duration);
        return result;
    }

    // Get cache statistics
    getStats(): CacheStats {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            size: this.size,
            maxSize: (this as any).maxSize,
            hitRate: total > 0 ? (this.hits / total) * 100 : 0
        };
    }

    // Get detailed cache information
    getInfo() {
        return {
            name: this.cacheName,
            stats: this.getStats(),
            operations: this.operations,
            errors: this.errors,
            errorRate: this.operations > 0 ? (this.errors / this.operations) * 100 : 0,
            lastCleanup: this.lastCleanup,
            ttl: this.ttl,
            cleanupInterval: this.cleanupInterval
        };
    }

    // Force cleanup
    forceCleanup(): number {
        const beforeSize = this.size;
        this.cleanup();
        return beforeSize - this.size;
    }

    // Update TTL for a specific key
    touch(key: string): boolean {
        const entry = this.entries.get(key);
        if (entry) {
            entry.timestamp = Date.now();
            return true;
        }
        return false;
    }

    // Get all keys (for debugging)
    getKeys(): string[] {
        return Array.from(this.entries.keys());
    }

    // Get cache size by memory usage (approximate)
    getMemoryUsage(): number {
        let totalSize = 0;
        for (const [key, entry] of this.entries.entries()) {
            totalSize += key.length * 2; // Approximate string size
            totalSize += JSON.stringify(entry.value).length * 2; // Approximate value size
        }
        return totalSize;
    }
}