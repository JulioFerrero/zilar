import { Data, Effect, Exit, Schema, SchemaGetter, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';
import type { Me } from './auth-api';
import { errorFieldsOf } from './api-error-body';
import { parseTopic, type Topic } from './topics-api';

export type { Me };

/**
 * The server APIs the real chat store needs, validated at the boundary with
 * Effect Schema (T-0551, the T-0506 recipe). The session token comes from a
 * `TokenProvider` so tests can inject a fake. The request is an Effect
 * pipeline, cut back to a `Promise` at the edge with `Effect.runPromise`.
 */

export interface Contact {
  userId: string;
  name: string;
  jid: string;
  avatarUrl?: string;
}

export type ChatEntry =
  | {
      kind: 'dm';
      chatJid: string;
      title: string;
      userId: string;
      avatarUrl?: string;
      // Set on the caller's AIs; absent on older servers (treated as human).
      isAi?: boolean;
    }
  | {
      kind: 'group';
      chatJid: string;
      title: string;
      groupId: string;
      memberCount: number;
      role: GroupRole;
      // T-0144: `group` behaves as before; `channel` is the broadcast feed
      // (its General topic is the feed). Optional so older servers still
      // parse; the store maps the feed row from the General topic with the
      // channel fields (chatKind, subscriberCount, description, myRole).
      chatKind?: 'group' | 'channel';
      // T-0144: the same count under the usual channel name, for channels only.
      subscriberCount?: number;
      // T-0144: the channel's short blurb. Optional so older payloads parse.
      description?: string | null;
      // T-0108: a group entry may carry its visible `topics` (archived
      // excluded). Optional so older servers still parse; the store maps such
      // a group to one row per topic (General keeps the old chat id).
      // Validated `Topic` rows (T-0139), malformed wire rows dropped.
      topics?: Topic[];
    };

export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupMember {
  userId: string;
  name: string;
  role: GroupRole;
  // T-0227: the member's `@handle` while set (null on the wire when unset).
  // Optional so payloads from an older server still parse.
  handle?: string;
  // T-0116: the custom group roles this member holds, shown as chips. Absent
  // on payloads from an older server (treated as none).
  roles: { id: string; name: string }[];
}

/** The group detail the new-topic sheet reads (people + roles + AIs). */
export interface GroupDetail {
  id: string;
  title: string;
  createdBy: string;
  membersCanCreateTopics?: boolean;
  // T-0144: `channel` is the broadcast feed (its General topic is the feed).
  // Optional so older servers still parse (treated as a group).
  kind?: 'group' | 'channel';
  // T-0144: the channel's short blurb. Optional so older payloads parse.
  description?: string | null;
  members: GroupMember[];
  ais: GroupAi[];
}

/** One AI in the group, so the sheet can offer the viewer's own unticked. */
export interface GroupAi {
  aiId: string;
  jid: string;
  name: string;
  ownerId: string;
}

export interface XmppToken {
  jid: string;
  token: string;
  expiresAt: string;
  service: string;
  domain: string;
  mucDomain: string;
}

/** Reads the bearer session token from secure storage. */
export type TokenProvider = () => Promise<string | undefined>;

export interface ChatApi {
  getMe(): Promise<Me>;
  getChats(): Promise<ChatEntry[]>;
  getContacts(): Promise<Contact[]>;
  getGroup(groupId: string): Promise<GroupDetail>;
  getXmppToken(): Promise<XmppToken>;
}

export class ChatApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
    this.code = code;
  }
}

// A lenient nullable string: a missing or non-string value decodes to `null`
// instead of failing the row (the viewer's own JID on `Me`, absent on older
// payloads), exactly like the old type guard.
const LenientNullStringSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
  Schema.decodeTo(Schema.NullOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

// A lenient optional string: a missing or non-string value decodes to
// `undefined` (absent) instead of failing the row (contact and DM avatar
// urls), exactly like the old `optionalString` guard.
const LenientOptionalStringSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(undefined)),
  Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : undefined)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const MeSchema = struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  jid: LenientNullStringSchema,
});

const ContactSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  jid: Schema.String,
  avatarUrl: LenientOptionalStringSchema,
});

const GroupRoleSchema = Schema.Literals(['owner', 'admin', 'member']);

const DmEntrySchema = struct({
  kind: Schema.Literals(['dm']),
  chatJid: Schema.String,
  title: Schema.String,
  userId: Schema.String,
  avatarUrl: LenientOptionalStringSchema,
  // Set on the caller's AIs; absent or false for human contacts (as web).
  isAi: Schema.optional(Schema.Boolean),
});

