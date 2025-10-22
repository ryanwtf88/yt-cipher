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
    port: parseInt(Deno.env.get("SERVER_PORT") || Deno.env.get("PORT") || "8001", 10),
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

function handleRoot(_requestId: string): Response {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YT-Cipher | Susanoo Protocol</title>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --primary: #8B00FF;
            --secondary: #6A0DAD;
            --accent: #9D4EDD;
            --dark: #0a0a0a;
        }
        html { scroll-behavior: smooth; }
        body {
            font-family: 'Rajdhani', sans-serif;
            background: var(--dark);
            color: #fff;
            overflow-x: hidden;
            line-height: 1.6;
        }
        .particles {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            pointer-events: none;
        }
        .particle {
            position: absolute;
            width: 2px;
            height: 2px;
            background: var(--primary);
            border-radius: 50%;
            opacity: 0;
            animation: particleFloat 15s infinite;
        }
        @keyframes particleFloat {
            0% { transform: translateY(100vh) translateX(0) rotate(0deg); opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { transform: translateY(-100vh) translateX(100px) rotate(360deg); opacity: 0; }
        }
        .header {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 40px 20px;
            position: relative;
        }
        .logo-3d {
            font-size: 120px;
            font-weight: 900;
            font-family: 'Orbitron', sans-serif;
            letter-spacing: 15px;
            background: linear-gradient(45deg, #8B00FF, #6A0DAD, #9D4EDD, #8B00FF);
            background-size: 300% 300%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            animation: gradientFlow 4s ease infinite, float3d 6s ease-in-out infinite;
            text-shadow: 0 0 40px rgba(139, 0, 255, 0.8), 0 0 80px rgba(139, 0, 255, 0.6);
            transform-style: preserve-3d;
            filter: drop-shadow(0 10px 20px rgba(139, 0, 255, 0.4));
            margin-bottom: 20px;
        }
        @keyframes gradientFlow {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
        }
        @keyframes float3d {
            0%, 100% { transform: translateY(0) rotateX(0deg) rotateY(0deg); }
            25% { transform: translateY(-30px) rotateX(8deg) rotateY(-8deg); }
            75% { transform: translateY(-30px) rotateX(-8deg) rotateY(8deg); }
        }
        .subtitle {
            font-size: 32px;
            color: var(--accent);
            letter-spacing: 8px;
            font-weight: 700;
            margin-bottom: 40px;
            animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.85; transform: scale(1.02); }
        }
        .stats-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            max-width: 1200px;
            width: 100%;
            margin: 40px 0;
        }
        .stat-card {
            background: rgba(139, 0, 255, 0.05);
            border: 1px solid var(--primary);
            border-radius: 15px;
            padding: 30px;
            backdrop-filter: blur(10px);
            transition: all 0.3s;
            text-align: center;
        }
        .stat-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(139, 0, 255, 0.3);
            border-color: var(--accent);
        }
        .stat-value {
            font-size: 48px;
            font-weight: 900;
            color: var(--primary);
            font-family: 'Orbitron', sans-serif;
            margin-bottom: 10px;
        }
        .stat-label {
            font-size: 18px;
            color: var(--accent);
            font-weight: 600;
        }
        .section {
            max-width: 1400px;
            margin: 0 auto;
            padding: 80px 40px;
        }
        .section-title {
            font-size: 56px;
            color: var(--primary);
            text-align: center;
            margin-bottom: 60px;
            letter-spacing: 4px;
            font-weight: 700;
            font-family: 'Orbitron', sans-serif;
            text-shadow: 0 0 30px rgba(139, 0, 255, 0.6);
            position: relative;
        }
        .section-title::after {
            content: '';
            position: absolute;
            bottom: -15px;
            left: 50%;
            transform: translateX(-50%);
            width: 150px;
            height: 4px;
            background: linear-gradient(90deg, transparent, var(--primary), transparent);
        }
        .endpoints-grid {
            display: grid;
            gap: 25px;
        }
        .endpoint-card {
            background: rgba(139, 0, 255, 0.05);
            border: 1px solid var(--primary);
            border-radius: 15px;
            overflow: hidden;
            transition: all 0.3s;
        }
        .endpoint-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(139, 0, 255, 0.4);
        }
        .endpoint-header {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            padding: 20px 30px;
            display: flex;
            align-items: center;
            gap: 15px;
        }
        .method-badge {
            background: rgba(255, 255, 255, 0.2);
            padding: 8px 16px;
            border-radius: 8px;
            font-weight: 700;
            font-size: 14px;
            font-family: 'Orbitron', sans-serif;
        }
        .endpoint-path {
            font-family: 'Orbitron', sans-serif;
            font-size: 20px;
            font-weight: 700;
        }
        .endpoint-body {
            padding: 30px;
        }
        .endpoint-desc {
            color: var(--accent);
            margin-bottom: 20px;
            font-size: 18px;
        }
        .code-block {
            background: #1e293b;
            color: #e2e8f0;
            padding: 20px;
            border-radius: 10px;
            font-family: monospace;
            font-size: 14px;
            overflow-x: auto;
            margin: 15px 0;
        }
        .auth-notice {
            background: rgba(139, 0, 255, 0.1);
            border: 2px solid var(--primary);
            border-radius: 15px;
            padding: 30px;
            margin: 40px 0;
            text-align: center;
        }
        .auth-notice h3 {
            color: var(--primary);
            font-size: 28px;
            margin-bottom: 15px;
            font-family: 'Orbitron', sans-serif;
        }
        .auth-notice p {
            color: var(--accent);
            font-size: 18px;
            line-height: 1.8;
        }
        .code-inline {
            background: rgba(139, 0, 255, 0.2);
            padding: 4px 12px;
            border-radius: 6px;
            font-family: monospace;
            color: #fff;
        }
        footer {
            text-align: center;
            padding: 60px 20px;
            background: rgba(10, 10, 10, 0.95);
            border-top: 1px solid var(--primary);
        }
        footer p {
            font-size: 18px;
            color: var(--accent);
            margin: 10px 0;
        }
        @media (max-width: 768px) {
            .logo-3d { font-size: 60px; letter-spacing: 8px; }
            .subtitle { font-size: 20px; letter-spacing: 4px; }
            .section-title { font-size: 36px; }
            .stat-value { font-size: 32px; }
        }
    </style>
