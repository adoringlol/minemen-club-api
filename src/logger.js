import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logsDir = process.env.API_LOG_DIR || join(__dirname, '..', 'logs');

// Create logs directory if it doesn't exist
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// Helper to colorize text
const c = {
  success: (text) => `${colors.green}${text}${colors.reset}`,
  error: (text) => `${colors.red}${text}${colors.reset}`,
  warn: (text) => `${colors.yellow}${text}${colors.reset}`,
  info: (text) => `${colors.cyan}${text}${colors.reset}`,
  debug: (text) => `${colors.gray}${text}${colors.reset}`,
  highlight: (text) => `${colors.bright}${colors.white}${text}${colors.reset}`,
  dim: (text) => `${colors.dim}${text}${colors.reset}`,
  player: (text) => `${colors.magenta}${text}${colors.reset}`,
  time: (text) => `${colors.gray}${text}${colors.reset}`,
  bracket: (text) => `${colors.gray}[${colors.reset}${text}${colors.gray}]${colors.reset}`,
};

// Get today's date for log file name
function getLogFileName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}.log`;
}

// Get timestamp for log message
function getTimestamp() {
  const now = new Date();
  return now.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// Get full timestamp for file logs
function getFullTimestamp() {
  const now = new Date();
  return now.toLocaleString('en-US', { timeZone: 'America/Chicago' });
}

// Write to log file
function writeToFile(message, type) {
  const timestamp = getFullTimestamp();
  const logMessage = `[${timestamp}] [${type}] ${message}\n`;

  try {
    const logFile = join(logsDir, getLogFileName());
    appendFileSync(logFile, logMessage);
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
}

// Format timestamp for console
function formatTime() {
  return c.time(getTimestamp());
}

// Core log function
export function log(message, type = 'INFO') {
  writeToFile(message, type);
}

// ═══════════════════════════════════════════════════════════════
// Main logging functions
// ═══════════════════════════════════════════════════════════════

export function logInfo(message) {
  console.log(`${formatTime()} ${c.info('ℹ')}  ${message}`);
  writeToFile(message, 'INFO');
}

export function logSuccess(message) {
  console.log(`${formatTime()} ${c.success('✓')}  ${c.success(message)}`);
  writeToFile(message, 'SUCCESS');
}

export function logError(message) {
  console.log(`${formatTime()} ${c.error('✗')}  ${c.error(message)}`);
  writeToFile(message, 'ERROR');
}

export function logWarn(message) {
  console.log(`${formatTime()} ${c.warn('!')}  ${c.warn(message)}`);
  writeToFile(message, 'WARN');
}

export function logDebug(message) {
  writeToFile(message, 'DEBUG');
}

// ═══════════════════════════════════════════════════════════════
// Specialized logging functions
// ═══════════════════════════════════════════════════════════════

export function logScheduler(message) {
  logDebug(`[SCHEDULER] ${message}`);
}

export function logPlayer(playerName, status, details = '') {
  const playerTag = c.player(playerName.padEnd(16));
  const statusIcon = status === 'online' ? c.success('●') :
    status === 'offline' ? c.error('○') :
      c.warn('◐');
  const detailsStr = details ? c.dim(` ${details}`) : '';
  console.log(`${formatTime()} ${statusIcon} ${playerTag}${detailsStr}`);
  writeToFile(`${playerName}: ${status} ${details}`, 'PLAYER');
}

export function logScraper(playerName, message, isError = false) {
  const playerTag = c.player(playerName.padEnd(16));
  if (isError) {
    console.log(`${formatTime()} ${c.error('⚡')} ${playerTag} ${c.error(message)}`);
    writeToFile(`Scraper [${playerName}]: ${message}`, 'ERROR');
  } else {
    console.log(`${formatTime()} ${c.dim('⚡')} ${playerTag} ${c.dim(message)}`);
    writeToFile(`Scraper [${playerName}]: ${message}`, 'DEBUG');
  }
}

export function logSession(playerName, action, duration = null) {
  const playerTag = c.player(playerName.padEnd(16));
  const actionIcon = action === 'start' ? c.success('▶') : c.error('■');
  const actionText = action === 'start' ? c.success('Session started') : c.error('Session ended');
  const durationStr = duration ? c.dim(` (${formatDuration(duration)})`) : '';
  console.log(`${formatTime()} ${actionIcon} ${playerTag} ${actionText}${durationStr}`);
  writeToFile(`${playerName}: Session ${action}${duration ? ` (${duration}s)` : ''}`, 'SESSION');
}

// ═══════════════════════════════════════════════════════════════
// Display helpers
// ═══════════════════════════════════════════════════════════════

export function logDivider(char = '─', length = 50) {
  console.log(c.dim(char.repeat(length)));
}

export function logHeader(title) {
  const line = '═'.repeat(50);
  console.log('');
  console.log(c.dim(line));
  console.log(c.highlight(`  ${title}`));
  console.log(c.dim(line));
}

export function logSection(title) {
  console.log('');
  console.log(c.dim('─'.repeat(40)));
  console.log(c.info(`  ${title}`));
  console.log(c.dim('─'.repeat(40)));
}

export function logKeyValue(key, value) {
  console.log(`  ${c.dim(key.padEnd(20))} ${value}`);
}

export function logBotReady(username, id, ping) {
  logHeader('MMC Bot Started');
  logKeyValue('Bot Name', c.highlight(username));
  logKeyValue('Bot ID', c.dim(id));
  logKeyValue('Latency', ping >= 0 ? `${ping}ms` : c.warn('Connecting...'));
  logDivider('═', 50);
  console.log('');
}

export function logCommandsLoaded(commands) {
  logSection('Commands Loaded');
  commands.forEach(cmd => {
    console.log(`  ${c.success('✓')} ${cmd}`);
  });
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
// Utility functions
// ═══════════════════════════════════════════════════════════════

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// Export colors for external use
export { c as colors };
