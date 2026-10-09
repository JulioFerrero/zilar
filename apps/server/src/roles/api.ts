// Group roles module on the Effect `HttpApi` adapter (T-0525): the same
// methods, paths, statuses and bodies as the deleted router (`routes.ts`),
// mounted by the Effect edge (`apps/server/src/effect/edge.ts`). The `groups`
// module still owns the other `/groups/...` routes, so only these exact paths
// mount. Its service runs on effect/sql.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  CurrentUser,
  Session,
  failureResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
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

// Applied to the group so a payload decode failure renders like the old zod
// path: 400 `invalid_request`. No test asserts the exact text, so the Effect
// Schema message is used (the old text was the first zod issue).
class RolesSchemaErrors extends HttpApiMiddleware.Service<RolesSchemaErrors>()(
  'zilar/effect/http/RolesSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<RolesSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(RolesSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message),
      );
    }),
  );
}

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
  .middleware(RolesSchemaErrors)
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

export const ROLES_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/groups/:id/roles' },
  { method: 'POST', path: '/api/groups/:id/roles' },
  { method: 'PATCH', path: '/api/groups/:id/roles/:roleId' },
  { method: 'DELETE', path: '/api/groups/:id/roles/:roleId' },
  { method: 'PUT', path: '/api/groups/:id/roles/:roleId/members' },
];

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
      .handle('list', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const roles = yield* Effect.promise(() =>
              listRoles(deps.db, request.params.id, user.id),
            );
            return { roles };
          }),
          logger,
          requestId,
        );
      })
      // Creates a role (owner/admin only); capped at `MAX_ROLES_PER_GROUP`.
      .handle('create', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const role = yield* Effect.promise(() =>
              createRole(serviceDeps(), request.params.id, user.id, request.payload.name),
            );
            return HttpServerResponse.jsonUnsafe(role, { status: 201 });
          }),
          logger,
          requestId,
        );
      })
      // Renames a role (owner/admin only).
      .handle('rename', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return yield* Effect.promise(() =>
              renameRole(
                serviceDeps(),
                request.params.id,
                request.params.roleId,
                user.id,
                request.payload.name,
              ),
            );
          }),
          logger,
          requestId,
        );
      })
      // Deletes a role (owner/admin only), 204 with no body.
      .handle('remove', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            yield* Effect.promise(() =>
              deleteRole(serviceDeps(), request.params.id, request.params.roleId, user.id),
            );
          }),
          logger,
          requestId,
        );
      })
      // Replaces a role's member set (owner/admin only), last write wins.
      .handle('setMembers', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return yield* Effect.promise(() =>
              setRoleMembers(
                serviceDeps(),
                request.params.id,
                request.params.roleId,
                user.id,
                request.payload.userIds,
              ),
            );
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(RolesApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: ROLES_API_ROUTES };
}
