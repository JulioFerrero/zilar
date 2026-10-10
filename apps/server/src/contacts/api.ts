// Contacts module on the Effect `HttpApi` adapter (T-0514): the same method,
// path and answer as the deleted router. Its store runs on effect/sql.

import { Layer, Schema } from 'effect';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { Session, handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { listContacts } from './service';

export interface ContactsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
}

// The contact rows, exactly like `listContacts` returns them: an email never
// appears here. `avatarUrl` and `handle` are omitted when absent.
const Contact = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  jid: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
  handle: Schema.optional(Schema.NullOr(Schema.String)),
});

const ContactsGroup = HttpApiGroup.make('contacts')
  .add(
    HttpApiEndpoint.get('list', '/contacts', {
      success: Schema.Array(Contact),
    }),
  )
  .middleware(Session)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const ContactsApi = HttpApi.make('contacts').add(ContactsGroup);

export function createContactsApi(deps: ContactsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const config = deps.config;

  const groupLayer = HttpApiBuilder.group(ContactsApi, 'contacts', (handlers) =>
    handlers.handle(
      'list',
      handler(logger, (_request, user) => listContacts(deps.db, user.id, config.xmpp.domain)),
    ),
  );

  const apiLayer = HttpApiBuilder.layer(ContactsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  return mountApi(ContactsApi, apiLayer);
}
