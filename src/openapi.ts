
export const openApiSpec = {
    openapi: "3.0.0",
    info: {
        title: "YT-Cipher API",
        version: "1.0.0",
        description: "High-performance YouTube signature decryption and URL resolution API. Part of the Susanoo Protocol.",
        contact: {
            name: "RY4N"
        }
    },
    servers: [
        {
            url: "/",
            description: "Current Server"
        }
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                description: "Enter your API token (default: RY4N)"
            }
        },
        schemas: {
            SignatureRequest: {
                type: "object",
                required: ["encrypted_signature", "player_url"],
                properties: {
                    encrypted_signature: { type: "string" },
                    n_param: { type: "string" },
                    player_url: { type: "string" }
                }
            },
            SignatureResponse: {
                type: "object",
                properties: {
                    decrypted_signature: { type: "string" },
                    decrypted_n_sig: { type: "string" }
                }
            },
            StsRequest: {
                type: "object",
                required: ["player_url"],
                properties: {
                    player_url: { type: "string" }
                }
            },
            StsResponse: {
                type: "object",
                properties: {
                    sts: { type: "string" },
                    success: { type: "boolean" },
                    timestamp: { type: "string" },
                    processing_time_ms: { type: "number" }
                }
            },
            ResolveUrlRequest: {
                type: "object",
                required: ["stream_url", "player_url"],
                properties: {
                    stream_url: { type: "string" },
                    player_url: { type: "string" },
                    encrypted_signature: { type: "string" },
                    signature_key: { type: "string" },
                    n_param: { type: "string" }
                }
            },
            ResolveUrlResponse: {
                type: "object",
                properties: {
                    resolved_url: { type: "string" }
                }
            },
            BatchDecryptRequest: {
                type: "object",
                required: ["signatures"],
                properties: {
                    signatures: {
                        type: "array",
                        items: { "$ref": "#/components/schemas/SignatureRequest" }
                    }
                }
            },
            BatchDecryptResponse: {
                type: "object",
                properties: {
                    results: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                encrypted_signature: { type: "string" },
                                n_param: { type: "string" },
                                player_url: { type: "string" },
                                decrypted_signature: { type: "string" },
                                decrypted_n_sig: { type: "string" },
                                success: { type: "boolean" },
                                error: { type: "string" }
                            }
                        }
                    },
                    summary: {
                        type: "object",
                        properties: {
                            total: { type: "number" },
                            successful: { type: "number" },
                            failed: { type: "number" }
                        }
                    }
                }
            },
            ValidateSignatureRequest: {
                type: "object",
                required: ["encrypted_signature", "player_url"],
                properties: {
                    encrypted_signature: { type: "string" },
                    player_url: { type: "string" }
                }
            },
            ValidateSignatureResponse: {
                type: "object",
                properties: {
                    is_valid: { type: "boolean" },
                    signature_type: { type: "string" },
                    signature_length: { type: "number" },
                    player_url_valid: { type: "boolean" },
                    validation_details: {
                        type: "object",
                        properties: {
                            length_check: { type: "boolean" },
                            pattern_check: { type: "boolean" },
                            player_url_check: { type: "boolean" }
                        }
                    }
                }
            },
            ClearCacheRequest: {
                type: "object",
                properties: {
                    cache_type: {
                        type: "string",
                        enum: ["all", "player", "solver", "preprocessed", "sts"]
                    },
                    clear_all: { type: "boolean" }
                }
            },
            ClearCacheResponse: {
                type: "object",
                properties: {
                    cleared_caches: {
                        type: "array",
                        items: { type: "string" }
                    },
                    cache_count: { type: "number" },
                    clear_all: { type: "boolean" }
                }
            },
            ApiError: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: false },
                    error: {
                        type: "object",
                        properties: {
                            error: { type: "string" },
                            code: { type: "string" },
                            details: { type: "object" },
                            timestamp: { type: "string" },
                            request_id: { type: "string" }
                        }
                    }
                }
            },
            StandardResponse: {
                type: "object",
                properties: {
                    success: { type: "boolean" },
                    timestamp: { type: "string" },
                    request_id: { type: "string" }
                }
            }
        }
    },
    security: [
        { bearerAuth: [] }
    ],
    paths: {
        "/decrypt_signature": {
            post: {
                summary: "Decrypt YouTube signature",
                description: "Decrypts the signature and n-parameter for a video stream.",
                tags: ["Decryption"],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { "$ref": "#/components/schemas/SignatureRequest" }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "Successful decryption",
                        content: {
                            "application/json": {
                                schema: {
                                    allOf: [
                                        { "$ref": "#/components/schemas/StandardResponse" },
                                        { type: "object", properties: { data: { "$ref": "#/components/schemas/SignatureResponse" } } }
                                    ]
                                }
                            }
                        }
                    },
                    "400": { description: "Invalid request", content: { "application/json": { schema: { "$ref": "#/components/schemas/ApiError" } } } },
                    "401": { description: "Unauthorized", content: { "application/json": { schema: { "$ref": "#/components/schemas/ApiError" } } } },
                    "500": { description: "Server error", content: { "application/json": { schema: { "$ref": "#/components/schemas/ApiError" } } } }
                }
            }
        },
        "/get_sts": {
            post: {
                summary: "Get Signature Timestamp (STS)",
                description: "Extracts the STS from a player script.",
                tags: ["Metadata"],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { "$ref": "#/components/schemas/StsRequest" }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "Successful extraction",
                        content: {
                            "application/json": {
                                schema: {
                                    allOf: [
                                        { "$ref": "#/components/schemas/StandardResponse" },
                                        { type: "object", properties: { data: { "$ref": "#/components/schemas/StsResponse" } } }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },
        "/resolve_url": {
            post: {
                summary: "Resolve Stream URL",
                description: "Resolves a stream URL by decrypting necessary parameters.",
                tags: ["Decryption"],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { "$ref": "#/components/schemas/ResolveUrlRequest" }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "URL Resolved",
                        content: {
                            "application/json": {
                                schema: {
                                    allOf: [
                                        { "$ref": "#/components/schemas/StandardResponse" },
                                        { type: "object", properties: { data: { "$ref": "#/components/schemas/ResolveUrlResponse" } } }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },
        "/batch_decrypt": {
            post: {
                summary: "Batch Decrypt Signatures",
                description: "Decrypts multiple signatures in a single request.",
                tags: ["Decryption"],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { "$ref": "#/components/schemas/BatchDecryptRequest" }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "Batch processed",
                        content: {
                            "application/json": {
                                schema: {
                                    allOf: [
                                        { "$ref": "#/components/schemas/StandardResponse" },
                                        { type: "object", properties: { data: { "$ref": "#/components/schemas/BatchDecryptResponse" } } }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },
        "/validate_signature": {
            post: {
                summary: "Validate Signature format",
                description: "Checks if a signature looks like it needs decryption.",
                tags: ["Validation"],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { "$ref": "#/components/schemas/ValidateSignatureRequest" }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "Validation result",
                        content: {
                            "application/json": {
                                schema: {
                                    allOf: [
                                        { "$ref": "#/components/schemas/StandardResponse" },
                                        { type: "object", properties: { data: { "$ref": "#/components/schemas/ValidateSignatureResponse" } } }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },
        "/clear_cache": {
            post: {
                summary: "Clear Caches",
                description: "Clears internal caches to free memory or force updates.",
                tags: ["System"],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: { "$ref": "#/components/schemas/ClearCacheRequest" }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "Cache cleared",
                        content: {
                            "application/json": {
                                schema: {
                                    allOf: [
                                        { "$ref": "#/components/schemas/StandardResponse" },
                                        { type: "object", properties: { data: { "$ref": "#/components/schemas/ClearCacheResponse" } } }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },
        "/health": {
            get: {
                summary: "Health Check",
                description: "Returns the health status of the server.",
                tags: ["System"],
                security: [],
                responses: {
                    "200": {
                        description: "Server is healthy",
                        content: {
                            "application/json": {
                                schema: { type: "object" }
                            }
                        }
                    }
                }
            }
        },
        "/status": {
            get: {
                summary: "Detailed Status",
                description: "Returns detailed system metrics and status.",
                tags: ["System"],
                security: [],
                responses: {
                    "200": {
                        description: "System status",
                        content: {
                            "application/json": {
                                schema: { type: "object" }
                            }
                        }
                    }
                }
            }
        },
        "/metrics": {
            get: {
                summary: "Prometheus Metrics",
                description: "Returns metrics in Prometheus text format.",
                tags: ["System"],
                security: [],
                responses: {
                    "200": {
                        description: "Metrics",
                        content: {
                            "text/plain": {
                                schema: { type: "string" }
                            }
                        }
                    }
                }
            }
        },
        "/info": {
            get: {
                summary: "Server Info",
                description: "General server information.",
                tags: ["System"],
                security: [],
                responses: {
                    "200": {
                        description: "Info",
                        content: {
                            "application/json": {
                                schema: { type: "object" }
                            }
                        }
                    }
                }
            }
        }
    }
};
