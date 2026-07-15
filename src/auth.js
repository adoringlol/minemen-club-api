const apiKeys = new Set(
  (process.env.API_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean),
);

const rateLimitMax = parsePositiveInteger(process.env.RATE_LIMIT_MAX, 60, 'RATE_LIMIT_MAX');
const rateLimitWindowSeconds = parsePositiveInteger(
  process.env.RATE_LIMIT_WINDOW_SECONDS,
  60,
  'RATE_LIMIT_WINDOW_SECONDS',
);
const rateLimitWindowMs = rateLimitWindowSeconds * 1_000;
const rateLimitBuckets = new Map();

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function setRateLimitHeaders(res, remaining) {
  res.set('RateLimit', `${rateLimitMax};w=${rateLimitWindowSeconds}`);
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
  let bucket = rateLimitBuckets.get(apiKey);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + rateLimitWindowMs };
    rateLimitBuckets.set(apiKey, bucket);
  }

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));

  if (bucket.count >= rateLimitMax) {
    setRateLimitHeaders(res, 0);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many requests. Try again after the Retry-After interval.',
    });
  }

  bucket.count += 1;
  setRateLimitHeaders(res, rateLimitMax - bucket.count);
  return next();
}
