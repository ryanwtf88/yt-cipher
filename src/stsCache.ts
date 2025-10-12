import { InstrumentedLRU } from "./instrumentedCache.ts";
import type { CacheConfig } from "./types.ts";

// Configuration for STS cache
const cacheSizeEnv = Deno.env.get('STS_CACHE_SIZE');
const ttlEnv = Deno.env.get('STS_CACHE_TTL');
const cleanupIntervalEnv = Deno.env.get('STS_CACHE_CLEANUP_INTERVAL');

const config: CacheConfig = {
    maxSize: cacheSizeEnv ? parseInt(cacheSizeEnv, 10) : 150,
    ttl: ttlEnv ? parseInt(ttlEnv, 10) : 1800000, // 30 minutes default (STS values change more frequently)
    cleanupInterval: cleanupIntervalEnv ? parseInt(cleanupIntervalEnv, 10) : 300000 // 5 minutes default
};

// key = hash of player URL
export const stsCache = new InstrumentedLRU<string>('sts', config.maxSize, config);