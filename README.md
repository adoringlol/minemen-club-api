# Minemen Club API

Standalone Express API for Minemen Club player profiles, status, matches, friends, practice stats, leaderboards, and clubs.

## Run with Docker

On a VPS with Docker and Compose installed:

```bash
git clone <your-github-repository-url> minemen-club-api
cd minemen-club-api
docker compose up -d --build
```

The API will be available on port `4000`:

```text
http://YOUR_VPS_IP:4000/
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

## Configuration

Copy `.env.example` to `.env` when running locally. Docker already supplies the data and log paths. Runtime files are kept in `/app/data` and `/app/logs`, so the included Compose volumes preserve them across container rebuilds.

If you have tab-export JSON files from the Minecraft mod, mount their directory and set `MMC_TAB_DIR` to that path. Without those files, the API uses the public web-scraping fallback.

## Endpoints

Open `/` for the current endpoint list. Examples:

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
