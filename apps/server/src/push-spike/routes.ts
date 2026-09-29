import { Hono } from 'hono';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import { HttpError } from '../errors';
import { nodeForUser, parseNode } from './protocol';
import type { PushSpikeConfig } from './spike-config';
import { WebPushSubscriptionSchema, type SubscriptionStore } from './subscriptions';

export interface PushSpikeRoutesDependencies {
  auth: Auth;
  config: PushSpikeConfig;
  store: SubscriptionStore;
}

// Spike-only routes, mounted only when PUSH_SPIKE_ENABLED=true (see
// app.ts). POST /api/push-spike/subscribe stores the browser's Web Push
// subscription (validated with zod) keyed by the user's push node; the
// response carries the enable stanza data the browser sends over its own
// XMPP session, because ejabberd requires the enable IQ to come from the
// user's session — there is no admin API for it.
export function createPushSpikeRoutes({ auth, config, store }: PushSpikeRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get('/push-spike/config', async (c) => {
    await requireSession(auth, c.req.raw.headers);
    if (!config.PUSH_SPIKE_ENABLED) {
      throw new HttpError(404, 'not_found', 'Not found');
    }
    if (config.PUSH_VAPID_PUBLIC_KEY === undefined) {
      throw new HttpError(503, 'push_spike_unavailable', 'Push spike is not configured');
    }
    return c.json({ vapidPublicKey: config.PUSH_VAPID_PUBLIC_KEY });
  });

  routes.post('/push-spike/subscribe', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    if (!config.PUSH_SPIKE_ENABLED) {
      throw new HttpError(404, 'not_found', 'Not found');
    }
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = WebPushSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_subscription', 'The push subscription is invalid');
    }
    if (config.PUSH_COMPONENT_JID === undefined) {
      throw new HttpError(503, 'push_spike_unavailable', 'Push spike is not configured');
    }
    const node = nodeForUser(user.id);
    parseNode(node);
    store.save({
      userId: user.id,
      node,
      subscription: parsed.data,
      createdAt: new Date(),
    });
    return c.json({
      jid: config.PUSH_COMPONENT_JID,
      node,
      vapidPublicKey: config.PUSH_VAPID_PUBLIC_KEY ?? null,
    });
  });

  routes.post('/push-spike/unsubscribe', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    if (!config.PUSH_SPIKE_ENABLED) {
      throw new HttpError(404, 'not_found', 'Not found');
    }
    const removed = store.removeByUser(user.id);
    return c.json({ removed });
  });

  return routes;
}
