import { Data, Effect, Exit, Schema, SchemaGetter, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';
import { errorFieldsOf } from './api-error-body';

/**
 * The contacts API (`/api/users/by-handle/:handle` and `/api/contact-requests`),
 * the mobile twin of the web client in `apps/web/src/lib/api.ts`. The wire
 * contract lives in `apps/server/src/contact-requests/routes.ts` and
 * `apps/server/src/contact-requests/service.ts`.
 *
 * The boundary is validated with Effect Schema (T-0550, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge
 * with `Effect.runPromise`. `ContactsApiError` keeps the server's `code` and
 * `status`, so screens can branch on the error without parsing the message
 * again (404 = unknown handle, 429 = rate limited).
 */

export type ContactRelation =
  'none' | 'contact' | 'request_sent' | 'request_received' | 'self' | 'blocked';

export interface HandleProfile {
  userId: string;
  name: string;
  handle: string;
  image: string | null;
  relation: ContactRelation;
}

export type ContactRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface ContactRequestPerson {
  userId: string;
  name: string;
  handle: string | null;
  image: string | null;
}

export interface ContactRequestView {
  id: string;
  status: ContactRequestStatus;
  createdAt: string;
  other: ContactRequestPerson;
}

export interface ContactRequestList {
  incoming: ContactRequestView[];
  outgoing: ContactRequestView[];
}

export interface ContactRequestRow {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: ContactRequestStatus;
  createdAt: string;
  decidedAt?: string | undefined;
}

export interface CreatedContactRequest {
  request: ContactRequestRow;
  /** Present when the other side already asked: offer Accept, not a second row. */
  incoming?: boolean | undefined;
}

export interface BlockedPerson {
  userId: string;
  name: string;
  handle: string | null;
  image: string | null;
  jid: string | null;
}

export interface ContactsApi {
  lookupByHandle(handle: string): Promise<HandleProfile>;
  sendContactRequest(handle: string): Promise<CreatedContactRequest>;
  listContactRequests(): Promise<ContactRequestList>;
  acceptContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
  declineContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
  cancelContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
  blockUser(userId: string): Promise<{ blocked: boolean }>;
  unblockUser(userId: string): Promise<{ blocked: boolean }>;
  listBlockedUsers(): Promise<BlockedPerson[]>;
}

export class ContactsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ContactsApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Normalizes a typed @handle for lookup: strips a leading @, trims
 * whitespace, lowercases. The server compares case-insensitively, so the
 * lookup sends the normalized form.
 */
export function normalizeHandleInput(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

// A lenient field: a missing or non-string value decodes to `null` instead of
// failing the row, exactly like the old type guard.
const LenientNullStringSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
  Schema.decodeTo(Schema.NullOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

// A lenient field: a missing or non-string `decidedAt` decodes to `undefined`
// (the key is omitted), exactly like the old type guard.
const LenientDecidedAtSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(undefined)),
  Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : undefined)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

// A lenient field: only an explicit `true` reads as true; anything else
// (including a missing key) reads as absent or false, exactly like the old
// `incoming === true` guard.
const LenientIncomingSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(undefined)),
  Schema.decodeTo(Schema.UndefinedOr(Schema.Boolean), {
    decode: SchemaGetter.transform((value) => (value === undefined ? undefined : value === true)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const HandleProfileSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  handle: Schema.String,
  image: LenientNullStringSchema,
  relation: Schema.Literals([
    'none',
    'contact',
    'request_sent',
    'request_received',
    'self',
    'blocked',
  ]),
});

const ContactRequestPersonSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  handle: LenientNullStringSchema,
  image: LenientNullStringSchema,
});

const ContactRequestStatusSchema = Schema.Literals([
  'pending',
  'accepted',
  'declined',
  'cancelled',
]);

const ContactRequestViewSchema = struct({
  id: Schema.String,
  status: ContactRequestStatusSchema,
  createdAt: Schema.String,
  other: ContactRequestPersonSchema,
});

const ContactRequestRowSchema = struct({
  id: Schema.String,
  fromUserId: Schema.String,
  toUserId: Schema.String,
  status: ContactRequestStatusSchema,
  createdAt: Schema.String,
  decidedAt: LenientDecidedAtSchema,
});

