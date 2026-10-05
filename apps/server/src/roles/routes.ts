import { Hono } from 'hono';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { InviteLogger } from '../groups/service';
import {
  createRole,
  createRoleBodySchema,
  deleteRole,
  listRoles,
  renameRole,
  renameRoleBodySchema,
  setRoleMembers,
  setRoleMembersBodySchema,
} from './service';

export interface RolesRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

function serviceDeps(deps: RolesRoutesDependencies) {
  return {
    db: deps.db,
    adminClient: deps.adminClient,
    domain: deps.config.xmpp.domain,
    logger: deps.logger,
    ...(deps.audit === undefined ? {} : { audit: deps.audit }),
  };
}

// Custom group roles (T-0116). Reading the list needs only group
// membership; every write needs a group owner/admin. The service answers
// the same 404 for a missing group and a stranger, and the same 404 for a
// missing role and a foreign one, so ids cannot be probed.
export function createRolesRoutes(deps: RolesRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get('/groups/:id/roles', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    return c.json({ roles: await listRoles(deps.db, c.req.param('id'), user.id) });
  });

  routes.post('/groups/:id/roles', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = createRoleBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const role = await createRole(serviceDeps(deps), c.req.param('id'), user.id, parsed.data.name);
    return c.json(role, 201);
  });

  routes.patch('/groups/:id/roles/:roleId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = renameRoleBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    return c.json(
      await renameRole(
        serviceDeps(deps),
        c.req.param('id'),
        c.req.param('roleId'),
        user.id,
        parsed.data.name,
      ),
    );
  });

  routes.delete('/groups/:id/roles/:roleId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    await deleteRole(serviceDeps(deps), c.req.param('id'), c.req.param('roleId'), user.id);
    return c.body(null, 204);
  });

  routes.put('/groups/:id/roles/:roleId/members', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = setRoleMembersBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    return c.json(
      await setRoleMembers(
        serviceDeps(deps),
        c.req.param('id'),
        c.req.param('roleId'),
        user.id,
        parsed.data.userIds,
      ),
    );
  });

  return routes;
}
