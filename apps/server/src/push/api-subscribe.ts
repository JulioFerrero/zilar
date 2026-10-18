// The push subscribe handler: a native `{ kind: 'fcm', token }` body stores
// the token in the clear (a delivery address, not a credential), while Web
// Push keys stay sealed. Step order is requirePush, decode, limiter; ids
// only reach the logs.

import { randomUUID } from 'node:crypto';
import { Effect, Option, Schema } from 'effect';
import { SubscribePushDevicePayload, isAllowedPushEndpoint } from '@zilar/api-contract';
import { currentSessionId } from '../auth/sessions';
import { errorClassName, isUniqueViolation } from '../effect/error-utils';
import { handler } from '../effect/http-core';
import { HttpError } from '../errors';
import type { RateLimiter } from '../rate-limit';
import { syncPushSubscriptionsForUser } from '../topics/rooms';
import { createPushCipher } from './crypto';
import { parseNode, randomNode } from './protocol';
import { saveDevice } from './store';
import type { PushApiDependencies } from './api';

export function createSubscribeHandler(
  deps: PushApiDependencies,
  subscribeLimiter: RateLimiter,
  requirePush: () => { storageKey: string },
) {
  const now = deps.now ?? Date.now;
  return handler(deps.logger, (request, user) =>
    Effect.gen(function* () {
      const { storageKey } = requirePush();
      const raw = yield* request.request.json.pipe(
        Effect.catchCause(() => Effect.succeed<unknown>(undefined)),
      );
      const decoded = Schema.decodeUnknownOption(SubscribePushDevicePayload)(raw);
      if (Option.isNone(decoded)) {
        // A Web Push endpoint outside the allowlist is a distinct 400: a
        // well-formed subscription to a host we refuse to call.
        const endpoint = endpointOf(raw);
        if (endpoint !== undefined && !isAllowedPushEndpoint(endpoint)) {
          throw new HttpError(400, 'invalid_request', 'The push endpoint is not allowed');
        }
        throw new HttpError(400, 'invalid_subscription', 'The push subscription is invalid');
      }
      if (!subscribeLimiter.allow(user.id)) {
        throw new HttpError(429, 'rate_limited', 'Too many push registrations, try again later');
      }
      const body = decoded.value;
      const sessionId = yield* Effect.promise(() =>
        currentSessionId(deps.auth, new Headers(request.request.headers)),
      );
      const cipher = createPushCipher(storageKey);
      const pushJid = deps.push.PUSH_COMPONENT_JID as string;
      // A replaced node leaves a stale enable-pair in ejabberd, but no admin
      // command targets a pair by node, so this only re-syncs the room
      // subscriptions; the old pair stops receiving because its device row is
      // gone. The browser normally sends `<disable/>` itself. Best effort: a
      // failure never fails the registration, logged with the user id only.
      const dropStalePushPairs = (staleNodes: string[]): Effect.Effect<void> =>
        Effect.promise(async () => {
          if (staleNodes.length === 0) {
            return;
          }
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
              { userId: user.id, staleNodes: staleNodes.length, err: errorClassName(error) },
              'push room re-sync failed after node replacement; the old node drops as unknown-device',
            );
          }
        });
      let node = randomNode();
      parseNode(node);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const outcome = yield* Effect.promise(() =>
          saveDevice(
            deps.db,
            cipher,
            'kind' in body
              ? {
                  id: randomUUID(),
                  userId: user.id,
                  node,
                  kind: 'fcm',
                  token: body.token,
                  userAgent: body.userAgent ?? null,
                  sessionId,
                  now: new Date(now()),
                }
              : {
                  id: randomUUID(),
                  userId: user.id,
                  node,
                  kind: 'webpush',
                  subscription: {
                    endpoint: body.endpoint,
                    keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
                    ...(body.expirationTime === undefined
                      ? {}
                      : { expirationTime: body.expirationTime }),
                  },
                  userAgent: body.userAgent ?? null,
                  sessionId,
                  now: new Date(now()),
                },
            {
              disablePushPair: (_userId, _node) => Effect.runPromise(dropStalePushPairs([_node])),
            },
          ),
        ).pipe(
          Effect.map((row) => ({ saved: true as const, row })),
          Effect.catchDefect((defect) => Effect.succeed({ saved: false as const, defect })),
        );
        if (!outcome.saved) {
          if (isUniqueViolation(outcome.defect)) {
            node = randomNode();
            continue;
          }
          return yield* Effect.die(outcome.defect);
        }
        const row = outcome.row;
        // The device is stored: subscribe the user to every room they may see so
        // MUC/Sub events reach them offline. Best effort: the sync's own reads can
        // throw after the row committed, so a failure logs ids only and answers
        // success (S2).
        yield* Effect.promise(() =>
          syncPushSubscriptionsForUser(
            {
              db: deps.db,
              adminClient: deps.adminClient,
              domain: deps.config.xmpp.domain,
              logger: deps.logger,
            },
            user.id,
          ),
        ).pipe(
          Effect.catchDefect((defect) =>
            Effect.sync(() => {
              deps.logger.warn(
                { userId: user.id, err: errorClassName(defect) },
                'push room sync failed after registration; membership changes re-sync later',
              );
            }),
          ),
        );
        return { id: row.id, node: row.node, jid: pushJid };
      }
      throw new HttpError(503, 'push_unavailable', 'Could not register the push device');
    }),
  );
}

function endpointOf(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null || !('endpoint' in raw)) {
    return undefined;
  }
  const endpoint = (raw as { endpoint?: unknown }).endpoint;
  return typeof endpoint === 'string' ? endpoint : undefined;
}
