// Group roles module on the Effect `HttpApi` adapter (T-0525): the same
// methods, paths, statuses and bodies as the deleted router (`routes.ts`),
// mounted by the Effect edge (`apps/server/src/effect/edge.ts`). The `groups`
// module still owns the other `/groups/...` routes, so only these exact paths
// mount. Its service runs on effect/sql.

import { Layer, Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import {
  SchemaErrors,
  Session,
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import {
  ROLE_NAME_MAX,
  createRole,
  deleteRole,
  listRoles,
  renameRole,
  setRoleMembers,
  type RolesServiceDeps,
} from './service';

const CONTROL_CHAR_MAX = 0x1f;
const CONTROL_CHAR_DEL = 0x7f;

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= CONTROL_CHAR_MAX || code === CONTROL_CHAR_DEL) {
      return true;
    }
  }
  return false;
}

// Replaces `roleNameSchema` (zod): trimmed, 1..30 characters, no control
// characters.
const RoleName = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(ROLE_NAME_MAX),
  Schema.makeFilter((value) =>
    hasControlCharacters(value) ? 'name must not contain control characters' : undefined,
  ),
);

// Replace `createRoleBodySchema` / `renameRoleBodySchema` (zod). Both are
// strict, so an excess key fails like the old `.strict()`.
const CreateRoleBody = Schema.Struct({ name: RoleName });
const RenameRoleBody = Schema.Struct({ name: RoleName });

// Replaces `setRoleMembersBodySchema` (zod): up to 50 non-empty user ids,
// strict.
const SetRoleMembersBody = Schema.Struct({
  userIds: Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)))).check(
    Schema.isMaxLength(50),
  ),
});

const RoleMember = Schema.Struct({ userId: Schema.String, name: Schema.String });

const GroupRole = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  members: Schema.Array(RoleMember),
});

const RoleList = Schema.Struct({ roles: Schema.Array(GroupRole) });

const GroupIdParams = Schema.Struct({ id: Schema.String });
const RoleParams = Schema.Struct({ id: Schema.String, roleId: Schema.String });

const RolesGroup = HttpApiGroup.make('roles')
  .add(
    HttpApiEndpoint.get('list', '/groups/:id/roles', {
      params: GroupIdParams,
      success: RoleList,
    }),
    HttpApiEndpoint.post('create', '/groups/:id/roles', {
      params: GroupIdParams,
      payload: CreateRoleBody,
      success: GroupRole,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.patch('rename', '/groups/:id/roles/:roleId', {
      params: RoleParams,
      payload: RenameRoleBody,
      success: GroupRole,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('remove', '/groups/:id/roles/:roleId', {
      params: RoleParams,
      success: HttpApiSchema.NoContent,
    }),
    HttpApiEndpoint.put('setMembers', '/groups/:id/roles/:roleId/members', {
      params: RoleParams,
      payload: SetRoleMembersBody,
      success: GroupRole,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

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
        handler(logger, async (request, user) =>
          HttpServerResponse.jsonUnsafe(
            await createRole(serviceDeps(), request.params.id, user.id, request.payload.name),
            { status: 201 },
          ),
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
