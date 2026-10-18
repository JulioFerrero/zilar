// An email never appears here; `avatarUrl` and `handle` are omitted when absent.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema } from 'effect/http-api';
import { CurrentUser, Session } from './middleware';

export const Contact = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  jid: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
  handle: Schema.optional(Schema.NullOr(Schema.String)),
});

export type Contact = typeof Contact.Type;

export const ContactList = Schema.Array(Contact);

// Removing a contact deletes the pair and drops both XMPP roster items, so it is capped per user.
export class ContactsWriteRateLimit extends HttpApiMiddleware.Service<
  ContactsWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/ContactsWriteRateLimit') {}

export const ContactsGroup = HttpApiGroup.make('contacts')
  .add(
    HttpApiEndpoint.get('list', '/contacts', {
      success: ContactList,
    }),
    // A target that is not a contact answers 404; the pair delete and roster cleanup live in `contacts/service.ts`.
    HttpApiEndpoint.delete('remove', '/contacts/:userId', {
      params: { userId: Schema.String },
      success: HttpApiSchema.NoContent,
    }).middleware(ContactsWriteRateLimit),
  )
  .middleware(Session)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
