import fs, { readFileSync, writeFileSync, existsSync } from 'fs';
import path, { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.API_DATA_DIR || join(__dirname, '..', 'data');
const configPath = join(dataDir, 'config.json');
const sessionsPath = join(dataDir, 'sessions.json');
const datesPath = join(dataDir, 'dates.json');

if (!existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function getConfig() {
  if (!existsSync(configPath)) {
    const defaultConfig = {
      tracker_channel: null,
      log_channel: null,
      tracked_players: {},
      tracker_messages: {},
      main_dashboard_id: null,
      interval: 300,
      tracking_enabled: false,
      last_updated: 'Never',
      autostart_time: null,
      schedule_start: null,
      schedule_stop: null,
      scraper_timeout: 30000,
      scraper_attempts: 2,
    };
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 4));
    return defaultConfig;
  }
  const data = readFileSync(configPath, 'utf-8');
  return JSON.parse(data);
}

export function saveConfig(config) {
  writeFileSync(configPath, JSON.stringify(config, null, 4));
}

export function addSession(playerName, loginTime, logoutTime) {
  const config = getConfig();

  // Initialize session_history if not exists
  if (!config.session_history) {
    config.session_history = {};
  }
  if (!config.session_history[playerName]) {
    config.session_history[playerName] = [];
  }

  const duration = logoutTime - loginTime;
  const loginDate = new Date(loginTime * 1000);

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayOfWeek = days[loginDate.getDay()];
  const date = loginDate.toISOString().split('T')[0];

  const session = {
    login_time: loginTime,
    logout_time: logoutTime,
    duration,
    day_of_week: dayOfWeek,
    date,
  };

  config.session_history[playerName].push(session);

  // Keep last 500 sessions per player to avoid bloat
  if (config.session_history[playerName].length > 500) {
    config.session_history[playerName] = config.session_history[playerName].slice(-500);
  }

  saveConfig(config);
  return session;
}

export function getPlayerSessions(playerName) {
  const config = getConfig();

  if (!config.session_history || !config.session_history[playerName]) {
    return [];
  }

  return config.session_history[playerName];
}

export function getSessions() {
  if (!existsSync(sessionsPath)) {
    const defaultSessions = { players: {} };
    writeFileSync(sessionsPath, JSON.stringify(defaultSessions, null, 4));
    return defaultSessions;
  }
  const data = readFileSync(sessionsPath, 'utf-8');
  return JSON.parse(data);
}

export function saveSessions(sessions) {
  writeFileSync(sessionsPath, JSON.stringify(sessions, null, 4));
}

export function getDates() {
  if (!existsSync(datesPath)) {
    const defaultDates = { dates: {} };
    writeFileSync(datesPath, JSON.stringify(defaultDates, null, 4));
    return defaultDates;
  }
  const data = readFileSync(datesPath, 'utf-8');
  return JSON.parse(data);
}

export function saveDates(dates) {
  writeFileSync(datesPath, JSON.stringify(dates, null, 4));
}

export function addSessionToFile(playerName, loginTime, logoutTime) {
  const duration = logoutTime - loginTime;
  const loginDate = new Date(loginTime * 1000);

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayOfWeek = days[loginDate.getDay()];
  const dateStr = loginDate.toISOString().split('T')[0];
  const hour = loginDate.getHours();

  const session = {
    login_time: loginTime,
    logout_time: logoutTime,
    duration,
    day_of_week: dayOfWeek,
    date: dateStr,
    hour,
  };

  // Add to sessions.json
  const sessions = getSessions();
  if (!sessions.players[playerName]) {
    sessions.players[playerName] = [];
  }
  sessions.players[playerName].push(session);
  // Keep last 500 sessions per player
  if (sessions.players[playerName].length > 500) {
    sessions.players[playerName] = sessions.players[playerName].slice(-500);
  }
  saveSessions(sessions);

  // Add to dates.json (organized by date)
  const dates = getDates();
  if (!dates.dates[dateStr]) {
    dates.dates[dateStr] = {};
  }
  if (!dates.dates[dateStr][playerName]) {
    dates.dates[dateStr][playerName] = [];
  }
  dates.dates[dateStr][playerName].push(session);
  saveDates(dates);

  return session;
}

