# Minemen Club API

Standalone Express API for Minemen Club player profiles, status, matches, friends, practice stats, leaderboards, and clubs.

## Run with Docker

On a VPS with Docker and Compose installed:

```bash
git clone https://github.com/adoringlol/minemen-club-api.git minemen-club-api
cd minemen-club-api
cp .env.example .env
# API keys are optional. Edit .env only if you want custom key limits.
docker compose up -d --build
```

The API will be available on port `4000`:

```text
http://YOUR_VPS_IP:4000/
```

Interactive API documentation is available at:

```text
http://YOUR_VPS_IP:4000/docs
```

To update it later:

```bash
git pull
docker compose up -d --build
```

To run without Compose:

```bash
docker build -t minemen-club-api .
docker run -d --name minemen-club-api --restart unless-stopped -p 4000:4000 \
  -v minemen-api-data:/app/data \
  -v minemen-api-logs:/app/logs \
  minemen-club-api
```

## Run locally without Docker

Requires Node.js 20 or newer.

```bash
npm ci
npm start
```

## Rate limits and optional API keys

No API key is required. Requests without an `API-Key` are rate-limited per client IP address to **60 requests every 5 minutes**.

```bash
curl http://YOUR_VPS_IP:4000/v1/status/PlayerName
```

API keys are optional and are useful when you want to give a user a custom limit:

```bash
curl -H "API-Key: your-secret-key" http://YOUR_VPS_IP:4000/v1/status/PlayerName
```

Configure these values in `.env`:

```dotenv
# Optional: one key, or multiple comma-separated keys.
API_KEYS=replace-with-a-long-random-secret
# Optional per-key override. Format: api-key=requests-per-window
API_KEY_LIMITS=partner-key=120
# Maximum requests each key can make in a time window.
RATE_LIMIT_MAX=60
RATE_LIMIT_WINDOW_SECONDS=60
# Anonymous requests without an API key: 60 requests per 5 minutes per client IP.
ANONYMOUS_RATE_LIMIT_MAX=60
ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS=300
# Set to 1 when the API is behind one trusted reverse proxy such as Nginx.
TRUST_PROXY_HOPS=0
```

Keys not listed in `API_KEY_LIMITS` use `RATE_LIMIT_MAX`; the custom limit still uses the shared `RATE_LIMIT_WINDOW_SECONDS` window. For example, the above makes `partner-key` eligible for 120 requests per 60 seconds. Sending an invalid API key returns `401`; omit the header to use the anonymous limit instead.

## Create a key with a custom limit

On the VPS, from the repository folder, create a cryptographically secure key and add it to `.env` in one command:

```bash
npm run key:create -- --limit 120
docker compose up -d
```

The command prints the new key once, adds it to both `API_KEYS` and `API_KEY_LIMITS`, and sets its limit to 120 requests per window. Save the printed key securely and give it to the intended user. To revoke a key, remove it from both variables in `.env`, then restart the container.

Anonymous responses include:

```text
RateLimit: 60;w=300
RateLimit-Remaining: 59
```

Responses made with an API key display that key’s own configured limit instead.

When a key reaches its quota, the API returns `429 Too Many Requests` and includes:

```text
RateLimit: 60;w=300
RateLimit-Remaining: 0
Retry-After: 42
```

Rate-limit counts are kept in memory, so restarting or redeploying the container resets them.

## Configuration

Copy `.env.example` to `.env` when running locally. Docker already supplies the data and log paths. Runtime files are kept in `/app/data` and `/app/logs`, so the included Compose volumes preserve them across container rebuilds.

If you have tab-export JSON files from the Minecraft mod, mount their directory and set `MMC_TAB_DIR` to that path. Without those files, the API uses the public web-scraping fallback.

## Endpoints

Open `/docs` for Scalar's interactive API reference or `/openapi.json` for the OpenAPI document. Examples:

```text
GET /v1/player/:name
GET /v1/status/:name
GET /v1/matches/:name
GET /v1/friends/:name
GET /v1/stats/:mode/:name
GET /v1/stats/:mode/:name/:gamemode
GET /v1/leaderboard/:mode/:gamemode
GET /v1/clubs/player/:name
```
