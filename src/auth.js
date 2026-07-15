const apiKeys = new Set(
  (process.env.API_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean),
);

const defaultApiKeyLimit = parsePositiveInteger(process.env.RATE_LIMIT_MAX, 60, 'RATE_LIMIT_MAX');
const apiKeyWindowSeconds = parsePositiveInteger(
  process.env.RATE_LIMIT_WINDOW_SECONDS,
  60,
  'RATE_LIMIT_WINDOW_SECONDS',
);
const anonymousLimit = parsePositiveInteger(
  process.env.ANONYMOUS_RATE_LIMIT_MAX,
  60,
  'ANONYMOUS_RATE_LIMIT_MAX',
);
const anonymousWindowSeconds = parsePositiveInteger(
  process.env.ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS,
  300,
  'ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS',
);
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
      throw new Error('API_KEY_LIMITS includes a key that is not present in API_KEYS.');
    }

    if (limits.has(apiKey)) {
      throw new Error('API_KEY_LIMITS cannot configure the same API key more than once.');
    }

    limits.set(apiKey, parsePositiveInteger(limit, null, 'API_KEY_LIMITS limit'));
  }

  return limits;
}

function setRateLimitHeaders(res, limit, windowSeconds, remaining) {
  res.set('RateLimit', `${limit};w=${windowSeconds}`);
  res.set('RateLimit-Remaining', String(Math.max(0, remaining)));
}

function resolveRateLimit(req) {
  const apiKey = req.get('API-Key');

  if (apiKey) {
    if (!apiKeys.has(apiKey)) {
      return { invalidApiKey: true };
    }

    return {
      bucketId: `key:${apiKey}`,
      limit: customRateLimits.get(apiKey) || defaultApiKeyLimit,
      windowSeconds: apiKeyWindowSeconds,
    };
  }

  return {
    bucketId: `anonymous:${req.ip || req.socket.remoteAddress || 'unknown'}`,
    limit: anonymousLimit,
    windowSeconds: anonymousWindowSeconds,
  };
}

export function applyRateLimit(req, res, next) {
  const config = resolveRateLimit(req);

  if (config.invalidApiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'The supplied API-Key is not valid. Omit the header to use the anonymous rate limit.',
    });
  }

  const now = Date.now();
  const windowMs = config.windowSeconds * 1_000;
  let bucket = rateLimitBuckets.get(config.bucketId);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateLimitBuckets.set(config.bucketId, bucket);
  }

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));

  if (bucket.count >= config.limit) {
    setRateLimitHeaders(res, config.limit, config.windowSeconds, 0);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many requests. Try again after the Retry-After interval.',
    });
  }

  bucket.count += 1;
  setRateLimitHeaders(res, config.limit, config.windowSeconds, config.limit - bucket.count);
  return next();
}
