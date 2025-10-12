import type { RequestContext, ValidateSignatureRequest } from "../types.ts";
import { createApiError, formatLogMessage } from "../utils.ts";

export async function handleValidateSignature(ctx: RequestContext): Promise<Response> {
    const { body, requestId, startTime } = ctx;
    
    try {
        // Type guard for ValidateSignatureRequest
        const validateRequest = body as ValidateSignatureRequest;
        
        // Validate request body
        if (!validateRequest.encrypted_signature || !validateRequest.player_url) {
            const error = createApiError(
                'encrypted_signature and player_url are required',
                'INVALID_REQUEST',
                { received: Object.keys(body) },
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

        console.log(formatLogMessage('info', 'Processing signature validation', {
            requestId,
            signatureLength: validateRequest.encrypted_signature.length,
            playerUrl: validateRequest.player_url
        }));

        // Basic signature validation logic
        const signature = validateRequest.encrypted_signature;
        let isValid = false;
        let signatureType = 'unknown';

        // Check if signature looks like a valid YouTube signature
        if (signature.length >= 10 && signature.length <= 200) {
            // Check for common YouTube signature patterns
            if (signature.match(/^[A-Za-z0-9+/=_-]+$/)) {
                isValid = true;
                
                // Determine signature type based on length and pattern
                if (signature.length <= 50) {
                    signatureType = 'short';
                } else if (signature.length <= 100) {
                    signatureType = 'medium';
                } else {
                    signatureType = 'long';
                }
            }
        }

        // Additional validation based on player URL
        const playerUrlValid = validateRequest.player_url.includes('youtube.com/s/player/') || 
                              validateRequest.player_url.includes('youtube.com/yts/jsbin/');

        if (!playerUrlValid) {
            isValid = false;
            signatureType = 'invalid_player_url';
        }

        const processingTime = Date.now() - startTime;
        
        console.log(formatLogMessage('info', 'Signature validation completed', {
            requestId,
            isValid,
            signatureType,
            processingTime
        }));

        return new Response(JSON.stringify({
            is_valid: isValid,
            signature_type: signatureType,
            signature_length: signature.length,
            player_url_valid: playerUrlValid,
            validation_details: {
                length_check: signature.length >= 10 && signature.length <= 200,
                pattern_check: signature.match(/^[A-Za-z0-9+/=_-]+$/) !== null,
                player_url_check: playerUrlValid
            },
            success: true,
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
        console.error(formatLogMessage('error', 'Signature validation failed', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error'
        }));

        const apiError = createApiError(
            'Signature validation failed',
            'VALIDATION_ERROR',
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