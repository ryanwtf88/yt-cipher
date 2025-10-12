import { getPlayerFilePath } from "../playerCache.ts";
import { 
    stsExtractions, 
    recordError 
} from "../metrics.ts";
import { 
    measureTimeAsync, 
    measureTime,
    formatLogMessage, 
    createApiError,
    extractPlayerId 
} from "../utils.ts";
import { stsCache } from "../stsCache.ts";
import type { RequestContext, StsRequest, StsResponse } from "../types.ts";

export async function handleGetSts(ctx: RequestContext): Promise<Response> {
    const startTime = performance.now();
    const { player_url } = ctx.body as StsRequest;
    const playerId = extractPlayerId(player_url);
    
    try {
        if (Deno.env.get("LOG_LEVEL") === "debug") {
            console.log(formatLogMessage('debug', 'Starting STS extraction', {
                requestId: ctx.requestId,
                playerId,
                playerUrl: player_url
            }));
        }

        // Get player file path with error handling
        const { result: playerFilePath, duration: filePathDuration } = await measureTimeAsync(async () => {
            return await getPlayerFilePath(player_url);
        });

        if (Deno.env.get("LOG_LEVEL") === "debug") {
            console.log(formatLogMessage('debug', 'Player file path retrieved', {
                requestId: ctx.requestId,
                playerId,
                filePath: playerFilePath,
                duration: `${filePathDuration.toFixed(2)}ms`
            }));
        }

        // Check cache first
        const cachedSts = stsCache.get(playerFilePath);
        if (cachedSts) {
            const totalDuration = performance.now() - startTime;
            
            // Record success metrics
            stsExtractions.labels({ player_id: playerId, status: 'success' }).inc();
            
            // Return exact format expected by Lavalink
            const response = { 
                sts: cachedSts
            };
            
            if (Deno.env.get("LOG_LEVEL") === "debug") {
                console.log(formatLogMessage('debug', 'STS retrieved from cache', {
                    requestId: ctx.requestId,
                    playerId,
                    sts: cachedSts,
                    duration: `${totalDuration.toFixed(2)}ms`
                }));
            }
            
            return new Response(JSON.stringify(response), {
                status: 200,
                headers: { 
                    "Content-Type": "application/json", 
                    "X-Cache-Hit": "true",
                    "X-Request-ID": ctx.requestId,
                    "X-Processing-Time": totalDuration.toString()
                },
            });
        }

        // Read player content
        const { result: playerContent, duration: readDuration } = await measureTimeAsync(async () => {
            return await Deno.readTextFile(playerFilePath);
        });

        if (Deno.env.get("LOG_LEVEL") === "debug") {
            console.log(formatLogMessage('debug', 'Player content read', {
                requestId: ctx.requestId,
                playerId,
                contentLength: playerContent.length,
                duration: `${readDuration.toFixed(2)}ms`
            }));
        }

        // Validate player content
        if (!playerContent || playerContent.length < 1000) {
            // Record error metrics
            stsExtractions.labels({ player_id: playerId, status: 'error' }).inc();
            recordError('sts_extraction', 'INVALID_PLAYER_CONTENT', '/get_sts', 'error');
            
            return new Response(JSON.stringify({
                error: "Invalid or too short player content"
            }), { 
                status: 500, 
                headers: { 
                    "Content-Type": "application/json"
                } 
            });
        }

        // Extract STS with multiple patterns
        const { result: sts, duration: extractionDuration } = measureTime(() => {
            // Try multiple patterns for STS extraction
            const patterns = [
                /(?:signatureTimestamp|sts):\s*(\d+)/,
                /"signatureTimestamp":\s*(\d+)/,
                /'signatureTimestamp':\s*(\d+)/,
                /signatureTimestamp\s*=\s*(\d+)/,
                /sts\s*=\s*(\d+)/,
                /"sts":\s*(\d+)/,
                /'sts':\s*(\d+)/
            ];
            
            for (const pattern of patterns) {
                const match = playerContent.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }
            
            return null;
        });

        if (!sts || typeof sts !== 'string') {
            // Record error metrics
            stsExtractions.labels({ player_id: playerId, status: 'error' }).inc();
            recordError('sts_extraction', 'STS_NOT_FOUND', '/get_sts', 'error');
            
            return new Response(JSON.stringify({
                error: "Signature timestamp not found in player script"
            }), { 
                status: 404, 
                headers: { 
                    "Content-Type": "application/json"
                } 
            });
        }

        // Validate STS value
        const stsNumber = parseInt(sts, 10);
        if (isNaN(stsNumber) || stsNumber < 0 || stsNumber > 9999999999) {
            // Record error metrics
            stsExtractions.labels({ player_id: playerId, status: 'error' }).inc();
            recordError('sts_extraction', 'INVALID_STS_VALUE', '/get_sts', 'error');
            
            return new Response(JSON.stringify({
                error: "Invalid signature timestamp value"
            }), { 
                status: 400, 
                headers: { 
                    "Content-Type": "application/json"
                } 
            });
        }

        // Cache the STS value
        stsCache.set(playerFilePath, sts);
        
        const totalDuration = performance.now() - startTime;
        
        // Record success metrics
        stsExtractions.labels({ player_id: playerId, status: 'success' }).inc();
        
        // Return exact format expected by Lavalink
        const response = { 
            sts
        };
        
        if (Deno.env.get("LOG_LEVEL") === "debug") {
            console.log(formatLogMessage('debug', 'STS extracted successfully', {
                requestId: ctx.requestId,
                playerId,
                sts: sts,
                extractionDuration: `${extractionDuration.toFixed(2)}ms`,
                totalDuration: `${totalDuration.toFixed(2)}ms`
            }));
        }

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 
                "Content-Type": "application/json", 
                "X-Cache-Hit": "false",
                "X-Request-ID": ctx.requestId,
                "X-Processing-Time": totalDuration.toString()
            },
        });

    } catch (error) {
        const totalDuration = performance.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        console.error(formatLogMessage('error', 'STS extraction handler failed', {
            requestId: ctx.requestId,
            playerId,
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            duration: `${totalDuration.toFixed(2)}ms`
        }));
        
        // Record error metrics
        stsExtractions.labels({ player_id: playerId, status: 'error' }).inc();
        recordError('sts_extraction', 'HANDLER_ERROR', '/get_sts', 'error');
        
        return new Response(JSON.stringify({
            error: "Internal server error during STS extraction"
        }), { 
            status: 500, 
            headers: { 
                "Content-Type": "application/json"
            } 
        });
    }
}