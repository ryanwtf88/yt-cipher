import { InstrumentedLRU } from "./instrumentedCache.ts";
import type { CacheConfig } from "./types.ts";

// Configuration for preprocessed cache
const cacheSizeEnv = Deno.env.get('PREPROCESSED_CACHE_SIZE');
const ttlEnv = Deno.env.get('PREPROCESSED_CACHE_TTL');
const cleanupIntervalEnv = Deno.env.get('PREPROCESSED_CACHE_CLEANUP_INTERVAL');

const config: CacheConfig = {
    maxSize: cacheSizeEnv ? parseInt(cacheSizeEnv, 10) : 150,
    ttl: ttlEnv ? parseInt(ttlEnv, 10) : 7200000, // 2 hours default (preprocessed content is more stable)
    cleanupInterval: cleanupIntervalEnv ? parseInt(cleanupIntervalEnv, 10) : 300000 // 5 minutes default
};

// The key is the hash of the player URL, and the value is the preprocessed script content.
export const preprocessedCache = new InstrumentedLRU<string>('preprocessed', config.maxSize, config);