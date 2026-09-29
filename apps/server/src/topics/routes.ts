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
import type { InviteLogger } from '../groups/service';
import {
  listTopicAis,
  requireVisibleTopic,
  toMissingTopic,
  toTopicView,
  toTopicViews,
  visibleTopics,
} from './access';
import {
  addTopicAi,
  addTopicAiBodySchema,
  addTopicMember,
  archiveTopic,
  createTopicBodySchema,
  createTopic,
  listTopicMembers,
  patchTopic,
  patchTopicBodySchema,
  removeTopicAi,
  removeTopicMember,
} from './service';

export const TOPIC_CREATE_RATE_LIMIT_MAX = 30;
export const TOPIC_CREATE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export interface TopicsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: InviteLogger;
  audit?: AuditRecorder;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

const memberBodySchema = z.object({ userId: z.string().min(1) }).strict();

function serviceDeps(deps: TopicsRoutesDependencies) {
  return {
    db: deps.db,
    adminClient: deps.adminClient,
    domain: deps.config.xmpp.domain,
    logger: deps.logger,
    ...(deps.audit === undefined ? {} : { audit: deps.audit }),
  };
}

export function createTopicsRoutes(deps: TopicsRoutesDependencies): Hono {
  const routes = new Hono();
  const mucDomain = deps.config.xmpp.mucDomain;
  const createLimiter = createRateLimiter({
    max: TOPIC_CREATE_RATE_LIMIT_MAX,
    windowMs: TOPIC_CREATE_RATE_LIMIT_WINDOW_MS,
    now: deps.now ?? Date.now,
  });

  routes.get('/groups/:id/topics', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const groupId = c.req.param('id');
    const rows = await visibleTopics(deps.db, groupId, user.id);
    // A stranger (or a missing group) sees an empty list, never a 403/404
    // that would reveal the group exists. The group route itself already
    // answers 404 for non-members; this list only narrows to visible topics.
    return c.json({ topics: await toTopicViews(deps.db, rows, mucDomain) });
  });

  routes.post('/groups/:id/topics', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!createLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many topics, try again later');
    }
    const body = await c.req.json().catch(() => null);
    const parsed = createTopicBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const topic = await createTopic(serviceDeps(deps), {
      ...parsed.data,
      groupId: c.req.param('id'),
      actorId: user.id,
    });
    return c.json(await toTopicView(deps.db, topic, mucDomain), 201);
  });

  routes.get('/topics/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const topic = await requireVisibleTopic(deps.db, c.req.param('id'), user.id);
    return c.json(await toTopicView(deps.db, topic, mucDomain));
  });

  routes.patch('/topics/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = patchTopicBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const topic = await patchTopic(serviceDeps(deps), {
      ...parsed.data,
      topicId: c.req.param('id'),
      actorId: user.id,
    });
    return c.json(await toTopicView(deps.db, topic, mucDomain));
  });

  routes.post('/topics/:id/archive', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const topic = await archiveTopic(serviceDeps(deps), c.req.param('id'), user.id);
    return c.json(await toTopicView(deps.db, topic, mucDomain));
  });

  routes.get('/topics/:id/members', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    return c.json({
      members: await listTopicMembers(serviceDeps(deps), c.req.param('id'), user.id),
    });
  });

  routes.post('/topics/:id/members', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = memberBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const topic = await addTopicMember(
      serviceDeps(deps),
      c.req.param('id'),
      user.id,
      parsed.data.userId,
    );
    return c.json(await toTopicView(deps.db, topic, mucDomain));
  });

  routes.delete('/topics/:id/members/:userId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const topic = await removeTopicMember(
      serviceDeps(deps),
      c.req.param('id'),
      user.id,
      c.req.param('userId'),
    );
    // Removing the last private member archives the topic: it is no longer
    // visible, so answer like a deletion. The row (and its history) survives.
    if (topic.archivedAt !== null) {
      throw toMissingTopic();
    }
    return c.json(await toTopicView(deps.db, topic, mucDomain));
  });

  // T-0109: AIs in non-General topics. Adding needs the AI's owner (who must
  // see the topic); removing needs the owner or a topic manager. General
  // membership stays in `group_ais`, so both routes 400 there.
  routes.get('/topics/:id/ais', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const topic = await requireVisibleTopic(deps.db, c.req.param('id'), user.id);
    const ais = await listTopicAis(deps.db, topic.id);
    return c.json({ ais });
  });

  routes.post('/topics/:id/ais', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = addTopicAiBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const topic = await addTopicAi(serviceDeps(deps), {
      topicId: c.req.param('id'),
      actorId: user.id,
      aiId: parsed.data.aiId,
    });
    return c.json(await toTopicView(deps.db, topic, mucDomain));
  });

  routes.delete('/topics/:id/ais/:aiId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const topic = await removeTopicAi(
      serviceDeps(deps),
      c.req.param('id'),
      user.id,
      c.req.param('aiId'),
    );
    return c.json(await toTopicView(deps.db, topic, mucDomain));
  });

  return routes;
}
