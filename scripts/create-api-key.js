import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const limitFlagIndex = args.indexOf('--limit');
const requestedLimit = limitFlagIndex === -1 ? 60 : Number(args[limitFlagIndex + 1]);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run key:create -- --limit <requests-per-window>');
  process.exit(0);
}

if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error('--limit must be a positive integer.');
}

const envPath = resolve('.env');
if (!existsSync(envPath)) {
  throw new Error('No .env file found. Copy .env.example to .env before creating a key.');
}

const apiKey = `mmc_${randomBytes(32).toString('base64url')}`;
const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);

appendValue('API_KEYS', apiKey);
appendValue('API_KEY_LIMITS', `${apiKey}=${requestedLimit}`);

writeFileSync(envPath, `${lines.filter((line, index) => index < lines.length - 1 || line !== '').join('\n')}\n`);

console.log('Created a new API key and saved it to .env.');
console.log(`API key (store it securely): ${apiKey}`);
console.log(`Custom limit: ${requestedLimit} requests per rate-limit window.`);
console.log('Restart the API container to load the new key.');

function appendValue(name, value) {
  const lineIndex = lines.findIndex((line) => line.startsWith(`${name}=`));

  if (lineIndex === -1) {
    lines.push(`${name}=${value}`);
    return;
  }

  const existingValue = lines[lineIndex].slice(name.length + 1).trim();
  lines[lineIndex] = `${name}=${existingValue ? `${existingValue},${value}` : value}`;
}
