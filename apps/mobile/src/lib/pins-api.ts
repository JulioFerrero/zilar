import { Data, Effect, Exit, Schema, SchemaGetter, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import type { SnapshotPinKind } from './pin-snapshot';

export type PinKind = SnapshotPinKind;

/**
 * The mobile twin of the web pins client (`apps/web/src/lib/api.ts`): list,
 * pin and unpin. The wire contract lives in
 * `apps/server/src/pins/{routes,service,access}` (T-0114).
 *
 * The boundary is validated with Effect Schema (T-0506, the recipe for the
 * other 24 `*-api.ts` files): the request is an Effect pipeline, cut back to a
 * `Promise` at the edge with `Effect.runPromise`. `chat` is a room bare JID for
 * groups/topics, or a DM peer's bare JID (the server keeps the canonical pair
 * key, so both sides share one list). The snapshot
 * (`senderName`/`text`/`kind`) is display only: the server trusts it for
 * rendering, never for authorization.
 */

export interface Pin {
  id: string;
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: PinKind;
  pinnedBy: string;
  pinnedAt: string;
}

export interface PinMessageInput {
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: PinKind;
}

export interface PinsApi {
  listPins(chat: string): Promise<Pin[]>;
  pinMessage(input: PinMessageInput): Promise<Pin>;
  unpinMessage(id: string): Promise<Pin>;
}

export class PinsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PinsApiError';
    this.status = status;
    this.code = code;
  }
}

/** Unknown kinds fall back to `text`, so a newer server never breaks pins. */
export function parsePinKind(value: unknown): PinKind {
  if (
    value === 'text' ||
    value === 'image' ||
    value === 'file' ||
    value === 'voice' ||
    value === 'card'
  ) {
    return value;
  }
  return 'text';
}

const PinKindSchema = Schema.Literals(['text', 'image', 'file', 'voice', 'card']);

// A lenient field: any value outside the five kinds decodes to `text` instead
// of failing the row. This is the T-0506 recipe for a server value the client
// must tolerate.
const LenientPinKindSchema = Schema.Unknown.pipe(
  Schema.decodeTo(PinKindSchema, {
    decode: SchemaGetter.transform((value) => parsePinKind(value)),
    encode: SchemaGetter.transform((kind) => kind),
  }),
);

const PinSchema = struct({
  id: Schema.String,
  chat: Schema.String,
  messageId: Schema.String,
  senderName: Schema.String,
  text: Schema.String,
  kind: LenientPinKindSchema,
  pinnedBy: Schema.String,
  pinnedAt: Schema.String,
});

// Unknown extra keys are dropped by the default non-strict decode. `Array` is
// made mutable to keep the `Pin[]` type the API has always returned.
const PinsListSchema = struct({
  pins: Schema.mutable(Schema.Array(PinSchema)),
});

// The server's error envelope. A missing or malformed envelope keeps the fixed
// fallbacks used by `requestEffect`.
const ErrorBodySchema = struct({
  error: struct({
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
});

/** A pin row the viewer may see; malformed rows return null and are dropped. */
export function parsePin(value: unknown): Pin | null {
  const decoded = Schema.decodeUnknownExit(PinSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parsePinsList(value: unknown): Pin[] | null {
  const decoded = Schema.decodeUnknownExit(PinsListSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value.pins : null;
}

// The internal failures, one per case. They carry no field beyond what the old
// `PinsApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class PinsNetworkError extends Data.TaggedError('PinsNetworkError') {}
class PinsRequestError extends Data.TaggedError('PinsRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class PinsUnauthorized extends Data.TaggedError('PinsUnauthorized') {}
class PinsInvalidResponse extends Data.TaggedError('PinsInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, PinsNetworkError | PinsRequestError> {
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
    catch: () => new PinsNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const decoded = Schema.decodeUnknownExit(ErrorBodySchema)(body);
    const error = Exit.isSuccess(decoded) ? decoded.value.error : undefined;
    return yield* new PinsRequestError({
      status: response.status,
      code: error?.code ?? 'request_failed',
      message: error?.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `PinsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createPinsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): PinsApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    PinsUnauthorized | PinsNetworkError | PinsRequestError | PinsInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new PinsUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new PinsInvalidResponse();
    }
    return parsed;
  });

  const withToken = (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> =>
    Effect.runPromise(
      withTokenEffect(path, init, parse).pipe(
        Effect.catchTags({
          PinsUnauthorized: () => Effect.fail(new PinsApiError(401, 'unauthorized', 'No session')),
          PinsNetworkError: () =>
            Effect.fail(new PinsApiError(0, 'network_error', 'Could not reach the server')),
          PinsRequestError: (error) =>
            Effect.fail(new PinsApiError(error.status, error.code, error.message)),
          PinsInvalidResponse: () =>
            Effect.fail(
              new PinsApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

  return {
    async listPins(chat) {
      const params = new URLSearchParams();
      params.set('chat', chat);
      const body = await withToken(
        `/api/pins?${params.toString()}`,
        { method: 'GET' },
        parsePinsList,
      );
      return body as Pin[];
    },
    async pinMessage(input) {
      const body = await withToken(
        '/api/pins',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        parsePin,
      );
      return body as Pin;
    },
    async unpinMessage(id) {
      // The server echoes the deleted row, so the store can remove it
      // without a refetch.
      const body = await withToken(
        `/api/pins/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        parsePin,
      );
      return body as Pin;
    },
  };
}

// The snapshot helpers (`pinKindFor`, `pinSnapshotText`, `pinLabel`) live in
// the dependency-free `pin-snapshot.ts`, so components can import them
// without pulling the API client (Vitest cannot resolve `@/` for component
// modules — see `apps/mobile` test notes in T-0112).
export { pinKindFor, pinLabel, pinSnapshotText } from './pin-snapshot';
export type { SnapshotPinKind } from './pin-snapshot';
