// Contacts module on the Effect `HttpApi` adapter (T-0514): the same method,
// path and answer as the deleted router. Its store runs on effect/sql.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpRouter } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import {
  CurrentUser,
  Session,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
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

export const CONTACTS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/contacts' },
];

export function createContactsApi(deps: ContactsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const config = deps.config;

  const groupLayer = HttpApiBuilder.group(ContactsApi, 'contacts', (handlers) =>
    handlers.handle('list', (request) => {
      const requestId = requestIdOf(request.request);
      return withErrorEnvelope(
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          return yield* Effect.promise(() => listContacts(deps.db, user.id, config.xmpp.domain));
        }),
        logger,
        requestId,
      );
    }),
  );

  const apiLayer = HttpApiBuilder.layer(ContactsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: CONTACTS_API_ROUTES };
}
