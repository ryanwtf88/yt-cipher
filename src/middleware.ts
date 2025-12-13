import { extractPlayerId, generateRequestId, formatLogMessage } from "./utils.ts";
import {
    endpointHits,
    responseCodes,
    endpointLatency,
    rateLimitHits,
    rateLimitRejections,
    requestSize,
    responseSize,
    errors as _errors,
    recordError
} from "./metrics.ts";
import type { RequestContext, RateLimitConfig } from "./types.ts";

export type Next = (ctx: RequestContext) => Response | Promise<Response>;

// Rate limiting store
class RateLimitStore {
    private store = new Map<string, { count: number; resetTime: number }>();
    private cleanupInterval: number;

    constructor(cleanupIntervalMs: number = 60000) {
        this.cleanupInterval = cleanupIntervalMs;
        this.startCleanup();
    }

    private startCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [key, value] of this.store.entries()) {
                if (now > value.resetTime) {
                    this.store.delete(key);
                }
            }
        }, this.cleanupInterval);
    }

    get(key: string): { count: number; resetTime: number } | undefined {
        const entry = this.store.get(key);
        if (entry && Date.now() > entry.resetTime) {
            this.store.delete(key);
            return undefined;
        }
        return entry;
    }

    set(key: string, count: number, resetTime: number) {
        this.store.set(key, { count, resetTime });
    }

    increment(key: string, windowMs: number): { count: number; resetTime: number } {
        const now = Date.now();
        const entry = this.get(key);

        if (!entry) {
            const resetTime = now + windowMs;
            this.set(key, 1, resetTime);
            return { count: 1, resetTime };
        }

        const newCount = entry.count + 1;
        this.set(key, newCount, entry.resetTime);
        return { count: newCount, resetTime: entry.resetTime };
    }
}

const rateLimitStore = new RateLimitStore();

// Default rate limit configuration
const defaultRateLimitConfig: RateLimitConfig = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100,
    skipSuccessfulRequests: false,
    skipFailedRequests: false
};

// Get client IP from request
function getClientIp(req: Request): string {
    const forwarded = req.headers.get('X-Forwarded-For');
    const realIp = req.headers.get('X-Real-IP');
    const cfConnectingIp = req.headers.get('CF-Connecting-IP');

    if (cfConnectingIp) return cfConnectingIp;
    if (realIp) return realIp;
    if (forwarded) return forwarded.split(',')[0].trim();

    return 'unknown';
}

// Rate limiting middleware
function withRateLimit(config: RateLimitConfig = defaultRateLimitConfig) {
    return (handler: Next): Next => {
        return (ctx: RequestContext) => {
            const clientIp = getClientIp(ctx.req);
            const userAgent = ctx.req.headers.get('User-Agent') || 'unknown';
            const { pathname } = new URL(ctx.req.url);

            const rateLimitKey = `${clientIp}:${pathname}`;
            const { count, resetTime } = rateLimitStore.increment(rateLimitKey, config.windowMs);

            // Record rate limit hit
            rateLimitHits.labels({
                client_ip: clientIp,
                user_agent: userAgent,
                endpoint: pathname
            }).inc();

            if (count > config.maxRequests) {
                const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);

                // Record rate limit rejection
                rateLimitRejections.labels({
                    client_ip: clientIp,
                    user_agent: userAgent,
                    endpoint: pathname,
                    reason: 'limit_exceeded'
                }).inc();

                return new Response(JSON.stringify({
                    success: false,
                    error: {
                        error: 'Rate limit exceeded',
                        code: 'RATE_LIMIT_EXCEEDED',
                        details: {
                            limit: config.maxRequests,
                            remaining: 0,
                            reset: resetTime,
                            retryAfter
                        },
                        timestamp: new Date().toISOString(),
                        request_id: ctx.requestId
                    },
                    timestamp: new Date().toISOString()
                }), {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': retryAfter.toString(),
                        'X-RateLimit-Limit': config.maxRequests.toString(),
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': resetTime.toString(),
                        'X-Request-ID': ctx.requestId
                    }
                });
            }

            // Add rate limit info to context
            ctx.rateLimitInfo = {
                limit: config.maxRequests,
                remaining: Math.max(0, config.maxRequests - count),
                reset: resetTime
            };

            return handler(ctx);
        };
    };
}

// Error handling middleware
function withErrorHandling(handler: Next): Next {
    return async (ctx: RequestContext) => {
        try {
            return await handler(ctx);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : undefined;

            // Record error metrics
            recordError(
                'middleware_error',
                'INTERNAL_ERROR',
                new URL(ctx.req.url).pathname,
                'error'
            );

            console.error(formatLogMessage('error', 'Middleware error', {
                requestId: ctx.requestId,
                error: errorMessage,
                stack: errorStack,
                url: ctx.req.url,
                method: ctx.req.method
            }));

            return new Response(JSON.stringify({
                success: false,
                error: {
                    error: 'Internal server error',
                    code: 'INTERNAL_ERROR',
                    details: { message: errorMessage },
                    timestamp: new Date().toISOString(),
                    request_id: ctx.requestId
                },
                timestamp: new Date().toISOString()
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-ID': ctx.requestId
                }
            });
        }
    };
}

