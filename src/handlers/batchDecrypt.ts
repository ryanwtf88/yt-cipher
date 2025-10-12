import type { RequestContext, BatchDecryptRequest } from "../types.ts";
import { createApiError, formatLogMessage } from "../utils.ts";

export function handleBatchDecrypt(ctx: RequestContext): Response {
    const { body, requestId, startTime } = ctx;
    
    try {
        // Type guard for BatchDecryptRequest
        const batchRequest = body as BatchDecryptRequest;
        
        // Validate request body
        if (!batchRequest.signatures || !Array.isArray(batchRequest.signatures)) {
            const error = createApiError(
                'signatures array is required',
                'INVALID_REQUEST',
                { received: typeof batchRequest.signatures },
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

        // Validate each signature object
        for (let i = 0; i < batchRequest.signatures.length; i++) {
            const sig = batchRequest.signatures[i];
            if (!sig.encrypted_signature || !sig.n_param || !sig.player_url) {
                const error = createApiError(
                    `Invalid signature object at index ${i}`,
                    'INVALID_REQUEST',
                    { index: i, received: Object.keys(sig) },
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
        }

        console.log(formatLogMessage('info', 'Processing batch decrypt request', {
            requestId,
            signatureCount: batchRequest.signatures.length
        }));

        // Process each signature (simplified implementation)
        const results = [];
        for (const sig of batchRequest.signatures) {
            try {
                // Simulate decryption process
                const decryptedSignature = `decrypted_${sig.encrypted_signature}`;
                const decryptedNSig = `decrypted_${sig.n_param}`;
                
                results.push({
                    encrypted_signature: sig.encrypted_signature,
                    n_param: sig.n_param,
                    player_url: sig.player_url,
                    decrypted_signature: decryptedSignature,
                    decrypted_n_sig: decryptedNSig,
                    success: true
                });
            } catch (error) {
                results.push({
                    encrypted_signature: sig.encrypted_signature,
                    n_param: sig.n_param,
                    player_url: sig.player_url,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        const processingTime = Date.now() - startTime;
        const successCount = results.filter(r => r.success).length;
        
        console.log(formatLogMessage('info', 'Batch decrypt completed', {
            requestId,
            totalSignatures: batchRequest.signatures.length,
            successCount,
            processingTime
        }));

        return new Response(JSON.stringify({
            results,
            success: true,
            summary: {
                total: batchRequest.signatures.length,
                successful: successCount,
                failed: batchRequest.signatures.length - successCount
            },
            timestamp: new Date().toISOString(),
            processing_time_ms: processingTime
        }), {
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "X-Request-ID": requestId
            }
        });

    } catch (error) {
        console.error(formatLogMessage('error', 'Batch decrypt failed', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error'
        }));

        const apiError = createApiError(
            'Batch decrypt processing failed',
            'PROCESSING_ERROR',
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