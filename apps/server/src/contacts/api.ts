import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { ContactsGroup, ContactsWriteRateLimit } from '@zilar/api-contract';
import type { Logger } from 'pino';
import { createAuditRecorder, type AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { listContacts, removeContact, type RemoveContactDeps } from './service';

// The same write budget as the blocks API: removing a contact deletes the pair and
// touches ejabberd.
export const CONTACTS_WRITE_RATE_LIMIT_MAX = 30;
export const CONTACTS_WRITE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const RATE_LIMIT_MESSAGE = 'Too many attempts, try again later';

export interface ContactsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  audit?: AuditRecorder;
  adminClient?: EjabberdAdminClient;
  now?: () => number;
  writeLimiter?: RateLimiter;
}

const ContactsApi = HttpApi.make('contacts').add(ContactsGroup);

function serviceFor(deps: ContactsApiDependencies): RemoveContactDeps {
  return {
    db: deps.db,
    domain: deps.config.xmpp.domain,
    audit: deps.audit ?? createAuditRecorder({ db: deps.db, logger: deps.logger }),
    ...(deps.adminClient === undefined ? {} : { adminClient: deps.adminClient }),
  };
}

export function createContactsApi(deps: ContactsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const config = deps.config;
  const writeLimiter =
    deps.writeLimiter ??
    createRateLimiter({
      max: CONTACTS_WRITE_RATE_LIMIT_MAX,
      windowMs: CONTACTS_WRITE_RATE_LIMIT_WINDOW_MS,
      now: deps.now ?? Date.now,
    });
  const service = serviceFor(deps);

  // Roster cleanup after a removal warns, never fails; the warn needs the request logger.
  const serviceWithLogger = { ...service, logger };

  const groupLayer = HttpApiBuilder.group(ContactsApi, 'contacts', (handlers) =>
    handlers
      .handle(
        'list',
        handler(logger, (_request, user) => listContacts(deps.db, user.id, config.xmpp.domain)),
      )
      // The write budget runs first; a target that is not a contact answers 404.
      .handle(
        'remove',
        handler(logger, (request, user) =>
          removeContact(serviceWithLogger, user.id, request.params.userId),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(ContactsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(rateLimitLayer(ContactsWriteRateLimit, writeLimiter, RATE_LIMIT_MESSAGE)),
  );

  return mountApi(ContactsApi, apiLayer);
}