// Request logging middleware
function withLogging(handler: Next): Next {
    return async (ctx: RequestContext) => {
        const startTime = performance.now();
        const { pathname } = new URL(ctx.req.url);
        const method = ctx.req.method;
        const userAgent = ctx.req.headers.get('User-Agent') || 'unknown';
        const clientIp = getClientIp(ctx.req);

        // Only log requests for non-health endpoints and errors
        const shouldLog = pathname !== '/health' && pathname !== '/metrics';

        if (shouldLog) {
            console.log(formatLogMessage('debug', 'Request started', {
                requestId: ctx.requestId,
                method,
                pathname,
                clientIp,
                userAgent: userAgent.substring(0, 50) // Truncate long user agents
            }));
        }

        const response = await handler(ctx);

        const duration = performance.now() - startTime;
        const responseSizeBytes = response.headers.get('Content-Length') ?
            parseInt(response.headers.get('Content-Length')!) : 0;

        // Only log completed requests for errors or if debug logging is enabled
        if (shouldLog && (response.status >= 400 || Deno.env.get("LOG_LEVEL") === "debug")) {
            console.log(formatLogMessage('info', 'Request completed', {
                requestId: ctx.requestId,
                method,
                pathname,
                status: response.status,
                duration: `${duration.toFixed(2)}ms`,
                responseSize: responseSizeBytes,
                clientIp
            }));
        }

        return response;
    };
}

// Enhanced metrics middleware
export function withMetrics(handler: Next): Next {
    return async (ctx: RequestContext) => {
        const { pathname } = new URL(ctx.req.url);
        const playerId = 'player_url' in ctx.body ? extractPlayerId(ctx.body.player_url) : 'unknown';
        const pluginVersion = ctx.req.headers.get("Plugin-Version") ?? "unknown";
        const userAgent = ctx.req.headers.get("User-Agent") ?? "unknown";
        const clientIp = getClientIp(ctx.req);

        // Record request metrics
        endpointHits.labels({
            method: ctx.req.method,
            pathname,
            player_id: playerId,
            plugin_version: pluginVersion,
            user_agent: userAgent,
            client_ip: clientIp
        }).inc();

        // Record request size
        const contentLength = ctx.req.headers.get('Content-Length');
        if (contentLength) {
            requestSize.labels({
                method: ctx.req.method,
                pathname
            }).observe(parseInt(contentLength));
        }

        const start = performance.now();
        let response: Response;

        try {
            response = await handler(ctx);
        } catch (error) {
            // Record error metrics
            recordError(
                'handler_error',
                'HANDLER_ERROR',
                pathname,
                'error'
            );
            throw error;
        }

        const duration = (performance.now() - start) / 1000;
        const cached = response.headers.get("X-Cache-Hit") === "true" ? "true" : "false";
        const endpointType = getEndpointType(pathname);

        // Record response metrics
        endpointLatency.labels({
            method: ctx.req.method,
            pathname,
            player_id: playerId,
            cached,
            endpoint_type: endpointType
        }).observe(duration);

        responseCodes.labels({
            method: ctx.req.method,
            pathname,
            status: String(response.status),
            player_id: playerId,
            plugin_version: pluginVersion,
            user_agent: userAgent,
            client_ip: clientIp
        }).inc();


        // Record response size
        const responseContentLength = response.headers.get('Content-Length');
        if (responseContentLength) {
            responseSize.labels({
                method: ctx.req.method,
                pathname,
                status: String(response.status)
            }).observe(parseInt(responseContentLength));
        }

        return response;
    };
}

// Helper function to determine endpoint type
function getEndpointType(pathname: string): string {
    if (pathname.includes('decrypt')) return 'signature';
    if (pathname.includes('sts')) return 'sts';
    if (pathname.includes('resolve')) return 'url';
    if (pathname.includes('health')) return 'health';
    if (pathname.includes('metrics')) return 'metrics';
    return 'unknown';
}

// CORS middleware
function withCORS(handler: Next): Next {
    return async (ctx: RequestContext) => {
        const { pathname: _pathname } = new URL(ctx.req.url);
        const method = ctx.req.method;

        // Handle preflight OPTIONS requests
        if (method === 'OPTIONS') {
            return new Response(null, {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID, User-Agent, Accept',
                    'Access-Control-Max-Age': '86400',
                    'Access-Control-Allow-Credentials': 'false'
                }
            });
        }

        const response = await handler(ctx);

        // Add CORS headers to all responses
        response.headers.set('Access-Control-Allow-Origin', '*');
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID, User-Agent, Accept');
        response.headers.set('Access-Control-Max-Age', '86400');
        response.headers.set('Access-Control-Allow-Credentials', 'false');

        return response;
    };
}

