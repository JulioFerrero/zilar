import { Data, Effect, Exit, Schema, SchemaGetter, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';

/**
 * The mobile media-gallery client (T-0436), the twin of `pins-api.ts`: it
 * pages `GET /api/media?chat&type&before&limit` (T-0431), returning
 * `{ items, next }`.
 *
 * The boundary is validated with Effect Schema (T-0532, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. Malformed rows are dropped, never rendered.
 *
 * A `MediaItem` is display metadata only: `messageId` is the jump key, `at`
 * is ISO, and the optional fields depend on `kind`.
 */

export type MediaTab = 'media' | 'files' | 'links' | 'voice';

export type MediaKind = 'image' | 'file' | 'gif' | 'voice' | 'link';

export interface MediaItem {
  messageId: string;
  chat: string;
  at: string;
  senderName: string;
  kind: MediaKind;
  url?: string;
  name?: string;
  size?: number;
  mime?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  linkUrl?: string;
  linkHost?: string;
}

/** One page of the gallery, newest first; `next` is the paging cursor. */
export interface MediaPage {
  items: MediaItem[];
  next: string | null;
}

export interface ListChatMediaInput {
  chat: string;
  type: MediaTab;
  before?: string;
  limit?: number;
}

export interface MediaApi {
  listChatMedia(input: ListChatMediaInput): Promise<MediaPage>;
}

export class MediaApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MediaApiError';
    this.status = status;
    this.code = code;
  }
}

const FiniteNumberSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => (Number.isFinite(value) ? undefined : 'not finite'))),
);

const IsoDateSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      Number.isNaN(Date.parse(value)) ? 'must be a parseable date' : undefined,
    ),
  ),
);

// An optional field the client tolerates: a value of the wrong shape is
// dropped instead of failing the row. This is the T-0506 recipe for a server
// value the client must not trust.
const LenientOptionalStringSchema = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : undefined)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const LenientOptionalNumberSchema = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.UndefinedOr(FiniteNumberSchema), {
    decode: SchemaGetter.transform((value) =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined,
    ),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const LenientOptionalWaveformSchema = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.UndefinedOr(Schema.mutable(Schema.Array(FiniteNumberSchema))), {
    decode: SchemaGetter.transform((value) =>
      Array.isArray(value) &&
      value.every((entry: unknown) => typeof entry === 'number' && Number.isFinite(entry))
        ? ([...value] as number[])
        : undefined,
    ),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const MediaItemSchema = struct({
  messageId: Schema.String,
  chat: Schema.String,
  at: IsoDateSchema,
  senderName: Schema.String,
  kind: Schema.Literals(['image', 'file', 'gif', 'voice', 'link']),
  url: Schema.optional(LenientOptionalStringSchema),
  name: Schema.optional(LenientOptionalStringSchema),
  size: Schema.optional(LenientOptionalNumberSchema),
  mime: Schema.optional(LenientOptionalStringSchema),
  width: Schema.optional(LenientOptionalNumberSchema),
  height: Schema.optional(LenientOptionalNumberSchema),
  durationMs: Schema.optional(LenientOptionalNumberSchema),
  waveform: Schema.optional(LenientOptionalWaveformSchema),
  linkUrl: Schema.optional(LenientOptionalStringSchema),
  linkHost: Schema.optional(LenientOptionalStringSchema),
});

// The page envelope: rows stay `unknown` because one malformed row is dropped
// and the rest stay. A non-string `next` is read as `null`.
const MediaPageSchema = struct({
  items: Schema.mutable(Schema.Array(Schema.Unknown)),
  next: Schema.optional(Schema.Unknown),
});

/**
 * A gallery row the viewer may see; a malformed row returns null and is
 * dropped by the list. Optional fields are only copied when the server sent
 * a value of the right shape, so a drifted payload never widens the type.
 */
export function parseMediaItem(value: unknown): MediaItem | null {
  const decoded = Schema.decodeUnknownExit(MediaItemSchema)(value);
  if (!Exit.isSuccess(decoded)) {
    return null;
  }
  const item = decoded.value;
  return {
    messageId: item.messageId,
    chat: item.chat,
    at: item.at,
    senderName: item.senderName,
    kind: item.kind,
    ...(item.url === undefined ? {} : { url: item.url }),
    ...(item.name === undefined ? {} : { name: item.name }),
    ...(item.size === undefined ? {} : { size: item.size }),
    ...(item.mime === undefined ? {} : { mime: item.mime }),
    ...(item.width === undefined ? {} : { width: item.width }),
    ...(item.height === undefined ? {} : { height: item.height }),
    ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs }),
    ...(item.waveform === undefined ? {} : { waveform: item.waveform }),
    ...(item.linkUrl === undefined ? {} : { linkUrl: item.linkUrl }),
    ...(item.linkHost === undefined ? {} : { linkHost: item.linkHost }),
  };
}

// The internal failures, one per case. They carry no field beyond what the old
// `MediaApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class MediaNetworkError extends Data.TaggedError('MediaNetworkError') {}
class MediaRequestError extends Data.TaggedError('MediaRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class MediaUnauthorized extends Data.TaggedError('MediaUnauthorized') {}
class MediaInvalidResponse extends Data.TaggedError('MediaInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, MediaNetworkError | MediaRequestError> {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetchImpl(`${apiUrl}${path}`, {
        ...init,
        signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
      }),
    catch: () => new MediaNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new MediaRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `MediaApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createMediaApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): MediaApi {
  const listChatMediaEffect = Effect.fnUntraced(function* (
    path: string,
  ): EffectType.fn.Return<
    MediaPage,
    MediaUnauthorized | MediaNetworkError | MediaRequestError | MediaInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new MediaUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, { method: 'GET' }, fetchImpl);
    const decoded = Schema.decodeUnknownExit(MediaPageSchema)(body);
    if (!Exit.isSuccess(decoded)) {
      return yield* new MediaInvalidResponse();
    }
    const items: MediaItem[] = [];
    for (const entry of decoded.value.items) {
      const item = parseMediaItem(entry);
      if (item !== null) {
        items.push(item);
      }
    }
    const next = decoded.value.next;
    return { items, next: typeof next === 'string' ? next : null };
  });

  const listChatMedia = (path: string): Promise<MediaPage> =>
    Effect.runPromise(
      listChatMediaEffect(path).pipe(
        Effect.catchTags({
          MediaUnauthorized: () =>
            Effect.fail(new MediaApiError(401, 'unauthorized', 'No session')),
          MediaNetworkError: () =>
            Effect.fail(new MediaApiError(0, 'network_error', 'Could not reach the server')),
          MediaRequestError: (error) =>
            Effect.fail(new MediaApiError(error.status, error.code, error.message)),
          MediaInvalidResponse: () =>
            Effect.fail(
              new MediaApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

  return {
    async listChatMedia({ chat, type, before, limit }) {
      const params = new URLSearchParams();
      params.set('chat', chat);
      params.set('type', type);
      if (before !== undefined) {
        params.set('before', before);
      }
      if (limit !== undefined) {
        params.set('limit', String(limit));
      }
      return listChatMedia(`/api/media?${params.toString()}`);
    },
  };
}
