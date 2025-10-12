import { InstrumentedLRU } from "./instrumentedCache.ts";
import type { Solvers, CacheConfig } from "./types.ts";

// Configuration for solver cache
const cacheSizeEnv = Deno.env.get('SOLVER_CACHE_SIZE');
const ttlEnv = Deno.env.get('SOLVER_CACHE_TTL');
const cleanupIntervalEnv = Deno.env.get('SOLVER_CACHE_CLEANUP_INTERVAL');

const config: CacheConfig = {
    maxSize: cacheSizeEnv ? parseInt(cacheSizeEnv, 10) : 50,
    ttl: ttlEnv ? parseInt(ttlEnv, 10) : 3600000, // 1 hour default
    cleanupInterval: cleanupIntervalEnv ? parseInt(cleanupIntervalEnv, 10) : 300000 // 5 minutes default
};

// key = hash of the player url
export const solverCache = new InstrumentedLRU<Solvers>('solver', config.maxSize, config);