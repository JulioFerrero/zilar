// The hand-decodes and fixed per-route error texts of the stickers API, split
// out of `./api` by T-0992. The group, the payload schemas (create, patch,
// reorder, favorite) and the reply schemas live in the shared contract
// (`@zilar/api-contract`, `stickers.ts`, T-0895). The schemas below are the
// ones the module still decodes by hand.

import { Effect, Schema } from 'effect';
import type { HttpServerRequest } from 'effect/http';
import { AddStickerFavoritePayload } from '@zilar/api-contract';
import type { SchemaErrorRender } from '../effect/http-core';
import { HttpError } from '../errors';
import { STICKER_PANEL_MAX, STICKERS_MAX_PER_PACK } from './service';

// Optional `q` <= 60, `cursor` <= 128. The route decodes the query manually
// with this Schema (the contract declares the keys as `RawQueryValue`, which
// the router never rejects) so an invalid query answers the fixed 400 message.
export const DiscoverQuery = Schema.Struct({
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(60))),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
});

// The import route decodes `ImportTelegramPayload` (the contract's schema)
// manually in its handler (after the 501 token check), so strictness comes
// from `STRICT_PAYLOAD` below.
export const STRICT_PAYLOAD = { onExcessProperty: 'error' } as const;

// Strict, `sticker_id: uuid`; the favorite-delete route decodes it from the
// query string by hand.
export const FavoriteBody = AddStickerFavoritePayload;

// Mirrors `c.req.json().catch(() => null)`: an unparseable or empty body is
// `null`, which the per-route message treats as an invalid body.
export function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function discoverQueryRecord(
  request: HttpServerRequest.HttpServerRequest,
): Record<string, string> {
  const queryIndex = request.originalUrl.indexOf('?');
  if (queryIndex === -1) {
    return {};
  }
  const params = new URLSearchParams(request.originalUrl.slice(queryIndex + 1));
  const record: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!(key in record)) {
      record[key] = value;
    }
  }
  return record;
}

export function favoriteQueryRecord(
  request: HttpServerRequest.HttpServerRequest,
): Record<string, string> {
  return discoverQueryRecord(request);
}

// Applied to the group so a payload decode failure renders as 400
// `invalid_request` with the fixed per-route message. The body was already
// read (and cached) by the failed payload decode. The discover and
// favorite-delete routes decode manually in their handlers, so they never
// reach this layer.
export const renderSchemaError: SchemaErrorRender = (_error, request) =>
  Effect.gen(function* () {
    const body = parseJsonOrNull(yield* Effect.orDie(request.text));
    return new HttpError(
      400,
      'invalid_request',
      matchSchemaErrorMessage(request.originalUrl, body),
    );
  });

function isEmptyRecord(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

// Picks the fixed message by the request path (the method is implied by the
// route): every path below carries exactly one JSON body shape. The patch
// route reads the cached body only to tell `{}` apart.
function matchSchemaErrorMessage(url: string, body: unknown): string {
  const path = url.split('?')[0] ?? url;
  if (path.endsWith('/sticker-packs/import/telegram')) {
    return 'input must be a string of 1 to 512 characters, with no other keys';
  }
  if (path.endsWith('/sticker-panel')) {
    return `order must be a list of at most ${STICKER_PANEL_MAX} sticker ids, with no other keys`;
  }
  if (path.endsWith('/sticker-favorites')) {
    return 'sticker_id must be a UUID, with no other keys';
  }
  if (path.endsWith('/sticker-packs')) {
    return 'title must be 1 to 60 characters and visibility private or server, with no other keys';
  }
  if (isEmptyRecord(body)) {
    return 'Nothing to update';
  }
  return `title must be 1 to 60 characters, visibility private or server and order at most ${STICKERS_MAX_PER_PACK} ids, with no other keys`;
}

// Runs the Telegram import budget after the pack-input parse, exactly like
// the old route's limiter position (item 9): garbage input fails before the
// 3/hour budget is spent. Kept in the handler (not endpoint middleware) so
// the 501 token check runs first: a missing token must never spend budget.
export function spendTelegramImportBudget(
  limiter: { allow: (key: string) => boolean },
  userId: string,
): void {
  if (!limiter.allow(userId)) {
    throw new HttpError(429, 'rate_limited', 'Too many Telegram imports, try again later');
  }
}

// A malformed percent escape is an unknown id (404), not a server error.
// The Effect router hands out decoded params (like the old `c.req.param`), so
// this second decode is idempotent on normal ids and keeps the old final id.
export function decodePathId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
}

// Referenced for parity documentation (the discover route decodes manually).
void DiscoverQuery;
