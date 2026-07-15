const apiKeySecurity = [{ ApiKeyAuth: [] }];

const classicGamemodes = [
  'fireballfight', 'bedfight', 'nodebuff', 'boxing', 'finaluhc', 'bridges', 'sumo',
  'builduhc', 'battlerush', 'classic', 'pearlfight', 'skywars', 'archer',
];

const modernGamemodes = [
  'spear-mace', 'mace', 'spear-elytra', 'sword', 'crystal', 'diamond-smp',
  'fireball-fight', 'uhc', 'axe', 'bridge', 'bed-fight', 'creeper',
  'netherite-potion', 'smp', 'shieldless-uhc', 'pearl-fight', 'sumo', 'cart',
  'diamond-potion', 'sky-wars', 'battle-rush', 'diamond-crystal', 'bow', 'manhunt',
];

const responseHeaders = {
  RateLimit: {
    description: 'Maximum requests for the authenticated key in the current window, followed by the window length in seconds.',
    schema: { type: 'string', example: '60;w=60' },
  },
  'RateLimit-Remaining': {
    description: 'Requests remaining for the authenticated key in the current rate-limit window.',
    schema: { type: 'integer', example: 59 },
  },
};

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

function jsonResponse(description, schema, example) {
  return {
    description,
    headers: responseHeaders,
    content: {
      'application/json': {
        schema,
        ...(example ? { example } : {}),
      },
    },
  };
}

function errorResponse(description, status, example) {
  return {
    description,
    ...(status === 401 ? {} : { headers: responseHeaders }),
    content: {
      'application/json': {
        schema: ref('Error'),
        ...(example ? { example } : {}),
      },
    },
  };
}

const standardErrors = {
  401: errorResponse('The `API-Key` header is missing or does not match a configured key.', 401, {
    error: 'Unauthorized',
    message: 'Provide a valid API-Key request header.',
  }),
  429: {
    description: 'The API key has exhausted its configured quota for the current window.',
    headers: {
      ...responseHeaders,
      'Retry-After': {
        description: 'Number of seconds until the API key may make another request.',
        schema: { type: 'integer', example: 42 },
      },
    },
    content: {
      'application/json': {
        schema: ref('Error'),
        example: {
          error: 'Rate limit exceeded',
          message: 'Too many requests. Try again after the Retry-After interval.',
        },
      },
    },
  },
};

const badRequest = (message) => errorResponse('A path parameter is invalid.', 400, { error: message });
const notFound = (message) => errorResponse('The requested resource or data was not found.', 404, { error: message });
const upstreamFailure = errorResponse('The upstream Minemen Club service could not be read.', 500, { error: 'Upstream request failed' });

const pathParameter = (name, description, schema = { type: 'string' }, example) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema,
  ...(example ? { example } : {}),
});

const playerParameter = pathParameter('name', 'Minecraft player name. Names are case-insensitive for cache lookup; the supplied value is returned in the response.', { type: 'string', minLength: 1, maxLength: 16 }, 'Notch');
const modeParameter = pathParameter('mode', 'Practice mode. Use `classic` for legacy kits or `modern` for modern kits.', { type: 'string', enum: ['classic', 'modern'] }, 'classic');
const gamemodeParameter = pathParameter(
  'gamemode',
  `Gamemode slug. Classic: ${classicGamemodes.join(', ')}. Modern: ${modernGamemodes.join(', ')}.`,
  { type: 'string', pattern: '^[a-z0-9-]+$' },
  'nodebuff',
);

function operation({ summary, description, parameters = [], schema, example, errors = {} }) {
  return {
    summary,
    description,
    security: apiKeySecurity,
    parameters,
    responses: {
      200: jsonResponse('Successful response.', schema, example),
      ...errors,
      ...standardErrors,
    },
  };
}

