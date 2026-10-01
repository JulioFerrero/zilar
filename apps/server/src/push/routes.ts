import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { syncPushSubscriptionsForUser } from '../topics/rooms';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { createPushCipher } from './crypto';
import { pushConfigError, type PushConfig } from './config';
import { parseNode, randomNode } from './protocol';
import { createWebPushSender, isExpiredSubscription, type WebPushDelivery } from './sender';
import {
  devicesForUser,
  markDeviceFailed,
  markDeviceUsed,
  removeDevice,
  saveDevice,
  setShowPreviewsForUser,
  showPreviewsForUser,
  toPushDeviceView,
} from './store';
import { UserAgentSchema, WebPushSubscriptionSchema } from './subscriptions';

export const PUSH_SUBSCRIBE_RATE_LIMIT_MAX = 30;
export const PUSH_SUBSCRIBE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PUSH_SETTINGS_RATE_LIMIT_MAX = 60;
export const PUSH_SETTINGS_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PUSH_TEST_RATE_LIMIT_MAX = 5;
export const PUSH_TEST_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface PushRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Push env (kept separate from the server config so push stays optional). */
  push: PushConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  /** Injected in tests so the rate-limit windows can advance without waiting. */
  now?: () => number;
  /** Injected in tests so no real push relay is ever called. */
  sender?: WebPushDelivery;
}

const subscribeSchema = WebPushSubscriptionSchema.extend({
  userAgent: UserAgentSchema.nullable().optional(),
});

const showPreviewsSchema = z.object({ showPreviews: z.boolean() }).strict();

const testSchema = z.object({ subscriptionId: z.string().min(1).max(256) }).strict();

// Drizzle wraps driver failures, so the unique code (23505 on Postgres and
// PGlite) lives on a nested `cause`. Walk the chain.
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === '23505') {
      return true;
    }
    if (
      typeof record.message === 'string' &&
      (/duplicate key/i.test(record.message) || /UNIQUE constraint/i.test(record.message))
    ) {
      return true;
    }
    if (!('cause' in record)) {
      return false;
    }
    current = record.cause;
  }
  return false;
}

// Logs the error class only, never the message: a sync failure surfaces
// driver text that could echo query parameters.
function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