const GroupEntryRawSchema = struct({
  kind: Schema.Literals(['group']),
  chatJid: Schema.String,
  title: Schema.String,
  groupId: Schema.String,
  memberCount: Schema.Number,
  role: GroupRoleSchema,
  // T-0144: absent on older servers (still parses, as before); a malformed
  // channel field rejects the entry rather than rendering half of it.
  chatKind: Schema.optional(Schema.Literals(['group', 'channel'])),
  subscriberCount: Schema.optional(Schema.Number),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0139: the server's `topics` on the entry. Absent on older servers
  // (still parses, as before); a non-array rejects the entry, while
  // malformed rows inside a valid array are dropped by `parseTopic`.
  topics: Schema.optional(Schema.Array(Schema.Unknown)),
});

const RoleChipSchema = struct({
  id: Schema.String,
  name: Schema.String,
});

const GroupMemberRawSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  role: GroupRoleSchema,
  // T-0227: null or absent on older servers (no handle); an empty handle
  // reads as absent too, like the hand validator. A non-string handle
  // rejects the detail rather than rendering half of it.
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0116: absent on older servers (treated as none); a malformed entry
  // rejects the detail rather than rendering half of it.
  roles: Schema.optional(Schema.mutable(Schema.Array(RoleChipSchema))),
});