const CreatedContactRequestSchema = struct({
  request: ContactRequestRowSchema,
  incoming: LenientIncomingSchema,
});

const DecidedRequestSchema = struct({
  request: ContactRequestRowSchema,
});

const BlockResultSchema = struct({
  blocked: Schema.Boolean,
});

const BlockedPersonSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  handle: LenientNullStringSchema,
  image: LenientNullStringSchema,
  jid: LenientNullStringSchema,
});

function toRequestRow(decoded: typeof ContactRequestRowSchema.Type): ContactRequestRow {
  return {
    id: decoded.id,
    fromUserId: decoded.fromUserId,
    toUserId: decoded.toUserId,
    status: decoded.status,
    createdAt: decoded.createdAt,
    ...(decoded.decidedAt === undefined ? {} : { decidedAt: decoded.decidedAt }),
  };
}

function toPerson(decoded: typeof ContactRequestPersonSchema.Type): ContactRequestPerson {
  return {
    userId: decoded.userId,
    name: decoded.name,
    handle: decoded.handle,
    image: decoded.image,
  };
}

function parseHandleProfile(value: unknown): HandleProfile | null {
  const decoded = Schema.decodeUnknownExit(HandleProfileSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  return {
    userId: decoded.value.userId,
    name: decoded.value.name,
    handle: decoded.value.handle,
    image: decoded.value.image,
    relation: decoded.value.relation,
  };
}

function parseRequestView(value: unknown): ContactRequestView | null {
  const decoded = Schema.decodeUnknownExit(ContactRequestViewSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  return {
    id: decoded.value.id,
    status: decoded.value.status,
    createdAt: decoded.value.createdAt,
    other: toPerson(decoded.value.other),
  };
}

function parseRequestList(value: unknown): ContactRequestList | null {
  const decoded = Schema.decodeUnknownExit(
    struct({
      incoming: Schema.mutable(Schema.Array(Schema.Unknown)),
      outgoing: Schema.mutable(Schema.Array(Schema.Unknown)),
    }),
  )(value);
  if (!Exit.isSuccess(decoded)) return null;
  // One malformed row fails the whole list, like the old hand validator.
  const incoming: ContactRequestView[] = [];
  for (const item of decoded.value.incoming) {
    const parsed = parseRequestView(item);
    if (parsed === null) return null;
    incoming.push(parsed);
  }
  const outgoing: ContactRequestView[] = [];
  for (const item of decoded.value.outgoing) {
    const parsed = parseRequestView(item);
    if (parsed === null) return null;
    outgoing.push(parsed);
  }
  return { incoming, outgoing };
}

function parseCreatedRequest(value: unknown): CreatedContactRequest | null {
  const decoded = Schema.decodeUnknownExit(CreatedContactRequestSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  return {
    request: toRequestRow(decoded.value.request),
    ...(decoded.value.incoming === undefined ? {} : { incoming: decoded.value.incoming }),
  };
}

function parseDecidedRequest(value: unknown): { request: ContactRequestRow } | null {
  const decoded = Schema.decodeUnknownExit(DecidedRequestSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  return { request: toRequestRow(decoded.value.request) };
}

function parseBlockResult(value: unknown): { blocked: boolean } | null {
  const decoded = Schema.decodeUnknownExit(BlockResultSchema)(value);
  return Exit.isSuccess(decoded) ? { blocked: decoded.value.blocked } : null;
}

function parseBlockedPerson(value: unknown): BlockedPerson | null {
  const decoded = Schema.decodeUnknownExit(BlockedPersonSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  return {
    userId: decoded.value.userId,
    name: decoded.value.name,
    handle: decoded.value.handle,
    image: decoded.value.image,
    jid: decoded.value.jid,
  };
}

function parseBlockedList(value: unknown): BlockedPerson[] | null {
  const decoded = Schema.decodeUnknownExit(
    struct({ blocked: Schema.mutable(Schema.Array(Schema.Unknown)) }),
  )(value);
  if (!Exit.isSuccess(decoded)) return null;
  // One malformed row fails the whole list, like the old hand validator.
  const parsed: BlockedPerson[] = [];
  for (const item of decoded.value.blocked) {
    const person = parseBlockedPerson(item);
    if (person === null) return null;
    parsed.push(person);
  }
  return parsed;
}

// The internal failures, one per case. They carry no field beyond what the old
// `ContactsApiError` already surfaced; the `Promise` edge maps each back to
// that same error, status, code and message.
class ContactsNetworkError extends Data.TaggedError('ContactsNetworkError') {}
class ContactsRequestError extends Data.TaggedError('ContactsRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class ContactsUnauthorized extends Data.TaggedError('ContactsUnauthorized') {}
class ContactsInvalidResponse extends Data.TaggedError('ContactsInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, ContactsNetworkError | ContactsRequestError> {
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
    catch: () => new ContactsNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new ContactsRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/**
 * The domain part of a bare JID (`ana@zilar.test` -> `zilar.test`).
 * Returns undefined for anything that is not a bare user JID.
 */
export function domainOfJid(jid: string | null | undefined): string | undefined {
  if (typeof jid !== 'string') return undefined;
  const bare = jid.split('/')[0] ?? '';
  const parts = bare.split('@');
  if (parts.length !== 2) return undefined;
  const domain = parts[1] ?? '';
  return domain === '' ? undefined : domain;
}

/**
 * The DM chat id for a contact: the server builds it from the user's id
 * lowercased plus the XMPP domain (`localpartFor` + `jidFor` in
 * `apps/server/src/xmpp/provisioning.ts`). Normal ids are alphanumeric, so
 * lowercasing is the whole mapping; ids that would need the server's hash
 * fallback resolve to a chat that does not exist and the caller falls back
 * to the chats list.
 */
export function contactChatId(userId: string, domain: string): string {
  return `${userId.toLowerCase()}@${domain}`;
}

/** The production `ContactsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createContactsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ContactsApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    ContactsUnauthorized | ContactsNetworkError | ContactsRequestError | ContactsInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new ContactsUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new ContactsInvalidResponse();
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
          ContactsUnauthorized: () =>
            Effect.fail(new ContactsApiError(401, 'unauthorized', 'No session')),
          ContactsNetworkError: () =>
            Effect.fail(new ContactsApiError(0, 'network_error', 'Could not reach the server')),
          ContactsRequestError: (error) =>
            Effect.fail(new ContactsApiError(error.status, error.code, error.message)),
          ContactsInvalidResponse: () =>
            Effect.fail(
              new ContactsApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  return {
    async lookupByHandle(handle) {
      const body = await withToken(
        `/api/users/by-handle/${encodeURIComponent(handle)}`,
        { method: 'GET' },
        parseHandleProfile,
      );
      return body as HandleProfile;
    },
    async sendContactRequest(handle) {
      const body = await withToken(
        '/api/contact-requests',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle }),
        },
        parseCreatedRequest,
      );
      return body as CreatedContactRequest;
    },
    async listContactRequests() {
      const body = await withToken('/api/contact-requests', { method: 'GET' }, parseRequestList);
      return body as ContactRequestList;
    },
    async acceptContactRequest(id) {
      const body = await withToken(
        `/api/contact-requests/${encodeURIComponent(id)}/accept`,
        { method: 'POST' },
        parseDecidedRequest,
      );
      return body as { request: ContactRequestRow };
    },
    async declineContactRequest(id) {
      const body = await withToken(
        `/api/contact-requests/${encodeURIComponent(id)}/decline`,
        { method: 'POST' },
        parseDecidedRequest,
      );
      return body as { request: ContactRequestRow };
    },
    async cancelContactRequest(id) {
      const body = await withToken(
        `/api/contact-requests/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        parseDecidedRequest,
      );
      return body as { request: ContactRequestRow };
    },
    async blockUser(userId) {
      const body = await withToken(
        `/api/blocks/${encodeURIComponent(userId)}`,
        { method: 'PUT' },
        parseBlockResult,
      );
      return body as { blocked: boolean };
    },
    async unblockUser(userId) {
      const body = await withToken(
        `/api/blocks/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
        parseBlockResult,
      );
      return body as { blocked: boolean };
    },
    async listBlockedUsers() {
      const body = await withToken('/api/blocks', { method: 'GET' }, parseBlockedList);
      return body as BlockedPerson[];
    },
  };
}