export function createPushRoutes(deps: PushRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const subscribeLimiter = createRateLimiter({
    max: PUSH_SUBSCRIBE_RATE_LIMIT_MAX,
    windowMs: PUSH_SUBSCRIBE_RATE_LIMIT_WINDOW_MS,
    now,
  });
  const settingsLimiter = createRateLimiter({
    max: PUSH_SETTINGS_RATE_LIMIT_MAX,
    windowMs: PUSH_SETTINGS_RATE_LIMIT_WINDOW_MS,
    now,
  });
  const testLimiter = createRateLimiter({
    max: PUSH_TEST_RATE_LIMIT_MAX,
    windowMs: PUSH_TEST_RATE_LIMIT_WINDOW_MS,
    now,
  });

  function requirePush(): { storageKey: string } {
    if (!deps.push.PUSH_ENABLED) {
      throw new HttpError(404, 'not_found', 'Not found');
    }
    const error = pushConfigError(deps.push);
    if (error !== null) {
      throw new HttpError(503, 'push_unavailable', 'Push notifications are not configured');
    }
    return { storageKey: deps.push.PUSH_STORAGE_KEY as string };
  }

  routes.get('/push/config', async (c) => {
    await requireSession(deps.auth, c.req.raw.headers);
    requirePush();
    return c.json({
      vapidPublicKey: deps.push.PUSH_VAPID_PUBLIC_KEY,
      pushJid: deps.push.PUSH_COMPONENT_JID,
    });
  });

  routes.post('/push/subscriptions', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const { storageKey } = requirePush();
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_subscription', 'The push subscription is invalid');
    }
    if (!subscribeLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many push registrations, try again later');
    }
    const cipher = createPushCipher(storageKey);
    const pushJid = deps.push.PUSH_COMPONENT_JID as string;
    let node = randomNode();
    parseNode(node);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const row = await saveDevice(deps.db, cipher, {
          id: randomUUID(),
          userId: user.id,
          node,
          subscription: parsed.data,
          userAgent: parsed.data.userAgent ?? null,
          now: new Date(now()),
        });
        // The device is stored: subscribe the user to every room they may
        // see so MUC/Sub events reach them while offline. Best effort — a
        // room failure never fails the registration (membership changes
        // re-sync later). The sync's own DB reads can throw after the row
        // committed, so a failure here must not 500 an operation that
        // already succeeded: log ids only and answer success (S2).
        try {
          await syncPushSubscriptionsForUser(
            {
              db: deps.db,
              adminClient: deps.adminClient,
              domain: deps.config.xmpp.domain,
              logger: deps.logger,
            },
            user.id,
          );
        } catch (error) {
          deps.logger.warn(
            { userId: user.id, err: errorName(error) },
            'push room sync failed after registration; membership changes re-sync later',
          );
        }
        return c.json({ id: row.id, node: row.node, jid: pushJid });
      } catch (error) {
        if (isUniqueViolation(error)) {
          node = randomNode();
          continue;
        }
        throw error;
      }
    }
    throw new HttpError(503, 'push_unavailable', 'Could not register the push device');
  });

  routes.get('/push/subscriptions', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    requirePush();
    const current = new Date(now());
    const devices = await devicesForUser(deps.db, user.id);
    // The list carries labels and dates only — never the endpoint URL or
    // the sealed keys.
    return c.json({ devices: devices.map((row) => toPushDeviceView(row, current)) });
  });

  routes.delete('/push/subscriptions/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    requirePush();
    // Device add and remove share the registration window: both are cheap
    // writes, and an uncapped remove would let a client churn the room
    // subscriptions below.
    if (!subscribeLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many push registrations, try again later');
    }
    // Scoped delete: an unknown id and another user's device answer the
    // same 404, so device ids cannot be probed.
    const removed = await removeDevice(deps.db, user.id, c.req.param('id'));
    if (!removed) {
      throw new HttpError(404, 'not_found', 'Push device not found');
    }
    // No devices left: drop the MUC/Sub room subscriptions too, so ejabberd
    // stops publishing for a user who cannot receive anything. Best effort
    // after the committed delete: a sync failure logs and still answers
    // success (S2).
    const remaining = await devicesForUser(deps.db, user.id);
    if (remaining.length === 0) {
      try {
        await syncPushSubscriptionsForUser(
          {
            db: deps.db,
            adminClient: deps.adminClient,
            domain: deps.config.xmpp.domain,
            logger: deps.logger,
          },
          user.id,
        );
      } catch (error) {
        deps.logger.warn(
          { userId: user.id, err: errorName(error) },
          'push room sync failed after device removal; membership changes re-sync later',
        );
      }
    }
    return c.json({ removed: true });
  });

  routes.get('/push/settings', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    requirePush();
    return c.json({ showPreviews: await showPreviewsForUser(deps.db, user.id) });
  });

  routes.put('/push/settings', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    requirePush();
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = showPreviewsSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'showPreviews must be a boolean');
    }
    if (!settingsLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many setting changes, try again later');
    }
    const showPreviews = await setShowPreviewsForUser(
      deps.db,
      user.id,
      parsed.data.showPreviews,
      new Date(now()),
    );
    return c.json({ showPreviews });
  });

  routes.post('/push/test', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const { storageKey } = requirePush();
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = testSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'subscriptionId is required');
    }
    if (!testLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many test notifications, try again later');
    }
    const devices = await devicesForUser(deps.db, user.id);
    const target = devices.find((row) => row.id === parsed.data.subscriptionId);
    if (target === undefined) {
      throw new HttpError(404, 'not_found', 'Push device not found');
    }
    const cipher = createPushCipher(storageKey);
    const sender =
      deps.sender ??
      createWebPushSender({
        PUSH_VAPID_PUBLIC_KEY: deps.push.PUSH_VAPID_PUBLIC_KEY as string,
        PUSH_VAPID_PRIVATE_KEY: deps.push.PUSH_VAPID_PRIVATE_KEY as string,
        PUSH_VAPID_SUBJECT: deps.push.PUSH_VAPID_SUBJECT as string,
      });
    let subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    try {
      subscription = {
        endpoint: target.endpoint,
        keys: { p256dh: cipher.decrypt(target.p256dh), auth: cipher.decrypt(target.auth) },
      };
    } catch {
      throw new HttpError(410, 'device_gone', 'The push device is no longer usable');
    }
    try {
      await sender.send(
        subscription,
        JSON.stringify({
          title: 'Galena',
          body: 'Push notifications work on this device.',
        }),
      );
      // A successful test proves receipt, so it counts for the 90-day
      // inactivity rule like a real notification (N1).
      await markDeviceUsed(deps.db, target.id, new Date(now()));
    } catch (error) {
      if (isExpiredSubscription(error)) {
        // Spec part 6: expired subscriptions are deleted. Scoped by id AND
        // userId like every other device delete, before answering 410.
        await removeDevice(deps.db, user.id, target.id);
        throw new HttpError(410, 'device_gone', 'The push device is no longer usable');
      }
      // Like the component path: a failed send stamps `failed_at`, so the
      // device list and the 90-day rule see the failure.
      await markDeviceFailed(deps.db, target.id, new Date(now()));
      throw new HttpError(502, 'push_failed', 'The test notification could not be sent');
    }
    return c.json({ sent: true });
  });

  return routes;
}
