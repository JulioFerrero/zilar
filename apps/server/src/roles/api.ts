// Group roles module on the Effect `HttpApi` adapter (T-0525): the same
// methods, paths, statuses and bodies as the deleted router (`routes.ts`),
// mounted by the Effect edge (`apps/server/src/effect/edge.ts`). The `groups`
// module still owns the other `/groups/...` routes, so only these exact paths
// mount. Its service runs on effect/sql.
//
// The schemas and the group live in the shared contract (`@zilar/api-contract`,
// T-0892); this file keeps the handlers and layers.

import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { Logger } from 'pino';
import { RolesGroup } from '@zilar/api-contract';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import {
  createRole,
  deleteRole,
  listRoles,
  renameRole,
  setRoleMembers,
  type RolesServiceDeps,
} from './service';

const RolesApi = HttpApi.make('roles').add(RolesGroup);

export interface RolesApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  audit?: AuditRecorder;
}

export function createRolesApi(deps: RolesApiDependencies): EffectApiMount {
  const logger = deps.logger;

  function serviceDeps(): RolesServiceDeps {
    return {
      db: deps.db,
      adminClient: deps.adminClient,
      domain: deps.config.xmpp.domain,
      logger: deps.logger,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    };
  }

  const groupLayer = HttpApiBuilder.group(RolesApi, 'roles', (handlers) =>
    handlers
      // The group's roles with their holders; any member may read.
      .handle(
        'list',
        handler(logger, async (request, user) => ({
          roles: await listRoles(deps.db, request.params.id, user.id),
        })),
      )
      // Creates a role (owner/admin only); capped at `MAX_ROLES_PER_GROUP`.
      .handle(
        'create',
        handler(logger, (request, user) =>
          createRole(serviceDeps(), request.params.id, user.id, request.payload.name),
        ),
      )
      // Renames a role (owner/admin only).
      .handle(
        'rename',
        handler(logger, (request, user) =>
          renameRole(
            serviceDeps(),
            request.params.id,
            request.params.roleId,
            user.id,
            request.payload.name,
          ),
        ),
      )
      // Deletes a role (owner/admin only), 204 with no body.
      .handle(
        'remove',
        handler(logger, async (request, user) => {
          await deleteRole(serviceDeps(), request.params.id, request.params.roleId, user.id);
        }),
      )
      // Replaces a role's member set (owner/admin only), last write wins.
      .handle(
        'setMembers',
        handler(logger, (request, user) =>
          setRoleMembers(
            serviceDeps(),
            request.params.id,
            request.params.roleId,
            user.id,
            request.payload.userIds,
          ),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(RolesApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(RolesApi, apiLayer);
}
