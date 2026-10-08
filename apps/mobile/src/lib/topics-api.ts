import { Data, Effect, Exit, Schema, SchemaGetter, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';
import type { TopicKind, TopicOwner, TopicStatus, TopicVisibility } from '@zilar/chat-core';

import { errorFieldsOf } from './api-error-body';

/**
 * The mobile twin of the web topics client (`apps/web/src/lib/api.ts`): list,
 * create and patch topics, read members, plus the group's
 * `membersCanCreateTopics` switch. The wire contract lives in
 * `apps/server/src/topics/{routes,service,access}` (T-0108/T-0109/T-0110).
 *
 * The boundary is validated with Effect Schema (T-0551, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge
 * with `Effect.runPromise`. Unknown enum values fall back safely (a
 * mid-rollout server can send a kind the bundle does not know), and
 * malformed rows are dropped, never rendered.
 */

export type { TopicKind, TopicStatus, TopicVisibility, TopicOwner };

export interface TopicAi {
  id: string;
  name: string;
}

export interface Topic {
  id: string;
  groupId: string;
  name: string;
  glyph: string;
  chatJid: string;
  visibility: TopicVisibility;
  kind: TopicKind;
  status: TopicStatus;
  owner: TopicOwner | null;
  linkUrl: string | null;
  linkLabel: string | null;
  isGeneral: boolean;
  archived: boolean;
  memberCount: number;
  ais: TopicAi[];
  // T-0116: roles with access and the approver role. Absent on payloads from
  // an older server (treated as none); never stale, the store replaces them
  // on every topic refresh (going public clears them server-side too).
  roles: TopicRole[];
  approverRole: ApproverRole | null;
}

export interface TopicMember {
  userId: string;
  name: string;
}

/** A custom group role attached to a topic, with its holder count (T-0116). */
export interface TopicRole {
  id: string;
  name: string;
  memberCount: number;
}

/** The role whose holders may decide approval cards in this topic (T-0116). */
export interface ApproverRole {
  id: string;
  name: string;
}

export interface CreateTopicInput {
  name: string;
  kind?: TopicKind;
  visibility?: TopicVisibility;
  memberIds?: string[];
  glyph?: string;
  owner?: { kind: 'user' | 'ai'; id: string } | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
}

export interface PatchTopicInput {
  name?: string;
  glyph?: string;
  kind?: TopicKind;
  status?: TopicStatus;
  owner?: { kind: 'user' | 'ai'; id: string } | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
  archived?: true;
  visibility?: TopicVisibility;
  memberIds?: string[];
  confirmExposeHistory?: boolean;
}

/** Replaces a private topic's roles and picks its approver role (T-0116). */
export interface SetTopicRolesInput {
  roleIds: string[];
  approverRoleId: string | null;
}

export interface TopicsApi {
  createTopic(groupId: string, input: CreateTopicInput): Promise<Topic>;
  getTopic(id: string): Promise<Topic>;
  patchTopic(id: string, input: PatchTopicInput): Promise<Topic>;
  archiveTopic(id: string): Promise<Topic>;
  listTopicMembers(id: string): Promise<TopicMember[]>;
  addTopicMember(id: string, userId: string): Promise<Topic>;
  removeTopicMember(id: string, userId: string): Promise<Topic>;
  listTopicAis(id: string): Promise<TopicAi[]>;
  addTopicAi(id: string, aiId: string): Promise<Topic>;
  removeTopicAi(id: string, aiId: string): Promise<Topic>;
  setTopicRoles(id: string, input: SetTopicRolesInput): Promise<Topic>;
  setMembersCanCreateTopics(groupId: string, allowed: boolean): Promise<boolean>;
}

export class TopicsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'TopicsApiError';
    this.status = status;
    this.code = code;
  }
}

/** Unknown kinds fall back to `chat`, so a newer server never breaks the list. */
export function parseTopicKind(value: unknown): TopicKind {
  if (
    value === 'chat' ||
    value === 'task' ||
    value === 'bug' ||
    value === 'ui' ||
    value === 'routine'
  ) {
    return value;
  }
  return 'chat';
}

/** Unknown statuses fall back to `open`, always with their text (never color alone). */
export function parseTopicStatus(value: unknown): TopicStatus {
  if (
    value === 'open' ||
    value === 'in_progress' ||
    value === 'in_review' ||
    value === 'blocked' ||
    value === 'done'
  ) {
    return value;
  }
  return 'open';
}

