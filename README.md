# Minemen Club API

Standalone Express API for Minemen Club player profiles, status, matches, friends, practice stats, leaderboards, and clubs.

## Run with Docker

On a VPS with Docker and Compose installed:

```bash
git clone https://github.com/adoringlol/minemen-club-api.git minemen-club-api
cd minemen-club-api
cp .env.example .env
# Edit .env and set API_KEYS to a long, unique secret.
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
  -e API_KEYS="replace-with-a-long-random-secret" \
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

## Authentication and rate limits

Every `/v1` endpoint requires an `API-Key` request header. The documentation page is public so users can enter their key in Scalar's authentication panel and try endpoints directly.

```bash
curl -H "API-Key: your-secret-key" http://YOUR_VPS_IP:4000/v1/status/PlayerName
```

Configure these values in `.env`:

```dotenv
# One key, or multiple comma-separated keys.
API_KEYS=replace-with-a-long-random-secret
# Maximum requests each key can make in a time window.
RATE_LIMIT_MAX=60
RATE_LIMIT_WINDOW_SECONDS=60
```

Each successful authenticated response includes:

```text
RateLimit: 60;w=60
RateLimit-Remaining: 59
```

When a key reaches its quota, the API returns `429 Too Many Requests` and includes:

```text
RateLimit: 60;w=60
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
