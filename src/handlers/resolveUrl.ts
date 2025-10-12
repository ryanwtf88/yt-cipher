import { getSolvers } from "../solver.ts";
import type { RequestContext, ResolveUrlRequest } from "../types.ts";
import { createApiError, formatLogMessage } from "../utils.ts";

export async function handleResolveUrl(ctx: RequestContext): Promise<Response> {
    const { requestId, startTime } = ctx;
    const { stream_url, player_url, encrypted_signature, signature_key, n_param: nParamFromRequest } = ctx.body as ResolveUrlRequest;

    try {
        console.log(formatLogMessage('info', 'Processing URL resolution request', {
            requestId,
            playerUrl: player_url,
            streamUrl: stream_url,
            hasSignature: !!encrypted_signature,
            hasNParam: !!nParamFromRequest
        }));

        // Validate required parameters
        if (!stream_url || !player_url) {
            const error = createApiError(
                'stream_url and player_url are required',
                'MISSING_REQUIRED_PARAMS',
                { received: Object.keys(ctx.body) },
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

        const solvers = await getSolvers(player_url);

        if (!solvers) {
            const error = createApiError(
                'Failed to generate solvers from player script',
                'SOLVER_GENERATION_FAILED',
                { player_url },
                requestId
            );
            
            return new Response(JSON.stringify({
                success: false,
                error,
                timestamp: new Date().toISOString()
            }), { 
                status: 500, 
                headers: { 
                    "Content-Type": "application/json",
                    "X-Request-ID": requestId
                } 
            });
        }

        const url = new URL(stream_url);

        // Handle signature decryption
        if (encrypted_signature) {
            if (!solvers.sig) {
                const error = createApiError(
                    'No signature solver found for this player',
                    'NO_SIGNATURE_SOLVER',
                    { player_url },
                    requestId
                );
                
                return new Response(JSON.stringify({
                    success: false,
                    error,
                    timestamp: new Date().toISOString()
                }), { 
                    status: 500, 
                    headers: { 
                        "Content-Type": "application/json",
                        "X-Request-ID": requestId
                    } 
                });
            }
            
            try {
                const decryptedSig = solvers.sig(encrypted_signature);
                const sigKey = signature_key || 'sig';
                url.searchParams.set(sigKey, decryptedSig);
                url.searchParams.delete("s");
            } catch (error) {
                console.error(formatLogMessage('error', 'Signature decryption failed in URL resolution', {
                    requestId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }));
            }
        }

        // Handle N parameter decryption
        let nParam = nParamFromRequest || null;
        if (!nParam) {
            nParam = url.searchParams.get("n");
        }

        if (solvers.n && nParam) {
            try {
                const decryptedN = solvers.n(nParam);
                url.searchParams.set("n", decryptedN);
            } catch (error) {
                console.error(formatLogMessage('error', 'N parameter decryption failed in URL resolution', {
                    requestId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }));
            }
        }
        
        const processingTime = Date.now() - startTime;
        
        console.log(formatLogMessage('info', 'URL resolution completed', {
            requestId,
            processingTime,
            resolvedUrl: url.toString()
        }));

        // Return response in Lavalink-compatible format
        const response = {
            resolved_url: url.toString(),
            success: true,
            timestamp: new Date().toISOString(),
            processing_time_ms: processingTime
        };

        return new Response(JSON.stringify(response), { 
            status: 200, 
            headers: { 
                "Content-Type": "application/json",
                "X-Request-ID": requestId
            } 
        });

    } catch (error) {
        console.error(formatLogMessage('error', 'URL resolution handler failed', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error'
        }));

        const apiError = createApiError(
            'URL resolution failed',
            'RESOLUTION_ERROR',
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