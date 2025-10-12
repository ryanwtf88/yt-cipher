import type { ApiError, LogLevel } from "./types.ts";

// Constants
const ALLOWED_HOSTNAMES = ["youtube.com", "www.youtube.com", "m.youtube.com"];
const YOUTUBE_PLAYER_PATTERN = /\/s\/player\/([^\/]+)/;
const _PLAYER_ID_PATTERN = /\/player\/([^\/\?]+)/;

// URL validation and normalization
export function validateAndNormalizePlayerUrl(playerUrl: string): string {
    if (!playerUrl || typeof playerUrl !== 'string') {
        throw new Error('Player URL is required and must be a string');
    }

    const trimmedUrl = playerUrl.trim();
    if (!trimmedUrl) {
        throw new Error('Player URL cannot be empty');
    }

    // Handle relative paths
    if (trimmedUrl.startsWith('/')) {
        if (trimmedUrl.startsWith('/s/player/')) {
            return `https://www.youtube.com${trimmedUrl}`;
        }
        throw new Error(`Invalid player path: ${trimmedUrl}`);
    }

    // Handle absolute URLs
    try {
        const url = new URL(trimmedUrl);
        
        // Validate protocol
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error(`Invalid protocol: ${url.protocol}`);
        }

        // Validate hostname
        if (!ALLOWED_HOSTNAMES.includes(url.hostname)) {
            throw new Error(`Player URL from invalid host: ${url.hostname}. Allowed hosts: ${ALLOWED_HOSTNAMES.join(', ')}`);
        }

        // Validate path contains player
        if (!url.pathname.includes('/player/') && !url.pathname.includes('/s/player/')) {
            throw new Error(`Invalid player URL path: ${url.pathname}`);
        }

        return trimmedUrl;
    } catch (e) {
        if (e instanceof TypeError) {
            throw new Error(`Invalid URL format: ${trimmedUrl}`);
        }
        throw e;
    }
}

export function extractPlayerId(playerUrl: string): string {
    try {
        const url = new URL(playerUrl);
        const pathParts = url.pathname.split('/');
        const playerIndex = pathParts.indexOf('player');
        
        if (playerIndex !== -1 && playerIndex + 1 < pathParts.length) {
            const playerId = pathParts[playerIndex + 1];
            // Clean up any query parameters or fragments
            return playerId.split('?')[0].split('#')[0];
        }
    } catch (_e) {
        // Fallback for relative paths
        const match = playerUrl.match(YOUTUBE_PLAYER_PATTERN);
        if (match && match[1]) {
            return match[1].split('?')[0].split('#')[0];
        }
    }
    return 'unknown';
}

// URL validation utilities
export function isValidUrl(urlString: string): boolean {
    try {
        new URL(urlString);
        return true;
    } catch {
        return false;
    }
}

export function normalizeUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        // Remove trailing slash from pathname
        if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
            urlObj.pathname = urlObj.pathname.slice(0, -1);
        }
        return urlObj.toString();
    } catch {
        return url;
    }
}

// String utilities
export function sanitizeString(input: string, maxLength: number = 1000): string {
    if (typeof input !== 'string') {
        return '';
    }
    
    return input
        .trim()
        .slice(0, maxLength)
        // deno-lint-ignore no-control-regex
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Remove control characters
}

export function generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Error utilities
export function createApiError(
    message: string, 
    code: string, 
    details?: Record<string, unknown>,
    requestId?: string
): ApiError {
    return {
        error: message,
        code,
        details,
        timestamp: new Date().toISOString(),
        request_id: requestId
    };
}

export function isRetryableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const err = error as { code?: string; message?: string };
    if (!error) return false;
    
    const retryableCodes = ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'];
    const retryableMessages = ['timeout', 'network', 'connection', 'rate limit'];
    
    return retryableCodes.some(code => err.code === code) ||
           retryableMessages.some(msg => err.message?.toLowerCase().includes(msg));
}

// Performance utilities
export function measureTime<T>(fn: () => T): { result: T; duration: number } {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    return { result, duration };
}

export async function measureTimeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return { result, duration };
}

// Validation utilities
export function validateRequiredFields(obj: Record<string, unknown>, requiredFields: string[]): string[] {
    const errors: string[] = [];
    
    for (const field of requiredFields) {
        if (!(field in obj) || obj[field] === undefined || obj[field] === null || obj[field] === '') {
            errors.push(`Field '${field}' is required`);
        }
    }
    
    return errors;
}

export function validateStringLength(str: string, min: number, max: number, fieldName: string): string | null {
    if (typeof str !== 'string') {
        return `${fieldName} must be a string`;
    }
    
    if (str.length < min) {
        return `${fieldName} must be at least ${min} characters long`;
    }
    
    if (str.length > max) {
        return `${fieldName} must be no more than ${max} characters long`;
    }
    
    return null;
}

// Logging utilities
export function formatLogMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (meta && Object.keys(meta).length > 0) {
        return `${base} ${JSON.stringify(meta)}`;
    }
    
    return base;
}

// Memory utilities
export function getMemoryUsage(): { used: number; total: number; percentage: number } {
    const usage = Deno.memoryUsage();
    const total = usage.heapTotal;
    const used = usage.heapUsed;
    const percentage = total > 0 ? (used / total) * 100 : 0;
    
    return { used, total, percentage };
}

// Rate limiting utilities
export function calculateRetryAfter(_windowMs: number, resetTime: number): number {
    const now = Date.now();
    const timeUntilReset = resetTime - now;
    return Math.max(0, Math.ceil(timeUntilReset / 1000));
}

// Cache utilities
export function calculateHitRate(hits: number, misses: number): number {
    const total = hits + misses;
    return total > 0 ? (hits / total) * 100 : 0;
}

// Time utilities
export function formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// Get client IP from request
export function getClientIp(req: Request): string {
    const forwarded = req.headers.get('X-Forwarded-For');
    const realIp = req.headers.get('X-Real-IP');
    const cfConnectingIp = req.headers.get('CF-Connecting-IP');
    
    if (cfConnectingIp) return cfConnectingIp;
    if (realIp) return realIp;
    if (forwarded) return forwarded.split(',')[0].trim();
    
    return 'unknown';
}

// Deep clone utility
export function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    if (obj instanceof Date) {
        return new Date(obj.getTime()) as T;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item)) as T;
    }
    
    if (obj instanceof Map) {
        const clonedMap = new Map();
        for (const [key, value] of obj) {
            clonedMap.set(deepClone(key), deepClone(value));
        }
        return clonedMap as T;
    }
    
    if (obj instanceof Set) {
        const clonedSet = new Set();
        for (const value of obj) {
            clonedSet.add(deepClone(value));
        }
        return clonedSet as T;
    }
    
    const cloned = {} as T;
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }
    
    return cloned;
}