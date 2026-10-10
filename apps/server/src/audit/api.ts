// Audit module on the Effect `HttpApi` adapter (T-0525): the same method,
// path, query rules and answers as the deleted router. Its service runs on
// effect/sql. `app.ts` mounts {@link createAuditApi} through the Effect edge.

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiMiddleware } from 'effect/http-api';
import { AuditGroup, AuditSchemaErrors, type AuditPage } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  failureResponse,
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { listAuditForAi, listAuditForGroup, type ListAuditPage } from './service';

// Any query decode failure is the fixed text `Invalid audit query`, exactly
// like the old route.

function schemaErrorLayer(logger: Logger): Layer.Layer<AuditSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(AuditSchemaErrors, () =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', 'Invalid audit query'),
      );
    }),
  );
}

// The service throws `Error('Invalid cursor')` for a malformed `before`; the
// old route mapped just that message to 400, and every other rejection stayed
// an unhandled 500. Both travel as defects so the envelope renders them.
function listPage(promise: () => Promise<ListAuditPage>): Effect.Effect<ListAuditPage> {
  return Effect.promise(promise).pipe(
    Effect.catchDefect((defect) =>
      Effect.die(
        defect instanceof Error && defect.message === 'Invalid cursor'
          ? new HttpError(400, 'invalid_request', 'Invalid cursor')
          : defect,
      ),
    ),
  );
}

// The service returns `Date`s; the wire carries their ISO strings, which is
// what `JSON.stringify` wrote before the contract declared the page.
function toWirePage(page: ListAuditPage): AuditPage {
  return {
    entries: page.entries.map((entry) => ({ ...entry, at: entry.at.toISOString() })),
    next: page.next,
  };
}

const AuditApi = HttpApi.make('audit').add(AuditGroup);

export interface AuditApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: Logger;
}

export function createAuditApi(deps: AuditApiDependencies): EffectApiMount {
  const logger = deps.logger;

  const groupLayer = HttpApiBuilder.group(AuditApi, 'audit', (handlers) =>
    handlers
      // The caller's audit rows: a group's (owner/admin) or an AI's (owner).
      // Unknown scopes answer an empty page, never a 404.
      .handle(
        'list',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const requestId = requestIdOf(request.request);
            const { groupId, aiId, limit, before } = request.query;
            const hasGroup = groupId !== undefined;
            const hasAi = aiId !== undefined;
            if (hasGroup === hasAi) {
              return httpErrorResponse(
                requestId,
                new HttpError(400, 'invalid_request', 'Provide exactly one of groupId or aiId'),
              );
            }
            const options = {
              ...(limit === undefined ? {} : { limit }),
              ...(before === undefined ? {} : { before }),
            };
            if (hasGroup && groupId !== undefined) {
              const page = yield* listPage(() =>
                listAuditForGroup(deps.db, groupId, user.id, options),
              );
              return toWirePage(page);
            }
            if (hasAi && aiId !== undefined) {
              const page = yield* listPage(() => listAuditForAi(deps.db, aiId, user.id, options));
              return toWirePage(page);
            }
            return httpErrorResponse(
              requestId,
              new HttpError(400, 'invalid_request', 'Provide exactly one of groupId or aiId'),
            );
          }),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(AuditApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(AuditApi, apiLayer);
}
