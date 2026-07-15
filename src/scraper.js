import { gotScraping } from 'got-scraping';
import { load } from 'cheerio';
import { logError, logWarn, logScraper } from './logger.js';
import { getConfig } from './config.js';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GOT_HEADERS = {
  browsers: [{ name: 'chrome', minVersion: 120 }],
  devices: ['desktop'],
  locales: ['en-US'],
  operatingSystems: ['windows'],
};

// Runtime data directory. Mount a host directory here when sharing tab exports
// from a Minecraft mod; otherwise the API falls back to web scraping.
const TAB_DIR = process.env.MMC_TAB_DIR || join(__dirname, '..', 'data');

// All supported regions
const REGIONS = ['na', 'eu', 'as'];

// Max age of tab data before falling back to web scraping (30 seconds)
const TAB_DATA_MAX_AGE_MS = 30000;

// Time to wait for mod to respond to trigger (ms)
const TAB_TRIGGER_WAIT_MS = 500;

// Time to wait for duel check result (ms)
const DUEL_CHECK_TIMEOUT_MS = 6000;

/**
 * Request fresh tab list data from all Minecraft mod instances.
 * Writes trigger files and waits briefly for mods to export.
 */
async function requestFreshTabList() {
  try {
    const { writeFileSync, unlinkSync } = await import('fs');

    // Write a global trigger file (all instances will respond)
    const globalTriggerFile = join(TAB_DIR, 'tab_refresh.trigger');
    writeFileSync(globalTriggerFile, Date.now().toString());

    // Wait for mods to respond
    await new Promise(resolve => setTimeout(resolve, TAB_TRIGGER_WAIT_MS));

    // Clean up trigger file if it still exists
    if (existsSync(globalTriggerFile)) {
      unlinkSync(globalTriggerFile);
    }
  } catch (error) {
    logWarn(`Failed to request fresh tab list: ${error.message}`);
  }
}

/**
 * Request a duel check for a player on a specific region.
 * Writes a trigger file and waits for the mod to execute /duel and return result.
 * @param {string} playerName - Player to check
 * @param {string} region - Region where the player was found (na, eu, as)
 * @returns {Promise<{state: string, timestamp: number} | null>} Result or null if timeout/error
 */
export async function requestDuelCheck(playerName, region) {
  try {
    const { writeFileSync, unlinkSync } = await import('fs');

    // Delete any existing result file
    const resultFile = join(TAB_DIR, 'duel_result.json');
    if (existsSync(resultFile)) {
      unlinkSync(resultFile);
    }

    // Write trigger file: "playername|region"
    const triggerFile = join(TAB_DIR, 'duel_check.trigger');
    writeFileSync(triggerFile, `${playerName}|${region}`);

    // Wait for result with polling
    const startTime = Date.now();
    while (Date.now() - startTime < DUEL_CHECK_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, 200));

      if (existsSync(resultFile)) {
        try {
          const content = readFileSync(resultFile, 'utf-8');
          const result = JSON.parse(content);

          // Verify this is for our request
          if (result.player && result.player.toLowerCase() === playerName.toLowerCase()) {
            return result;
          }
        } catch (e) {
          // File might still be written, continue waiting
        }
      }
    }

    // Timeout - clean up trigger file if still exists
    if (existsSync(triggerFile)) {
      unlinkSync(triggerFile);
    }

    return null;
  } catch (error) {
    logWarn(`Failed to request duel check: ${error.message}`);
    return null;
  }
}

// Duel check result states (must match DuelChecker.java)
export const DUEL_STATE = {
  IN_GAME: 'in_game',
  FOLLOWING: 'following',
  AT_SPAWN: 'at_spawn',
  NOT_FOUND: 'not_found',
  TIMEOUT: 'timeout',
};

// Spec check result states (must match SpecChecker.java)
export const SPEC_STATE = {
  IN_GAME: 'in_game',      // Found game info (has opponent, mode)
  SPECTATING: 'spectating', // Player is spectating someone else
  BLOCKED: 'blocked',       // Spectating not allowed
  TIMEOUT: 'timeout',
};

const SPEC_CHECK_TIMEOUT_MS = 20000; // 20 second timeout for spec check (extended for queue processing)

