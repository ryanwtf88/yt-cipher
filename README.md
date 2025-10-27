# yt-cipher

A high-performance YouTube signature decryption service built with Deno, designed for seamless integration with Lavalink and other music bots.

[![Deno](https://img.shields.io/badge/Deno-2.5.4-blue?logo=deno)](https://deno.land/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.2-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Packages](https://github.com/ryanwtf88/yt-cipher/actions/workflows/image.yml/badge.svg?branch=main)](https://github.com/ryanwtf88/yt-cipher/actions/workflows/image.yml)
[![Version](https://img.shields.io/badge/Version-0.0.1-blue.svg)](https://github.com/ryanwtf88/yt-cipher)
[![Author](https://img.shields.io/badge/Author-RY4N-orange.svg)](https://github.com/ryanwtf88/yt-cipher)
[![Stars](https://img.shields.io/github/stars/ryanwtf88/yt-cipher?style=social)](https://github.com/ryanwtf88/yt-cipher)
[![Forks](https://img.shields.io/github/forks/ryanwtf88/yt-cipher?style=social)](https://github.com/ryanwtf88/yt-cipher)


## Features

- **High Performance**: Built with Deno for optimal speed and memory usage
- **Lavalink Compatible**: Dedicated endpoints for Lavalink YouTube source integration
- **Real-time Monitoring**: Live stats and performance metrics
- **Advanced Caching**: Multi-layer caching with TTL and LRU eviction
- **Worker Pool**: Parallel processing with configurable concurrency
- **Comprehensive Metrics**: Prometheus metrics for monitoring and observability
- **Rate Limiting**: Configurable rate limiting to prevent abuse
- **CORS Support**: Full CORS support for web-based clients
- **Docker Ready**: Production-ready Docker configuration
- **Health Monitoring**: Built-in health checks and status endpoints

## Quick Start

### Prerequisites

- [Deno](https://deno.land/) 2.5.4 or later

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/ryanwtf88/yt-cipher.git
   cd yt-cipher
   ```

2. **Set environment variables (optional)**
   ```bash
   export API_TOKEN="your_custom_api_token"  # Change from default YOUR_API_TOKEN
   export SERVER_PORT=3000                  # Optional: default port
   ```

3. **Run the server**
   ```bash
   deno run --allow-net --allow-read --allow-write --allow-env --allow-sys server.ts
   ```

4. **Verify installation**
   ```bash
   curl http://localhost:3000/health
   ```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_PORT` | `3000` | Server port |
| `SERVER_HOST` | `0.0.0.0` | Server host |
| `API_TOKEN` | `YOUR_API_TOKEN` | API authentication token (change this!) |
| `MAX_THREADS` | `16` | Worker pool concurrency |
| `WORKER_TASK_TIMEOUT` | `60000` | Worker task timeout (ms) |
| `WORKER_MAX_RETRIES` | `5` | Maximum worker retries |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (1 min) |
| `RATE_LIMIT_MAX_REQUESTS` | `999999999` | Max requests per window |
| `LOG_LEVEL` | `warn` | Logging level (debug, info, warn, error) |
| `LOG_FORMAT` | `text` | Log format (text, json) |

### Cache Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PLAYER_CACHE_SIZE` | `10000` | Player cache max size |
| `PLAYER_CACHE_TTL` | `7200000` | Player cache TTL (2 hours) |
| `SOLVER_CACHE_SIZE` | `5000` | Solver cache max size |
| `SOLVER_CACHE_TTL` | `7200000` | Solver cache TTL (2 hours) |
| `PREPROCESSED_CACHE_SIZE` | `15000` | Preprocessed cache max size |
| `PREPROCESSED_CACHE_TTL` | `14400000` | Preprocessed cache TTL (4 hours) |
| `STS_CACHE_SIZE` | `10000` | STS cache max size |
| `STS_CACHE_TTL` | `3600000` | STS cache TTL (1 hour) |

## API Endpoints

### Service Information

- **GET** `/` - Service Information - With Docs
- **GET** `/health` - Health check with real-time monitoring
- **GET** `/status` - Detailed system status with performance metrics
- **GET** `/info` - Server information and capabilities
- **GET** `/metrics` - Prometheus metrics with real-time data

### Core API Endpoints

#### POST /decrypt_signature

Decrypt YouTube signature and n parameter.

**Request:**
```json
{
  "encrypted_signature": "encrypted_signature_string",
  "n_param": "encrypted_n_param_string",
  "player_url": "https://www.youtube.com/s/player/player_id/player.js"
}
```

**Response:**
```json
{
  "decrypted_signature": "decrypted_signature_string",
  "decrypted_n_sig": "decrypted_n_param_string",
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "processing_time_ms": 150
}
```

#### POST /get_sts

Extract signature timestamp from player script.

**Request:**
```json
{
  "player_url": "https://www.youtube.com/s/player/player_id/player.js"
}
```

**Response:**
```json
{
  "sts": "12345",
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "processing_time_ms": 100
}
```

#### POST /resolve_url

Resolve YouTube stream URL with decrypted parameters.

**Request:**
```json
{
  "stream_url": "https://example.com/video?c=WEB&cver=2.0&s=encrypted_signature&n=encrypted_n_param",
  "player_url": "https://www.youtube.com/s/player/player_id/player.js",
  "encrypted_signature": "encrypted_signature_string",
  "signature_key": "sig",
  "n_param": "encrypted_n_param_string"
}
```

**Response:**
```json
{
  "resolved_url": "https://example.com/video?c=WEB&cver=2.0&sig=decrypted_signature&n=decrypted_n_param",
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "processing_time_ms": 200
}
```

## Lavalink Integration

yt-cipher is fully compatible with Lavalink YouTube source integration using the standard API endpoints. It implements the RemoteCipherManager interface required by Lavalink's YouTube source plugin.

### API Compatibility

The service provides the following endpoints that Lavalink expects:

- **POST /decrypt_signature** - Decrypts YouTube signatures and N parameters
- **POST /get_sts** - Extracts signature timestamps from player scripts  
- **POST /resolve_url** - Resolves YouTube stream URLs with decrypted parameters

### Response Format

All endpoints return responses in the format expected by Lavalink:

```json
{
  "decrypted_signature": "decrypted_value",
  "decrypted_n_sig": "decrypted_n_value", 
  "sts": "timestamp_value",
  "resolved_url": "https://resolved-url.com",
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "processing_time_ms": 150
}
```

### Configuration

Set the API token for authentication:

```bash
export API_TOKEN="your_custom_api_token"
```

### Lavalink Configuration

#### Lavaplayer
```java
YoutubeSourceOptions options = new YoutubeSourceOptions()
    .setRemoteCipherUrl("http://localhost:3000", "your_custom_api_token");
YoutubeAudioSourceManager sourceManager = new YoutubeAudioSourceManager(options, ...);
```

#### Lavalink
```yaml
plugins:
  youtube:
    remoteCipher:
      url: "http://localhost:3000"
      password: "your_custom_api_token"
      userAgent: "your_service_name"
      timeout: 10000
      retryOnFailure: true
```

### Authentication

All API endpoints require API token authentication using the `Authorization` header:

```
Authorization: Bearer your_custom_api_token
```

**Important**: Change the default token `YOUR_API_TOKEN` to a secure custom token in production!

## Docker Deployment

### Using Docker Compose (Recommended)

1. **Clone and configure**
   ```bash
   git clone https://github.com/ryanisnomore/yt-cipher.git
   cd yt-cipher
   ```

2. **Set environment variables**
   ```bash
   export API_TOKEN="your_custom_api_token"  # Change this!
   ```

3. **Start the service**
   ```bash
   docker-compose up -d
   ```

4. **Verify deployment**
   ```bash
   curl http://localhost:3000/health
   ```

### Using Docker

1. **Build the image**
   ```bash
   docker build -t yt-cipher .
   ```

2. **Run the container**
   ```bash
   docker run -d \
     --name yt-cipher \
     -p 3000:3000 \
     -e API_TOKEN="your_custom_api_token" \
     -v player_cache:/app/player_cache \
     yt-cipher
   ```

## Monitoring

### Health Checks

- **GET** `/health` - Basic health check with real-time data
- **GET** `/status` - Detailed system status including performance metrics

### Prometheus Metrics

Access metrics at `/metrics` endpoint:

- **HTTP Metrics**: Request counts, response times, status codes
- **Cache Metrics**: Hit rates, miss rates, cache sizes
- **Worker Metrics**: Task counts, processing times, error rates
- **System Metrics**: Memory usage, uptime, active connections
- **Real-time Metrics**: Live performance data

### Real-time Monitoring

The service provides real-time monitoring through:

- Live request statistics
- Active connection counts
- Average response times
- Error rates and performance metrics
- Interactive HTML dashboard at `/`

## Development

### Prerequisites

- Deno 2.5.4+

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/ryanwtf88/yt-cipher.git
   cd yt-cipher
   ```

2. **Run in development mode**
   ```bash
   deno run --allow-net --allow-read --allow-write --allow-env --allow-sys server.ts
   ```

### Testing

Run the test suite:

```bash
# Type checking
deno check server.ts

# Run with debug logging
LOG_LEVEL=debug deno run --allow-net --allow-read --allow-write --allow-env --allow-sys server.ts
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started, report issues, and submit pull requests.

## Security

If you discover a security vulnerability, please refer to our [SECURITY.md](SECURITY.md) for responsible disclosure guidelines and contact information.

## Code of Conduct

By participating in this project, you agree to abide by our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Let's foster a positive and inclusive environment together.

## License

This project is licensed under the [MIT License](LICENSE).


## Acknowledgments

- [Deno](https://deno.land/) - The runtime that powers this service
- [Lavalink](https://github.com/lavalink-devs/Lavalink) - The music bot framework this integrates with
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - For YouTube extraction inspiration
- [EJS](https://github.com/yt-dlp/ejs) - For signature decryption algorithms
- [yt-cipher](https://github.com/kikkia/yt-cipher) - The repository this is based off of and should be forked from ;)
- [cursor](https://cursor.com/) - The author of basically all the code not from the above repo

## Support

- **Issues**: [GitHub Issues](https://github.com/ryanwtf88/yt-cipher/issues)
- **Discussions**: [GitHub Discussions](https://github.com/ryanwtf88/yt-cipher/discussions)
- **Documentation**: [API Docs](http://localhost:3000/api/docs) (when running)

---

**Made with ❤️ by [RY4N](https://github.com/ryanwtf88)**