// Security headers middleware
function withSecurityHeaders(handler: Next): Next {
    return async (ctx: RequestContext) => {
        const response = await handler(ctx);

        // Add security headers
        response.headers.set('X-Content-Type-Options', 'nosniff');
        response.headers.set('X-Frame-Options', 'DENY');
        response.headers.set('X-XSS-Protection', '1; mode=block');
        response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

        return response;
    };
}

// Authentication middleware for Lavalink integration
export function withAuth(handler: Next): Next {
    return async (ctx: RequestContext) => {
        const { pathname } = new URL(ctx.req.url);
        const _method = ctx.req.method;

        // Skip auth for health and metrics endpoints
        if (pathname === '/health' || pathname === '/metrics' || pathname === '/status' || pathname === '/api/docs') {
            return await handler(ctx);
        }

        // Check for API token authentication (Lavalink style)
        const authHeader = ctx.req.headers.get('Authorization');
        const apiToken = Deno.env.get("RY4N");

        if (apiToken) {
            let isValidAuth = false;

            // Check Bearer token format
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                if (token === apiToken) {
                    isValidAuth = true;
                }
            }

            // Check Basic auth format (for Lavalink compatibility)
            if (!isValidAuth && authHeader && authHeader.startsWith('Basic ')) {
                try {
                    const encoded = authHeader.substring(6);
                    const decoded = atob(encoded);
                    const [_username, password] = decoded.split(':');
                    if (password === apiToken) {
                        isValidAuth = true;
                    }
                } catch (_e) {
                    // Invalid base64, continue to error
                }
            }

            // Check direct password in Authorization header (fallback)
            if (!isValidAuth && authHeader && authHeader === apiToken) {
                isValidAuth = true;
            }

            if (!isValidAuth) {
                return new Response(JSON.stringify({
                    success: false,
                    error: {
                        error: 'Authentication required',
                        code: 'AUTH_REQUIRED',
                        details: 'API token authentication required for this endpoint',
                        timestamp: new Date().toISOString(),
                        request_id: ctx.requestId
                    }
                }), {
                    status: 401,
                    headers: {
                        "Content-Type": "application/json",
                        "X-Request-ID": ctx.requestId
                    }
                });
            }

            const providedToken = authHeader!.substring(7); // Remove 'Bearer '
            if (providedToken !== apiToken) {
                return new Response(JSON.stringify({
                    success: false,
                    error: {
                        error: 'Invalid authentication',
                        code: 'AUTH_INVALID',
                        details: 'Invalid API token provided',
                        timestamp: new Date().toISOString(),
                        request_id: ctx.requestId
                    }
                }), {
                    status: 401,
                    headers: {
                        "Content-Type": "application/json",
                        "X-Request-ID": ctx.requestId
                    }
                });
            }
        } else {
            // No API token configured, allow all requests (development mode)
            console.log(formatLogMessage('warn', 'No API token configured, allowing all requests', {
                requestId: ctx.requestId,
                pathname
            }));
        }

        return await handler(ctx);
    };
}

// Request ID middleware
function withRequestId(handler: Next): Next {
    return async (ctx: RequestContext) => {
        // Ensure request ID is set
        if (!ctx.requestId) {
            ctx.requestId = generateRequestId();
        }

        const response = await handler(ctx);

        // Add request ID to response headers
        response.headers.set('X-Request-ID', ctx.requestId);

        return response;
    };
}

// Compose all middleware
export function composeMiddleware(
    handler: Next,
    options: {
        enableAuth?: boolean;
        enableRateLimit?: boolean;
        enableLogging?: boolean;
        enableCORS?: boolean;
        enableSecurityHeaders?: boolean;
        rateLimitConfig?: RateLimitConfig;
    } = {}
): Next {
    const {
        enableAuth = true,
        enableRateLimit = true,
        enableLogging = true,
        enableCORS = true,
        enableSecurityHeaders = true,
        rateLimitConfig = defaultRateLimitConfig
    } = options;

    let composed = handler;

    // Add authentication first
    if (enableAuth) {
        composed = withAuth(composed);
    }

    // Apply middleware in reverse order (last applied is first executed)
    if (enableSecurityHeaders) {
        composed = withSecurityHeaders(composed);
    }

    if (enableCORS) {
        composed = withCORS(composed);
    }

    composed = withRequestId(composed);
    composed = withErrorHandling(composed);
    composed = withMetrics(composed);

    if (enableLogging) {
        composed = withLogging(composed);
    }

    if (enableRateLimit) {
        composed = withRateLimit(rateLimitConfig)(composed);
    }

    return composed;
}

// Export individual middleware functions
export {
    withRateLimit,
    withErrorHandling,
    withLogging,
    withCORS,
    withSecurityHeaders,
    withRequestId
};
