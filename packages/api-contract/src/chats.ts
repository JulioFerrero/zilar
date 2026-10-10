// The chats list (T-0533, moved to the contract by T-0894): the caller's DMs
// (contacts and own AIs) and groups, sorted by title.
//
// The entries are declared as `Unknown` on purpose: the list is a
// discriminated union whose group entries carry topic views and a background,
// and the server passes each entry through unchanged (a named struct would
// drop keys it does not list). Each client validates the entries it renders
// with its own schema, so a malformed entry is still an `invalid_response`.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Session } from './middleware';

export const ChatList = Schema.Struct({
  chats: Schema.Array(Schema.Unknown),
});

export type ChatList = typeof ChatList.Type;

export const ChatsGroup = HttpApiGroup.make('chats')
  .add(HttpApiEndpoint.get('list', '/chats', { success: ChatList }))
  .middleware(Session)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
