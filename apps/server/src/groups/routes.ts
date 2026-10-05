import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
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
import { setGroupVisibility } from './visibility';
import { joinPublicGroup } from './join';

export interface GroupsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: InviteLogger;
  audit?: AuditRecorder;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
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
  // T-0164: `public` creates the group with a handle in one transaction
  // (same 409 `handle_taken` race mapping as the visibility change);
  // `private` (default) behaves as before.
  visibility: z.enum(['private', 'public']).optional(),
  handle: z.string().min(1).max(64).optional(),
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
    // T-0164: the owner may flip a group public (with a handle) or back to
    // private. The handle insert/retire, the visibility update and the
    // unique-violation mapping share one transaction in `setGroupVisibility`.
    visibility: z.enum(['private', 'public']).optional(),
    handle: z.string().min(1).max(64).optional(),
  })
  .strict();

const changeRoleSchema = z
  .object({
    role: z.enum(['admin', 'member']),
  })
  .strict();

export const ROLE_CHANGE_RATE_LIMIT_MAX = 30;
export const ROLE_CHANGE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
// T-0164: open joins of public groups: 30 per hour per user (like the
// invite-link join budget's per-user half), so handles cannot be farmed at
// speed. Directory + by-handle reads below share the same clock.
export const PUBLIC_JOIN_RATE_LIMIT_MAX = 30;
export const PUBLIC_JOIN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export function createGroupsRoutes({
  auth,
  db,
  config,
  adminClient,
  logger,
  audit,
  now,
}: GroupsRoutesDependencies): Hono {
  const routes = new Hono();
  const domain = config.xmpp.domain;
  // T-0124: role changes hit ejabberd (one affiliation write per call), so
  // they are capped per owner like topic creation is capped per user.
  const roleLimiter = createRateLimiter({
    max: ROLE_CHANGE_RATE_LIMIT_MAX,
    windowMs: ROLE_CHANGE_RATE_LIMIT_WINDOW_MS,
    now: now ?? Date.now,
  });
  const joinLimiter = createRateLimiter({
    max: PUBLIC_JOIN_RATE_LIMIT_MAX,
    windowMs: PUBLIC_JOIN_RATE_LIMIT_WINDOW_MS,
    now: now ?? Date.now,
  });

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
      ...(parsed.data.visibility === undefined ? {} : { visibility: parsed.data.visibility }),
      ...(parsed.data.handle === undefined ? {} : { handle: parsed.data.handle }),
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
  // the owner/admins only (who posts is public — every admin post carries
  // its name — while the subscriber audience stays hidden); a stranger sees
  // the same 404 as a missing group, so the audience cannot be probed.
  // Group members keep the full list on the detail itself.
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

  // T-0124: promote/demote through the role route (owner only). Channels
  // only: plain groups answer the same 404 as an unknown group (the spec
  // asks for channel rules only, and no group UI calls this route). Every
  // change is audited as `group.role_changed` (ids and roles only). The
  // room affiliation follows the committed row best-effort (see
  // `changeMemberRole`).
  routes.put('/groups/:id/members/:userId/role', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    if (!roleLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many role changes, try again later');
    }
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
      domain,
      logger,
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
  // T-0164: the same route carries `visibility` + `handle` (owner only):
  // the visibility change is one transaction (handle insert or retire,
  // visibility update, unique violation mapped to 409 `handle_taken`,
  // interval rule 409 `handle_change_too_soon` with `nextChangeAt`), and
  // the change is audited as `group.visibility_changed` (ids only) once the
  // transaction commits. A non-owner member touching visibility sees the
  // same 404 the visibility rule itself answers (so the setting cannot be
  // probed), while the other settings keep the existing 403 pattern.
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
    const wantsVisibility =
      parsed.data.visibility !== undefined || parsed.data.handle !== undefined;
    if (wantsVisibility) {
      if (parsed.data.visibility === undefined) {
        throw new HttpError(400, 'invalid_request', 'visibility is required with a handle');
      }
      const changed = await setGroupVisibility(db, {
        groupId: c.req.param('id'),
        actorId: user.id,
        visibility: parsed.data.visibility,
        ...(parsed.data.handle === undefined ? {} : { handle: parsed.data.handle }),
      });
      if (audit !== undefined) {
        const recorder = audit;
        const groupId = c.req.param('id');
        void recorder
          .record({
            actorUserId: user.id,
            aiId: null,
            groupId,
            action: 'group.visibility_changed',
            subjectId: groupId,
            argsHash: null,
            costCurrency: null,
            costAmount: null,
            result: 'ok',
            detail: { groupId, visibility: changed.visibility },
          })
          .catch(() => {
            logger.warn({ groupId }, 'could not audit a visibility change');
          });
      }
    }
    const group = await patchGroup(db, {
      groupId: c.req.param('id'),
      actorId: user.id,
      membersCanCreateTopics: parsed.data.membersCanCreateTopics,
    });
    return c.json(group);
  });

  // T-0164: open join for public groups and channels. Private and unknown
  // groups answer the same 404; a full group answers 409 `group_full`;
  // joining twice is harmless (`alreadyMember: true`). Rate limited per
  // user; audited as `group.joined_public` (ids only) by the service.
  routes.post('/groups/:id/join', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    if (!joinLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many join attempts, try again later');
    }
    const result = await joinPublicGroup(
      {
        db,
        adminClient,
        domain,
        logger,
        ...(audit === undefined ? {} : { audit }),
      },
      c.req.param('id'),
      user.id,
    );
    return c.json(result);
  });

  return routes;
}
