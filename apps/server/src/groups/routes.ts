import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import {
  addGroupAi,
  addGroupMembers,
  changeMemberRole,
  createGroup,
  getGroupDetail,
  getMembership,
  listMembersForViewer,
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
  audit?: AuditRecorder;
}

const titleSchema = z
  .string()
  .trim()
  .min(1, { message: 'title must not be empty' })
  .max(100, { message: 'title must be at most 100 characters' });

const descriptionSchema = z
  .string()
  .trim()
  .max(300, { message: 'description must be at most 300 characters' });

const createGroupSchema = z.object({
  title: titleSchema,
  memberIds: z.array(z.string().min(1)).max(MAX_GROUP_MEMBERS).default([]),
  // T-0124: `channel` creates the broadcast feed (moderated room). A missing
  // kind is a plain group, like before.
  kind: z.enum(['group', 'channel']).optional(),
  // T-0124: the channel's short blurb (≤ 300); an empty string clears to null.
  description: descriptionSchema.optional(),
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

const changeRoleSchema = z
  .object({
    role: z.enum(['admin', 'member']),
  })
  .strict();

export function createGroupsRoutes({
  auth,
  db,
  config,
  adminClient,
  logger,
  audit,
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
      ...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
      ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
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
    // T-0124: a channel subscriber sees the detail without the audience
    // list (admins see everyone, like in a group). The count still rides
    // the chat list and the preview.
    if (group.kind === 'channel' && membership.role === 'member') {
      return c.json({ ...group, members: [] });
    }
    return c.json(group);
  });

  // T-0124: the channel audience list, for admins only. A subscriber gets
  // the empty list (the count rides the detail); a stranger sees the same
  // 404 as a missing group, so the audience cannot be probed. Group members
  // keep the full list on the detail itself.
  routes.get('/groups/:id/members', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const groupId = c.req.param('id');
    const group = await getGroupDetail(db, groupId);
    if (!group) {
      throw new HttpError(404, 'not_found', 'Group not found');
    }
    const { members } = await listMembersForViewer(db, groupId, user.id);
    return c.json({ members });
  });

  // T-0124: promote a member to admin (or demote one back). Only the owner.
  // The room affiliation follows at once, so a channel's voice mapping is
  // enforced by the room, not the UI. Every change is audited as
  // `group.role_changed` (ids and roles only).
  routes.put('/groups/:id/members/:userId/role', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = changeRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const group = await changeMemberRole(db, adminClient, {
      groupId: c.req.param('id'),
      actorId: user.id,
      targetUserId: c.req.param('userId'),
      role: parsed.data.role,
      domain,
      logger,
      ...(audit === undefined ? {} : { audit }),
    });
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
