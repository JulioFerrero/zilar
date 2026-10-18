// Entries are `Unknown` on purpose: the server passes each through unchanged (a named struct would drop keys it does not list),
// so each client decodes what it renders and a malformed entry is an `invalid_response`.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { GroupBackground } from './groups';
import { SchemaErrors, Session } from './middleware';
import { mutableStruct } from './mutable-struct';

// The newest archived message preview; `archiveId` is the row's archive timestamp (the read mark), not the origin id.
// Optional, so older payloads still parse.
export const ChatLastMessage = mutableStruct({
  id: Schema.String,
  text: Schema.String,
  senderName: Schema.optional(Schema.String),
  at: Schema.String,
  archiveId: Schema.optional(Schema.String),
});

export type ChatLastMessage = typeof ChatLastMessage.Type;

export const DmChatEntry = mutableStruct({
  kind: Schema.Literal('dm'),
  chatJid: Schema.String,
  title: Schema.String,
  userId: Schema.optional(Schema.String),
  avatarUrl: Schema.optional(Schema.String),
  isAi: Schema.optional(Schema.Boolean),
  unread: Schema.optional(Schema.Number),
  lastMessage: Schema.optional(ChatLastMessage),
  // The highest delivered mark of another member, an archive id in the caller's own-message terms; absent when nobody confirmed yet.
  deliveredUntil: Schema.optional(Schema.String),
  // The peer's read mark, an archive id in the caller's own-message terms; absent until the peer has read.
  readUntil: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
});

export type DmChatEntry = typeof DmChatEntry.Type;

export const GroupChatEntry = mutableStruct({
  kind: Schema.Literal('group'),
  chatJid: Schema.String,
  title: Schema.String,
  groupId: Schema.String,
  memberCount: Schema.Number,
  role: Schema.Literals(['owner', 'admin', 'member']),
  chatKind: Schema.optional(Schema.Literals(['group', 'channel'])),
  subscriberCount: Schema.optional(Schema.Number),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  visibility: Schema.optional(Schema.Literals(['private', 'public'])),
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  // Topics are parsed loosely; each row is validated by `Topic` where a client maps it, and unknown rows are dropped.
  topics: Schema.optional(Schema.mutable(Schema.Array(Schema.Unknown))),
  avatarUrl: Schema.optional(Schema.String),
  background: Schema.optional(GroupBackground),
  unread: Schema.optional(Schema.Number),
  lastMessage: Schema.optional(ChatLastMessage),
  createdAt: Schema.optional(Schema.String),
  // The highest delivered mark of any other member, an archive id in the caller's own-message terms.
  deliveredUntil: Schema.optional(Schema.String),
});

export type GroupChatEntry = typeof GroupChatEntry.Type;

export const ChatEntry = Schema.Union([DmChatEntry, GroupChatEntry]);

export type ChatEntry = typeof ChatEntry.Type;

export const ChatList = Schema.Struct({
  chats: Schema.Array(Schema.Unknown),
});

export type ChatList = typeof ChatList.Type;

// Origin ids (the wire id), 1 to 50 ids, each non-empty and at most 128 chars.
const DeliveredOriginIds = Schema.Array(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
).check(Schema.isMinLength(1), Schema.isMaxLength(50));

export const ChatsGroup = HttpApiGroup.make('chats')
  .add(HttpApiEndpoint.get('list', '/chats', { success: ChatList }))
  .add(
    HttpApiEndpoint.put('markRead', '/chats/:jid/read', {
      params: { jid: Schema.String },
      payload: Schema.Struct({
        messageId: Schema.String,
        displayed: Schema.optional(
          Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
        ),
      }),
      success: HttpApiSchema.NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post('reply', '/chats/:jid/reply', {
      params: { jid: Schema.String },
      payload: Schema.Struct({
        clientId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
        text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)),
      }),
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
  // Deletes only the caller's own archive rows: `clearHistory` drops all with the peer,
  // `deleteForMe` drops one named by its archive id.
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
