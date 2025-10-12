import {
    Counter,
    Gauge,
    Histogram,
    Registry,
} from "https://deno.land/x/ts_prometheus/mod.ts";
import type { CacheStats, MetricsData, LogLevel } from "./types.ts";

export const registry = new Registry();

// Default buckets for various metrics
const httpBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const cacheBuckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const workerBuckets = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];

// HTTP Request Metrics
export const endpointHits = Counter.with({
    name: "http_requests_total",
    help: "Total number of HTTP requests.",
    labels: ["method", "pathname", "player_id", "plugin_version", "user_agent", "client_ip"],
    registry: [registry],
});

export const responseCodes = Counter.with({
    name: "http_responses_total",
    help: "Total number of HTTP responses.",
    labels: ["method", "pathname", "status", "player_id", "plugin_version", "user_agent", "client_ip"],
    registry: [registry],
});

export const endpointLatency = Histogram.with({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds.",
    labels: ["method", "pathname", "player_id", "cached", "endpoint_type"],
    buckets: httpBuckets,
    registry: [registry],
});

// Rate Limiting Metrics
export const rateLimitHits = Counter.with({
    name: "rate_limit_hits_total",
    help: "Total number of rate limit hits.",
    labels: ["client_ip", "user_agent", "endpoint"],
    registry: [registry],
});

export const rateLimitRejections = Counter.with({
    name: "rate_limit_rejections_total",
    help: "Total number of rate limit rejections.",
    labels: ["client_ip", "user_agent", "endpoint", "reason"],
    registry: [registry],
});

// Cache Metrics
export const cacheSize = Gauge.with({
    name: "cache_size",
    help: "The number of items in the cache.",
    labels: ["cache_name", "cache_type"],
    registry: [registry],
});

export const cacheHits = Counter.with({
    name: "cache_hits_total",
    help: "Total number of cache hits.",
    labels: ["cache_name", "cache_type"],
    registry: [registry],
});

export const cacheMisses = Counter.with({
    name: "cache_misses_total",
    help: "Total number of cache misses.",
    labels: ["cache_name", "cache_type"],
    registry: [registry],
});

export const cacheOperations = Counter.with({
    name: "cache_operations_total",
    help: "Total number of cache operations.",
    labels: ["cache_name", "operation", "status"],
    registry: [registry],
});

export const cacheLatency = Histogram.with({
    name: "cache_operation_duration_seconds",
    help: "Cache operation duration in seconds.",
    labels: ["cache_name", "operation"],
    buckets: cacheBuckets,
    registry: [registry],
});

// Worker Pool Metrics
export const workerTasks = Counter.with({
    name: "worker_tasks_total",
    help: "Total number of worker tasks processed.",
    labels: ["worker_id", "task_type", "status"],
    registry: [registry],
});

export const workerTaskDuration = Histogram.with({
    name: "worker_task_duration_seconds",
    help: "Worker task duration in seconds.",
    labels: ["worker_id", "task_type"],
    buckets: workerBuckets,
    registry: [registry],
});

export const workerErrors = Counter.with({
    name: "worker_errors_total",
    help: "Total number of worker errors.",
    labels: ["worker_id", "error_type"],
    registry: [registry],
});

export const activeWorkers = Gauge.with({
    name: "active_workers",
    help: "Number of active workers.",
    labels: ["status"],
    registry: [registry],
});

// Player URL Metrics
export const playerUrlRequests = Counter.with({
    name: "player_url_requests_total",
    help: "Total number of requests for each player ID.",
    labels: ["player_id", "player_version"],
    registry: [registry],
});

// Solver Metrics
export const solverOperations = Counter.with({
    name: "solver_operations_total",
    help: "Total number of solver operations.",
    labels: ["operation_type", "player_id", "status"],
    registry: [registry],
});

export const solverLatency = Histogram.with({
    name: "solver_operation_duration_seconds",
    help: "Solver operation duration in seconds.",
    labels: ["operation_type", "player_id"],
    buckets: httpBuckets,
    registry: [registry],
});

// Error Metrics
export const errors = Counter.with({
    name: "errors_total",
    help: "Total number of errors.",
    labels: ["error_type", "error_code", "endpoint", "severity"],
    registry: [registry],
});

// System Metrics
export const memoryUsage = Gauge.with({
    name: "memory_usage_bytes",
    help: "Memory usage in bytes.",
    labels: ["type"],
    registry: [registry],
});

export const uptime = Gauge.with({
    name: "uptime_seconds",
    help: "Server uptime in seconds.",
    registry: [registry],
});

// Performance Metrics
export const requestSize = Histogram.with({
    name: "request_size_bytes",
    help: "Request size in bytes.",
    labels: ["method", "pathname"],
    buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
    registry: [registry],
});

export const responseSize = Histogram.with({
    name: "response_size_bytes",
    help: "Response size in bytes.",
    labels: ["method", "pathname", "status"],
    buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
    registry: [registry],
});

