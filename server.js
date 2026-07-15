import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { scrapePlayerProfile, scrapeMatchHistory, scrapePlayerFriends, scrapePlayerStats, scrapePlayerGamemodeStats, scrapeLeaderboardBatch, scrapeLeaderboardPlacement, scrapeClub, scrapeClubByPlayer, GAMEMODE_SLUGS } from './src/scraper.js';

const app = express();
const PORT = Number(process.env.PORT || process.env.API_PORT || 4000);

app.use(cors());
app.use(express.json());

// --- Simple in-memory cache ---
const cache = new Map();
const CACHE_TTL_MS = 30_000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { ts: Date.now(), data });
}

// --- Helpers ---
function normalize(name) {
  return name.trim();
}

async function getProfile(player) {
  const key = `profile:${player.toLowerCase()}`;
  const cached = getCached(key);
  if (cached) return { data: cached, cached: true };
  const data = await scrapePlayerProfile(player);
  if (!data.error) setCache(key, data);
  return { data, cached: false };
}

// --- Routes ---

app.get('/', (req, res) => {
  res.json({
    name: 'Minemen Club API',
    version: 'v1',
    endpoints: [
      'GET /v1/player/:name',
      'GET /v1/status/:name',
      'GET /v1/matches/:name',
      'GET /v1/friends/:name',
      'GET /v1/stats/:mode/:name           (mode = classic | modern)',
      'GET /v1/stats/:mode/:name/:gamemode (per-gamemode detail)',
      'GET /v1/leaderboard/:mode/:gamemode                 (top 10)',
      'GET /v1/leaderboard/:mode/:gamemode/offset/:offset  (page from offset)',
      'GET /v1/leaderboard/:mode/:gamemode/placement/:n    (single entry at placement n)',
      'GET /v1/clubs/id/:clubId       (club roster by id)',
      'GET /v1/clubs/player/:name     (club roster by player)',
      'GET /v1/generator/:name        (list all player endpoints for :name)',
    ],
  });
});

// Full player profile
app.get('/v1/player/:name', async (req, res) => {
  const player = normalize(req.params.name);
  const { data, cached } = await getProfile(player);
  if (data.error) return res.status(data.httpStatus || 500).json({ error: data.error });
  res.json({ ...data, cached });
});

// Status only — fast for polling
app.get('/v1/status/:name', async (req, res) => {
  const player = normalize(req.params.name);
  const { data, cached } = await getProfile(player);
  if (data.error) return res.status(data.httpStatus || 500).json({ error: data.error });
  res.json({
    player: data.player,
    status: data.status,
    server: data.server,
    region: data.region,
    last_seen_unix: data.last_seen_unix,
    rank: data.rank,
    cached,
  });
});

// Recent match history
app.get('/v1/matches/:name', async (req, res) => {
  const player = normalize(req.params.name);
  const key = `matches:${player.toLowerCase()}`;
  const cached = getCached(key);
  if (cached) return res.json({ ...cached, cached: true });

  const [data, err] = await scrapeMatchHistory(player);
  if (err) return res.status(500).json({ error: err });

  const result = { player, matches: data.matches };
  setCache(key, result);
  res.json(result);
});

// Friends — count + available friend names
app.get('/v1/friends/:name', async (req, res) => {
  const player = normalize(req.params.name);
  const key = `friends:${player.toLowerCase()}`;
  const cached = getCached(key);
  if (cached) return res.json({ ...cached, cached: true });

  const data = await scrapePlayerFriends(player);
  if (data.error) return res.status(data.httpStatus || 500).json({ error: data.error });

  setCache(key, data);
  res.json(data);
});

// Practice stats overview for a mode (classic | modern)
app.get('/v1/stats/:mode/:name', async (req, res) => {
  const mode = normalize(req.params.mode).toLowerCase();
  const player = normalize(req.params.name);
  const key = `stats:${mode}:${player.toLowerCase()}`;
  const cached = getCached(key);
  if (cached) return res.json({ ...cached, cached: true });

  const data = await scrapePlayerStats(player, mode);
  if (data.error) return res.status(data.httpStatus || 500).json({ error: data.error });

  setCache(key, data);
  res.json(data);
});

// Detailed stats for a single gamemode
app.get('/v1/stats/:mode/:name/:gamemode', async (req, res) => {
  const mode = normalize(req.params.mode).toLowerCase();
  const player = normalize(req.params.name);
  const gamemode = normalize(req.params.gamemode).toLowerCase();
  const key = `stats:${mode}:${player.toLowerCase()}:${gamemode}`;
  const cached = getCached(key);
  if (cached) return res.json({ ...cached, cached: true });

  const data = await scrapePlayerGamemodeStats(player, mode, gamemode);
  if (data.error) return res.status(data.httpStatus || 500).json({ error: data.error });

  setCache(key, data);
  res.json(data);
});