/** Unknown visibilities are treated as private: hiding is safer than leaking. */
export function parseTopicVisibility(value: unknown): TopicVisibility {
  if (value === 'public' || value === 'private') {
    return value;
  }
  return 'private';
}

const TopicKindSchema = Schema.Literals(['chat', 'task', 'bug', 'ui', 'routine']);
const TopicStatusSchema = Schema.Literals(['open', 'in_progress', 'in_review', 'blocked', 'done']);
const TopicVisibilitySchema = Schema.Literals(['public', 'private']);

// Lenient enum fields: any unknown value (or an absent key on an older
// payload) decodes to the same default the hand validator used, instead of
// failing the row. This is the T-0506 recipe for a server value the client
// must tolerate.
const LenientTopicKindSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed('chat')),
  Schema.decodeTo(TopicKindSchema, {
    decode: SchemaGetter.transform((value) => parseTopicKind(value)),
    encode: SchemaGetter.transform((kind) => kind),
  }),
);

const LenientTopicStatusSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed('open')),
  Schema.decodeTo(TopicStatusSchema, {
    decode: SchemaGetter.transform((value) => parseTopicStatus(value)),
    encode: SchemaGetter.transform((status) => status),
  }),
);

const LenientTopicVisibilitySchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed('private')),
  Schema.decodeTo(TopicVisibilitySchema, {
    decode: SchemaGetter.transform((value) => parseTopicVisibility(value)),
    encode: SchemaGetter.transform((visibility) => visibility),
  }),
);

const TopicOwnerSchema = struct({
  kind: Schema.Literals(['user', 'ai']),
  id: Schema.String,
  name: Schema.String,
});

const TopicAiSchema = struct({
  id: Schema.String,
  name: Schema.String,
});

const TopicRoleSchema = struct({
  id: Schema.String,
  name: Schema.String,
  memberCount: Schema.Number,
});

const ApproverRoleSchema = struct({
  id: Schema.String,
  name: Schema.String,
});

const TopicSchema = struct({
  id: Schema.String,
  groupId: Schema.String,
  name: Schema.String,
  glyph: Schema.String,
  chatJid: Schema.String,
  visibility: LenientTopicVisibilitySchema,
  kind: LenientTopicKindSchema,
  status: LenientTopicStatusSchema,
  owner: Schema.NullOr(TopicOwnerSchema),
  linkUrl: Schema.NullOr(Schema.String),
  linkLabel: Schema.NullOr(Schema.String),
  isGeneral: Schema.Boolean,
  archived: Schema.Boolean,
  memberCount: Schema.Number,
  ais: Schema.mutable(Schema.Array(TopicAiSchema)),
  // T-0116: absent on payloads from an older server (treated as none); a
  // malformed entry fails the row, like the hand validator.
  roles: Schema.optional(Schema.mutable(Schema.Array(TopicRoleSchema))),
  approverRole: Schema.optional(Schema.NullOr(ApproverRoleSchema)),
});

const TopicMemberSchema = struct({
  userId: Schema.String,
  name: Schema.String,
});

const TopicMembersSchema = struct({
  members: Schema.mutable(Schema.Array(TopicMemberSchema)),
});

const TopicAisSchema = struct({
  ais: Schema.mutable(Schema.Array(TopicAiSchema)),
});

// The group's `membersCanCreateTopics` switch (T-0108). Optional on the wire
// so older servers still parse; treated as off. Any non-boolean value
// decodes to `false` instead of failing, like the hand validator.
const LenientSwitchSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(false)),
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === true),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const MembersCanCreateTopicsSchema = struct({
  membersCanCreateTopics: LenientSwitchSchema,
});