// T-0108: the plain-members-may-create switch. Optional so older servers
// still parse (treated as off); anything but an explicit boolean reads as
// absent, like the hand validator.
const LenientSwitchSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(undefined)),
  Schema.decodeTo(Schema.UndefinedOr(Schema.Boolean), {
    decode: SchemaGetter.transform((value) =>
      value === true ? true : value === false ? false : undefined,
    ),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const GroupAiSchema = struct({
  aiId: Schema.String,
  jid: Schema.String,
  name: Schema.String,
  ownerId: Schema.String,
});

const GroupDetailRawSchema = struct({
  id: Schema.String,
  title: Schema.String,
  createdBy: Schema.String,
  members: Schema.mutable(Schema.Array(GroupMemberRawSchema)),
  membersCanCreateTopics: LenientSwitchSchema,
  // T-0144: absent on older servers (treated as a group); malformed channel
  // fields reject the detail rather than rendering half of it.
  kind: Schema.optional(Schema.Literals(['group', 'channel'])),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  // The group AIs ride along when present; ignored when absent or not an
  // array. A malformed entry inside a valid array rejects the detail.
  ais: Schema.Unknown.pipe(
    Schema.withDecodingDefault(Effect.succeed(undefined)),
    Schema.decodeTo(Schema.UndefinedOr(Schema.Array(Schema.Unknown)), {
      decode: SchemaGetter.transform((value) =>
        Array.isArray(value) ? (value as ReadonlyArray<unknown>) : undefined,
      ),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
});

const XmppTokenSchema = struct({
  jid: Schema.String,
  token: Schema.String,
  expiresAt: Schema.String,
  service: Schema.String,
  domain: Schema.String,
  mucDomain: Schema.String,
});

const ChatsListSchema = struct({
  chats: Schema.mutable(Schema.Array(Schema.Unknown)),
});

const ContactsListSchema = Schema.mutable(Schema.Array(ContactSchema));

function parseMe(value: unknown): Me | null {
  const decoded = Schema.decodeUnknownExit(MeSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseChatEntry(value: unknown): ChatEntry | null {
  const dm = Schema.decodeUnknownExit(DmEntrySchema)(value);
  if (Exit.isSuccess(dm)) {
    const { avatarUrl, ...rest } = dm.value;
    return avatarUrl === undefined ? rest : { ...rest, avatarUrl };
  }
  const group = Schema.decodeUnknownExit(GroupEntryRawSchema)(value);
  if (!Exit.isSuccess(group)) return null;
  const raw = group.value;
  // T-0139: keep the server's `topics` on the entry (validated with
  // `parseTopic`, the same shape the topics API uses — never trust the
  // wire; malformed rows are dropped, never rendered).
  let topics: Topic[] | undefined;
  if (raw.topics !== undefined) {
    topics = [];
    for (const entry of raw.topics) {
      const topic = parseTopic(entry);
      if (topic !== null) {
        topics.push(topic);
      }
    }
  }
  return {
    kind: 'group',
    chatJid: raw.chatJid,
    title: raw.title,
    groupId: raw.groupId,
    memberCount: raw.memberCount,
    role: raw.role,
    ...(topics === undefined ? {} : { topics }),
    ...(raw.chatKind === undefined ? {} : { chatKind: raw.chatKind }),
    ...(raw.subscriberCount === undefined ? {} : { subscriberCount: raw.subscriberCount }),
    ...(raw.description === undefined ? {} : { description: raw.description }),
  };
}

function parseGroupDetail(value: unknown): GroupDetail | null {
  const decoded = Schema.decodeUnknownExit(GroupDetailRawSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  const raw = decoded.value;
  const members: GroupMember[] = [];
  for (const member of raw.members) {
    const handle =
      member.handle === undefined || member.handle === null || member.handle === ''
        ? undefined
        : member.handle;
    members.push({
      userId: member.userId,
      name: member.name,
      role: member.role,
      roles: member.roles ?? [],
      ...(handle === undefined ? {} : { handle }),
    });
  }
  const ais: GroupAi[] = [];
  if (Array.isArray(raw.ais)) {
    for (const entry of raw.ais) {
      const ai = Schema.decodeUnknownExit(GroupAiSchema)(entry);
      if (!Exit.isSuccess(ai)) return null;
      ais.push(ai.value);
    }
  }
  return {
    id: raw.id,
    title: raw.title,
    createdBy: raw.createdBy,
    members,
    ais,
    ...(raw.membersCanCreateTopics === undefined
      ? {}
      : { membersCanCreateTopics: raw.membersCanCreateTopics }),
    ...(raw.kind === undefined ? {} : { kind: raw.kind }),
    ...(raw.description === undefined ? {} : { description: raw.description }),
  };
}

function parseChatsList(value: unknown): ChatEntry[] | null {
  const decoded = Schema.decodeUnknownExit(ChatsListSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  const chats: ChatEntry[] = [];
  for (const entry of decoded.value.chats) {
    const parsed = parseChatEntry(entry);
    if (parsed === null) return null;
    chats.push(parsed);
  }
  return chats;
}

function parseContactsList(value: unknown): Contact[] | null {
  const decoded = Schema.decodeUnknownExit(ContactsListSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  return decoded.value.map((contact) => {
    const { avatarUrl, ...rest } = contact;
    return avatarUrl === undefined ? rest : { ...rest, avatarUrl };
  });
}

function parseXmppToken(value: unknown): XmppToken | null {
  const decoded = Schema.decodeUnknownExit(XmppTokenSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

// The internal failures, one per case. They carry no field beyond what the old
// `ChatApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class ChatNetworkError extends Data.TaggedError('ChatNetworkError') {}
class ChatRequestError extends Data.TaggedError('ChatRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class ChatUnauthorized extends Data.TaggedError('ChatUnauthorized') {}
class ChatInvalidResponse extends Data.TaggedError('ChatInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, ChatNetworkError | ChatRequestError> {
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
    catch: () => new ChatNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new ChatRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `ChatApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createChatApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    ChatUnauthorized | ChatNetworkError | ChatRequestError | ChatInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new ChatUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new ChatInvalidResponse();
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
          ChatUnauthorized: () => Effect.fail(new ChatApiError(401, 'unauthorized', 'No session')),
          ChatNetworkError: () =>
            Effect.fail(new ChatApiError(0, 'network_error', 'Could not reach the server')),
          ChatRequestError: (error) =>
            Effect.fail(new ChatApiError(error.status, error.code, error.message)),
          ChatInvalidResponse: () =>
            Effect.fail(
              new ChatApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

  return {
    async getMe() {
      return (await withToken('/api/me', { method: 'GET' }, parseMe)) as Me;
    },
    async getChats() {
      const body = await withToken('/api/chats', { method: 'GET' }, parseChatsList);
      return body as ChatEntry[];
    },
    async getContacts() {
      const body = await withToken('/api/contacts', { method: 'GET' }, parseContactsList);
      return body as Contact[];
    },
    async getGroup(groupId) {
      return (await withToken(
        `/api/groups/${encodeURIComponent(groupId)}`,
        { method: 'GET' },
        parseGroupDetail,
      )) as GroupDetail;
    },
    async getXmppToken() {
      return (await withToken('/api/xmpp/token', { method: 'POST' }, parseXmppToken)) as XmppToken;
    },
  };
}
