import { randomUUID } from 'node:crypto';
import type { ServerCore } from '../app/deps';
import { Effect, Option, Schema } from 'effect';
import { HttpApiBuilder, type HttpApi } from 'effect/http-api';
import {
  PushGroup,
  PushSettingsPayload,
  SubscribePushDevicePayload,
  isAllowedPushEndpoint,
} from '@zilar/api-contract';
import { currentSessionId } from '../auth/sessions';
import { errorClassName, isUniqueViolation } from '../effect/error-utils';
import { handler } from '../effect/http-core';
import { HttpError, xmppUnavailable } from '../errors';
import { unreadForChats, type UnreadScope } from '../chats/unread';
import { cardEditTarget, isLiveAiUiRow } from '../notify/ai-cards';
import type { RateLimiter } from '../rate-limit';
import { cachedAllowedArchives } from './archives-cache';
import { syncPushSubscriptionsForUser } from '../topics/rooms';
import { readCandidateByOriginId, type ArchiveCandidate } from './archive-scan';
import { loadEditsForTargets } from '../search/edit-overlay';
import { resolveCandidate } from './candidates';
import { createPushCipher } from './crypto';
import type { FcmSender } from './fcm';
import { createNativeSender } from './native-sender';
import { buildPushPayload } from './payload';
import { parseNode, randomNode } from './protocol';
import {
  devicesForUser,
  removeDevice,
  saveDevice,
  setShowPreviewsForUser,
  showPreviewsForUser,
  toPushDeviceView,
} from './store';
import { STRICT_DECODE, TEST_WAKE_CHAT_ID, createRequirePush } from './api-util';
import { createTestHandler } from './api-test';
import type { PushApiDependencies } from './api';

import { markDeliveredAndNotify } from '../chats/delivered-notice';

import type { EjabberdAdminClient } from '../xmpp/admin/types';

import type { ArchivePool } from '../search/service';

// The push preview proves the message reached the device, so the handler
// forks the delivered mark off the HTTP path. The chat id is the same `bare`
// PUT /chats/:jid/delivered stores: the DM author's bare JID or the room JID.

/** The push deps one forked mark needs; a subset of `PushApiDependencies`. */
interface PreviewDeliveredDeps extends Pick<ServerCore, 'db' | 'config' | 'logger'> {
  archive?: ArchivePool;
  adminClient?: EjabberdAdminClient;
}

/** Stores the caller's delivered mark off the HTTP path with
 * `Effect.runFork`, so the preview never waits; every failure is swallowed
 * with a warn of ids only. The message id is the archive origin id. */