/**
 * Request a spec check for a player on a specific region.
 * Writes a trigger file and waits for the mod to execute /spec and return result.
 * Only call this if the player is confirmed to be in_game from duel check.
 * @param {string} playerName - Player to check
 * @param {string} region - Region where the player was found (na, eu, as)
 * @returns {Promise<{state: string, opponent?: string, mode?: string, duration?: string, map?: string, timestamp: number} | null>}
 */
export async function requestSpecCheck(playerName, region) {
  try {
    const { writeFileSync, unlinkSync } = await import('fs');

    // Delete any existing result file
    const resultFile = join(TAB_DIR, 'spec_result.json');
    if (existsSync(resultFile)) {
      unlinkSync(resultFile);
    }

    // Write trigger file: "playername|region"
    const triggerFile = join(TAB_DIR, 'spec_check.trigger');
    console.log(`[SpecCheck] Writing trigger file for ${playerName} on ${region}`);
    writeFileSync(triggerFile, `${playerName}|${region}`);

    // Wait for result with polling
    const startTime = Date.now();
    while (Date.now() - startTime < SPEC_CHECK_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, 200));

      if (existsSync(resultFile)) {
        try {
          const content = readFileSync(resultFile, 'utf-8');
          const result = JSON.parse(content);

          // Verify this is for our request
          if (result.player && result.player.toLowerCase() === playerName.toLowerCase()) {
            return result;
          }
        } catch (e) {
          // File might still be written, continue waiting
        }
      }
    }

    // Timeout - clean up trigger file if still exists
    if (existsSync(triggerFile)) {
      unlinkSync(triggerFile);
    }

    return null;
  } catch (error) {
    logWarn(`Failed to request spec check: ${error.message}`);
    return null;
  }
}

/**
 * Read tab list data from a specific region's JSON export.
 * Returns null if file doesn't exist, is too old, or mod is offline.
 * Uses robust parsing to handle file corruption.
 * @param {string} region - Region code (na, eu, as)
 */
function getTabListDataForRegion(region) {
  try {
    const filePath = join(TAB_DIR, `tab_players_${region}.json`);
    if (!existsSync(filePath)) {
      return null;
    }

    let content = readFileSync(filePath, 'utf-8');

    // Robust parsing: find the valid JSON boundaries
    // Try to find the last closing brace/bracket pair
    const startIdx = content.indexOf('{');

    // Try both formats: old ends with ]}, new ends with }}
    let endIdx = content.lastIndexOf('}}');
    if (endIdx === -1) {
      endIdx = content.lastIndexOf(']}');
    }

    if (startIdx === -1 || endIdx === -1) {
      return null;
    }

    // Extract just the valid JSON portion
    content = content.substring(startIdx, endIdx + 2);

    const data = JSON.parse(content);

    // Check if mod marked itself as offline
    if (!data.online) {
      return null;
    }

    // Check if data is too old (60 seconds for more tolerance)
    const age = Date.now() - data.timestamp;
    if (age > 60000) {
      return null;
    }

    return { ...data, region };
  } catch (error) {
    console.error(`[Scraper] Error parsing ${region} tab list:`, error.message);
    return null;
  }
}

/**
 * Get tab list data from all active regions.
 * Also checks legacy tab_players.json for backward compatibility.
 * @returns {Array} Array of { region, server, players, timestamp } objects
 */
export function getAllTabListData() {
  const results = [];

  // Check new region-specific files
  for (const region of REGIONS) {
    const data = getTabListDataForRegion(region);
    if (data) {
      results.push(data);
    }
  }

  // Fallback: check legacy tab_players.json (for old mod versions)
  if (results.length === 0) {
    const legacyData = getLegacyTabListData();
    if (legacyData) {
      results.push(legacyData);
    }
  }

  return results;
}

/**
 * Read from legacy tab_players.json (backward compatibility).
 */
