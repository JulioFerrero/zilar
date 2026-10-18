// One signed-in GET serving the bytes an AI put in a card. A group room is readable by
// its members (the same check `/api/files` uses), a DM card only by the AI's owner. An
// unknown id, an invisible room and a missing file all answer the same 404.

import { readFile } from 'node:fs/promises';
import { Effect, Layer, Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { SqlClient } from 'effect/sql';
import type { Logger } from 'pino';
import { isDmBlocked } from '../blocks/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config/load';
import type { ServerDatabase } from '../db/client';
import type { CardMediaRow } from '../db/rows-agents';
import { runSql } from '../effect/sql';
import { Session, handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { allowedArchives, resolveChatFilter } from '../search/service';
import { cardMediaPath, getCardMedia } from './service';

// 600 per 10 min per user, charged before the lookup so ids cannot be probed for free.
export const CARD_MEDIA_READ_RATE_LIMIT_MAX = 600;
export const CARD_MEDIA_READ_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface CardMediaApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  storageDir: string;
  now?: () => number;
}

const CardMediaIdParams = Schema.Struct({ id: Schema.String });

const CardMediaGroup = HttpApiGroup.make('card-media')
  .add(
    HttpApiEndpoint.get('serve', '/card-media/:id', {
      params: CardMediaIdParams,
    }),
  )
  .middleware(Session)
  .prefix('/api');

const CardMediaApi = HttpApi.make('card-media').add(CardMediaGroup);

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

// Only a conservative character set, at most 100 characters, so the header cannot be
// split or misread.
function sanitiseName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._ -]/g, '').slice(0, 100);
  return safe === '' ? 'file' : safe;
}

async function isAiOwner(db: ServerDatabase, aiId: string, userId: string): Promise<boolean> {
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  return ai?.owner === userId;
}

// A DM is readable only by the AI's owner, on top of the ordinary DM visibility and
// block checks.
async function mayRead(
  deps: CardMediaApiDependencies,
  row: CardMediaRow,
  userId: string,
): Promise<boolean> {
  const allowed = await allowedArchives(deps.db, deps.config, userId);
  const filter = resolveChatFilter(allowed, row.roomJid);
  if (filter === null) {
    return false;
  }
  if (filter.kind === 'dm') {
    if (await isDmBlocked(deps.db, userId, filter.peer)) {
      return false;
    }
    return isAiOwner(deps.db, row.aiId, userId);
  }
  return true;
}

async function readBytes(deps: CardMediaApiDependencies, row: CardMediaRow): Promise<Uint8Array> {
  try {
    return await readFile(cardMediaPath(deps.storageDir, row));
  } catch {
    // A row without its file is as invisible as an unknown id.
    throw notFound();
  }
}

export function createCardMediaApi(deps: CardMediaApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const readLimiter = createRateLimiter({
    max: CARD_MEDIA_READ_RATE_LIMIT_MAX,
    windowMs: CARD_MEDIA_READ_RATE_LIMIT_WINDOW_MS,
    now,
  });

  const groupLayer = HttpApiBuilder.group(CardMediaApi, 'card-media', (handlers) =>
    handlers.handle(
      'serve',
      handler(logger, async (request, user) => {
        if (!readLimiter.allow(user.id)) {
          throw new HttpError(429, 'rate_limited', 'Too many card media reads, try again later');
        }
        const row = await getCardMedia(deps.db, request.params.id);
        if (row === undefined || !(await mayRead(deps, row, user.id))) {
          throw notFound();
        }
        const bytes = await readBytes(deps, row);
        const headers: Record<string, string> = {
          'content-type': row.mime,
          'content-length': String(bytes.byteLength),
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'",
          'cache-control': 'private, max-age=31536000, immutable',
          etag: `"${row.id}"`,
        };
        if (!row.mime.startsWith('image/')) {
          headers['content-disposition'] = `attachment; filename="${sanitiseName(row.name)}"`;
        }
        return HttpServerResponse.uint8Array(bytes, { status: 200, headers });
      }),
    ),
  );

  const apiLayer = HttpApiBuilder.layer(CardMediaApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  return mountApi(CardMediaApi, apiLayer);
}
