# Use the official Deno image with specific version
FROM denoland/deno:2.5.4

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN groupadd -r ytcipher && useradd -r -g ytcipher ytcipher

# Copy the application files
COPY . .

# Create necessary directories and set permissions
RUN mkdir -p /app/player_cache /app/.deno && \
    chown -R ytcipher:ytcipher /app

# Set environment variables
ENV DENO_DIR=/app/.deno
ENV DENO_CACHE=/app/.deno
ENV DENO_NO_PACKAGE_JSON=1
ENV DENO_UNSTABLE=1

# Install dependencies and cache them
RUN deno cache server.ts && \
    deno cache src/workerPool.ts && \
    deno cache src/playerCache.ts && \
    deno cache src/handlers/*.ts && \
    deno cache src/middleware.ts && \
    deno cache src/validation.ts && \
    deno cache src/metrics.ts && \
    deno cache src/utils.ts && \
    deno cache src/types.ts

# Switch to non-root user
USER ytcipher

# Expose the port
EXPOSE 8001

# Health check with improved logic
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD deno run --allow-net --allow-read --allow-write --allow-env -A -e "try { const res = await fetch('http://localhost:3000/health'); if (res.ok) { const data = await res.json(); if (data.status === 'healthy' || data.status === 'degraded') { Deno.exit(0); } } } catch { } Deno.exit(1);"

# Add labels for better container management
LABEL maintainer="RY4N <https://github.com/ryanisnomore>"
LABEL description="High-performance YouTube signature decryption service"
LABEL version="0.0.1"
LABEL org.opencontainers.image.source="https://github.com/ryanisnomore/yt-cipher"
LABEL org.opencontainers.image.description="YouTube signature decryption service for Lavalink"
LABEL org.opencontainers.image.licenses="MIT"

# Run the application
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-sys", "server.ts"]