export function createOpenApiDocument(serverUrl) {
  return {
    openapi: '3.1.1',
    info: {
      title: 'Minemen Club API',
      version: 'v1',
      description: [
        'Read-only API for Minemen Club player profiles, matches, practice statistics, leaderboards, and clubs.',
        '',
        'Every `/v1` request requires the `API-Key` header. Responses may be served from a 30-second in-memory cache; cached data is identified by an optional `cached: true` field.',
        '',
        'Use the **Authenticate** button in Scalar to enter your API key, then use **Send Request** on any endpoint.',
      ].join('\n'),
    },
    servers: [{ url: serverUrl, description: 'Configured API base URL.' }],
    tags: [
      { name: 'Players', description: 'Player profile, status, match, and friend data.' },
      { name: 'Stats', description: 'Classic and modern practice statistics.' },
      { name: 'Leaderboards', description: 'Paginated practice leaderboard data.' },
      { name: 'Clubs', description: 'Club details and member rosters.' },
      { name: 'Utilities', description: 'Helpers for generating player-specific endpoint URLs.' },
    ],
    paths: {
      '/v1/player/{name}': {
        get: {
          ...operation({
            summary: 'Get a full player profile',
            description: 'Returns profile status, server and region when online, rank, club, friend count, and summary ELO data for every available practice mode.',
            parameters: [playerParameter],
            schema: ref('PlayerProfile'),
            example: {
              player: 'Notch', status: 'offline', server: null, region: null, last_seen_unix: 1710000000,
              rank: 'MEDIA', joined: 'Jan 1, 2020', club: null, club_id: null, friends: 24,
              elo: { classic: { global_elo: 1200, global_rank: 42, wins: 100, losses: 50 } }, ms: 213, cached: false,
            },
            errors: { 404: notFound('Player not found'), 500: upstreamFailure },
          }),
          tags: ['Players'],
        },
      },
      '/v1/status/{name}': {
        get: {
          ...operation({
            summary: 'Get a player status',
            description: 'A compact version of the profile lookup intended for status polling. It includes online/offline state, server, region, rank, and last-seen time without ELO or club details.',
            parameters: [playerParameter],
            schema: ref('PlayerStatus'),
            example: { player: 'Notch', status: 'online', server: 'NA Practice-1', region: 'NA', last_seen_unix: null, rank: 'MEDIA', cached: false },
            errors: { 404: notFound('Player not found'), 500: upstreamFailure },
          }),
          tags: ['Players'],
        },
      },
      '/v1/matches/{name}': {
        get: {
          ...operation({
            summary: 'Get recent match history',
            description: 'Returns the match cards currently visible on the player profile. `elo` is retained for compatibility and is currently an empty string; use `elo_change` for the displayed change value.',
            parameters: [playerParameter],
            schema: ref('MatchHistory'),
            example: {
              player: 'Notch',
              matches: [{ url: 'https://minemen.club/match/example', player1: 'Notch', player2: 'Steve', elo: '', elo_change: '+12', type: 'NoDebuff', date: '2 hours ago', result: 'Won' }],
            },
            errors: { 500: upstreamFailure },
          }),
          tags: ['Players'],
        },
      },
      '/v1/friends/{name}': {
        get: {
          ...operation({
            summary: 'Get a player friend list',
            description: 'Returns the total friend count from the profile and the friend names currently shown publicly. `shown` can be lower than `friend_count` when the profile does not expose every friend name.',
            parameters: [playerParameter],
            schema: ref('FriendsResponse'),
            example: { player: 'Notch', friend_count: 24, shown: 2, friends: ['Steve', 'Alex'] },
            errors: { 404: notFound('Player not found'), 500: upstreamFailure },
          }),
          tags: ['Players'],
        },
      },
      '/v1/stats/{mode}/{name}': {
        get: {
          ...operation({
            summary: 'Get practice stats for a mode',
            description: 'Returns a player’s global ELO and world rank for one practice mode, plus a summary card for each available gamemode. Use the returned `slug` value with the detailed gamemode endpoint.',
            parameters: [modeParameter, playerParameter],
            schema: ref('PracticeStats'),
            example: {
              player: 'Notch', mode: 'classic', global_elo: 1200, world_rank: 42,
              gamemodes: [{ slug: 'nodebuff', name: 'NoDebuff', ranked_elo: 1337, ranked_wins: 100, ranked_losses: 25, casual_title: 'Gold', casual_wins: 10 }],
            },
            errors: { 400: badRequest('Invalid mode (use classic or modern)'), 404: notFound('Player not found or no data'), 500: upstreamFailure },
          }),
          tags: ['Stats'],
        },
      },
      '/v1/stats/{mode}/{name}/{gamemode}': {
        get: {
          ...operation({
            summary: 'Get detailed gamemode stats',
            description: 'Returns detailed ranked, casual, and/or tournament sections for one gamemode. The sections and their metrics vary by mode and kit. `history` contains ELO chart points when Minemen Club provides them.',
            parameters: [modeParameter, playerParameter, gamemodeParameter],
            schema: ref('GamemodeStats'),
            example: {
              player: 'Notch', mode: 'classic', gamemode: 'nodebuff', name: 'NoDebuff', world_rank: 42,
              ranked: { elo: 1337, wins: 100, losses: 25, win_rate: 80 }, casual: { title: 'Gold', wins: 10 },
              history: [{ date: '2025-01-01', elo: 1300 }],
            },
            errors: { 400: badRequest('Invalid mode or gamemode'), 404: notFound('No stats available for this gamemode'), 500: upstreamFailure },
          }),
          tags: ['Stats'],
        },
      },
      '/v1/leaderboard/{mode}/{gamemode}': {
        get: {
          ...operation({
            summary: 'Get the top 10 leaderboard entries',
            description: 'Returns the first leaderboard page (offset `0`) for a practice mode and gamemode. Each page contains up to 10 entries.',
            parameters: [modeParameter, gamemodeParameter],
            schema: ref('LeaderboardPage'),
            example: { mode: 'classic', gamemode: 'nodebuff', offset: 0, count: 1, entries: [{ position: 1, username: 'Notch', uuid: '00000000-0000-0000-0000-000000000000', elo: 2000 }] },
            errors: { 400: badRequest('Invalid mode or gamemode'), 502: errorResponse('The leaderboard endpoint returned invalid JSON.', 502, { error: 'Invalid response from leaderboard API' }), 500: upstreamFailure },
          }),
          tags: ['Leaderboards'],
        },
      },
      '/v1/leaderboard/{mode}/{gamemode}/offset/{offset}': {
        get: {
          ...operation({
            summary: 'Get a leaderboard page from an offset',
            description: 'Returns up to 10 entries beginning at the supplied zero-based offset. For example, `offset=10` normally returns placements 11 through 20.',
            parameters: [modeParameter, gamemodeParameter, pathParameter('offset', 'Zero-based entry offset. Use multiples of 10 to page through results.', { type: 'integer', minimum: 0 }, 10)],
            schema: ref('LeaderboardPage'),
            example: { mode: 'classic', gamemode: 'nodebuff', offset: 10, count: 1, entries: [{ position: 11, username: 'Steve', uuid: '11111111-1111-1111-1111-111111111111', elo: 1800 }] },
            errors: { 400: badRequest('Invalid mode or gamemode'), 502: errorResponse('The leaderboard endpoint returned invalid JSON.', 502, { error: 'Invalid response from leaderboard API' }), 500: upstreamFailure },
          }),
          tags: ['Leaderboards'],
        },
      },
      '/v1/leaderboard/{mode}/{gamemode}/placement/{placement}': {
        get: {
          ...operation({
            summary: 'Get a leaderboard entry by placement',
            description: 'Looks up one one-based leaderboard placement and calculates the required offset automatically. Use this when you need a specific rank instead of a page.',
            parameters: [modeParameter, gamemodeParameter, pathParameter('placement', 'One-based leaderboard placement.', { type: 'integer', minimum: 1 }, 1)],
            schema: ref('LeaderboardEntryResponse'),
            example: { mode: 'classic', gamemode: 'nodebuff', placement: 1, position: 1, username: 'Notch', uuid: '00000000-0000-0000-0000-000000000000', elo: 2000 },
            errors: { 400: badRequest('Invalid mode, gamemode, or placement'), 404: notFound('No player at placement #1'), 502: errorResponse('The leaderboard endpoint returned invalid JSON.', 502, { error: 'Invalid response from leaderboard API' }), 500: upstreamFailure },
          }),
          tags: ['Leaderboards'],
        },
      },
      '/v1/clubs/id/{clubId}': {
        get: {
          ...operation({
            summary: 'Get a club roster by club ID',
            description: 'Returns a club’s name, capacity, leader, and member roles. Club IDs are the hexadecimal identifiers found in Minemen Club club URLs.',
            parameters: [pathParameter('clubId', 'Club ID from a Minemen Club URL. Hexadecimal characters and hyphens are accepted.', { type: 'string', pattern: '^[a-fA-F0-9-]+$' }, '00000000-0000-0000-0000-000000000000')],
            schema: ref('Club'),
            example: { club_id: '00000000-0000-0000-0000-000000000000', name: 'Example Club', member_count: 2, member_limit: 50, leader: 'Notch', members: [{ username: 'Notch', role: 'LEADER' }, { username: 'Steve', role: 'MEMBER' }] },
            errors: { 400: badRequest('Invalid club id'), 404: notFound('Club not found'), 500: upstreamFailure },
          }),
          tags: ['Clubs'],
        },
      },
      '/v1/clubs/player/{name}': {
        get: {
          ...operation({
            summary: 'Get a player’s club roster',
            description: 'Resolves the player’s current club from their profile, then returns the same club roster payload as the club-ID endpoint. The queried player may or may not be the club leader.',
            parameters: [playerParameter],
            schema: ref('PlayerClub'),
            example: { queried_player: 'Steve', club_id: '00000000-0000-0000-0000-000000000000', name: 'Example Club', member_count: 2, member_limit: 50, leader: 'Notch', members: [{ username: 'Notch', role: 'LEADER' }, { username: 'Steve', role: 'MEMBER' }] },
            errors: { 404: notFound('Player not found or player is not in a club'), 500: upstreamFailure },
          }),
          tags: ['Clubs'],
        },
      },
      '/v1/generator/{name}': {
        get: {
          ...operation({
            summary: 'Generate player-specific endpoint URLs',
            description: 'Builds the profile, status, match, friend, stat, and club URLs for one player. It does not call Minemen Club and is useful for API clients that need a discoverable set of links.',
            parameters: [playerParameter],
            schema: ref('EndpointGenerator'),
            example: { player: 'Notch', base: 'https://api.example.com', endpoints: [{ description: 'Full player profile', path: '/v1/player/Notch', url: 'https://api.example.com/v1/player/Notch' }] },
          }),
          tags: ['Utilities'],
        },
      },
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
            error: { type: 'string', description: 'Short error reason.' },
            message: { type: 'string', description: 'Optional human-readable remediation.' },
          },
        },
        EloSummary: {
          type: 'object',
          properties: {
            global_elo: { type: ['integer', 'null'], description: 'Global ELO for the practice mode.' },
            global_rank: { type: ['integer', 'null'], description: 'Global leaderboard rank for the practice mode.' },
            wins: { type: ['integer', 'null'] },
            losses: { type: ['integer', 'null'] },
          },
        },
        PlayerProfile: {
          type: 'object',
          required: ['player', 'status', 'friends', 'elo', 'ms', 'cached'],
          properties: {
            player: { type: 'string' }, status: { type: 'string', enum: ['online', 'offline', 'banned', 'unknown'] },
            server: { type: ['string', 'null'], description: 'Current server when online.' }, region: { type: ['string', 'null'], enum: ['NA', 'EU', 'AS', null] },
            last_seen_unix: { type: ['integer', 'null'], description: 'Unix timestamp in seconds when offline.' }, rank: { type: ['string', 'null'] },
            joined: { type: ['string', 'null'], description: 'Profile join date exactly as displayed by Minemen Club.' }, club: { type: ['string', 'null'] }, club_id: { type: ['string', 'null'] },
            friends: { type: 'integer', minimum: 0 }, elo: { type: 'object', additionalProperties: ref('EloSummary') },
            ms: { type: 'integer', minimum: 0, description: 'Profile upstream fetch time in milliseconds.' }, cached: { type: 'boolean', description: 'Whether the response was served from the API cache.' },
          },
        },
        PlayerStatus: {
          type: 'object',
          required: ['player', 'status', 'server', 'region', 'last_seen_unix', 'rank', 'cached'],
          properties: {
            player: { type: 'string' }, status: { type: 'string', enum: ['online', 'offline', 'banned', 'unknown'] },
            server: { type: ['string', 'null'] }, region: { type: ['string', 'null'], enum: ['NA', 'EU', 'AS', null] },
            last_seen_unix: { type: ['integer', 'null'] }, rank: { type: ['string', 'null'] }, cached: { type: 'boolean' },
          },
        },
        Match: {
          type: 'object',
          required: ['url', 'player1', 'player2', 'elo', 'elo_change', 'type', 'date', 'result'],
          properties: {
            url: { type: 'string', format: 'uri' }, player1: { type: 'string' }, player2: { type: 'string' },
            elo: { type: 'string', description: 'Reserved compatibility field; currently empty.' }, elo_change: { type: 'string' },
            type: { type: 'string', description: 'Displayed kit or gamemode name.' }, date: { type: 'string', description: 'Displayed relative match time.' }, result: { type: 'string', description: 'Displayed result label.' },
          },
        },
        MatchHistory: {
          type: 'object',
          required: ['player', 'matches'],
          properties: { player: { type: 'string' }, matches: { type: 'array', items: ref('Match') }, cached: { type: 'boolean', description: 'Present and true when served from cache.' } },
        },
        FriendsResponse: {
          type: 'object',
          required: ['player', 'friend_count', 'shown', 'friends'],
          properties: { player: { type: 'string' }, friend_count: { type: 'integer', minimum: 0 }, shown: { type: 'integer', minimum: 0 }, friends: { type: 'array', items: { type: 'string' } }, cached: { type: 'boolean', description: 'Present and true when served from cache.' } },
        },
        GamemodeSummary: {
          type: 'object',
          required: ['slug', 'name', 'ranked_elo', 'ranked_wins', 'ranked_losses', 'casual_title', 'casual_wins'],
          properties: {
            slug: { type: 'string' }, name: { type: 'string' }, ranked_elo: { type: ['integer', 'null'] }, ranked_wins: { type: ['integer', 'null'] }, ranked_losses: { type: ['integer', 'null'] },
            casual_title: { type: ['string', 'null'] }, casual_wins: { type: ['integer', 'null'] },
          },
        },
        PracticeStats: {
          type: 'object',
          required: ['player', 'mode', 'global_elo', 'world_rank', 'gamemodes'],
          properties: { player: { type: 'string' }, mode: { type: 'string', enum: ['classic', 'modern'] }, global_elo: { type: ['integer', 'null'] }, world_rank: { type: ['integer', 'null'] }, gamemodes: { type: 'array', items: ref('GamemodeSummary') }, cached: { type: 'boolean', description: 'Present and true when served from cache.' } },
        },
        GamemodeStats: {
          type: 'object',
          required: ['player', 'mode', 'gamemode', 'name', 'world_rank', 'history'],
          properties: {
            player: { type: 'string' }, mode: { type: 'string', enum: ['classic', 'modern'] }, gamemode: { type: 'string' }, name: { type: 'string' }, world_rank: { type: ['integer', 'null'] },
            ranked: { type: 'object', description: 'Present when ranked data is available.', additionalProperties: true }, casual: { type: 'object', description: 'Present when casual data is available.', additionalProperties: true }, tournament: { type: 'object', description: 'Present when tournament data is available.', additionalProperties: true },
            history: { type: 'array', items: { type: 'object', required: ['date', 'elo'], properties: { date: { type: 'string' }, elo: { type: 'integer' } } } }, cached: { type: 'boolean', description: 'Present and true when served from cache.' },
          },
        },
        LeaderboardEntry: {
          type: 'object',
          required: ['position', 'username', 'uuid', 'elo'],
          properties: { position: { type: 'integer', minimum: 1 }, username: { type: 'string' }, uuid: { type: ['string', 'null'] }, elo: { type: ['integer', 'null'] } },
        },
        LeaderboardPage: {
          type: 'object',
          required: ['mode', 'gamemode', 'offset', 'count', 'entries'],
          properties: { mode: { type: 'string', enum: ['classic', 'modern'] }, gamemode: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 0, maximum: 10 }, entries: { type: 'array', items: ref('LeaderboardEntry') }, cached: { type: 'boolean', description: 'Present and true when served from cache.' } },
        },
        LeaderboardEntryResponse: {
          allOf: [
            { type: 'object', required: ['mode', 'gamemode', 'placement'], properties: { mode: { type: 'string', enum: ['classic', 'modern'] }, gamemode: { type: 'string' }, placement: { type: 'integer', minimum: 1 }, cached: { type: 'boolean', description: 'Present and true when served from cache.' } } },
            ref('LeaderboardEntry'),
          ],
        },
        ClubMember: {
          type: 'object', required: ['username', 'role'], properties: { username: { type: 'string' }, role: { type: 'string', description: 'Club role such as LEADER, ADMIN, or MEMBER.' } },
        },
        Club: {
          type: 'object',
          required: ['club_id', 'name', 'member_count', 'member_limit', 'leader', 'members'],
          properties: { club_id: { type: 'string' }, name: { type: 'string' }, member_count: { type: 'integer', minimum: 0 }, member_limit: { type: ['integer', 'null'] }, leader: { type: ['string', 'null'] }, members: { type: 'array', items: ref('ClubMember') }, cached: { type: 'boolean', description: 'Present and true when served from cache.' } },
        },
        PlayerClub: {
          allOf: [{ type: 'object', required: ['queried_player'], properties: { queried_player: { type: 'string', description: 'Player used to resolve the club.' }, cached: { type: 'boolean', description: 'Present and true when served from cache.' } } }, ref('Club')],
        },
        GeneratedEndpoint: {
          type: 'object',
          required: ['description', 'path', 'url'],
          properties: { description: { type: 'string' }, path: { type: 'string' }, url: { type: 'string', format: 'uri' }, available_gamemodes: { type: 'array', items: { type: 'object', properties: { gamemode: { type: 'string' }, url: { type: 'string', format: 'uri' } } } } },
        },
        EndpointGenerator: {
          type: 'object', required: ['player', 'base', 'endpoints'], properties: { player: { type: 'string' }, base: { type: 'string', format: 'uri' }, endpoints: { type: 'array', items: ref('GeneratedEndpoint') } },
        },
      },
    },
  };
}
