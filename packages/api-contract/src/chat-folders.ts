// Chat folders (T-0232, T-0237): the caller's own folders, listed in order.
// A write answers with the authoritative row; the list drops a row this build
// cannot read (for example an icon from a newer server) instead of failing
// the whole list.

import { Exit, Schema, SchemaGetter } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { SchemaErrors, Session } from './middleware';

// Mirrors `packages/chat-core/src/folders.ts` (FOLDER_ICONS, FOLDER_NAME_MAX,
// FOLDER_CHATS_MAX). The contract does not depend on `@zilar/chat-core`.
export const FOLDER_ICONS = [
  'folder',
  'message-circle',
  'user',
  'users',
  'megaphone',
  'bot',
  'briefcase',
  'house',
  'star',
  'heart',
  'bookmark',
  'flag',
  'bell',
  'globe',
  'graduation-cap',
  'gamepad-2',
  'music',
  'camera',
  'shopping-bag',
  'plane',
  'coffee',
  'dumbbell',
  'code',
  'wallet',
] as const;

export type FolderIcon = (typeof FOLDER_ICONS)[number];

export const FOLDER_CHAT_TYPES = ['dm', 'group', 'channel', 'ai'] as const;

export type FolderChatType = (typeof FOLDER_CHAT_TYPES)[number];

export const FOLDER_NAME_MAX = 24;
export const FOLDER_CHATS_MAX = 100;

const FolderIconSchema = Schema.Literals(FOLDER_ICONS);
const FolderChatTypeSchema = Schema.Literals(FOLDER_CHAT_TYPES);

const IncludeTypes = Schema.Array(FolderChatTypeSchema).check(
  Schema.makeFilter((types) =>
    new Set(types).size === types.length ? undefined : 'includeTypes must not contain duplicates',
  ),
);

const JidList = Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)))
  .check(Schema.isMaxLength(FOLDER_CHATS_MAX))
  .check(
    Schema.makeFilter((jids) =>
      new Set(jids).size === jids.length ? undefined : 'Chat lists must not contain duplicates',
    ),
  );

// `name` is trimmed before the length check, like zod's `.trim().min(1).max()`.
const FolderName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(FOLDER_NAME_MAX));

/**
 * The chat lists and flags are optional: the server treats an omitted list as
 * empty and an omitted flag as false.
 */
export const CreateChatFolderPayload = Schema.Struct({
  name: FolderName,
  icon: FolderIconSchema,
  includeTypes: Schema.optional(IncludeTypes),
  includeChats: Schema.optional(JidList),
  excludeChats: Schema.optional(JidList),
  excludeMuted: Schema.optional(Schema.Boolean),
  excludeRead: Schema.optional(Schema.Boolean),
});

export const PatchChatFolderPayload = Schema.Struct({
  name: Schema.optional(FolderName),
  icon: Schema.optional(FolderIconSchema),
  includeTypes: Schema.optional(IncludeTypes),
  includeChats: Schema.optional(JidList),
  excludeChats: Schema.optional(JidList),
  excludeMuted: Schema.optional(Schema.Boolean),
  excludeRead: Schema.optional(Schema.Boolean),
}).check(
  Schema.makeFilter((value) => (Object.keys(value).length > 0 ? undefined : 'Nothing to update')),
);

export const OrderChatFoldersPayload = Schema.Struct({
  ids: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
});

/** A folder row. The arrays are mutable in the type so a client can hand them on. */
export const ChatFolder = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: FolderIconSchema,
  position: Schema.Number,
  includeTypes: Schema.mutable(Schema.Array(FolderChatTypeSchema)),
  includeChats: Schema.mutable(Schema.Array(Schema.String)),
  excludeChats: Schema.mutable(Schema.Array(Schema.String)),
  excludeMuted: Schema.Boolean,
  excludeRead: Schema.Boolean,
});

export type ChatFolder = typeof ChatFolder.Type;

const decodeChatFolder = Schema.decodeUnknownExit(ChatFolder);

// A row this build cannot read is dropped; encoding (the server side) passes
// the rows through.
const ReadableChatFolders = Schema.Array(Schema.Unknown).pipe(
  Schema.decodeTo(Schema.mutable(Schema.Array(ChatFolder)), {
    decode: SchemaGetter.transform((rows) =>
      rows.filter((row): row is typeof ChatFolder.Encoded => Exit.isSuccess(decodeChatFolder(row))),
    ),
    encode: SchemaGetter.transform((rows) => rows),
  }),
);

/** The list drops unreadable rows. */
export const ChatFolderList = Schema.Struct({ folders: ReadableChatFolders });

/** The order answer carries every row, so one unreadable row is a broken server. */
export const ChatFolderOrder = Schema.Struct({ folders: Schema.mutable(Schema.Array(ChatFolder)) });

export const ChatFolderResult = Schema.Struct({ folder: ChatFolder });

export const ChatFolderDeleted = Schema.Struct({ deleted: Schema.Literal(true) });

export const ChatFoldersGroup = HttpApiGroup.make('chatFolders')
  .add(
    HttpApiEndpoint.get('list', '/chat-folders', {
      success: ChatFolderList,
    }),
    HttpApiEndpoint.post('create', '/chat-folders', {
      payload: CreateChatFolderPayload,
      success: ChatFolderResult.pipe(HttpApiSchema.status(201)),
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.put('order', '/chat-folders/order', {
      payload: OrderChatFoldersPayload,
      success: ChatFolderOrder,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.patch('update', '/chat-folders/:id', {
      params: { id: Schema.String },
      payload: PatchChatFolderPayload,
      success: ChatFolderResult,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('remove', '/chat-folders/:id', {
      params: { id: Schema.String },
      success: ChatFolderDeleted,
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
