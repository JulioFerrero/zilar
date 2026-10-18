import { Effect, Exit, Schema, SchemaGetter } from 'effect';
import { struct } from '@zilar/protocol';
import { ChatLastMessage, GroupBackground, GroupListener } from '@zilar/api-contract';

import type { ChatEntry, GroupAi, GroupDetail, GroupMember, Me, XmppToken } from './chat-api';
import { parseTopic } from './topics-api';

// Lenient nullable string: a missing or non-string value decodes to `null` instead of failing the row.
const LenientNullStringSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
  Schema.decodeTo(Schema.NullOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

// Lenient optional string: a missing or non-string value decodes to `undefined` instead of failing the row.
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
  // Absent on the caller's own AI DMs, so it must stay optional or an owned AI fails the whole list.
  userId: Schema.optional(Schema.String),
  avatarUrl: LenientOptionalStringSchema,
  isAi: Schema.optional(Schema.Boolean),
  // Absent on older servers; they ride the entry so `summariesFor` maps them onto the row.
  unread: Schema.optional(Schema.Number),
  lastMessage: Schema.optional(ChatLastMessage),
  // Without the marks the shared mapper finds none on a DM row, so ticks reset on every cold start. Absent on older servers.
  deliveredUntil: Schema.optional(Schema.String),
  readUntil: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
});

const GroupEntryRawSchema = struct({
  kind: Schema.Literals(['group']),
  chatJid: Schema.String,
  title: Schema.String,
  groupId: Schema.String,
  memberCount: Schema.Number,
  role: GroupRoleSchema,
  // Absent on older servers; a malformed channel field rejects the entry rather than rendering half of it.
  chatKind: Schema.optional(Schema.Literals(['group', 'channel'])),
  subscriberCount: Schema.optional(Schema.Number),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  // Absent on older servers; a malformed one rejects the entry rather than rendering half of it.
  visibility: Schema.optional(Schema.Literals(['private', 'public'])),
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.String),
  background: Schema.optional(GroupBackground),
  // Absent on older servers; a non-array rejects the entry, while malformed rows inside are dropped by `parseTopic`.
  topics: Schema.optional(Schema.Array(Schema.Unknown)),
  // Absent on older servers; they ride the entry so `summariesFor` maps them onto the General row.
  unread: Schema.optional(Schema.Number),
  lastMessage: Schema.optional(ChatLastMessage),
  // Absent on older servers; it lets the list sort a just-created group with no messages first.
  createdAt: Schema.optional(Schema.String),
  // A group carries only this mark (no `readUntil`), so its delivered tick survives a cold start. Absent on older servers.
  deliveredUntil: Schema.optional(Schema.String),
});

const RoleChipSchema = struct({
  id: Schema.String,
  name: Schema.String,
});

const GroupMemberRawSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  role: GroupRoleSchema,
  // No handle is `null` or absent; an empty handle reads as absent too, and a non-string rejects the detail.
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  // Absent on older servers (treated as none); a malformed entry rejects the detail.
  roles: Schema.optional(Schema.mutable(Schema.Array(RoleChipSchema))),
});

// Absent means off; anything but an explicit boolean reads as absent.
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
  // Absent on older servers; the picture is a relative `/api/avatars/<id>` path.
  avatarUrl: Schema.optional(Schema.String),
  // A malformed `listener` must drop only the listener, not the whole detail; it is decoded separately below.
  listener: Schema.Unknown.pipe(Schema.withDecodingDefault(Effect.succeed(undefined))),
  // Absent on older servers (treated as a group); malformed channel fields reject the detail.
  kind: Schema.optional(Schema.Literals(['group', 'channel'])),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  // Ignored when absent or not an array; a malformed entry inside a valid array rejects the detail.
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
  // The raw objects are kept, not the decoded `Topic`s: `chatEntryTopics` decodes each one itself, while `summariesFor` reads `unread` and `lastMessage` off the same objects. Never trust the wire — `parseTopic` drops malformed rows.
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
    // Absent on older servers, so they stay absent here.
    ...(raw.visibility === undefined ? {} : { visibility: raw.visibility }),
    ...(raw.handle === undefined ? {} : { handle: raw.handle }),
    ...(raw.avatarUrl === undefined ? {} : { avatarUrl: raw.avatarUrl }),
    ...(raw.background === undefined ? {} : { background: raw.background }),
    // `summariesFor` maps them onto the General row; absent stays absent.
    ...(raw.unread === undefined ? {} : { unread: raw.unread }),
    ...(raw.lastMessage === undefined ? {} : { lastMessage: raw.lastMessage }),
    // Carried so an empty group sorts first.
    ...(raw.createdAt === undefined ? {} : { createdAt: raw.createdAt }),
    // The shared mapper paints its tick before new receipts arrive.
    ...(raw.deliveredUntil === undefined ? {} : { deliveredUntil: raw.deliveredUntil }),
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
  // A malformed `listener` drops only the listener; the rest of the detail is kept.
  const listener = Schema.decodeUnknownExit(GroupListener)(raw.listener);
  return {
    id: raw.id,
    title: raw.title,
    createdBy: raw.createdBy,
    members,
    ais,
    ...(raw.membersCanCreateTopics === undefined
      ? {}
      : { membersCanCreateTopics: raw.membersCanCreateTopics }),
    ...(raw.avatarUrl === undefined ? {} : { avatarUrl: raw.avatarUrl }),
    ...(Exit.isSuccess(listener) ? { listener: listener.value } : {}),
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