function forkPreviewDelivered(
  deps: PreviewDeliveredDeps,
  input: { chatJid: string; userId: string; messageId: string },
): void {
  Effect.runFork(
    Effect.tryPromise({
      try: () =>
        markDeliveredAndNotify(
          {
            db: deps.db,
            config: deps.config,
            archive: deps.archive,
            logger: deps.logger,
            ...(deps.adminClient === undefined ? {} : { adminClient: deps.adminClient }),
          },
          { bare: input.chatJid, userId: input.userId, originIds: [input.messageId] },
        ),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          deps.logger.warn(
            { userId: input.userId, chatJid: input.chatJid, err: errorClassName(error) },
            'push preview delivered mark failed',
          );
        }),
      ),
    ),
  );
}
// The push subscribe handler: a native `{ kind: 'fcm', token }` body stores
// the token in the clear (a delivery address, not a credential), while Web
// Push keys stay sealed. Step order is requirePush, decode, limiter; ids
// only reach the logs.
function createSubscribeHandler(
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
        yield* syncRoomsBestEffort(deps, user.id, 'after registration');
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

function syncRoomsBestEffort(
  deps: PushApiDependencies,
  userId: string,
  reason: string,
): Effect.Effect<void> {
  return Effect.promise(() =>
    syncPushSubscriptionsForUser(
      {
        db: deps.db,
        adminClient: deps.adminClient,
        domain: deps.config.xmpp.domain,
        logger: deps.logger,
      },
      userId,
    ),
  ).pipe(
    Effect.catchDefect((defect) =>
      Effect.sync(() => {
        deps.logger.warn(
          { userId, err: errorClassName(defect) },
          `push room sync failed ${reason}; membership changes re-sync later`,
        );
      }),
    ),
  );
}

export { TEST_WAKE_CHAT_ID } from './api-util';

export function createPushGroupLayer(
  api: HttpApi.HttpApi<'push', typeof PushGroup>,
  deps: PushApiDependencies,
  limiters: {
    subscribe: RateLimiter;
    settings: RateLimiter;
    test: RateLimiter;
    preview: RateLimiter;
  },
) {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const requirePush = createRequirePush(deps);
  // The native sender for the test route, built once from the push config.
  // Injected in tests.
  const nativeSender: FcmSender | undefined =
    deps.nativeSender ?? createNativeSender(deps.push, logger);

  return HttpApiBuilder.group(api, 'push', (handlers) =>
    handlers
      .handle(
        'config',
        handler(logger, () =>
          Effect.sync(() => {
            requirePush();
            return {
              vapidPublicKey: deps.push.PUSH_VAPID_PUBLIC_KEY as string,
              pushJid: deps.push.PUSH_COMPONENT_JID as string,
            };
          }),
        ),
      )
      .handleRaw('subscribe', createSubscribeHandler(deps, limiters.subscribe, requirePush))
      .handle(
        'list',
        handler(logger, (_request, user) =>
          Effect.gen(function* () {
            requirePush();
            const current = new Date(now());
            const devices = yield* Effect.promise(() => devicesForUser(deps.db, user.id));
            // The list carries labels and dates only, never the endpoint URL or keys.
            return { devices: devices.map((row) => toPushDeviceView(row, current)) };
          }),
        ),
      )
      .handle(
        'remove',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            requirePush();
            // Device add and remove share the registration window: both are cheap
            // writes, and an uncapped remove would let a client churn the room
            // subscriptions.
            if (!limiters.subscribe.allow(user.id)) {
              throw new HttpError(
                429,
                'rate_limited',
                'Too many push registrations, try again later',
              );
            }
            // Scoped delete: an unknown id and another user's device answer the same
            // 404, so device ids cannot be probed.
            const removed = yield* Effect.promise(() =>
              removeDevice(deps.db, user.id, request.params.id),
            );
            if (!removed) {
              throw new HttpError(404, 'not_found', 'Push device not found');
            }
            // No devices left: drop the MUC/Sub room subscriptions too, so ejabberd
            // stops publishing. Best effort after the committed delete.
            const remaining = yield* Effect.promise(() => devicesForUser(deps.db, user.id));
            if (remaining.length === 0) {
              yield* syncRoomsBestEffort(deps, user.id, 'after device removal');
            }
            return { removed: true };
          }),
        ),
      )
      .handle(
        'settings',
        handler(logger, (_request, user) =>
          Effect.gen(function* () {
            requirePush();
            return {
              showPreviews: yield* Effect.promise(() => showPreviewsForUser(deps.db, user.id)),
            };
          }),
        ),
      )
      .handle(
        'preview',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            if (!limiters.preview.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many preview lookups, try again later');
            }
            const archive = deps.archive;
            if (archive === undefined) {
              throw xmppUnavailable();
            }
            const userId = user.id;
            // A failed archive read is a defect (`orDie`) so the error envelope renders
            // it.
            const allowed = yield* Effect.tryPromise({
              try: () => cachedAllowedArchives(deps.db, deps.config, userId),
              catch: () => xmppUnavailable(),
            }).pipe(Effect.orDie);
            const row = yield* Effect.tryPromise({
              try: () => readCandidateByOriginId(archive, allowed, request.query.messageId),
              catch: () => xmppUnavailable(),
            }).pipe(Effect.orDie);
            // An unknown id and an invisible message both match no row; muted and hidden
            // rows answer the same 404, so the route reveals nothing.
            if (row === undefined) {
              throw new HttpError(404, 'not_found', 'Notification not found');
            }
            // A retracted message answers 404; a correction replaces the text with the
            // newest body.
            const editTarget = cardEditTarget(row.xml);
            const overlay = yield* Effect.tryPromise({
              try: () =>
                loadEditsForTargets(
                  archive,
                  { kind: 'all', owners: allowed },
                  editTarget === null ? [row.originId] : [row.originId, editTarget],
                ),
              catch: () => xmppUnavailable(),
            }).pipe(Effect.orDie);
            const ownEdit = overlay.get(row.originId);
            if (ownEdit?.retracted === true) {
              throw new HttpError(404, 'not_found', 'Notification not found');
            }
            // The live AI UI is not a message: skip the card and edits of one.
            const liveIds = new Set<string>();
            if (editTarget !== null) {
              const targetEdit = overlay.get(editTarget);
              // A retracted target hides its edits too; another sender's edit has no
              // accepted entry.
              if (targetEdit === undefined || targetEdit.retracted) {
                throw new HttpError(404, 'not_found', 'Notification not found');
              }
              if (
                targetEdit.latestText !== undefined &&
                targetEdit.latestText !== (row.text ?? '')
              ) {
                throw new HttpError(404, 'not_found', 'Notification not found');
              }
              const targetRow: ArchiveCandidate | undefined = yield* Effect.tryPromise({
                try: () => readCandidateByOriginId(archive, allowed, editTarget),
                catch: () => xmppUnavailable(),
              }).pipe(Effect.orDie);
              if (targetRow !== undefined && isLiveAiUiRow(targetRow.xml, targetRow.barePeer)) {
                liveIds.add(editTarget);
              }
            }
            const candidate =
              ownEdit?.latestText === undefined ? row : { ...row, text: ownEdit.latestText };
            const verdict = yield* Effect.promise(() =>
              resolveCandidate(
                { db: deps.db, config: deps.config, now: () => new Date(now()) },
                userId,
                allowed,
                candidate,
                liveIds,
              ),
            );
            if (verdict.status !== 'ok') {
              throw new HttpError(404, 'not_found', 'Notification not found');
            }
            // The preview proves this device received the message, so mark it delivered;
            // off the HTTP path and error-swallowed. Only an `ok` verdict marks: unknown,
            // invisible, muted and test wakes mark nothing.
            if (verdict.message.chatJid !== TEST_WAKE_CHAT_ID) {
              forkPreviewDelivered(deps, {
                chatJid: verdict.message.chatJid,
                userId,
                messageId: request.query.messageId,
              });
            }
            const showPreviews = yield* Effect.promise(() => showPreviewsForUser(deps.db, userId));
            const payload = buildPushPayload(verdict.message, {
              muted: false,
              visible: true,
              showPreviews,
            });
            if (payload === undefined) {
              throw new HttpError(404, 'not_found', 'Notification not found');
            }
            // The chat's unread count for the badge; a failed read only omits the field.
            const scope: UnreadScope =
              verdict.message.chatKind === 'dm'
                ? { kind: 'dm', peer: verdict.message.chatJid.toLowerCase() }
                : { kind: 'room', room: verdict.message.chatJid.toLowerCase() };
            const unread = yield* Effect.promise(() =>
              unreadForChats(
                deps.db,
                deps.config,
                archive,
                userId,
                new Map([[verdict.message.chatJid, scope]]),
              )
                .then((counts) => counts[verdict.message.chatJid]?.unread)
                .catch(() => undefined),
            );
            // Ids only: the derived text is returned, never logged.
            return {
              title: payload.title,
              body: payload.body,
              chatId: verdict.message.chatJid,
              // The archive id, so Mark as read can store this row's mark.
              archiveId: String(row.timestamp),
              // Absent when the count is 0 or the read failed.
              ...(unread !== undefined && unread >= 1 ? { unread } : {}),
            };
          }),
        ),
      )
      .handleRaw(
        'updateSettings',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            requirePush();
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(null)),
            );
            const decoded = Schema.decodeUnknownOption(PushSettingsPayload, STRICT_DECODE)(raw);
            if (Option.isNone(decoded)) {
              throw new HttpError(400, 'invalid_request', 'showPreviews must be a boolean');
            }
            if (!limiters.settings.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many setting changes, try again later');
            }
            const showPreviews = yield* Effect.promise(() =>
              setShowPreviewsForUser(deps.db, user.id, decoded.value.showPreviews, new Date(now())),
            );
            return { showPreviews };
          }),
        ),
      )
      .handleRaw('test', createTestHandler(deps, limiters.test, nativeSender, now, logger)),
  );
}
