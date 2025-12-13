import { initializeWorkers } from "./src/workerPool.ts";
import { initializeCache } from "./src/playerCache.ts";
import { handleDecryptSignature } from "./src/handlers/decryptSignature.ts";
import { handleGetSts } from "./src/handlers/getSts.ts";
import { handleResolveUrl } from "./src/handlers/resolveUrl.ts";
import { handleBatchDecrypt } from "./src/handlers/batchDecrypt.ts";
import { handleValidateSignature } from "./src/handlers/validateSignature.ts";
import { handleClearCache } from "./src/handlers/clearCache.ts";
import { composeMiddleware, type Next } from "./src/middleware.ts";
import { withValidation } from "./src/validation.ts";
import { registry, metricsCollector } from "./src/metrics.ts";
import {
    generateRequestId,
    formatLogMessage,
    getMemoryUsage,
    formatUptime,
    createApiError
} from "./src/utils.ts";
import { openApiSpec } from "./src/openapi.ts";
import type { ApiRequest, RequestContext, HealthStatus, ServerConfig } from "./src/types.ts";

const config: ServerConfig = {
    port: parseInt(Deno.env.get("SERVER_PORT") || Deno.env.get("PORT") || "3000", 10),
    host: Deno.env.get("SERVER_IP") || Deno.env.get("SERVER_HOST") || "0.0.0.0",
    // for jexactyl   host: "0.0.0.0",
    apiToken: Deno.env.get("API_TOKEN") || "YO_TOKEN",
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
        level: (Deno.env.get("LOG_LEVEL") as "debug" | "info" | "warn" | "error") || "warn",
        format: (Deno.env.get("LOG_FORMAT") as "json" | "text") || "text"
    }
};

const serverStartTime = Date.now();
let isShuttingDown = false;

const realTimeData = {
    activeConnections: 0,
    totalRequests: 0,
    errorCount: 0,
    lastRequestTime: Date.now(),
    averageResponseTime: 0,
    responseTimes: [] as number[]
};

function createJsonResponse(data: unknown, status: number = 200, headers: Record<string, string> = {}): Response {
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

function updateRealTimeData(responseTime: number, isError: boolean = false) {
    realTimeData.totalRequests++;
    realTimeData.lastRequestTime = Date.now();
    realTimeData.responseTimes.push(responseTime);

    if (realTimeData.responseTimes.length > 100) {
        realTimeData.responseTimes = realTimeData.responseTimes.slice(-100);
    }

    realTimeData.averageResponseTime = realTimeData.responseTimes.reduce((a, b) => a + b, 0) / realTimeData.responseTimes.length;

    if (isError) {
        realTimeData.errorCount++;
    }
}

async function baseHandler(req: Request): Promise<Response> {
    const requestId = generateRequestId();
    const { pathname } = new URL(req.url);
    const method = req.method;
    const userAgent = req.headers.get('User-Agent') || 'unknown';
    const clientIp = req.headers.get('X-Forwarded-For') ||
        req.headers.get('X-Real-IP') ||
        req.headers.get('CF-Connecting-IP') ||
        'unknown';
    const startTime = Date.now();

    realTimeData.activeConnections++;

    console.log(formatLogMessage('info', 'Incoming request', {
        requestId,
        method,
        pathname,
        userAgent: userAgent.substring(0, 100),
        clientIp
    }));

    try {
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

        if (pathname === "/info") {
            const response = handleServerInfo(requestId);
            updateRealTimeData(Date.now() - startTime);
            realTimeData.activeConnections--;
            return response;
        }

        if (pathname === "/swagger.json") {
            const response = new Response(JSON.stringify(openApiSpec), {
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                }
            });
            updateRealTimeData(Date.now() - startTime);
            realTimeData.activeConnections--;
            return response;
        }

        if (pathname.startsWith('/decrypt_signature') || pathname.startsWith('/get_sts') ||
            pathname.startsWith('/resolve_url') || pathname.startsWith('/batch_decrypt') ||
            pathname.startsWith('/validate_signature') || pathname.startsWith('/clear_cache')) {

            const API_TOKEN = config.apiToken;

            if (!API_TOKEN || API_TOKEN === "" || API_TOKEN === "YOUR_API_TOKEN") {
                console.log(formatLogMessage('warn', 'API authentication disabled', {
                    requestId,
                    pathname
                }));
            } else {
                const authHeader = req.headers.get("authorization");
                const isValidAuth = authHeader === `Bearer ${API_TOKEN}` || authHeader === API_TOKEN;

                if (!isValidAuth) {
                    const error = authHeader ? "Invalid API token" : "Missing API token";

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

        let handler: Next | null = null;

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

        let body: ApiRequest = {} as ApiRequest;
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

        const ctx: RequestContext = {
            req,
            body,
            requestId,
            startTime,
            clientIp,
            userAgent
        };

        const composedHandler = composeMiddleware(
            withValidation(handler!),
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

function handleRoot(_requestId: string): Response {
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>YT-Cipher API Documentation</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
    <style>
      body { margin: 0; padding: 0; background: #0a0a0a; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: '/swagger.json',
          dom_id: '#swagger-ui',
        });
      };
    </script>
  </body>
</html>`;

    return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" }
    });
}

async function handleMetrics(requestId: string): Promise<Response> {
    try {
        const metrics = await registry.metrics();
        const realTimeMetrics = `
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

async function handleHealth(requestId: string): Promise<Response> {
    try {
        const uptime = Date.now() - serverStartTime;
        const memory = getMemoryUsage();

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

function gracefulShutdown(signal: string) {
    if (isShuttingDown) {
        console.log(formatLogMessage('warn', 'Shutdown already in progress', { signal }));
        return;
    }

    isShuttingDown = true;
    console.log(formatLogMessage('info', 'Graceful shutdown initiated', { signal }));

    try {
        console.log(formatLogMessage('info', 'Shutting down worker pool...'));
        console.log(formatLogMessage('info', 'Graceful shutdown completed'));
        Deno.exit(0);
    } catch (error) {
        console.error(formatLogMessage('error', 'Error during graceful shutdown', {
            error: error instanceof Error ? error.message : 'Unknown error'
        }));
        Deno.exit(1);
    }
}

Deno.addSignalListener("SIGINT", () => gracefulShutdown("SIGINT"));
Deno.addSignalListener("SIGTERM", () => gracefulShutdown("SIGTERM"));

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

console.log(formatLogMessage('info', 'Initializing caches...'));
await initializeCache();

console.log(formatLogMessage('info', 'Initializing worker pool...'));
initializeWorkers();

console.log(formatLogMessage('info', 'Server components initialized successfully'));
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
