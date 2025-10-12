/**
 * EJS (Enhanced JavaScript Solver) Integration
 * Based on https://github.com/yt-dlp/ejs
 */

import { preprocessPlayer, getFromPrepared } from "../ejs/src/yt/solver/solvers.ts";
import { isOneOf } from "../ejs/src/utils.ts";

export interface EJSRequest {
    type: "n" | "sig";
    challenges: string[];
}

export interface EJSResponse {
    type: "result" | "error";
    data?: Record<string, string>;
    error?: string;
}

export interface EJSInput {
    type: "player" | "preprocessed";
    player?: string;
    preprocessed_player?: string;
    requests: EJSRequest[];
}

export interface EJSOutput {
    responses: EJSResponse[];
}

/**
 * Process EJS requests using the official yt-dlp EJS solver
 */
export function processEJSRequests(input: EJSInput): EJSOutput {
    try {
        const preprocessedPlayer = input.type === "player" 
            ? preprocessPlayer(input.player!)
            : input.preprocessed_player!;
        
        const solvers = getFromPrepared(preprocessedPlayer);

        const responses = input.requests.map((request): EJSResponse => {
            if (!isOneOf(request.type, "n", "sig")) {
                return {
                    type: "error",
                    error: `Unknown request type: ${request.type}`,
                };
            }
            
            const solver = solvers[request.type];
            if (!solver) {
                return {
                    type: "error",
                    error: `Failed to extract ${request.type} function`,
                };
            }
            
            try {
                return {
                    type: "result",
                    data: Object.fromEntries(
                        request.challenges.map((challenge) => [challenge, solver(challenge)]),
                    ),
                };
            } catch (error) {
                return {
                    type: "error",
                    error: `Solver error: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        });

        return { responses };
    } catch (error) {
        return {
            responses: [{
                type: "error",
                error: `EJS processing error: ${error instanceof Error ? error.message : String(error)}`,
            }]
        };
    }
}

/**
 * Preprocess a YouTube player script using EJS
 */
export function preprocessPlayerScript(playerScript: string): string {
    try {
        return preprocessPlayer(playerScript);
    } catch (error) {
        throw new Error(`Failed to preprocess player script: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Extract solvers from preprocessed player script
 */
export function extractSolversFromPreprocessed(preprocessedScript: string) {
    try {
        return getFromPrepared(preprocessedScript);
    } catch (error) {
        throw new Error(`Failed to extract solvers: ${error instanceof Error ? error.message : String(error)}`);
    }
}