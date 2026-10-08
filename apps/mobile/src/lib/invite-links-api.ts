import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';
import { errorFieldsOf } from './api-error-body';
import type { TokenProvider } from './chat-api';

/**
 * Group invite links (T-0136), the mobile twin of the web client
 * (`apps/web/src/lib/api.ts`, "Group invite links" + "Join by link"): create,
 * list and revoke shareable group links for owners/admins, plus the
 * join-by-link preview and join. The wire contract lives in
 * `apps/server/src/invite-links/{routes,service}.ts` (T-0115).
 *
 * The boundary is validated with Effect Schema (T-0506 recipe): the request is
 * an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. Malformed rows fail the decode and throw
 * `invalid_response`. The token is shown once at creation in `url` and never
 * stored — the list carries hints, labels, uses and state, never tokens.
 */

export interface GroupInviteLink {
  id: string;
  label: string | null;
  tokenHint: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface CreatedInviteLink {
  id: string;
  /** The raw token, shown once. Never stored, logged or audited. */
  token: string;
  url: string;
}

export interface CreateGroupInviteLinkInput {
  label?: string;
  expiresInHours?: number;
  maxUses?: number;
}

export interface JoinPreview {
  groupTitle: string;
  memberCount: number;
  alreadyMember: boolean;
  groupId?: string;
  // T-0144: the group's kind, so the join screen reads "Join channel" for a
  // channel. Optional so older servers still parse (treated as a group).
  kind?: 'group' | 'channel';
}

export interface JoinResult {
  groupId: string;
  alreadyMember: boolean;
}

export interface InviteLinksApi {
  createGroupInviteLink(
    groupId: string,
    input?: CreateGroupInviteLinkInput,
  ): Promise<CreatedInviteLink>;
  listGroupInviteLinks(groupId: string): Promise<GroupInviteLink[]>;
  revokeGroupInviteLink(groupId: string, linkId: string): Promise<void>;
  previewJoinLink(token: string): Promise<JoinPreview>;
  joinByLink(token: string): Promise<JoinResult>;
}

export class InviteLinksApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'InviteLinksApiError';
    this.status = status;
    this.code = code;
  }
}

// `label`, `maxUses` and `expiresAt` are nullable but required: an explicit
// `null` decodes to `null`, while a missing key or a wrong type fails the row,
// exactly like the old type guards.
const GroupInviteLinkSchema = struct({
  id: Schema.String,
  label: Schema.NullOr(Schema.String),
  tokenHint: Schema.String,
  uses: Schema.Number,
  maxUses: Schema.NullOr(Schema.Number),
  expiresAt: Schema.NullOr(Schema.String),
  revoked: Schema.Boolean,
  createdAt: Schema.String,
});

const CreatedInviteLinkSchema = struct({
  id: Schema.String,
  token: Schema.String,
  url: Schema.String,
});

// `groupId` and `kind` are optional: absent keys are omitted from the preview,
// but a present key with the wrong type fails it — an older server that omits
// `kind` still parses (treated as a group).
const JoinPreviewSchema = struct({
  groupTitle: Schema.String,
  memberCount: Schema.Number,
  alreadyMember: Schema.Boolean,
  groupId: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(['group', 'channel'])),
});

const JoinResultSchema = struct({
  groupId: Schema.String,
  alreadyMember: Schema.Boolean,
});

const InviteLinkListSchema = struct({
  links: Schema.mutable(Schema.Array(GroupInviteLinkSchema)),
});

