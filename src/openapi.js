const apiKeySecurity = [{ ApiKeyAuth: [] }];

const responseHeaders = {
  RateLimit: {
    description: 'Requests allowed during the current window, followed by the window duration in seconds.',
    schema: { type: 'string', example: '60;w=60' },
  },
  'RateLimit-Remaining': {
    description: 'Requests remaining for the current API key in the current window.',
    schema: { type: 'integer', example: 59 },
  },
};

const successResponse = (description = 'Successful response.') => ({
  description,
  headers: responseHeaders,
  content: {
    'application/json': {
      schema: { type: 'object', additionalProperties: true },
    },
  },
});

const errorResponses = {
  401: {
    description: 'Missing or invalid API key.',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
      },
    },
  },
  429: {
    description: 'Rate limit exceeded.',
    headers: {
      ...responseHeaders,
      'Retry-After': {
        description: 'Seconds until this API key can make another request.',
        schema: { type: 'integer', example: 42 },
      },
    },
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
      },
    },
  },
};

const pathParameter = (name, description, schema = { type: 'string' }) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema,
});

const playerParameter = pathParameter('name', 'Minecraft player name.');
const modeParameter = pathParameter('mode', 'Practice mode.', { type: 'string', enum: ['classic', 'modern'] });
const gamemodeParameter = pathParameter('gamemode', 'Gamemode slug.');

const operation = (summary, parameters = [], description) => ({
  summary,
  ...(description ? { description } : {}),
  security: apiKeySecurity,
  parameters,
  responses: {
    200: successResponse(),
    ...errorResponses,
  },
});

export function createOpenApiDocument(serverUrl) {
  return {
    openapi: '3.1.1',
    info: {
      title: 'Minemen Club API',
      version: 'v1',
      description: 'API for Minemen Club player profiles, status, matches, friends, practice stats, leaderboards, and clubs. All `/v1` endpoints require an `API-Key` request header.',
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: 'Players' },
      { name: 'Stats' },
      { name: 'Leaderboards' },
      { name: 'Clubs' },
      { name: 'Utilities' },
    ],
    paths: {
      '/v1/player/{name}': { get: { ...operation('Get a full player profile', [playerParameter]), tags: ['Players'] } },
      '/v1/status/{name}': { get: { ...operation('Get a player status', [playerParameter]), tags: ['Players'] } },
      '/v1/matches/{name}': { get: { ...operation('Get recent match history', [playerParameter]), tags: ['Players'] } },
      '/v1/friends/{name}': { get: { ...operation('Get player friends', [playerParameter]), tags: ['Players'] } },
      '/v1/stats/{mode}/{name}': { get: { ...operation('Get practice stats overview', [modeParameter, playerParameter]), tags: ['Stats'] } },
      '/v1/stats/{mode}/{name}/{gamemode}': { get: { ...operation('Get detailed gamemode stats', [modeParameter, playerParameter, gamemodeParameter]), tags: ['Stats'] } },
      '/v1/leaderboard/{mode}/{gamemode}': { get: { ...operation('Get the top 10 leaderboard entries', [modeParameter, gamemodeParameter]), tags: ['Leaderboards'] } },
      '/v1/leaderboard/{mode}/{gamemode}/offset/{offset}': {
        get: {
          ...operation('Get a leaderboard page from an offset', [modeParameter, gamemodeParameter, pathParameter('offset', 'Zero-based leaderboard offset.', { type: 'integer', minimum: 0 })]),
          tags: ['Leaderboards'],
        },
      },
      '/v1/leaderboard/{mode}/{gamemode}/placement/{placement}': {
        get: {
          ...operation('Get a leaderboard entry by placement', [modeParameter, gamemodeParameter, pathParameter('placement', 'One-based leaderboard placement.', { type: 'integer', minimum: 1 })]),
          tags: ['Leaderboards'],
        },
      },
      '/v1/clubs/id/{clubId}': { get: { ...operation('Get a club roster by club ID', [pathParameter('clubId', 'Minemen Club ID.')]), tags: ['Clubs'] } },
      '/v1/clubs/player/{name}': { get: { ...operation('Get a player\'s club roster', [playerParameter]), tags: ['Clubs'] } },
      '/v1/generator/{name}': { get: { ...operation('Generate all player-specific endpoint URLs', [playerParameter]), tags: ['Utilities'] } },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'API-Key',
          description: 'Use one of the keys configured in `API_KEYS`. Per-key limits can be configured with `API_KEY_LIMITS`.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  };
}
