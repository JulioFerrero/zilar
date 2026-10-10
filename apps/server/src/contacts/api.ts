// Contacts module on the Effect `HttpApi` adapter (T-0514): the same method,
// path and answer as the deleted router. Its store runs on effect/sql. The
// schemas and the group live in the shared contract (`@zilar/api-contract`,
// T-0894); this file keeps the handlers and layers.

import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { ContactsGroup } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { listContacts } from './service';

export interface ContactsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
}

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