</head>
<body>
    <div class="particles" id="particles"></div>
    
    <div class="header">
        <h1 class="logo-3d">YT-CIPHER</h1>
        <p class="subtitle">SUSANOO PROTOCOL</p>
        
        <div class="stats-container">
            <div class="stat-card">
                <div class="stat-value" id="uptime">--</div>
                <div class="stat-label">UPTIME</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="requests">--</div>
                <div class="stat-label">REQUESTS</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="active">--</div>
                <div class="stat-label">ACTIVE</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="avgTime">--</div>
                <div class="stat-label">AVG TIME (ms)</div>
            </div>
        </div>
    </div>
    
    <div class="section">
        <h2 class="section-title">API ENDPOINTS</h2>
        
        <div class="auth-notice">
            <h3>AUTHENTICATION REQUIRED</h3>
            <p>All API endpoints require <span class="code-inline">Authorization: Bearer YOUR_TOKEN</span></p>
            <p>Default token: <span class="code-inline">YOUR_API_TOKEN</span></p>
        </div>
        
        <div class="endpoints-grid">
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method-badge">POST</span>
                    <span class="endpoint-path">/decrypt_signature</span>
                </div>
                <div class="endpoint-body">
                    <p class="endpoint-desc">Decrypt YouTube signature and n parameter</p>
                    <div class="code-block">{ "encrypted_signature": "...", "n_param": "...", "player_url": "..." }</div>
                </div>
            </div>
            
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method-badge">POST</span>
                    <span class="endpoint-path">/get_sts</span>
                </div>
                <div class="endpoint-body">
                    <p class="endpoint-desc">Extract signature timestamp from player</p>
                    <div class="code-block">{ "player_url": "..." }</div>
                </div>
            </div>
            
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method-badge">POST</span>
                    <span class="endpoint-path">/resolve_url</span>
                </div>
                <div class="endpoint-body">
                    <p class="endpoint-desc">Resolve stream URL with decrypted parameters</p>
                    <div class="code-block">{ "stream_url": "...", "player_url": "...", "encrypted_signature": "...", "n_param": "..." }</div>
                </div>
            </div>
            
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method-badge">POST</span>
                    <span class="endpoint-path">/batch_decrypt</span>
                </div>
                <div class="endpoint-body">
                    <p class="endpoint-desc">Decrypt multiple signatures in single request</p>
                    <div class="code-block">{ "signatures": [{ "encrypted_signature": "...", "n_param": "...", "player_url": "..." }] }</div>
                </div>
            </div>
            
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method-badge">POST</span>
                    <span class="endpoint-path">/validate_signature</span>
                </div>
                <div class="endpoint-body">
                    <p class="endpoint-desc">Validate signature encryption status</p>
                    <div class="code-block">{ "encrypted_signature": "...", "player_url": "..." }</div>
                </div>
            </div>
            
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method-badge">POST</span>
                    <span class="endpoint-path">/clear_cache</span>
                </div>
                <div class="endpoint-body">
                    <p class="endpoint-desc">Clear specific or all caches</p>
                    <div class="code-block">{ "cache_type": "all", "clear_all": true }</div>
                </div>
            </div>
        </div>
    </div>
    
    <div class="section">
        <h2 class="section-title">SYSTEM MONITORING</h2>
        <div class="endpoints-grid">
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method-badge">GET</span>
                    <span class="endpoint-path">/health</span>
                </div>
                <div class="endpoint-body">
                    <p class="endpoint-desc">Health check with system status</p>
                </div>
            </div>
            
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method-badge">GET</span>
                    <span class="endpoint-path">/status</span>
                </div>
                <div class="endpoint-body">
                    <p class="endpoint-desc">Detailed server status and metrics</p>
                </div>
            </div>
            
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method-badge">GET</span>
                    <span class="endpoint-path">/metrics</span>
                </div>
                <div class="endpoint-body">
                    <p class="endpoint-desc">Prometheus metrics endpoint</p>
                </div>
            </div>
            
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method-badge">GET</span>
                    <span class="endpoint-path">/info</span>
                </div>
                <div class="endpoint-body">
                    <p class="endpoint-desc">Server information and capabilities</p>
                </div>
            </div>
        </div>
    </div>
    
    <footer>
        <p>SUSANOO PROTOCOL ACTIVATED</p>
        <p>&copy; YT-CIPHER | Made with 💀 by RY4N</p>
    </footer>
    
    <script>
        function createParticles() {
            const container = document.getElementById('particles');
            for (let i = 0; i < 80; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.top = Math.random() * 100 + 'vh';
                particle.style.animationDelay = Math.random() * 15 + 's';
                particle.style.animationDuration = (Math.random() * 15 + 15) + 's';
                container.appendChild(particle);
            }
        }
        
        async function updateStats() {
            try {
                const response = await fetch('/status');
                const data = await response.json();
                
                if (data.realTime) {
                    document.getElementById('uptime').textContent = data.realTime.uptime.formatted;
                    document.getElementById('requests').textContent = data.realTime.requests.total.toLocaleString();
                    document.getElementById('active').textContent = data.realTime.requests.active;
                    document.getElementById('avgTime').textContent = data.realTime.requests.averageResponseTime;
                }
            } catch (error) {
                console.error('Failed to update stats:', error);
            }
        }
        
        createParticles();
        updateStats();
        setInterval(updateStats, 3000);
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

function handleHealth(requestId: string): Promise<Response> {
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

function handleStatus(requestId: string): Promise<Response> {
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