function parseCreatedInviteLink(value: unknown): CreatedInviteLink | null {
  const decoded = Schema.decodeUnknownExit(CreatedInviteLinkSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseJoinPreview(value: unknown): JoinPreview | null {
  const decoded = Schema.decodeUnknownExit(JoinPreviewSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseJoinResult(value: unknown): JoinResult | null {
  const decoded = Schema.decodeUnknownExit(JoinResultSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseInviteLinkList(value: unknown): GroupInviteLink[] | null {
  const decoded = Schema.decodeUnknownExit(InviteLinkListSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value.links : null;
}

// revoke answers 204 with no body; any 2xx body is accepted and ignored,
// exactly like the old hand validator.
function parseRevoke(value: unknown): Record<string, never> | null {
  const decoded = Schema.decodeUnknownExit(Schema.Unknown)(value);
  return Exit.isSuccess(decoded) ? {} : null;
}

// The internal failures, one per case. They carry no field beyond what the old
// `InviteLinksApiError` already surfaced; the `Promise` edge maps each back to
// that same error, status, code and message.
class InviteLinksNetworkError extends Data.TaggedError('InviteLinksNetworkError') {}
class InviteLinksRequestError extends Data.TaggedError('InviteLinksRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class InviteLinksUnauthorized extends Data.TaggedError('InviteLinksUnauthorized') {}
class InviteLinksInvalidResponse extends Data.TaggedError('InviteLinksInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, InviteLinksNetworkError | InviteLinksRequestError> {
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
    catch: () => new InviteLinksNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new InviteLinksRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `InviteLinksApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createInviteLinksApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): InviteLinksApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    | InviteLinksUnauthorized
    | InviteLinksNetworkError
    | InviteLinksRequestError
    | InviteLinksInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new InviteLinksUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new InviteLinksInvalidResponse();
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
          InviteLinksUnauthorized: () =>
            Effect.fail(new InviteLinksApiError(401, 'unauthorized', 'No session')),
          InviteLinksNetworkError: () =>
            Effect.fail(new InviteLinksApiError(0, 'network_error', 'Could not reach the server')),
          InviteLinksRequestError: (error) =>
            Effect.fail(new InviteLinksApiError(error.status, error.code, error.message)),
          InviteLinksInvalidResponse: () =>
            Effect.fail(
              new InviteLinksApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  return {
    async createGroupInviteLink(groupId, input = {}) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/invite-links`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        parseCreatedInviteLink,
      );
      return body as CreatedInviteLink;
    },
    async listGroupInviteLinks(groupId) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/invite-links`,
        { method: 'GET' },
        parseInviteLinkList,
      );
      return body as GroupInviteLink[];
    },
    async revokeGroupInviteLink(groupId, linkId) {
      await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/invite-links/${encodeURIComponent(linkId)}`,
        { method: 'DELETE' },
        parseRevoke,
      );
    },
    async previewJoinLink(token) {
      const body = await withToken(
        `/api/join/${encodeURIComponent(token)}`,
        { method: 'GET' },
        parseJoinPreview,
      );
      return body as JoinPreview;
    },
    async joinByLink(token) {
      const body = await withToken(
        `/api/join/${encodeURIComponent(token)}`,
        { method: 'POST' },
        parseJoinResult,
      );
      return body as JoinResult;
    },
  };
}

/**
 * Extracts the join token from a link the user pastes or opens. Accepts the
 * custom scheme (`zilar://join/<token>`), the web URL shape
 * (`https://host/j/<token>`), and a bare 64-hex token. Returns undefined for
 * anything else, so random clipboard text never reaches the server.
 */
export function extractJoinToken(raw: string): string | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  if (/^[0-9a-f]{64}$/i.test(text)) {
    return text.toLowerCase();
  }
  let parsed: URL | undefined;
  try {
    parsed = new URL(text);
  } catch {
    return undefined;
  }
  if (parsed.protocol === 'zilar:' && parsed.hostname.toLowerCase() === 'join') {
    const token = parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
    return /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : undefined;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
    // The web URL shape (`/j/<token>`, T-0115) and the mobile deep-link path
    // (`/join/<token>`): both carry a bare 64-hex token.
    if (
      segments.length === 2 &&
      (segments[0]?.toLowerCase() === 'j' || segments[0]?.toLowerCase() === 'join')
    ) {
      const token = segments[1] ?? '';
      return /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : undefined;
    }
  }
  return undefined;
}

const INVITE_LINK_FAILURE_MESSAGE = 'This link does not work';
const INVITE_LINK_RETRY_MESSAGE = 'Too many attempts. Try again later.';
/**
 * The neutral join failure text (T-0115): invalid, expired, revoked and full
 * links all read the same, so failures never reveal why; rate-limit answers
 * get a friendly retry text. The token must never appear in error text, so
 * callers must pass only the error code/status, never the token.
 */
export function joinFailureMessage(error: { status: number; code: string }): string {
  if (error.status === 429 || error.code === 'rate_limited') {
    return INVITE_LINK_RETRY_MESSAGE;
  }
  return INVITE_LINK_FAILURE_MESSAGE;
}

export type GroupChatTarget =
  { kind: 'chat'; chatId: string } | { kind: 'group'; groupId: string } | { kind: 'list' };

/**
 * Resolves where a joined group opens: its General topic chat, else any of
 * its rows' group screen, else the chats list. Pure and UI-free (lives here
 * rather than the join view so store tests can import it without pulling in
 * `react-native`), so the route — which reads the chats fresh at call time —
 * and tests share it.
 */
export function resolveGroupChat(
  chats: { id: string; groupId?: string; topic?: { isGeneral?: boolean } }[],
  groupId: string,
): GroupChatTarget {
  const general = chats.find((chat) => chat.groupId === groupId && chat.topic?.isGeneral === true);
  if (general !== undefined) {
    return { kind: 'chat', chatId: general.id };
  }
  if (chats.some((chat) => chat.groupId === groupId)) {
    return { kind: 'group', groupId };
  }
  return { kind: 'list' };
}