/** A topic row the viewer may see: malformed rows return null and are dropped. */
export function parseTopic(value: unknown): Topic | null {
  const decoded = Schema.decodeUnknownExit(TopicSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  return {
    ...decoded.value,
    roles: decoded.value.roles ?? [],
    approverRole: decoded.value.approverRole ?? null,
  };
}

function parseTopicMemberList(value: unknown): TopicMember[] | null {
  const decoded = Schema.decodeUnknownExit(TopicMembersSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value.members : null;
}

function parseTopicAiList(value: unknown): TopicAi[] | null {
  const decoded = Schema.decodeUnknownExit(TopicAisSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value.ais : null;
}

function parseMembersCanCreateTopics(value: unknown): boolean | null {
  const decoded = Schema.decodeUnknownExit(MembersCanCreateTopicsSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value.membersCanCreateTopics : null;
}

/**
 * The topics of one `/api/chats` group entry: entries that parse as topics
 * are kept (malformed ones dropped); an older server omits `topics` entirely,
 * so the result is empty for it and the group keeps its single legacy row.
 */
export function chatEntryTopics(entry: unknown): Topic[] {
  const decoded = Schema.decodeUnknownExit(
    struct({ topics: Schema.optional(Schema.Array(Schema.Unknown)) }),
  )(entry);
  if (!Exit.isSuccess(decoded) || decoded.value.topics === undefined) {
    return [];
  }
  const topics: Topic[] = [];
  for (const raw of decoded.value.topics) {
    const topic = parseTopic(raw);
    if (topic !== null) {
      topics.push(topic);
    }
  }
  return topics;
}

// The internal failures, one per case. They carry no field beyond what the old
// `TopicsApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class TopicsNetworkError extends Data.TaggedError('TopicsNetworkError') {}
class TopicsRequestError extends Data.TaggedError('TopicsRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class TopicsUnauthorized extends Data.TaggedError('TopicsUnauthorized') {}
class TopicsInvalidResponse extends Data.TaggedError('TopicsInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, TopicsNetworkError | TopicsRequestError> {
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
    catch: () => new TopicsNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new TopicsRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `TopicsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createTopicsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): TopicsApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    TopicsUnauthorized | TopicsNetworkError | TopicsRequestError | TopicsInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new TopicsUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new TopicsInvalidResponse();
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
          TopicsUnauthorized: () =>
            Effect.fail(new TopicsApiError(401, 'unauthorized', 'No session')),
          TopicsNetworkError: () =>
            Effect.fail(new TopicsApiError(0, 'network_error', 'Could not reach the server')),
          TopicsRequestError: (error) =>
            Effect.fail(new TopicsApiError(error.status, error.code, error.message)),
          TopicsInvalidResponse: () =>
            Effect.fail(
              new TopicsApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

  const json = (
    input:
      | CreateTopicInput
      | PatchTopicInput
      | SetTopicRolesInput
      | { userId: string }
      | { aiId: string },
  ): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  return {
    async createTopic(groupId, input) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/topics`,
        json(input),
        parseTopic,
      );
      return body as Topic;
    },
    async getTopic(id) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}`,
        { method: 'GET' },
        parseTopic,
      );
      return body as Topic;
    },
    async patchTopic(id, input) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}`,
        { ...json(input), method: 'PATCH' },
        parseTopic,
      );
      return body as Topic;
    },
    async archiveTopic(id) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/archive`,
        { method: 'POST' },
        parseTopic,
      );
      return body as Topic;
    },
    async listTopicMembers(id) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/members`,
        { method: 'GET' },
        parseTopicMemberList,
      );
      return body as TopicMember[];
    },
    async addTopicMember(id, userId) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/members`,
        json({ userId }),
        parseTopic,
      );
      return body as Topic;
    },
    async removeTopicMember(id, userId) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
        parseTopic,
      );
      return body as Topic;
    },
    async listTopicAis(id) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/ais`,
        { method: 'GET' },
        parseTopicAiList,
      );
      return body as TopicAi[];
    },
    async addTopicAi(id, aiId) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/ais`,
        json({ aiId }),
        parseTopic,
      );
      return body as Topic;
    },
    async removeTopicAi(id, aiId) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/ais/${encodeURIComponent(aiId)}`,
        { method: 'DELETE' },
        parseTopic,
      );
      return body as Topic;
    },
    async setTopicRoles(id, input) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/roles`,
        { ...json(input), method: 'PUT' },
        parseTopic,
      );
      return body as Topic;
    },
    // The group's `membersCanCreateTopics` switch (T-0108). Optional on the
    // wire so older servers still parse; treated as off.
    async setMembersCanCreateTopics(groupId, allowed) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ membersCanCreateTopics: allowed }),
        },
        parseMembersCanCreateTopics,
      );
      return body as boolean;
    },
  };
}

/** The first glyph letter, uppercased, for a new topic the user just named. */
export function glyphForTopicName(name: string): string {
  const first = [...name.trim()][0] ?? 'G';
  return first.toUpperCase();
}
