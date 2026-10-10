// The contact list (T-0514, moved to the contract by T-0894): the people the
// caller can chat with. An email never appears here. `avatarUrl` and `handle`
// are omitted when absent.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Session } from './middleware';

export const Contact = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  jid: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
  handle: Schema.optional(Schema.NullOr(Schema.String)),
});

export type Contact = typeof Contact.Type;

export const ContactList = Schema.Array(Contact);

export const ContactsGroup = HttpApiGroup.make('contacts')
  .add(
    HttpApiEndpoint.get('list', '/contacts', {
      success: ContactList,
    }),
  )
  .middleware(Session)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