// Leaderboard — single entry at a given placement (offset computed automatically)
app.get('/v1/leaderboard/:mode/:gamemode/placement/:placement', async (req, res) => {
  const mode = normalize(req.params.mode).toLowerCase();
  const gamemode = normalize(req.params.gamemode).toLowerCase();
  const placement = req.params.placement;
  const key = `lb:${mode}:${gamemode}:p${placement}`;
  const cached = getCached(key);
  if (cached) return res.json({ ...cached, cached: true });

  const data = await scrapeLeaderboardPlacement(mode, gamemode, placement);
  if (data.error) return res.status(data.httpStatus || 500).json({ error: data.error });

  setCache(key, data);
  res.json(data);
});

// Leaderboard — page of entries starting at offset
app.get('/v1/leaderboard/:mode/:gamemode/offset/:offset', async (req, res) => {
  const mode = normalize(req.params.mode).toLowerCase();
  const gamemode = normalize(req.params.gamemode).toLowerCase();
  const offset = req.params.offset;
  const key = `lb:${mode}:${gamemode}:o${offset}`;
  const cached = getCached(key);
  if (cached) return res.json({ ...cached, cached: true });

  const data = await scrapeLeaderboardBatch(mode, gamemode, offset);
  if (data.error) return res.status(data.httpStatus || 500).json({ error: data.error });

  setCache(key, data);
  res.json(data);
});

// Leaderboard — top 10 (offset 0)
app.get('/v1/leaderboard/:mode/:gamemode', async (req, res) => {
  const mode = normalize(req.params.mode).toLowerCase();
  const gamemode = normalize(req.params.gamemode).toLowerCase();
  const key = `lb:${mode}:${gamemode}:o0`;
  const cached = getCached(key);
  if (cached) return res.json({ ...cached, cached: true });

  const data = await scrapeLeaderboardBatch(mode, gamemode, 0);
  if (data.error) return res.status(data.httpStatus || 500).json({ error: data.error });

  setCache(key, data);
  res.json(data);
});

// Club roster by club id
app.get('/v1/clubs/id/:clubId', async (req, res) => {
  const clubId = normalize(req.params.clubId);
  const key = `club:${clubId.toLowerCase()}`;
  const cached = getCached(key);
  if (cached) return res.json({ ...cached, cached: true });

  const data = await scrapeClub(clubId);
  if (data.error) return res.status(data.httpStatus || 500).json({ error: data.error });

  setCache(key, data);
  res.json(data);
});

// Club roster by player (resolves their club id, then loads the club)
app.get('/v1/clubs/player/:name', async (req, res) => {
  const player = normalize(req.params.name);
  const key = `clubplayer:${player.toLowerCase()}`;
  const cached = getCached(key);
  if (cached) return res.json({ ...cached, cached: true });

  const data = await scrapeClubByPlayer(player);
  if (data.error) return res.status(data.httpStatus || 500).json({ error: data.error });

  setCache(key, data);
  res.json(data);
});

// Generator — list all player-scoped endpoints for a given player name
app.get('/v1/generator/:name', (req, res) => {
  const player = normalize(req.params.name);
  const base = process.env.API_BASE_URL || `http://localhost:${PORT}`;

  const endpoints = [
    { description: 'Full player profile',            path: `/v1/player/${player}` },
    { description: 'Online status (fast poll)',       path: `/v1/status/${player}` },
    { description: 'Recent match history',            path: `/v1/matches/${player}` },
    { description: 'Friends list',                    path: `/v1/friends/${player}` },
    { description: 'Classic practice stats',          path: `/v1/stats/classic/${player}` },
    { description: 'Modern practice stats',           path: `/v1/stats/modern/${player}` },
    { description: 'Classic stats — per gamemode',    path: `/v1/stats/classic/${player}/:gamemode`, available_gamemodes: GAMEMODE_SLUGS.classic.map(gm => ({ gamemode: gm, url: `${base}/v1/stats/classic/${player}/${gm}` })) },
    { description: 'Modern stats — per gamemode',     path: `/v1/stats/modern/${player}/:gamemode`,  available_gamemodes: GAMEMODE_SLUGS.modern.map(gm  => ({ gamemode: gm, url: `${base}/v1/stats/modern/${player}/${gm}`  })) },
    { description: "Player's club roster",            path: `/v1/clubs/player/${player}` },
  ].map(e => ({ ...e, url: `${base}${e.path}` }));

  res.json({ player, base, endpoints });
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Unknown endpoint' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] http://localhost:${PORT}`);
});
