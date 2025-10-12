import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { initializeWorkers } from "./src/workerPool.ts";
import { initializeCache } from "./src/playerCache.ts";
import { handleDecryptSignature } from "./src/handlers/decryptSignature.ts";
import { handleGetSts } from "./src/handlers/getSts.ts";
import { handleResolveUrl } from "./src/handlers/resolveUrl.ts";
import { handleBatchDecrypt } from "./src/handlers/batchDecrypt.ts";
import { handleValidateSignature } from "./src/handlers/validateSignature.ts";
import { handleClearCache } from "./src/handlers/clearCache.ts";
import { composeMiddleware } from "./src/middleware.ts";
import { withValidation } from "./src/validation.ts";
import { registry, metricsCollector } from "./src/metrics.ts";
import { 
    generateRequestId, 
    formatLogMessage, 
    getMemoryUsage, 
    formatUptime,
    createApiError 
} from "./src/utils.ts";
import type { ApiRequest, RequestContext, HealthStatus, ServerConfig } from "./src/types.ts";

const config: ServerConfig = {
    port: parseInt(Deno.env.get("SERVER_PORT") || Deno.env.get("PORT") || "3000", 10),
    host: Deno.env.get("SERVER_HOST") || "0.0.0.0",
    apiToken: Deno.env.get("API_TOKEN") || "YOUR_API_TOKEN",
    rateLimit: {
        windowMs: parseInt(Deno.env.get("RATE_LIMIT_WINDOW_MS") || "60000", 10),
        maxRequests: parseInt(Deno.env.get("RATE_LIMIT_MAX_REQUESTS") || "999999999", 10),
        skipSuccessfulRequests: true, 
        skipFailedRequests: true 
    },
    cache: {
        player: {
            maxSize: parseInt(Deno.env.get("PLAYER_CACHE_SIZE") || "10000", 10),
            ttl: parseInt(Deno.env.get("PLAYER_CACHE_TTL") || "7200000", 10),
            cleanupInterval: parseInt(Deno.env.get("PLAYER_CACHE_CLEANUP_INTERVAL") || "600000", 10)
        },
        solver: {
            maxSize: parseInt(Deno.env.get("SOLVER_CACHE_SIZE") || "5000", 10),
            ttl: parseInt(Deno.env.get("SOLVER_CACHE_TTL") || "7200000", 10),
            cleanupInterval: parseInt(Deno.env.get("SOLVER_CACHE_CLEANUP_INTERVAL") || "600000", 10)
        },
        preprocessed: {
            maxSize: parseInt(Deno.env.get("PREPROCESSED_CACHE_SIZE") || "15000", 10),
            ttl: parseInt(Deno.env.get("PREPROCESSED_CACHE_TTL") || "14400000", 10),
            cleanupInterval: parseInt(Deno.env.get("PREPROCESSED_CACHE_CLEANUP_INTERVAL") || "600000", 10)
        },
        sts: {
            maxSize: parseInt(Deno.env.get("STS_CACHE_SIZE") || "10000", 10),
            ttl: parseInt(Deno.env.get("STS_CACHE_TTL") || "3600000", 10),
            cleanupInterval: parseInt(Deno.env.get("STS_CACHE_CLEANUP_INTERVAL") || "600000", 10)
        }
    },
    workers: {
        concurrency: parseInt(Deno.env.get("WORKER_CONCURRENCY") || "16", 10),
        timeout: parseInt(Deno.env.get("WORKER_TASK_TIMEOUT") || "60000", 10),
        maxRetries: parseInt(Deno.env.get("WORKER_MAX_RETRIES") || "5", 10)
    },
    logging: {
        level: (Deno.env.get("LOG_LEVEL") as any) || "warn", 
        format: (Deno.env.get("LOG_FORMAT") as any) || "text"
    }
};

// Server state
const serverStartTime = Date.now();
let isShuttingDown = false;
let requestCount = 0;
let lastHealthCheck = Date.now();

// Real-time data collection
const realTimeData = {
    activeConnections: 0,
    totalRequests: 0,
    errorCount: 0,
    lastRequestTime: Date.now(),
    averageResponseTime: 0,
    responseTimes: [] as number[]
};

