import { Effect, Exit, Schema, SchemaGetter } from 'effect';
import { struct } from '@zilar/protocol';
import { ChatLastMessage, GroupBackground } from '@zilar/api-contract';

import type { ChatEntry, GroupAi, GroupDetail, GroupMember, Me, XmppToken } from './chat-api';
import { parseTopic } from './topics-api';

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

const GroupRoleSchema = Schema.Literals(['owner', 'admin', 'member']);

const DmEntrySchema = struct({
  kind: Schema.Literals(['dm']),
  chatJid: Schema.String,
  title: Schema.String,
  // Absent on the caller's own AI DMs (the same as the shared contract and the
  // real server), so it must stay optional or an owned AI fails the whole list.
  userId: Schema.optional(Schema.String),
  avatarUrl: LenientOptionalStringSchema,
  // Set on the caller's AIs; absent or false for human contacts (as web).
  isAi: Schema.optional(Schema.Boolean),
  // T-1214: the server's unread count and preview (T-1198). Absent on older
  // servers (still parses); they ride the entry so `summariesFor` maps them
  // onto the row.
  unread: Schema.optional(Schema.Number),
  lastMessage: Schema.optional(ChatLastMessage),
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
  // T-0924: the fields web already carried onto its rows. Absent on older
  // servers (still parses); a malformed one rejects the entry rather than
  // rendering half of it, like the channel fields above.
  visibility: Schema.optional(Schema.Literals(['private', 'public'])),
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.String),
  background: Schema.optional(GroupBackground),
  // T-0139: the server's `topics` on the entry. Absent on older servers
  // (still parses, as before); a non-array rejects the entry, while
  // malformed rows inside a valid array are dropped by `parseTopic`.
  topics: Schema.optional(Schema.Array(Schema.Unknown)),
  // T-1214: the entry-level unread count and preview (T-1198, the General
  // row's fields). Absent on older servers (still parses); they ride the
  // entry so `summariesFor` maps them onto the General row.
  unread: Schema.optional(Schema.Number),
  lastMessage: Schema.optional(ChatLastMessage),
  // T-1318: the group's creation/join time, so the list sorts a just-created
  // group with no messages first. Absent on older servers (still parses).
  createdAt: Schema.optional(Schema.String),
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

export function parseMe(value: unknown): Me | null {
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
  // wire; malformed rows are dropped, never rendered). T-1214: the raw
  // objects are kept, not the decoded `Topic`s, so each topic's `unread`
  // and `lastMessage` still read — that is what `chatEntryTopics`
  // (`@zilar/client-core/store`, `chat-rows.ts:138`) expects: it decodes
  // each raw object with `Topic` itself, while `summariesFor` reads the
  // two fields off the same raw objects.
  let topics: unknown[] | undefined;
  if (raw.topics !== undefined) {
    topics = [];
    for (const entry of raw.topics) {
      if (parseTopic(entry) !== null) {
        topics.push(entry);
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
    // T-0924: carry the four fields web already kept, so both apps' rows
    // match. Absent on older servers, so they stay absent here.
    ...(raw.visibility === undefined ? {} : { visibility: raw.visibility }),
    ...(raw.handle === undefined ? {} : { handle: raw.handle }),
    ...(raw.avatarUrl === undefined ? {} : { avatarUrl: raw.avatarUrl }),
    ...(raw.background === undefined ? {} : { background: raw.background }),
    // T-1214: carry the entry-level unread count and preview, so
    // `summariesFor` maps them onto the General row. Absent on older
    // servers, so they stay absent here.
    ...(raw.unread === undefined ? {} : { unread: raw.unread }),
    ...(raw.lastMessage === undefined ? {} : { lastMessage: raw.lastMessage }),
    // T-1318: carry the creation time so an empty group sorts first.
    ...(raw.createdAt === undefined ? {} : { createdAt: raw.createdAt }),
  };
}

export function parseGroupDetail(value: unknown): GroupDetail | null {
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

export function parseChatsList(value: unknown): ChatEntry[] | null {
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

export function parseXmppToken(value: unknown): XmppToken | null {
  const decoded = Schema.decodeUnknownExit(XmppTokenSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}