function getLegacyTabListData() {
  try {
    const filePath = join(TAB_DIR, 'tab_players.json');
    if (!existsSync(filePath)) {
      return null;
    }

    let content = readFileSync(filePath, 'utf-8');

    // Robust parsing: find valid JSON boundaries
    const startIdx = content.indexOf('{');
    let endIdx = content.lastIndexOf('}}');
    if (endIdx === -1) {
      endIdx = content.lastIndexOf(']}');
    }

    if (startIdx === -1 || endIdx === -1) {
      return null;
    }

    content = content.substring(startIdx, endIdx + 2);
    const data = JSON.parse(content);

    if (!data.online) {
      return null;
    }

    const age = Date.now() - data.timestamp;
    if (age > 60000) {
      return null;
    }

    // Detect region from server name or default to 'na'
    let region = 'na';
    if (data.server) {
      const serverLower = data.server.toLowerCase();
      if (serverLower.startsWith('eu')) region = 'eu';
      else if (serverLower.startsWith('as')) region = 'as';
    }

    return { ...data, region };
  } catch (error) {
    console.error('[Scraper] Error parsing legacy tab list:', error.message);
    return null;
  }
}

/**
 * Check if any Minecraft mod is online and providing live tab list data.
 * @returns {boolean} True if at least one region has fresh data.
 */
export function isTabListActive() {
  return getAllTabListData().length > 0;
}

/**
 * Get the list of active regions with live updates.
 * @returns {string[]} Array of active region names (e.g., ['na', 'eu'])
 */
export function getActiveRegions() {
  const allData = getAllTabListData();
  return allData.map(d => d.region.toUpperCase());
}

/**
 * Check if a player is online using the Minecraft mod's tab list.
 * Checks all active regions.
 * Returns { found: true, online: boolean, server: string, region: string, rank: string } or { found: false }
 */
export function checkPlayerInTabList(playerName) {
  const allData = getAllTabListData();

  if (allData.length === 0) {
    return { found: false };
  }

  // Check each region for the player
  for (const regionData of allData) {
    const playersData = regionData.players;

    // Handle new format: { "Owner": [...], "Admin": [...], ... }
    if (playersData && typeof playersData === 'object' && !Array.isArray(playersData)) {
      for (const [rank, players] of Object.entries(playersData)) {
        if (Array.isArray(players)) {
          const foundPlayer = players.find(p => p.toLowerCase() === playerName.toLowerCase());
          if (foundPlayer) {
            return {
              found: true,
              online: true,
              server: regionData.server || regionData.region.toUpperCase(),
              region: regionData.region,
              rank: rank,
            };
          }
        }
      }
    } else if (Array.isArray(playersData)) {
      // Old format: just an array
      const isOnline = playersData.some(p => p.toLowerCase() === playerName.toLowerCase());
      if (isOnline) {
        return {
          found: true,
          online: true,
          server: regionData.server || regionData.region.toUpperCase(),
          region: regionData.region,
          rank: 'Default',
        };
      }
    }
  }

  // Player not found in any region's tab list
  // Return found: false so we fall through to web scraping
  // (they might be on a region we're not monitoring)
  return { found: false };
}