// Business Logic Metrics
export const signatureDecryptions = Counter.with({
    name: "signature_decryptions_total",
    help: "Total number of signature decryptions.",
    labels: ["player_id", "status", "user_agent"],
    registry: [registry],
});


export const stsExtractions = Counter.with({
    name: "sts_extractions_total",
    help: "Total number of STS extractions.",
    labels: ["player_id", "status"],
    registry: [registry],
});

export const urlResolutions = Counter.with({
    name: "url_resolutions_total",
    help: "Total number of URL resolutions.",
    labels: ["player_id", "status"],
    registry: [registry],
});

// Health Check Metrics
export const healthChecks = Counter.with({
    name: "health_checks_total",
    help: "Total number of health checks.",
    labels: ["status"],
    registry: [registry],
});

// Custom metrics collection
class MetricsCollector {
    private cacheStats: Map<string, CacheStats> = new Map();
    private startTime: number = Date.now();

    updateCacheStats(cacheName: string, stats: CacheStats) {
        this.cacheStats.set(cacheName, stats);
        
        // Update Prometheus metrics
        cacheSize.labels({ cache_name: cacheName, cache_type: 'lru' }).set(stats.size);
        cacheHits.labels({ cache_name: cacheName, cache_type: 'lru' }).inc(stats.hits);
        cacheMisses.labels({ cache_name: cacheName, cache_type: 'lru' }).inc(stats.misses);
    }

    getMetricsData(): MetricsData {
        const now = Date.now();
        const uptimeMs = now - this.startTime;
        
        return {
            requests: {
                total: this.getCounterValue(endpointHits),
                successful: this.getCounterValue(responseCodes, { status: '200' }) + 
                           this.getCounterValue(responseCodes, { status: '201' }),
                failed: this.getCounterValue(responseCodes, { status: '4xx' }) + 
                        this.getCounterValue(responseCodes, { status: '5xx' }),
                rateLimited: this.getCounterValue(rateLimitRejections)
            },
            performance: {
                averageResponseTime: this.getHistogramAverage(endpointLatency),
                p95ResponseTime: this.getHistogramPercentile(endpointLatency, 0.95),
                p99ResponseTime: this.getHistogramPercentile(endpointLatency, 0.99)
            },
            cache: Object.fromEntries(this.cacheStats),
            workers: {
                total: this.getGaugeValue(activeWorkers, { status: 'total' }),
                active: this.getGaugeValue(activeWorkers, { status: 'active' }),
                idle: this.getGaugeValue(activeWorkers, { status: 'idle' }),
                error: this.getCounterValue(workerErrors)
            }
        };
    }

    private getCounterValue(counter: any, labels?: Record<string, string>): number {
        // This is a simplified implementation
        // In a real implementation, you'd need to access the actual counter values
        return 0;
    }

    private getGaugeValue(gauge: any, labels?: Record<string, string>): number {
        // This is a simplified implementation
        return 0;
    }

    private getHistogramAverage(histogram: any): number {
        // This is a simplified implementation
        return 0;
    }

    private getHistogramPercentile(histogram: any, percentile: number): number {
        // This is a simplified implementation
        return 0;
    }

    updateMemoryUsage() {
        const usage = Deno.memoryUsage();
        memoryUsage.labels({ type: 'heap_used' }).set(usage.heapUsed);
        memoryUsage.labels({ type: 'heap_total' }).set(usage.heapTotal);
        memoryUsage.labels({ type: 'external' }).set(usage.external);
        memoryUsage.labels({ type: 'rss' }).set(usage.rss);
    }

    updateUptime() {
        const uptimeSeconds = (Date.now() - this.startTime) / 1000;
        uptime.set(uptimeSeconds);
    }
}

export const metricsCollector = new MetricsCollector();

// Utility functions for metrics
export function incrementCounter(counter: any, labels: Record<string, string>, value: number = 1) {
    counter.labels(labels).inc(value);
}

export function setGauge(gauge: any, labels: Record<string, string>, value: number) {
    gauge.labels(labels).set(value);
}

export function observeHistogram(histogram: any, labels: Record<string, string>, value: number) {
    histogram.labels(labels).observe(value);
}

export function recordCacheOperation(cacheName: string, operation: string, status: 'success' | 'error', duration: number) {
    cacheOperations.labels({ cache_name: cacheName, operation, status }).inc();
    cacheLatency.labels({ cache_name: cacheName, operation }).observe(duration);
}

export function recordWorkerTask(workerId: string, taskType: string, status: 'success' | 'error', duration: number) {
    workerTasks.labels({ worker_id: workerId, task_type: taskType, status }).inc();
    workerTaskDuration.labels({ worker_id: workerId, task_type: taskType }).observe(duration);
}

export function recordError(errorType: string, errorCode: string, endpoint: string, severity: LogLevel) {
    errors.labels({ error_type: errorType, error_code: errorCode, endpoint, severity }).inc();
}

// Start periodic updates
setInterval(() => {
    metricsCollector.updateMemoryUsage();
    metricsCollector.updateUptime();
}, 10000); // Update every 10 seconds