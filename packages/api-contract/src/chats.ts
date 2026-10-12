// The chats list (T-0533, moved to the contract by T-0894): the caller's DMs
// (contacts and own AIs) and groups, sorted by title.
//
// The list's entries are declared as `Unknown` on purpose: the server passes
// each entry through unchanged (a named struct would drop keys it does not
// list), so each client still decodes the entries it renders and a malformed
// entry is an `invalid_response`. `ChatEntry` below is the shared schema of one
// entry (T-0924): both apps decode the same union instead of each keeping its
// own.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { GroupBackground } from './groups';
import { SchemaErrors, Session } from './middleware';
import { mutableStruct } from './mutable-struct';

/**
 * The newest archived message of a chat (T-1198): the preview the chat list
 * shows under the title. `senderName` is the display name ("You" for the
 * caller's own messages); `at` is an ISO datetime. `archiveId` (T-1214) is
 * the row's archive timestamp as a decimal string — the read mark for this
 * preview (`id` is the origin id, not a mark). Optional, so older payloads
 * still parse.
 */
export const ChatLastMessage = mutableStruct({
  id: Schema.String,
  text: Schema.String,
  senderName: Schema.optional(Schema.String),
  at: Schema.String,
  archiveId: Schema.optional(Schema.String),
});

export type ChatLastMessage = typeof ChatLastMessage.Type;

/**
 * One DM: a human contact or the caller's own AI. A field an older server
 * omitted is optional so an older payload still parses.
 */
export const DmChatEntry = mutableStruct({
  kind: Schema.Literal('dm'),
  chatJid: Schema.String,
  title: Schema.String,
  userId: Schema.optional(Schema.String),
  avatarUrl: Schema.optional(Schema.String),
  /** Set on the caller's AIs; absent or false for human contacts. */
  isAi: Schema.optional(Schema.Boolean),
  /** T-1198: messages after the caller's read mark, absent without archive. */
  unread: Schema.optional(Schema.Number),
  /** T-1198: the newest archived message, absent without archive. */
  lastMessage: Schema.optional(ChatLastMessage),
  /**
   * T-1229: the highest delivered mark of another member, an archive id in
   * the caller's own-message terms. Absent when nobody confirmed yet or
   * without archive.
   */
  deliveredUntil: Schema.optional(Schema.String),
});

export type DmChatEntry = typeof DmChatEntry.Type;

/**
 * One group (a channel is a group with `chatKind: 'channel'`). Every field an
 * older server omitted is optional so an older payload still parses.
 */
export const GroupChatEntry = mutableStruct({
  kind: Schema.Literal('group'),
  chatJid: Schema.String,
  title: Schema.String,
  groupId: Schema.String,
  memberCount: Schema.Number,
  role: Schema.Literals(['owner', 'admin', 'member']),
  // T-0124: `group` behaves as before; `channel` is the broadcast feed (its
  // General topic is the feed).
  chatKind: Schema.optional(Schema.Literals(['group', 'channel'])),
  // T-0124: the same count under the usual channel name, for channels only.
  subscriberCount: Schema.optional(Schema.Number),
  // T-0124: the channel's short blurb.
  description: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0164: `public` groups are in the directory; `private` stay invite-only.
  visibility: Schema.optional(Schema.Literals(['private', 'public'])),
  // T-0164: the group's `@handle` while public, null while private.
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0111: the group's visible topics (archived excluded). Parsed loosely
  // here — each row is validated by `Topic` when a client maps the entry to
  // chat rows, and unknown rows are dropped there.
  topics: Schema.optional(Schema.mutable(Schema.Array(Schema.Unknown))),
  // T-0165: the group's picture, when it has one.
  avatarUrl: Schema.optional(Schema.String),
  // T-0466: the group's shared background.
  background: Schema.optional(GroupBackground),
  /** T-1198: messages after the caller's read mark, absent without archive. */
  unread: Schema.optional(Schema.Number),
  /** T-1198: the newest archived message, absent without archive. */
  lastMessage: Schema.optional(ChatLastMessage),
  /**
   * T-1229: the highest delivered mark of any other member, an archive id
   * in the caller's own-message terms. Absent when nobody confirmed yet or
   * without archive.
   */
  deliveredUntil: Schema.optional(Schema.String),
});

export type GroupChatEntry = typeof GroupChatEntry.Type;

/**
 * One `/api/chats` entry: a DM or a group. Both apps decode with this one
 * union (T-0924); mobile still decodes each entry on its own and skips a bad
 * one, so its leniency is unchanged.
 */
export const ChatEntry = Schema.Union([DmChatEntry, GroupChatEntry]);

export type ChatEntry = typeof ChatEntry.Type;

export const ChatList = Schema.Struct({
  chats: Schema.Array(Schema.Unknown),
});

export type ChatList = typeof ChatList.Type;

/**
 * T-1229: the receiving device's delivery confirmation. Origin ids (the wire
 * id, `docs/plan/delivered-tick.md` §4), 1 to 50 ids, each non-empty and at
 * most 128 chars.
 */
const DeliveredOriginIds = Schema.Array(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
).check(Schema.isMinLength(1), Schema.isMaxLength(50));

export const ChatsGroup = HttpApiGroup.make('chats')
  .add(HttpApiEndpoint.get('list', '/chats', { success: ChatList }))
  .add(
    HttpApiEndpoint.put('markRead', '/chats/:jid/read', {
      params: { jid: Schema.String },
      payload: Schema.Struct({ messageId: Schema.String }),
      success: HttpApiSchema.NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.put('markDelivered', '/chats/:jid/delivered', {
      params: { jid: Schema.String },
      payload: Schema.Struct({ originIds: DeliveredOriginIds }),
      success: HttpApiSchema.NoContent,
    }),
  )
  // T-1236: the caller deletes their own copy of a DM. `clearHistory` drops
  // every archive row the caller holds with the peer; `deleteForMe` drops one,
  // named by its archive id (the row's timestamp). Both are no-content and
  // only touch the caller's rows.
  .add(
    HttpApiEndpoint.delete('clearHistory', '/chats/:jid/history', {
      params: { jid: Schema.String },
      success: HttpApiSchema.NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.delete('deleteForMe', '/chats/:jid/messages/:archiveId', {
      params: { jid: Schema.String, archiveId: Schema.String },
      success: HttpApiSchema.NoContent,
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