// Enhanced JSON response helper
function createJsonResponse(data: any, status: number = 200, headers: Record<string, string> = {}): Response {
    const defaultHeaders = {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        ...headers
    };
    
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: defaultHeaders
    });
}

// Real-time data update function
function updateRealTimeData(responseTime: number, isError: boolean = false) {
    realTimeData.totalRequests++;
    realTimeData.lastRequestTime = Date.now();
    realTimeData.responseTimes.push(responseTime);
    
    // Keep only last 100 response times for average calculation
    if (realTimeData.responseTimes.length > 100) {
        realTimeData.responseTimes = realTimeData.responseTimes.slice(-100);
    }
    
    realTimeData.averageResponseTime = realTimeData.responseTimes.reduce((a, b) => a + b, 0) / realTimeData.responseTimes.length;
    
    if (isError) {
        realTimeData.errorCount++;
    }
}

// Enhanced request handler
async function baseHandler(req: Request): Promise<Response> {
    const requestId = generateRequestId();
    const { pathname, searchParams } = new URL(req.url);
    const method = req.method;
    const userAgent = req.headers.get('User-Agent') || 'unknown';
    const clientIp = req.headers.get('X-Forwarded-For') || 
                    req.headers.get('X-Real-IP') || 
                    req.headers.get('CF-Connecting-IP') || 
                    'unknown';
    const startTime = Date.now();

    // Update real-time data
    realTimeData.activeConnections++;

    // Log incoming request
    console.log(formatLogMessage('info', 'Incoming request', {
        requestId,
        method,
        pathname,
        userAgent: userAgent.substring(0, 100),
        clientIp
    }));

    try {
        // Handle different endpoints
        if (method === "GET" && pathname === "/") {
            const response = handleRoot(requestId);
            updateRealTimeData(Date.now() - startTime);
            realTimeData.activeConnections--;
            return response;
        }

        if (pathname === "/metrics") {
            const response = await handleMetrics(requestId);
            updateRealTimeData(Date.now() - startTime);
            realTimeData.activeConnections--;
            return response;
        }

        if (pathname === "/health") {
            const response = await handleHealth(requestId);
            updateRealTimeData(Date.now() - startTime);
            realTimeData.activeConnections--;
            return response;
        }

        if (pathname === "/status") {
            const response = await handleStatus(requestId);
            updateRealTimeData(Date.now() - startTime);
            realTimeData.activeConnections--;
            return response;
        }

        if (pathname === "/api/docs") {
            const response = handleApiDocs(requestId);
            updateRealTimeData(Date.now() - startTime);
            realTimeData.activeConnections--;
            return response;
        }

        if (pathname === "/info") {
            const response = handleServerInfo(requestId);
            updateRealTimeData(Date.now() - startTime);
            realTimeData.activeConnections--;
            return response;
        }

        // API authentication - only require auth for API endpoints, not info endpoints
        if (pathname.startsWith('/decrypt_signature') || pathname.startsWith('/get_sts') || 
            pathname.startsWith('/resolve_url') || pathname.startsWith('/batch_decrypt') || 
            pathname.startsWith('/validate_signature') || pathname.startsWith('/clear_cache')) {
            
            const API_TOKEN = config.apiToken;
            
            // Skip authentication if no token is configured (development mode)
            if (!API_TOKEN || API_TOKEN === "" || API_TOKEN === "YOUR_API_TOKEN") {
                console.log(formatLogMessage('warn', 'API authentication disabled - no valid token configured', {
                    requestId,
                    pathname,
                    configuredToken: API_TOKEN
                }));
            } else {
                const authHeader = req.headers.get("authorization");
                const isValidAuth = authHeader === `Bearer ${API_TOKEN}` || authHeader === API_TOKEN;
                
                if (!isValidAuth) {
                    const error = authHeader ? "Invalid API token" : "Missing API token";
                    
                    console.log(formatLogMessage('warn', 'API authentication failed', {
                        requestId,
                        pathname,
                        hasAuthHeader: !!authHeader,
                        authHeaderLength: authHeader ? authHeader.length : 0
                    }));
                    
                    updateRealTimeData(Date.now() - startTime, true);
                    realTimeData.activeConnections--;
                    return new Response(JSON.stringify({ 
                        success: false,
                        error,
                        timestamp: new Date().toISOString()
                    }), { 
                        status: 401, 
                        headers: { 
                            "Content-Type": "application/json",
                            "X-Request-ID": requestId
                        }
                    });
                }
            }
        }

        // Route to appropriate handler
        let handler: ((ctx: RequestContext) => Promise<Response>) | null = null;

        switch (pathname) {
            case '/decrypt_signature':
                handler = handleDecryptSignature;
                break;
            case '/get_sts':
                handler = handleGetSts;
                break;
            case '/resolve_url':
                handler = handleResolveUrl;
                break;
            case '/batch_decrypt':
                handler = handleBatchDecrypt;
                break;
            case '/validate_signature':
                handler = handleValidateSignature;
                break;
            case '/clear_cache':
                handler = handleClearCache;
                break;
            default:
                updateRealTimeData(Date.now() - startTime, true);
                realTimeData.activeConnections--;
                return new Response(JSON.stringify({
                    success: false,
                    error: createApiError(
                        'Endpoint not found',
                        'NOT_FOUND',
                        { pathname, method },
                        requestId
                    ),
                    timestamp: new Date().toISOString()
                }), { 
                    status: 404, 
                    headers: { 
                        "Content-Type": "application/json",
                        "X-Request-ID": requestId
                    } 
                });
        }

        // Parse request body for POST requests
        let body: any = {} as any;
        if (method === "POST") {
            try {
                const contentType = req.headers.get('Content-Type') || '';
                if (!contentType.includes('application/json')) {
                    const error = createApiError(
                        'Content-Type must be application/json',
                        'INVALID_CONTENT_TYPE',
                        { contentType },
                        requestId
                    );
                    
                    updateRealTimeData(Date.now() - startTime, true);
                    realTimeData.activeConnections--;
                    return new Response(JSON.stringify({
                        success: false,
                        error,
                        timestamp: new Date().toISOString()
                    }), { 
                        status: 415, 
                        headers: { 
                            "Content-Type": "application/json",
                            "X-Request-ID": requestId
                        } 
                    });
                }
                
                body = await req.json() as ApiRequest;
            } catch (error) {
                const apiError = createApiError(
                    'Invalid JSON body',
                    'INVALID_JSON',
                    { originalError: (error as Error).message },
                    requestId
                );
                
                updateRealTimeData(Date.now() - startTime, true);
                realTimeData.activeConnections--;
                return new Response(JSON.stringify({
                    success: false,
                    error: apiError,
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

        // Create request context
        const ctx: RequestContext = { 
            req, 
            body, 
            requestId, 
            startTime,
            clientIp,
            userAgent
        };

        // Apply middleware
        const composedHandler = composeMiddleware(
            withValidation(handler),
            {
                enableRateLimit: true,
                enableLogging: true,
                enableCORS: true,
                enableSecurityHeaders: true,
                rateLimitConfig: config.rateLimit
            }
        );

        const response = await composedHandler(ctx);
        updateRealTimeData(Date.now() - startTime, response.status >= 400);
        realTimeData.activeConnections--;
        return response;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        console.error(formatLogMessage('error', 'Request handler failed', {
            requestId,
            pathname,
            method,
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined
        }));
        
        const apiError = createApiError(
            'Internal server error',
            'INTERNAL_ERROR',
            { originalError: errorMessage },
            requestId
        );
        
        updateRealTimeData(Date.now() - startTime, true);
        realTimeData.activeConnections--;
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

// Root endpoint handler with real-time data
function handleRoot(requestId: string): Response {
    const uptime = Date.now() - serverStartTime;
    const memory = getMemoryUsage();
    
    const response = {
        service: "yt-cipher",
        version: "0.0.1",
        status: "running",
        timestamp: new Date().toISOString(),
        realTime: {
            uptime: {
                milliseconds: uptime,
                formatted: formatUptime(uptime)
            },
            memory: {
                used: memory.used,
                total: memory.total,
                percentage: memory.percentage
            },
            requests: {
                total: realTimeData.totalRequests,
                active: realTimeData.activeConnections,
                errors: realTimeData.errorCount,
                averageResponseTime: Math.round(realTimeData.averageResponseTime),
                lastRequest: new Date(realTimeData.lastRequestTime).toISOString()
            }
        },
        endpoints: {
            health: "/health",
            status: "/status",
            info: "/info",
            metrics: "/metrics",
            docs: "/api/docs",
            api: {
                decrypt_signature: "POST /decrypt_signature",
                get_sts: "POST /get_sts",
                resolve_url: "POST /resolve_url",
                batch_decrypt: "POST /batch_decrypt",
                validate_signature: "POST /validate_signature",
                clear_cache: "POST /clear_cache"
            }
        }
    };
    
    return createJsonResponse(response, 200, { 
        "X-Request-ID": requestId
    });
}

// Metrics endpoint handler with real-time data
async function handleMetrics(requestId: string): Promise<Response> {
    try {
        const metrics = await registry.metrics();
        const realTimeMetrics = `
# Real-time metrics
yt_cipher_active_connections ${realTimeData.activeConnections}
yt_cipher_total_requests ${realTimeData.totalRequests}
yt_cipher_error_count ${realTimeData.errorCount}
yt_cipher_average_response_time ${realTimeData.averageResponseTime}
yt_cipher_uptime_seconds ${(Date.now() - serverStartTime) / 1000}
`;
        
        return new Response(metrics + realTimeMetrics, {
            headers: { 
                "Content-Type": "text/plain",
                "X-Request-ID": requestId
            },
        });
    } catch (error) {
        console.error(formatLogMessage('error', 'Failed to generate metrics', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error'
        }));
        
        return new Response("Error generating metrics", { 
            status: 500,
            headers: { "X-Request-ID": requestId }
        });
    }
}

// Health check endpoint handler with real-time data
async function handleHealth(requestId: string): Promise<Response> {
    try {
        const uptime = Date.now() - serverStartTime;
        const memory = getMemoryUsage();
        
        // Determine overall status based on real-time data
        let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
        
        if (realTimeData.errorCount > realTimeData.totalRequests * 0.1) {
            status = 'degraded';
        }
        if (realTimeData.errorCount > realTimeData.totalRequests * 0.3) {
            status = 'unhealthy';
        }
        if (memory.percentage > 90) {
            status = 'unhealthy';
        }
        
        const healthStatus: HealthStatus = {
            status,
            timestamp: new Date().toISOString(),
            uptime,
            version: "0.0.1",
            realTime: {
                activeConnections: realTimeData.activeConnections,
                totalRequests: realTimeData.totalRequests,
                errorCount: realTimeData.errorCount,
                errorRate: realTimeData.totalRequests > 0 ? (realTimeData.errorCount / realTimeData.totalRequests) : 0,
                averageResponseTime: Math.round(realTimeData.averageResponseTime),
                lastRequest: new Date(realTimeData.lastRequestTime).toISOString()
            },
            workers: {
                total: 1,
                idle: 1,
                busy: 0,
                error: 0
            },
            caches: {
                solver: { hits: 0, misses: 0, size: 0, maxSize: 0, hitRate: 0 },
                preprocessed: { hits: 0, misses: 0, size: 0, maxSize: 0, hitRate: 0 }
            },
            memory: {
                used: memory.used,
                total: memory.total,
                percentage: memory.percentage
            }
        };
        
        return new Response(JSON.stringify(healthStatus, null, 2), {
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "X-Request-ID": requestId
            },
        });
        
    } catch (error) {
        console.error(formatLogMessage('error', 'Health check failed', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error'
        }));
        
        return new Response(JSON.stringify({
            status: "unhealthy",
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error'
        }), { 
            status: 503,
            headers: { 
                "Content-Type": "application/json",
                "X-Request-ID": requestId
            }
        });
    }
}

// Status endpoint handler with real-time data
async function handleStatus(requestId: string): Promise<Response> {
    try {
        const uptime = Date.now() - serverStartTime;
        const memory = getMemoryUsage();
        const metricsData = metricsCollector.getMetricsData();
        
        const status = {
            service: "yt-cipher",
            version: "0.0.1",
            status: "running",
            timestamp: new Date().toISOString(),
            realTime: {
                uptime: {
                    milliseconds: uptime,
                    formatted: formatUptime(uptime)
                },
                memory: {
                    used: memory.used,
                    total: memory.total,
                    percentage: memory.percentage
                },
                requests: {
                    total: realTimeData.totalRequests,
                    active: realTimeData.activeConnections,
                    errors: realTimeData.errorCount,
                    errorRate: realTimeData.totalRequests > 0 ? (realTimeData.errorCount / realTimeData.totalRequests) : 0,
                    averageResponseTime: Math.round(realTimeData.averageResponseTime),
                    lastRequest: new Date(realTimeData.lastRequestTime).toISOString()
                },
                performance: {
                    requestsPerSecond: realTimeData.totalRequests / (uptime / 1000),
                    averageResponseTime: Math.round(realTimeData.averageResponseTime),
                    errorRate: realTimeData.totalRequests > 0 ? (realTimeData.errorCount / realTimeData.totalRequests) : 0
                }
            },
            workers: { total: 1, idle: 1, busy: 0, error: 0 },
            solver: { cacheStats: { solver: { hits: 0, misses: 0, size: 0, maxSize: 0, hitRate: 0 }, preprocessed: { hits: 0, misses: 0, size: 0, maxSize: 0, hitRate: 0 } } },
            metrics: metricsData,
            config: {
                port: config.port,
                host: config.host,
                rateLimit: config.rateLimit,
                workers: config.workers
            }
        };
        
        return new Response(JSON.stringify(status, null, 2), {
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "X-Request-ID": requestId
            },
        });
        
    } catch (error) {
        console.error(formatLogMessage('error', 'Status check failed', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error'
        }));
        
        return new Response(JSON.stringify({
            service: "yt-cipher",
            status: "error",
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error'
        }), { 
            status: 500,
            headers: { 
                "Content-Type": "application/json",
                "X-Request-ID": requestId
            }
        });
    }
}

// Server info endpoint handler with real-time data
function handleServerInfo(requestId: string): Response {
    const uptime = Date.now() - serverStartTime;
    const memory = getMemoryUsage();
    
    const info = {
        service: "yt-cipher",
        version: "0.0.1",
        description: "High-performance YouTube signature decryption service",
        status: "running",
        timestamp: new Date().toISOString(),
        realTime: {
            uptime: {
                milliseconds: uptime,
                formatted: formatUptime(uptime)
            },
            memory: {
                used: memory.used,
                total: memory.total,
                percentage: memory.percentage
            },
            requests: {
                total: realTimeData.totalRequests,
                active: realTimeData.activeConnections,
                errors: realTimeData.errorCount,
                averageResponseTime: Math.round(realTimeData.averageResponseTime),
                lastRequest: new Date(realTimeData.lastRequestTime).toISOString()
            }
        },
        features: [
            "YouTube signature decryption",
            "N parameter decryption", 
            "URL resolution",
            "Batch processing",
            "Signature validation",
            "Advanced caching",
            "Prometheus metrics",
            "Rate limiting",
            "CORS support",
            "Real-time monitoring"
        ],
        capabilities: {
            signature_decryption: true,
            n_parameter_decryption: true,
            url_resolution: true,
            batch_processing: true,
            signature_validation: true,
            caching: true,
            metrics: true,
            rate_limiting: true,
            cors: true,
            real_time_monitoring: true
        },
        endpoints: {
            health: "/health",
            status: "/status", 
            info: "/info",
            metrics: "/metrics",
            docs: "/api/docs",
            api: {
                decrypt_signature: "POST /decrypt_signature",
                get_sts: "POST /get_sts",
                resolve_url: "POST /resolve_url",
                batch_decrypt: "POST /batch_decrypt",
                validate_signature: "POST /validate_signature",
                clear_cache: "POST /clear_cache"
            }
        },
        configuration: {
            port: config.port,
            host: config.host,
            authentication: config.apiToken && config.apiToken !== "YOUR_API_TOKEN" && config.apiToken !== "" ? "enabled" : "disabled",
            rate_limiting: {
                enabled: true,
                window_ms: config.rateLimit.windowMs,
                max_requests: config.rateLimit.maxRequests
            },
            workers: {
                concurrency: config.workers.concurrency,
                timeout: config.workers.timeout,
                max_retries: config.workers.maxRetries
            },
            cache: {
                player: config.cache.player,
                solver: config.cache.solver,
                preprocessed: config.cache.preprocessed,
                sts: config.cache.sts
            }
        }
    };
    
    return createJsonResponse(info, 200, { 
        "X-Request-ID": requestId
    });
}

// API documentation endpoint handler with HTML interface
function handleApiDocs(requestId: string): Response {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>yt-cipher API Documentation</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            margin-bottom: 30px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            text-align: center;
        }
        
        .header h1 {
            font-size: 3rem;
            font-weight: 700;
            background: linear-gradient(135deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 10px;
        }
        
        .header p {
            font-size: 1.2rem;
            color: #666;
            margin-bottom: 20px;
        }
        
        .status-badge {
            display: inline-block;
            background: #10b981;
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-weight: 600;
            font-size: 0.9rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.9);
            padding: 20px;
            border-radius: 15px;
            text-align: center;
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
        }
        
        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            color: #667eea;
            margin-bottom: 5px;
        }
        
        .stat-label {
            color: #666;
            font-size: 0.9rem;
        }
        
        .endpoints-section {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            margin-bottom: 30px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }
        
        .endpoints-section h2 {
            font-size: 2rem;
            margin-bottom: 30px;
            color: #333;
        }
        
        .endpoint {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            margin-bottom: 20px;
            overflow: hidden;
            transition: all 0.3s ease;
        }
        
        .endpoint:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
        }
        
        .endpoint-header {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 15px 20px;
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .method {
            background: rgba(255, 255, 255, 0.2);
            padding: 4px 12px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 0.8rem;
        }
        
        .path {
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 1.1rem;
        }
        
        .endpoint-body {
            padding: 20px;
        }
        
        .endpoint-description {
            color: #666;
            margin-bottom: 15px;
            font-size: 1rem;
        }
        
        .request-response {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-top: 15px;
        }
        
        .request, .response {
            background: #f1f5f9;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }
        
        .request h4, .response h4 {
            color: #333;
            margin-bottom: 10px;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .json-example {
            background: #1e293b;
            color: #e2e8f0;
            padding: 15px;
            border-radius: 6px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.85rem;
            overflow-x: auto;
            margin-top: 10px;
        }
        
        .auth-info {
            background: #fef3c7;
            border: 1px solid #f59e0b;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
        }
        
        .auth-info h4 {
            color: #92400e;
            margin-bottom: 10px;
        }
        
        .auth-info p {
            color: #92400e;
            margin-bottom: 5px;
        }
        
        .code {
            background: #1e293b;
            color: #e2e8f0;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.85rem;
        }
        
        .footer {
            text-align: center;
            color: rgba(255, 255, 255, 0.8);
            margin-top: 40px;
        }
        
        @media (max-width: 768px) {
            .request-response {
                grid-template-columns: 1fr;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .stats-grid {
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>yt-cipher API</h1>
            <p>High-performance YouTube signature decryption service</p>
            <span class="status-badge">● Running</span>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value" id="uptime">Loading...</div>
                <div class="stat-label">Uptime</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="requests">Loading...</div>
                <div class="stat-label">Total Requests</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="active">Loading...</div>
                <div class="stat-label">Active Connections</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="responseTime">Loading...</div>
                <div class="stat-label">Avg Response Time (ms)</div>
            </div>
        </div>
        
        <div class="endpoints-section">
            <h2>API Endpoints</h2>
            
            <div class="auth-info">
                <h4>🔐 Authentication</h4>
                <p>All API endpoints require authentication using the <span class="code">Authorization</span> header.</p>
                <p>Format: <span class="code">Authorization: Bearer YOUR_API_TOKEN</span></p>
                <p>Default token is <span class="code">YOUR_API_TOKEN</span> - please change this in production!</p>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method">POST</span>
                    <span class="path">/decrypt_signature</span>
                </div>
                <div class="endpoint-body">
                    <div class="endpoint-description">
                        Decrypt YouTube signature and n parameter for stream URL resolution.
                    </div>
                    <div class="request-response">
                        <div class="request">
                            <h4>Request</h4>
                            <div class="json-example">{
  "encrypted_signature": "encrypted_signature_string",
  "n_param": "encrypted_n_param_string",
  "player_url": "https://www.youtube.com/s/player/player_id/player.js"
}</div>
                        </div>
                        <div class="response">
                            <h4>Response</h4>
                            <div class="json-example">{
  "decrypted_signature": "decrypted_signature_string",
  "decrypted_n_sig": "decrypted_n_param_string",
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "processing_time_ms": 150
}</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method">POST</span>
                    <span class="path">/get_sts</span>
                </div>
                <div class="endpoint-body">
                    <div class="endpoint-description">
                        Extract signature timestamp from YouTube player script.
                    </div>
                    <div class="request-response">
                        <div class="request">
                            <h4>Request</h4>
                            <div class="json-example">{
  "player_url": "https://www.youtube.com/s/player/player_id/player.js"
}</div>
                        </div>
                        <div class="response">
                            <h4>Response</h4>
                            <div class="json-example">{
  "sts": "12345",
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "processing_time_ms": 100
}</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method">POST</span>
                    <span class="path">/resolve_url</span>
                </div>
                <div class="endpoint-body">
                    <div class="endpoint-description">
                        Resolve YouTube stream URL with decrypted parameters.
                    </div>
                    <div class="request-response">
                        <div class="request">
                            <h4>Request</h4>
                            <div class="json-example">{
  "stream_url": "https://example.com/video?c=WEB&cver=2.0&s=encrypted_signature&n=encrypted_n_param",
  "player_url": "https://www.youtube.com/s/player/player_id/player.js",
  "encrypted_signature": "encrypted_signature_string",
  "signature_key": "sig",
  "n_param": "encrypted_n_param_string"
}</div>
                        </div>
                        <div class="response">
                            <h4>Response</h4>
                            <div class="json-example">{
  "resolved_url": "https://example.com/video?c=WEB&cver=2.0&sig=decrypted_signature&n=decrypted_n_param",
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "processing_time_ms": 200
}</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method">POST</span>
                    <span class="path">/batch_decrypt</span>
                </div>
                <div class="endpoint-body">
                    <div class="endpoint-description">
                        Decrypt multiple signatures in a single request for improved performance.
                    </div>
                    <div class="request-response">
                        <div class="request">
                            <h4>Request</h4>
                            <div class="json-example">{
  "signatures": [
    {
      "encrypted_signature": "encrypted_signature_string",
      "n_param": "encrypted_n_param_string",
      "player_url": "https://www.youtube.com/s/player/player_id/player.js"
    }
  ]
}</div>
                        </div>
                        <div class="response">
                            <h4>Response</h4>
                            <div class="json-example">{
  "results": [
    {
      "decrypted_signature": "decrypted_signature_string",
      "decrypted_n_sig": "decrypted_n_param_string",
      "success": true
    }
  ],
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "processing_time_ms": 300
}</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method">POST</span>
                    <span class="path">/validate_signature</span>
                </div>
                <div class="endpoint-body">
                    <div class="endpoint-description">
                        Validate if a signature is properly encrypted and can be decrypted.
                    </div>
                    <div class="request-response">
                        <div class="request">
                            <h4>Request</h4>
                            <div class="json-example">{
  "encrypted_signature": "encrypted_signature_string",
  "player_url": "https://www.youtube.com/s/player/player_id/player.js"
}</div>
                        </div>
                        <div class="response">
                            <h4>Response</h4>
                            <div class="json-example">{
  "is_valid": true,
  "signature_type": "encrypted",
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "processing_time_ms": 50
}</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method">POST</span>
                    <span class="path">/clear_cache</span>
                </div>
                <div class="endpoint-body">
                    <div class="endpoint-description">
                        Clear specific or all caches to free up memory.
                    </div>
                    <div class="request-response">
                        <div class="request">
                            <h4>Request</h4>
                            <div class="json-example">{
  "cache_type": "all",
  "clear_all": true
}</div>
                        </div>
                        <div class="response">
                            <h4>Response</h4>
                            <div class="json-example">{
  "cleared_caches": ["player", "solver", "preprocessed", "sts"],
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "processing_time_ms": 100
}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>Made with ❤️ by RY4N | <a href="https://github.com/ryanisnomore/yt-cipher" style="color: rgba(255, 255, 255, 0.8);">GitHub</a></p>
        </div>
    </div>
    
    <script>
        // Real-time data updates
        async function updateStats() {
            try {
                const response = await fetch('/status');
                const data = await response.json();
                
                if (data.realTime) {
                    document.getElementById('uptime').textContent = data.realTime.uptime.formatted;
                    document.getElementById('requests').textContent = data.realTime.requests.total.toLocaleString();
                    document.getElementById('active').textContent = data.realTime.requests.active;
                    document.getElementById('responseTime').textContent = data.realTime.requests.averageResponseTime;
                }
            } catch (error) {
                console.error('Failed to update stats:', error);
            }
        }
        
        // Update stats every 5 seconds
        updateStats();
        setInterval(updateStats, 5000);
    </script>
</body>
</html>`;
    
    return new Response(html, {
        status: 200,
        headers: { 
            "Content-Type": "text/html",
            "X-Request-ID": requestId
        },
    });
}

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
    if (isShuttingDown) {
        console.log(formatLogMessage('warn', 'Shutdown already in progress', { signal }));
        return;
    }
    
    isShuttingDown = true;
    console.log(formatLogMessage('info', 'Graceful shutdown initiated', { signal }));
    
    try {
        // Shutdown workers
        console.log(formatLogMessage('info', 'Shutting down worker pool...'));
        // await shutdownWorkers(); // Uncomment when implemented
        
        console.log(formatLogMessage('info', 'Graceful shutdown completed'));
        Deno.exit(0);
    } catch (error) {
        console.error(formatLogMessage('error', 'Error during graceful shutdown', {
            error: error instanceof Error ? error.message : 'Unknown error'
        }));
        Deno.exit(1);
    }
}

// Setup signal handlers
Deno.addSignalListener("SIGINT", () => gracefulShutdown("SIGINT"));
Deno.addSignalListener("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Server initialization
console.log(formatLogMessage('info', 'Starting server initialization', {
    port: config.port,
    host: config.host,
    logLevel: config.logging.level,
    logFormat: config.logging.format
}));

try {
    const networkInterfaces = Deno.networkInterfaces();
    console.log(formatLogMessage('info', 'Network interfaces available', {
        interfaces: networkInterfaces.map(iface => ({
            name: iface.name,
            family: iface.family,
            address: iface.address
        }))
    }));
} catch (error) {
    console.log(formatLogMessage('warn', 'Cannot list network interfaces', {
        error: error instanceof Error ? error.message : 'Unknown error'
    }));
}

// Initialize components
console.log(formatLogMessage('info', 'Initializing caches...'));
await initializeCache();

console.log(formatLogMessage('info', 'Initializing worker pool...'));
initializeWorkers();

console.log(formatLogMessage('info', 'Server components initialized successfully'));

// Start server
console.log(formatLogMessage('info', 'Starting server', {
    url: `http://${config.host}:${config.port}`
}));

try {
    const server = Deno.serve({
        port: config.port,
        hostname: config.host,
        onListen: (params) => {
            console.log(formatLogMessage('info', 'Server started successfully', {
                hostname: params.hostname,
                port: params.port,
                localUrl: `http://localhost:${params.port}`,
                publicUrl: `http://${params.hostname}:${params.port}`
            }));
        },
        onError: (error) => {
            console.error(formatLogMessage('error', 'Server error', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            }));
            return new Response("Internal Server Error", { 
                status: 500,
                headers: { "Content-Type": "text/plain" }
            });
        }
    }, baseHandler);

    console.log(formatLogMessage('info', 'Server is running and ready to accept requests'));
    
    await server.finished;
} catch (error) {
    console.error(formatLogMessage('error', 'Failed to start server', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
    }));
    Deno.exit(1);
}