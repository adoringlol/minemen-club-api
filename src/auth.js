const apiKeys = new Set(
  (process.env.API_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean),
);

const defaultRateLimitMax = parsePositiveInteger(process.env.RATE_LIMIT_MAX, 60, 'RATE_LIMIT_MAX');
const rateLimitWindowSeconds = parsePositiveInteger(
  process.env.RATE_LIMIT_WINDOW_SECONDS,
  60,
  'RATE_LIMIT_WINDOW_SECONDS',
);
const rateLimitWindowMs = rateLimitWindowSeconds * 1_000;
const rateLimitBuckets = new Map();
const customRateLimits = parseCustomRateLimits(process.env.API_KEY_LIMITS);

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function parseCustomRateLimits(value) {
  const limits = new Map();
  if (!value) return limits;

  for (const entry of value.split(',').map((item) => item.trim()).filter(Boolean)) {
    const separatorIndex = entry.lastIndexOf('=');
    const apiKey = entry.slice(0, separatorIndex).trim();
    const limit = entry.slice(separatorIndex + 1).trim();

    if (separatorIndex < 1 || !apiKey || !limit) {
      throw new Error('API_KEY_LIMITS entries must use the format api-key=limit.');
    }

    if (!apiKeys.has(apiKey)) {
      throw new Error(`API_KEY_LIMITS includes a key that is not present in API_KEYS.`);
    }

    if (limits.has(apiKey)) {
      throw new Error('API_KEY_LIMITS cannot configure the same API key more than once.');
    }

    limits.set(apiKey, parsePositiveInteger(limit, null, 'API_KEY_LIMITS limit'));
  }

  return limits;
}

function getRateLimit(apiKey) {
  return customRateLimits.get(apiKey) || defaultRateLimitMax;
}

function setRateLimitHeaders(res, limit, remaining) {
  res.set('RateLimit', `${limit};w=${rateLimitWindowSeconds}`);
  res.set('RateLimit-Remaining', String(Math.max(0, remaining)));
}

export function assertAuthConfiguration() {
  if (apiKeys.size === 0) {
    throw new Error('API_KEYS must contain at least one API key before the server can start.');
  }
}

export function requireApiKey(req, res, next) {
  const apiKey = req.get('API-Key');

  if (!apiKey || !apiKeys.has(apiKey)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Provide a valid API-Key request header.',
    });
  }

  const now = Date.now();
  const rateLimitMax = getRateLimit(apiKey);
  let bucket = rateLimitBuckets.get(apiKey);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + rateLimitWindowMs };
    rateLimitBuckets.set(apiKey, bucket);
  }

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));

  if (bucket.count >= rateLimitMax) {
    setRateLimitHeaders(res, rateLimitMax, 0);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many requests. Try again after the Retry-After interval.',
    });
  }

  bucket.count += 1;
  setRateLimitHeaders(res, rateLimitMax, rateLimitMax - bucket.count);
  return next();
}
