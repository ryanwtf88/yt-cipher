import type { Input as _MainInput, Output as _MainOutput } from "../ejs/src/yt/solver/main.ts";

// Core solver interface
export interface Solvers {
    n: ((val: string) => string) | null;
    sig: ((val: string) => string) | null;
}

// Request/Response interfaces
export interface SignatureRequest {
    encrypted_signature: string;
    n_param: string;
    player_url: string;
}

export interface SignatureResponse {
    decrypted_signature: string;
    decrypted_n_sig: string;
}

export interface StsRequest {
    player_url: string;
}

export interface StsResponse {
    sts: string;
    success: boolean;
    timestamp: string;
    processing_time_ms?: number;
}

export interface ResolveUrlRequest {
    stream_url: string;
    player_url: string;
    encrypted_signature?: string;
    signature_key?: string;
    n_param?: string;
}

export interface ResolveUrlResponse {
    resolved_url: string;
}

// New request types for additional endpoints
export interface BatchDecryptRequest {
    signatures: SignatureRequest[];
}

export interface BatchDecryptResponse {
    results: Array<{
        encrypted_signature: string;
        n_param: string;
        player_url: string;
        decrypted_signature?: string;
        decrypted_n_sig?: string;
        success: boolean;
        error?: string;
    }>;
    summary: {
        total: number;
        successful: number;
        failed: number;
    };
}

export interface ValidateSignatureRequest {
    encrypted_signature: string;
    player_url: string;
}

export interface ValidateSignatureResponse {
    is_valid: boolean;
    signature_type: string;
    signature_length: number;
    player_url_valid: boolean;
    validation_details: {
        length_check: boolean;
        pattern_check: boolean;
        player_url_check: boolean;
    };
}

export interface GetPlayerInfoRequest {
    player_url: string;
}

export interface GetPlayerInfoResponse {
    player_id: string;
    version: string;
    sts: string;
    features: string[];
    capabilities: {
        signature_decryption: boolean;
        n_parameter_decryption: boolean;
        url_resolution: boolean;
        adaptive_streaming: boolean;
        hls_support: boolean;
        dash_support: boolean;
    };
    url_info: {
        domain: string;
        path: string;
        is_https: boolean;
    };
}

export interface CacheStatsRequest {
    // No specific request body needed for GET request
    [key: string]: never;
}

export interface CacheStatsResponse {
    player_cache: CacheStats & { ttl: number; lastCleanup: string };
    solver_cache: CacheStats & { ttl: number; lastCleanup: string };
    preprocessed_cache: CacheStats & { ttl: number; lastCleanup: string };
    sts_cache: CacheStats & { ttl: number; lastCleanup: string };
    overall_stats: {
        total_hits: number;
        total_misses: number;
        total_size: number;
        total_max_size: number;
        overall_hit_rate: number;
        memory_usage_percentage: number;
    };
}

export interface ClearCacheRequest {
    cache_type?: 'all' | 'player' | 'solver' | 'preprocessed' | 'sts';
    clear_all?: boolean;
}

export interface ClearCacheResponse {
    cleared_caches: string[];
    cache_count: number;
    clear_all: boolean;
}

// Error handling
export interface ApiError {
    error: string;
    code: string;
    details?: Record<string, unknown>;
    timestamp: string;
    request_id?: string;
}

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: ApiError;
    timestamp: string;
    request_id?: string;
}

// Worker management
export interface WorkerWithStatus extends Worker {
    isIdle?: boolean;
    lastUsed?: number;
    taskCount?: number;
    errorCount?: number;
}

export interface Task {
    data: string;
    resolve: (output: string) => void;
    reject: (error: unknown) => void;
}

// Rate limiting
export interface RateLimitConfig {
    windowMs: number;
    maxRequests: number;
    skipSuccessfulRequests?: boolean;
    skipFailedRequests?: boolean;
}

export interface RateLimitInfo {
    limit: number;
    remaining: number;
    reset: number;
    retryAfter?: number;
}

// Cache management
export interface CacheConfig {
    maxSize: number;
    ttl: number;
    cleanupInterval: number;
}

export interface CacheStats {
    hits: number;
    misses: number;
    size: number;
    maxSize: number;
    hitRate: number;
}

// Health and monitoring
export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    uptime: number;
    version: string;
    realTime?: {
        activeConnections: number;
        totalRequests: number;
        errorCount: number;
        errorRate: number;
        averageResponseTime: number;
        lastRequest: string;
    };
    workers: {
        total: number;
        idle: number;
        busy: number;
        error: number;
    };
    caches: Record<string, CacheStats>;
    memory: {
        used: number;
        total: number;
        percentage: number;
    };
}

// Request context with enhanced metadata
export interface RequestContext {
    req: Request;
    body: ApiRequest;
    requestId: string;
    startTime: number;
    clientIp?: string;
    userAgent?: string;
    rateLimitInfo?: RateLimitInfo;
}

// Configuration
export interface ServerConfig {
    port: number;
    host: string;
    apiToken?: string;
    rateLimit: RateLimitConfig;
    cache: {
        player: CacheConfig;
        solver: CacheConfig;
        preprocessed: CacheConfig;
        sts: CacheConfig;
    };
    workers: {
        concurrency: number;
        timeout: number;
        maxRetries: number;
    };
    logging: {
        level: 'debug' | 'info' | 'warn' | 'error';
        format: 'json' | 'text';
    };
}

// Union types
export type ApiRequest = SignatureRequest | StsRequest | ResolveUrlRequest | BatchDecryptRequest | ValidateSignatureRequest | GetPlayerInfoRequest | CacheStatsRequest | ClearCacheRequest;
export type ApiResponseType = SignatureResponse | StsResponse | ResolveUrlResponse | BatchDecryptResponse | ValidateSignatureResponse | GetPlayerInfoResponse | CacheStatsResponse | ClearCacheResponse;

// Utility types
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type CacheType = 'player' | 'solver' | 'preprocessed' | 'sts';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Event types for internal communication
export interface WorkerEvent {
    type: 'task_complete' | 'task_error' | 'worker_ready' | 'worker_error';
    taskId?: string;
    data?: unknown;
    error?: string;
    timestamp: number;
}

// Metrics data structure
export interface MetricsData {
    requests: {
        total: number;
        successful: number;
        failed: number;
        rateLimited: number;
    };
    performance: {
        averageResponseTime: number;
        p95ResponseTime: number;
        p99ResponseTime: number;
    };
    cache: Record<string, CacheStats>;
    workers: {
        total: number;
        active: number;
        idle: number;
        error: number;
    };
}