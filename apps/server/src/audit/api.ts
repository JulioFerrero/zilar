import { Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { AuditGroup, AuditSchemaErrors, type AuditPage } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  schemaErrorLayerFor,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { listAuditForAi, listAuditForGroup, type ListAuditPage } from './service';

// The service marks a malformed `before` with `Invalid cursor`, answered 400; every
// other rejection is an unhandled 500, so both travel as defects.
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
      // A group's rows for its owner/admin, an AI's for its owner. An unknown scope
      // answers an empty page, never a 404.
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
    // Every query decode failure answers the fixed text `Invalid audit query`.
    Layer.provide(schemaErrorLayerFor(AuditSchemaErrors, logger, 'Invalid audit query')),
  );

  return mountApi(AuditApi, apiLayer);
}
