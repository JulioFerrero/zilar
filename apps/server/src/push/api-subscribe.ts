// The push subscribe handler, split out of `./api` by T-1017 (size split).
// Moved unchanged: the device's push keys are still sealed and stored the same
// way, and the route keeps its exact step order (requirePush, then decode,
// then limiter) and its retry-on-node-collision loop.

import { randomUUID } from 'node:crypto';
import { Effect, Option, Schema } from 'effect';
import { RegisterPushDevicePayload } from '@zilar/api-contract';
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
      const decoded = Schema.decodeUnknownOption(RegisterPushDevicePayload)(raw);
      if (Option.isNone(decoded)) {
        throw new HttpError(400, 'invalid_subscription', 'The push subscription is invalid');
      }
      if (!subscribeLimiter.allow(user.id)) {
        throw new HttpError(429, 'rate_limited', 'Too many push registrations, try again later');
      }
      const body = decoded.value;
      const cipher = createPushCipher(storageKey);
      const pushJid = deps.push.PUSH_COMPONENT_JID as string;
      // A replaced node leaves a stale enable-pair behind in ejabberd
      // (XEP-0357 session state). No admin command targets a push pair
      // by node, so this only re-syncs the user's room subscriptions.
      // What actually stops delivery to the old pair is that its device
      // row is gone: the push component drops publishes for an unknown
      // node. The browser's own session normally sends `<disable/>` for
      // the old pair itself. Best effort: a failure never fails the
      // registration (no endpoint or key in the logs — user id only).
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
        // A rejection surfaces as a defect, which `yield*` does not
        // throw into the surrounding `try`; map it to a value so the
        // unique-violation retry below can inspect it.
        const outcome = yield* Effect.promise(() =>
          saveDevice(
            deps.db,
            cipher,
            {
              id: randomUUID(),
              userId: user.id,
              node,
              subscription: {
                endpoint: body.endpoint,
                keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
                ...(body.expirationTime === undefined
                  ? {}
                  : { expirationTime: body.expirationTime }),
              },
              userAgent: body.userAgent ?? null,
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
        // The device is stored: subscribe the user to every room they
        // may see so MUC/Sub events reach them while offline. Best
        // effort — a room failure never fails the registration
        // (membership changes re-sync later). The sync's own DB reads
        // can throw after the row committed, so a failure here must
        // not 500 an operation that already succeeded: log ids only
        // and answer success (S2).
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