// ========== Per-Server Config Helpers ==========

/**
 * Check if a server is whitelisted to use the tracker
 */
export function isServerWhitelisted(guildId) {
  const config = getConfig();
  if (!config.server_whitelist) return false;
  return config.server_whitelist.includes(guildId);
}

/**
 * Add a server to the whitelist
 */
export function addServerToWhitelist(guildId) {
  const config = getConfig();
  if (!config.server_whitelist) config.server_whitelist = [];

  if (config.server_whitelist.includes(guildId)) {
    return { alreadyExists: true, list: config.server_whitelist };
  }

  config.server_whitelist.push(guildId);
  saveConfig(config);
  return { alreadyExists: false, list: config.server_whitelist };
}

/**
 * Remove a server from the whitelist
 */
export function removeServerFromWhitelist(guildId) {
  const config = getConfig();
  if (!config.server_whitelist) config.server_whitelist = [];

  const index = config.server_whitelist.indexOf(guildId);
  if (index === -1) {
    return { notFound: true, list: config.server_whitelist };
  }

  config.server_whitelist.splice(index, 1);
  saveConfig(config);
  return { notFound: false, list: config.server_whitelist };
}

/**
 * Get list of whitelisted servers
 */
export function getWhitelistedServers() {
  const config = getConfig();
  return config.server_whitelist || [];
}

// ========== Per-Server Config (File-based) ==========

const SERVERS_DIR = path.join(process.cwd(), 'servers');

/**
 * Ensure servers directory exists
 */
function ensureServersDir() {
  if (!fs.existsSync(SERVERS_DIR)) {
    fs.mkdirSync(SERVERS_DIR, { recursive: true });
  }
}

/**
 * Get path to a server's config file
 */
function getServerConfigPath(guildId) {
  return path.join(SERVERS_DIR, `${guildId}.json`);
}

/**
 * Get server-specific config from servers/<id>.json
 */
export function getServerConfig(guildId) {
  ensureServersDir();
  const configPath = getServerConfigPath(guildId);

  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      console.error(`Error reading server config ${guildId}:`, err.message);
    }
  }

  // Return default config if file doesn't exist
  return {
    tracker_channel: null,
    log_channel: null,
    queueing_channel: null,
    tracked_players: [],
    ranked_queue: { enabled: false, player1: null, player2: null },
    tracking_enabled: false,
    use_embeds: false,
    interval: 60,
    dashboard_message_id: null,
  };
}

/**
 * Save server-specific config to servers/<id>.json
 */
export function saveServerConfig(guildId, serverConfig) {
  ensureServersDir();
  const configPath = getServerConfigPath(guildId);

  try {
    fs.writeFileSync(configPath, JSON.stringify(serverConfig, null, 2));
  } catch (err) {
    console.error(`Error saving server config ${guildId}:`, err.message);
  }
}

/**
 * Get all servers with their configs (reads all files in servers folder)
 */
export function getAllServerConfigs() {
  ensureServersDir();
  const configs = {};

  try {
    const files = fs.readdirSync(SERVERS_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const guildId = file.replace('.json', '');
        try {
          const configPath = path.join(SERVERS_DIR, file);
          configs[guildId] = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch (err) {
          console.error(`Error reading server config ${file}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('Error reading servers directory:', err.message);
  }

  return configs;
}

/**
 * Migrate server configs from old config.json format to new file-based format
 */
export function migrateServerConfigs() {
  const config = getConfig();

  if (config.servers && Object.keys(config.servers).length > 0) {
    console.log('Migrating server configs to servers folder...');
    ensureServersDir();

    for (const [guildId, serverConfig] of Object.entries(config.servers)) {
      const configPath = getServerConfigPath(guildId);
      if (!fs.existsSync(configPath)) {
        saveServerConfig(guildId, serverConfig);
        console.log(`  Migrated config for guild ${guildId}`);
      }
    }

    // Remove old servers object from config.json
    delete config.servers;
    saveConfig(config);
    console.log('Migration complete - removed old servers from config.json');
  }
}
