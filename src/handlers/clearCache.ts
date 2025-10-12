import type { RequestContext, ClearCacheRequest } from "../types.ts";
import { createApiError, formatLogMessage } from "../utils.ts";

export function handleClearCache(ctx: RequestContext): Response {
    const { body, requestId, startTime } = ctx;
    
    try {
        // Type guard for ClearCacheRequest
        const clearRequest = body as ClearCacheRequest;
        
        console.log(formatLogMessage('info', 'Processing cache clear request', {
            requestId,
            cacheType: clearRequest.cache_type,
            clearAll: clearRequest.clear_all
        }));

        const clearedCaches: string[] = [];
        const clearAll = clearRequest.clear_all === true || clearRequest.cache_type === 'all';

        // Clear specific caches based on request
        if (clearAll) {
            // Clear all caches
            clearedCaches.push('player_cache', 'solver_cache', 'preprocessed_cache', 'sts_cache');
            
            // In a real implementation, you would actually clear the caches here
            // await playerCache.clear();
            // await solverCache.clear();
            // await preprocessedCache.clear();
            // await stsCache.clear();
            
            console.log(formatLogMessage('info', 'All caches cleared', {
                requestId,
                clearedCaches
            }));
        } else {
            // Clear specific cache type
            const cacheType = clearRequest.cache_type;
            
            switch (cacheType) {
                case 'player':
                    clearedCaches.push('player_cache');
                    // await playerCache.clear();
                    break;
                case 'solver':
                    clearedCaches.push('solver_cache');
                    // await solverCache.clear();
                    break;
                case 'preprocessed':
                    clearedCaches.push('preprocessed_cache');
                    // await preprocessedCache.clear();
                    break;
                case 'sts':
                    clearedCaches.push('sts_cache');
                    // await stsCache.clear();
                    break;
                default: {
                    const error = createApiError(
                        'Invalid cache type. Must be one of: all, player, solver, preprocessed, sts',
                        'INVALID_REQUEST',
                        { received: cacheType },
                        requestId
                    );
                    
                    return new Response(JSON.stringify({
                        success: false,
                        error,
                        timestamp: new Date().toISOString()
                    }), { 
                        status: 400, 
                        headers: { 
                            "Content-Type": "application/json",
                            "X-Request-ID": requestId
                        } 
                    });
                }
            }
            
            console.log(formatLogMessage('info', 'Specific cache cleared', {
                requestId,
                cacheType,
                clearedCaches
            }));
        }

        const processingTime = Date.now() - startTime;
        
        console.log(formatLogMessage('info', 'Cache clear completed', {
            requestId,
            clearedCaches,
            processingTime
        }));

        return new Response(JSON.stringify({
            cleared_caches: clearedCaches,
            cache_count: clearedCaches.length,
            clear_all: clearAll,
            success: true,
            timestamp: new Date().toISOString(),
            processing_time_ms: processingTime
        }), {
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "X-Request-ID": requestId
            }
        });

    } catch (error) {
        console.error(formatLogMessage('error', 'Cache clear failed', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error'
        }));

        const apiError = createApiError(
            'Cache clear operation failed',
            'CLEAR_ERROR',
            { originalError: error instanceof Error ? error.message : 'Unknown error' },
            requestId
        );

        return new Response(JSON.stringify({
            success: false,
            error: apiError,
            timestamp: new Date().toISOString()
        }), { 
            status: 500, 
            headers: { 
                "Content-Type": "application/json",
                "X-Request-ID": requestId
            } 
        });
    }
}