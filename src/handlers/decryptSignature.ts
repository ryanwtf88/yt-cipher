import { getSolvers } from "../solver.ts";
import type { RequestContext, SignatureRequest } from "../types.ts";
import { createApiError, formatLogMessage } from "../utils.ts";

export async function handleDecryptSignature(ctx: RequestContext): Promise<Response> {
    const { requestId, startTime } = ctx;
    const { encrypted_signature, n_param, player_url } = ctx.body as SignatureRequest;

    try {
        console.log(formatLogMessage('info', 'Processing signature decryption request', {
            requestId,
            playerUrl: player_url,
            hasSignature: !!encrypted_signature,
            hasNParam: !!n_param
        }));

        // Validate required parameters
        if (!player_url) {
            const error = createApiError(
                'player_url is required',
                'MISSING_PLAYER_URL',
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

        let decrypted_signature = '';
        if (encrypted_signature && solvers.sig) {
            try {
                decrypted_signature = solvers.sig(encrypted_signature);
            } catch (error) {
                console.error(formatLogMessage('error', 'Signature decryption failed', {
                    requestId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }));
            }
        }

        let decrypted_n_sig = '';
        if (n_param && solvers.n) {
            try {
                decrypted_n_sig = solvers.n(n_param);
            } catch (error) {
                console.error(formatLogMessage('error', 'N parameter decryption failed', {
                    requestId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }));
            }
        }

        const processingTime = Date.now() - startTime;
        
        console.log(formatLogMessage('info', 'Signature decryption completed', {
            requestId,
            processingTime,
            success: !!(decrypted_signature || decrypted_n_sig)
        }));

        // Return response in Lavalink-compatible format
        const response = {
            decrypted_signature,
            decrypted_n_sig,
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
        console.error(formatLogMessage('error', 'Signature decryption handler failed', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error'
        }));

        const apiError = createApiError(
            'Signature decryption failed',
            'DECRYPTION_ERROR',
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