export async function getNormalizedPlayerName(playerName) {
  try {
    const response = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${playerName}`, { timeout: 5000 });
    return response.data.name; // Returns properly formatted name
  } catch (error) {
    logError(`Failed to normalize player name "${playerName}": ${error.message}`);
    return playerName; // Return original if API fails
  }
}

export async function scrapePlayerStatus(playerName) {
  const config = getConfig();
  const timeout = config.scraper_timeout || 30000;
  const maxAttempts = config.scraper_attempts || 2;
  const url = `https://minemen.club/player/${playerName}`;
  let lastError = null;

  // Request fresh tab list data from the mod (syncs before checking)
  await requestFreshTabList();

  // Try to get player status from the Minecraft mod's tab list
  const tabResult = checkPlayerInTabList(playerName);
  const isTabListOnline = tabResult.found && tabResult.online;

  if (tabResult.found) {
    if (tabResult.online) {
      logScraper(playerName, `Tab list: ONLINE, scraping for formatted server name`);
      // Continue to scrape to get the formatted server name from website
    } else {
      // Player not in tab list - they're offline on this server
      // Still need to scrape for last_seen and first_seen info
      logScraper(playerName, `Not in tab list, scraping for details`);
    }
  } else {
    // Mod offline - using web scraping
  }

  // Fallback: web scraping (approximation)
  // Try up to maxAttempts times
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const start = performance.now();
      const res = await gotScraping({ url, timeout: { request: timeout }, headerGeneratorOptions: GOT_HEADERS });
      const ms = Math.round(performance.now() - start);

      if (res.statusCode !== 200) {
        return { status: 'Error', ms };
      }

      const $ = load(res.body);
      const statusBar = $('.profile-status-bar');
      const isOnline = statusBar.hasClass('status-online');
      const isOffline = statusBar.hasClass('status-offline');

      let firstSeen = null;
      let playerRank = null;

      const rankSpan = $('span.profile-rank');
      if (rankSpan.length > 0) {
        playerRank = rankSpan.first().text().trim();
      }

      const joinedSpan = $('.profile-joined-row span');
      if (joinedSpan.length > 0) {
        firstSeen = joinedSpan.text().trim().replace(/^Joined\s*/i, '');
      }

      if (isOnline) {
        const srv = statusBar.find('div > span:last-child > span').text().trim().toUpperCase() || 'LOBBY';
        return {
          status: 'Online',
          server: srv,
          ms,
          color: 0x2ecc71,
          first_seen: firstSeen,
          rank: playerRank,
          source: isTabListOnline ? 'tab_list' : 'scrape',
        };
      } else if (isOffline) {
        let lastSeen = 'Unknown';
        const lastSeenEl = statusBar.find('.profile-last-seen');
        if (lastSeenEl.length > 0) {
          const tsMs = parseInt(lastSeenEl.attr('data-timestamp'), 10);
          if (!isNaN(tsMs)) {
            lastSeen = `<t:${Math.floor(tsMs / 1000)}:R>`;
          }
        }
        return {
          status: 'Offline',
          last_seen: lastSeen,
          server: 'OFFLINE',
          ms,
          color: 0xe74c3c,
          first_seen: firstSeen,
          rank: playerRank,
        };
      } else if (statusBar.hasClass('status-banned')) {
        return {
          status: 'Banned',
          server: 'BANNED',
          ms,
          color: 0x95a5a6,
          first_seen: firstSeen,
          rank: playerRank,
        };
      }

      return { status: 'Error', ms };
    } catch (error) {
      lastError = error;

      if ((error.name === 'TimeoutError' || error.code === 'ETIMEDOUT') && attempt < maxAttempts) {
        logScraper(playerName, `Timeout (attempt ${attempt}/${maxAttempts}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      logScraper(playerName, error.message, true);
    }
  }

  // If we get here, all attempts failed
  return { status: 'Error', ms: 0 };
}

export async function scrapeLeaderboard(mode) {
  const url = 'https://minemen.club/leaderboards/classic';
  const modesMap = {
    Global: 'GLOBAL',
    'Fireball Fight': 'FIREBALLFIGHT',
    'Bed Fight': 'BEDFIGHT',
    Nodebuff: 'NODEBUFF',
    Boxing: 'BOXING',
    Bridges: 'BRIDGES',
    Battlerush: 'BATTLERUSH',
    Sumo: 'SUMO',
    'Pearl Fight': 'PEARLFIGHT',
    'Build UHC': 'BUILDUHC',
    Classic: 'CLASSIC',
  };

  try {
    const res = await gotScraping({ url, timeout: { request: 30000 }, headerGeneratorOptions: GOT_HEADERS });

    if (res.statusCode !== 200) {
      return ['Failed to load page'];
    }

    const $ = load(res.body);
    const searchString = modesMap[mode] || mode;

    // Find the span with class="ELO" that contains the mode name
    let foundPanel = null;
    $('span.ELO').each((i, el) => {
      if ($(el).text().trim() === searchString) {
        foundPanel = $(el).closest('.leaderboards-panel');
        return false; // break
      }
    });

    if (!foundPanel) {
      return [`Mode '${mode}' (${searchString}) not found on page`];
    }

    // Find the table in the parent col-lg-4 div
    const parentCol = foundPanel.closest('.col-lg-4');
    const table = parentCol.find('table.fl-table');

    if (!table.length) {
      return ['No table found for mode'];
    }

    const rows = table.find('tbody tr').slice(0, 10);
    if (!rows.length) {
      return ['No rows in table'];
    }

    const leaderboard = [];
    rows.each((i, row) => {
      const tds = $(row).find('td');
      if (tds.length >= 3) {
        const rank = $(tds[0]).text().trim();
        const nameElement = $(tds[1]).find('a').text().trim();
        const name = nameElement || $(tds[1]).text().trim();
        const score = $(tds[2]).text().trim();
        if (name && score) {
          leaderboard.push(`${rank} **${name}** - ${score}`);
        }
      }
    });

    return leaderboard.length > 0 ? leaderboard : ['No data parsed'];
  } catch (error) {
    logError(`Leaderboard scraper error: ${error.message}`);
    return [`Exception: ${error.message}`];
  }
}

export async function scrapeMatchHistory(playerName) {
  const url = `https://minemen.club/player/${playerName}`;

  try {
    const res = await gotScraping({ url, timeout: { request: 30000 }, headerGeneratorOptions: GOT_HEADERS });

    if (res.statusCode !== 200) {
      return [null, `Failed to load page (status ${res.statusCode})`];
    }

    const $ = load(res.body);
    const matches = [];

    let firstSeen = null;
    const joinedSpan = $('.profile-joined-row span');
    if (joinedSpan.length > 0) {
      firstSeen = joinedSpan.text().trim().replace(/^Joined\s*/i, '');
    }

    const list = $('.pw-activity-list');
    if (!list.length) {
      return [null, 'No match history found.'];
    }

    list.find('.pw-activity-row').each((i, elem) => {
      const row = $(elem);
      const href = row.find('.pw-activity-row-link').attr('href');
      if (!href) return;

      matches.push({
        url: `https://minemen.club${href.split('?')[0]}`,
        player1: playerName,
        player2: row.find('.pw-activity-opponent-name').text().trim(),
        elo: '',
        elo_change: row.find('.pw-activity-elo-pill').text().trim(),
        type: row.find('.pw-activity-kit').text().trim(),
        date: row.find('.pw-activity-time').text().trim(),
        result: row.find('.pw-activity-rail-label').text().trim(),
      });
    });

    return [{ matches, first_seen: firstSeen }, null];
  } catch (error) {
    logError(`Match history scraper error: ${error.message}`);
    return [null, `Exception: ${error.message}`];
  }
}

export async function scrapePlayerProfile(playerName) {
  const url = `https://minemen.club/player/${playerName}`;
  try {
    const start = performance.now();
    const res = await gotScraping({ url, timeout: { request: 15000 }, headerGeneratorOptions: GOT_HEADERS });
    const ms = Math.round(performance.now() - start);

    if (res.statusCode === 404) return { error: 'Player not found', httpStatus: 404 };
    if (res.statusCode !== 200) return { error: `HTTP ${res.statusCode}`, httpStatus: res.statusCode };

    const $ = load(res.body);

    if (!$('.profile-sidebar').length) return { error: 'Player not found', httpStatus: 404 };

    const statusBar = $('.profile-status-bar');
    const isOnline = statusBar.hasClass('status-online');
    const isOffline = statusBar.hasClass('status-offline');
    const isBanned = statusBar.hasClass('status-banned');

    const rank = $('span.profile-rank').first().text().trim() || null;
    const joined = $('.profile-joined-row span').text().trim().replace(/^Joined\s*/i, '') || null;
    const club = $('.profile-club-name').text().trim() || null;
    const clubId = ($('.profile-club').attr('href') || '').match(/\/club\/([^?]+)/)?.[1] || null;
    const friends = parseInt($('.profile-friends-count').text().trim(), 10) || 0;

    let status, server = null, region = null, lastSeenUnix = null;

    if (isOnline) {
      status = 'online';
      server = statusBar.find('div > span:last-child > span').text().trim() || 'Lobby';
      region = server.match(/^(NA|EU|AS)\b/i)?.[1]?.toUpperCase() ?? null;
    } else if (isOffline) {
      status = 'offline';
      const tsMs = parseInt($('.profile-last-seen').attr('data-timestamp'), 10);
      if (!isNaN(tsMs)) lastSeenUnix = Math.floor(tsMs / 1000);
    } else if (isBanned) {
      status = 'banned';
    } else {
      status = 'unknown';
    }

    const elo = {};
    $('.pw-practice-panel').each((i, panel) => {
      const mode = $(panel).attr('data-mode');
      if (!mode) return;
      const globalElo = parseInt($(panel).find('.pw-summary-card-global .pw-summary-value').text().replace(/,/g, ''), 10);
      const globalRank = parseInt($(panel).find('.pw-rank-number').text().replace(/\D/g, ''), 10);
      const wins = parseInt($(panel).find('.pw-record-main strong').eq(0).text(), 10);
      const losses = parseInt($(panel).find('.pw-record-main strong').eq(1).text(), 10);
      elo[mode] = {
        global_elo: isNaN(globalElo) ? null : globalElo,
        global_rank: isNaN(globalRank) ? null : globalRank,
        wins: isNaN(wins) ? null : wins,
        losses: isNaN(losses) ? null : losses,
      };
    });

    return { player: playerName, status, server, region, last_seen_unix: lastSeenUnix, rank, joined, club, club_id: clubId, friends, elo, ms };
  } catch (error) {
    logError(`scrapePlayerProfile error for ${playerName}: ${error.message}`);
    return { error: error.message, httpStatus: 500 };
  }
}

export async function scrapePlayerFriends(playerName) {
  const url = `https://minemen.club/player/${playerName}`;
  try {
    const res = await gotScraping({ url, timeout: { request: 15000 }, headerGeneratorOptions: GOT_HEADERS });

    if (res.statusCode === 404) return { error: 'Player not found', httpStatus: 404 };
    if (res.statusCode !== 200) return { error: `HTTP ${res.statusCode}`, httpStatus: res.statusCode };

    const $ = load(res.body);
    if (!$('.profile-sidebar').length) return { error: 'Player not found', httpStatus: 404 };

    const friendCount = parseInt($('.profile-friends-count').text().trim(), 10) || 0;

    const friends = [];
    $('.profile-friends-grid .profile-friend').each((i, el) => {
      const name = $(el).attr('data-name');
      if (name) friends.push(name);
    });

    return { player: playerName, friend_count: friendCount, shown: friends.length, friends };
  } catch (error) {
    logError(`scrapePlayerFriends error for ${playerName}: ${error.message}`);
    return { error: error.message, httpStatus: 500 };
  }
}

// Full gamemode slug lists per mode (from /leaderboards/<mode>)
export const GAMEMODE_SLUGS = {
  classic: ['fireballfight', 'bedfight', 'nodebuff', 'boxing', 'finaluhc', 'bridges', 'sumo', 'builduhc', 'battlerush', 'classic', 'pearlfight', 'skywars', 'archer'],
  modern: ['spear-mace', 'mace', 'spear-elytra', 'sword', 'crystal', 'diamond-smp', 'fireball-fight', 'uhc', 'axe', 'bridge', 'bed-fight', 'creeper', 'netherite-potion', 'smp', 'shieldless-uhc', 'pearl-fight', 'sumo', 'cart', 'diamond-potion', 'sky-wars', 'battle-rush', 'diamond-crystal', 'bow', 'manhunt'],
};

function toInt(str) {
  if (str == null) return null;
  const n = parseInt(String(str).replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? null : n;
}

// Practice stats overview for a mode (classic|modern): global ELO + per-gamemode summary
export async function scrapePlayerStats(playerName, mode) {
  mode = String(mode || '').toLowerCase();
  if (mode !== 'classic' && mode !== 'modern') return { error: 'Invalid mode (use classic or modern)', httpStatus: 400 };

  const url = `https://minemen.club/player/${playerName}/practice/${mode}`;
  try {
    const res = await gotScraping({ url, timeout: { request: 15000 }, headerGeneratorOptions: GOT_HEADERS });
    if (res.statusCode === 404) return { error: 'Player not found', httpStatus: 404 };
    if (res.statusCode !== 200) return { error: `HTTP ${res.statusCode}`, httpStatus: res.statusCode };

    const $ = load(res.body);
    if ($('.error-section').length) return { error: 'Player not found or no data', httpStatus: 404 };

    const globalCard = $('.practice-elo-panel .practice-global-card').first();
    const globalElo = toInt(globalCard.find('strong').first().text());
    const worldRank = toInt(globalCard.find('em').first().text());

    const gamemodes = [];
    $('.practice-kit-card').each((i, el) => {
      const card = $(el);
      const slug = (card.attr('href') || '').split('/').filter(Boolean).pop();
      const name = card.find('.practice-kit-top h3').text().trim();
      const statDivs = card.find('.practice-kit-stats > div');

      const rankedElo = toInt(card.find('.practice-kit-ranked-elo').text());
      const [rw, rl] = $(statDivs[0]).find('em span').last().text().split('/').map(toInt);

      let casualTitle = card.find('.practice-kit-casual-title span').last().text().trim();
      if (!casualTitle) casualTitle = card.find('.practice-kit-casual-unranked').text().trim() || null;
      const casualWins = toInt($(statDivs[1]).find('em span').last().text());

      gamemodes.push({
        slug,
        name,
        ranked_elo: rankedElo,
        ranked_wins: rw ?? null,
        ranked_losses: rl ?? null,
        casual_title: casualTitle,
        casual_wins: casualWins,
      });
    });

    return { player: playerName, mode, global_elo: globalElo, world_rank: worldRank, gamemodes };
  } catch (error) {
    logError(`scrapePlayerStats error for ${playerName}/${mode}: ${error.message}`);
    return { error: error.message, httpStatus: 500 };
  }
}

// Detailed stats for a single gamemode (classic has ranked/casual/tournament; modern is sparser)
export async function scrapePlayerGamemodeStats(playerName, mode, gamemode) {
  mode = String(mode || '').toLowerCase();
  if (mode !== 'classic' && mode !== 'modern') return { error: 'Invalid mode (use classic or modern)', httpStatus: 400 };
  const slug = String(gamemode || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!slug) return { error: 'Invalid gamemode', httpStatus: 400 };

  const url = `https://minemen.club/player/${playerName}/practice/${mode}/${slug}`;
  try {
    const res = await gotScraping({ url, timeout: { request: 15000 }, headerGeneratorOptions: GOT_HEADERS });
    if (res.statusCode === 404) return { error: 'Not found', httpStatus: 404 };
    if (res.statusCode !== 200) return { error: `HTTP ${res.statusCode}`, httpStatus: res.statusCode };

    const $ = load(res.body);
    if ($('.error-section').length) return { error: 'No stats available for this gamemode', httpStatus: 404 };

    const name = $('.practice-kit-heading').first().text().trim() || slug;
    const globalCard = $('.practice-elo-panel .practice-global-card').first();
    const worldRank = toInt(globalCard.find('em').first().text());

    const result = { player: playerName, mode, gamemode: slug, name, world_rank: worldRank };

    $('.practice-mode-card').each((i, el) => {
      const card = $(el);
      const type = card.find('.practice-mode-title h3').text().trim().toLowerCase(); // ranked/casual/tournament
      if (!type) return;
      const section = {};

      const elo = toInt(card.find('.practice-mode-elo').text());
      if (elo != null) section.elo = elo;
      const title = card.find('.practice-casual-title-label').text().trim();
      if (title) section.title = title;

      card.find('.practice-mode-stats > div').each((j, d) => {
        const label = $(d).find('span').first().text().trim().toLowerCase().replace(/\s+/g, '_');
        const raw = $(d).find('strong').text().trim();
        if (!label) return;
        section[label] = /%/.test(raw) ? parseFloat(raw) : (toInt(raw) ?? raw);
      });

      result[type] = section;
    });

    // ELO history chart points (data-date / data-elo)
    const history = [];
    $('.practice-chart-point').each((i, el) => {
      const date = $(el).attr('data-date');
      const elo = toInt($(el).attr('data-elo'));
      if (date && elo != null) history.push({ date, elo });
    });
    result.history = history;

    return result;
  } catch (error) {
    logError(`scrapePlayerGamemodeStats error for ${playerName}/${mode}/${slug}: ${error.message}`);
    return { error: error.message, httpStatus: 500 };
  }
}

// Leaderboard batch (10 entries/page) via the site's infinite-scroll API
export async function scrapeLeaderboardBatch(mode, gamemode, offset = 0) {
  mode = String(mode || '').toLowerCase();
  if (mode !== 'classic' && mode !== 'modern') return { error: 'Invalid mode (use classic or modern)', httpStatus: 400 };
  const slug = String(gamemode || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!slug) return { error: 'Invalid gamemode', httpStatus: 400 };
  const off = Math.max(0, parseInt(offset, 10) || 0);

  const url = `https://minemen.club/leaderboards/batch/${mode}/${slug}?offset=${off}`;
  try {
    const res = await gotScraping({
      url,
      timeout: { request: 15000 },
      headerGeneratorOptions: GOT_HEADERS,
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (res.statusCode !== 200) return { error: `HTTP ${res.statusCode}`, httpStatus: res.statusCode };

    let data;
    try { data = JSON.parse(res.body); } catch { return { error: 'Invalid response from leaderboard API', httpStatus: 502 }; }

    const entries = (data.entries || []).map(e => ({
      position: e.position,
      username: e.username,
      uuid: e.uuid,
      elo: toInt(e.score),
    }));

    return { mode, gamemode: slug, offset: off, count: entries.length, entries };
  } catch (error) {
    logError(`scrapeLeaderboardBatch error for ${mode}/${slug}@${off}: ${error.message}`);
    return { error: error.message, httpStatus: 500 };
  }
}

// Single leaderboard entry at a given 1-based placement (computes the offset automatically)
export async function scrapeLeaderboardPlacement(mode, gamemode, placement) {
  const p = parseInt(placement, 10);
  if (!p || p < 1) return { error: 'Invalid placement (must be >= 1)', httpStatus: 400 };

  const batch = await scrapeLeaderboardBatch(mode, gamemode, p - 1);
  if (batch.error) return batch;

  const entry = batch.entries.find(e => e.position === p) || batch.entries[0];
  if (!entry) return { error: `No player at placement #${p}`, httpStatus: 404 };

  return { mode: batch.mode, gamemode: batch.gamemode, placement: p, ...entry };
}

// Club roster by club id — name, member count, and every member with their club rank (role)
export async function scrapeClub(clubId) {
  const id = String(clubId || '').toLowerCase().replace(/[^a-f0-9-]/g, '');
  if (!id) return { error: 'Invalid club id', httpStatus: 400 };

  const url = `https://minemen.club/club/${id}`;
  try {
    const res = await gotScraping({ url, timeout: { request: 15000 }, headerGeneratorOptions: GOT_HEADERS });
    if (res.statusCode === 404) return { error: 'Club not found', httpStatus: 404 };
    if (res.statusCode !== 200) return { error: `HTTP ${res.statusCode}`, httpStatus: res.statusCode };

    const $ = load(res.body);
    const name = $('.club-name').first().text().trim();
    if (!name) return { error: 'Club not found', httpStatus: 404 };

    const [, countStr, limitStr] = $('.club-stats').text().match(/(\d+)\s*\/\s*(\d+)/) || [];

    const members = [];
    // Leader sits in its own section
    $('.club-member-leader').each((i, el) => {
      const username = $(el).find('.club-member-name').text().trim();
      if (username) members.push({ username, role: 'LEADER' });
    });
    // Everyone else (admins + members)
    $('.club-members-list .club-member-row').each((i, el) => {
      const username = $(el).find('.club-member-name').text().trim();
      const role = ($(el).attr('data-role') || $(el).find('.club-role-badge').text().trim() || 'MEMBER').toUpperCase();
      if (username) members.push({ username, role });
    });

    const leader = members.find(m => m.role === 'LEADER')?.username || null;

    return {
      club_id: id,
      name,
      member_count: countStr ? parseInt(countStr, 10) : members.length,
      member_limit: limitStr ? parseInt(limitStr, 10) : null,
      leader,
      members,
    };
  } catch (error) {
    logError(`scrapeClub error for ${id}: ${error.message}`);
    return { error: error.message, httpStatus: 500 };
  }
}

// Club roster by player name — resolves the player's club id first, then loads the club
export async function scrapeClubByPlayer(playerName) {
  const profile = await scrapePlayerProfile(playerName);
  if (profile.error) return profile;
  if (!profile.club_id) return { error: 'Player is not in a club', httpStatus: 404 };

  const club = await scrapeClub(profile.club_id);
  if (club.error) return club;

  return { queried_player: playerName, ...club };
}
