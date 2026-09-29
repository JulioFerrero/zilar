import { Hono } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import {
  addGroupAi,
  addGroupMembers,
  createGroup,
  getGroupDetail,
  getMembership,
  MAX_GROUP_MEMBERS,
  patchGroup,
  removeGroupAi,
  removeGroupMember,
  type InviteLogger,
} from './service';

export interface GroupsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: InviteLogger;
}

const titleSchema = z
  .string()
  .trim()
  .min(1, { message: 'title must not be empty' })
  .max(100, { message: 'title must be at most 100 characters' });

const createGroupSchema = z.object({
  title: titleSchema,
  memberIds: z.array(z.string().min(1)).max(MAX_GROUP_MEMBERS).default([]),
});

const addMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(MAX_GROUP_MEMBERS),
});

const addAiSchema = z.object({
  aiId: z.string().min(1, { message: 'aiId is required' }),
});

const patchGroupSchema = z
  .object({
    membersCanCreateTopics: z.boolean().optional(),
  })
  .strict();

export function createGroupsRoutes({
  auth,
  db,
  config,
  adminClient,
  logger,
}: GroupsRoutesDependencies): Hono {
  const routes = new Hono();
  const domain = config.xmpp.domain;

  routes.post('/groups', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = createGroupSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }

    const group = await createGroup(db, adminClient, {
      creatorId: user.id,
      title: parsed.data.title,
      memberIds: parsed.data.memberIds,
      domain,
      logger,
    });
    return c.json(group, 201);
  });

  routes.get('/groups/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const groupId = c.req.param('id');
    const group = await getGroupDetail(db, groupId);
    const membership = group ? await getMembership(db, groupId, user.id) : null;
    // A non-member sees the same 404 as a missing group, so group ids cannot
    // be probed.
    if (!group || !membership) {
      throw new HttpError(404, 'not_found', 'Group not found');
    }
    return c.json(group);
  });

  routes.post('/groups/:id/members', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = addMembersSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }

    const group = await addGroupMembers(db, adminClient, {
      groupId: c.req.param('id'),
      actorId: user.id,
      userIds: parsed.data.userIds,
      domain,
      logger,
    });
    return c.json(group);
  });

  routes.delete('/groups/:id/members/:userId', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const group = await removeGroupMember(db, adminClient, {
      groupId: c.req.param('id'),
      actorId: user.id,
      targetUserId: c.req.param('userId'),
      domain,
      logger,
    });
    return c.json(group);
  });

  routes.post('/groups/:id/ais', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = addAiSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }

    const group = await addGroupAi(db, adminClient, {
      groupId: c.req.param('id'),
      actorId: user.id,
      aiId: parsed.data.aiId,
    });
    return c.json(group);
  });

  routes.delete('/groups/:id/ais/:aiId', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const group = await removeGroupAi(db, adminClient, {
      groupId: c.req.param('id'),
      actorId: user.id,
      aiId: c.req.param('aiId'),
      domain,
      logger,
    });
    return c.json(group);
  });

  // T-0108: group owner/admin toggles whether plain members may create
  // topics. A non-member sees the same 404 as a missing group.
  routes.patch('/groups/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = patchGroupSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const group = await patchGroup(db, {
      groupId: c.req.param('id'),
      actorId: user.id,
      membersCanCreateTopics: parsed.data.membersCanCreateTopics,
    });
    return c.json(group);
  });

  return routes;
}
