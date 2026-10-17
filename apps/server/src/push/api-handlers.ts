// The push API handlers and their group layer, split out of `./api` by T-1017
// (size split). Moved unchanged: config, list, remove, settings and
// updateSettings keep their order, statuses and texts; the subscribe route is
// built in `./api-subscribe`, the test route in `./api-test`, and the shared
// helpers live in `./api-util`.

import { Effect, Option, Schema } from 'effect';
import { HttpApiBuilder, type HttpApi } from 'effect/http-api';
import { PushGroup, PushSettingsPayload } from '@zilar/api-contract';
import { errorClassName } from '../effect/error-utils';
import { handler } from '../effect/http-core';
import { HttpError, xmppUnavailable } from '../errors';
import { unreadForChats, type UnreadScope } from '../chats/unread';
import { cardEditTarget, isLiveAiUiRow } from '../notify/ai-cards';
import type { RateLimiter } from '../rate-limit';
import { cachedAllowedArchives } from './archives-cache';
import { syncPushSubscriptionsForUser } from '../topics/rooms';
import { readCandidateByOriginId } from './archive-scan';
import { resolveCandidate } from './candidates';
import type { FcmSender } from './fcm';
import { createNativeSender } from './native-sender';
import { buildPushPayload } from './payload';
import {
  devicesForUser,
  removeDevice,
  setShowPreviewsForUser,
  showPreviewsForUser,
  toPushDeviceView,
} from './store';
import { STRICT_DECODE, TEST_WAKE_CHAT_ID, createRequirePush } from './api-util';
import { createSubscribeHandler } from './api-subscribe';
import { createTestHandler } from './api-test';
import { forkPreviewDelivered } from './preview-delivered';
import type { PushApiDependencies } from './api';

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
  // The native sender for the test route: injected in tests, otherwise built
  // once here from the push config (undefined without the FCM config).
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
            // The list carries labels and dates only — never the endpoint URL
            // or the sealed keys.
            return { devices: devices.map((row) => toPushDeviceView(row, current)) };
          }),
        ),
      )
      .handle(
        'remove',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            requirePush();
            // Device add and remove share the registration window: both are
            // cheap writes, and an uncapped remove would let a client churn
            // the room subscriptions below.
            if (!limiters.subscribe.allow(user.id)) {
              throw new HttpError(
                429,
                'rate_limited',
                'Too many push registrations, try again later',
              );
            }
            // Scoped delete: an unknown id and another user's device answer
            // the same 404, so device ids cannot be probed.
            const removed = yield* Effect.promise(() =>
              removeDevice(deps.db, user.id, request.params.id),
            );
            if (!removed) {
              throw new HttpError(404, 'not_found', 'Push device not found');
            }
            // No devices left: drop the MUC/Sub room subscriptions too, so
            // ejabberd stops publishing for a user who cannot receive
            // anything. Best effort after the committed delete: a sync
            // failure logs and still answers success (S2).
            const remaining = yield* Effect.promise(() => devicesForUser(deps.db, user.id));
            if (remaining.length === 0) {
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
                      'push room sync failed after device removal; membership changes re-sync later',
                    );
                  }),
                ),
              );
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
            // A failed archive read is a defect (`orDie`) so the shared error
            // envelope renders it, exactly like the search route.
            const allowed = yield* Effect.tryPromise({
              try: () => cachedAllowedArchives(deps.db, deps.config, userId),
              catch: () => xmppUnavailable(),
            }).pipe(Effect.orDie);
            const row = yield* Effect.tryPromise({
              try: () => readCandidateByOriginId(archive, allowed, request.query.messageId),
              catch: () => xmppUnavailable(),
            }).pipe(Effect.orDie);
            // An unknown id and a message in a chat the caller may not see both
            // match no row; muted, hidden and skipped rows also answer the same
            // 404, so the route never reveals whether a message exists.
            if (row === undefined) {
              throw new HttpError(404, 'not_found', 'Notification not found');
            }
            // The live AI UI is not a message (T-1400): skip the card and an
            // edit of one, so an AI progress card's text is never previewed.
            const editTarget = cardEditTarget(row.xml);
            const liveIds = new Set<string>();
            if (editTarget !== null) {
              const targetRow = yield* Effect.tryPromise({
                try: () => readCandidateByOriginId(archive, allowed, editTarget),
                catch: () => xmppUnavailable(),
              }).pipe(Effect.orDie);
              if (targetRow !== undefined && isLiveAiUiRow(targetRow.xml)) liveIds.add(editTarget);
            }
            const verdict = yield* Effect.promise(() =>
              resolveCandidate(
                { db: deps.db, config: deps.config, now: () => new Date(now()) },
                userId,
                allowed,
                row,
                liveIds,
              ),
            );
            if (verdict.status !== 'ok') {
              throw new HttpError(404, 'not_found', 'Notification not found');
            }
            // The preview proves this device received the message, so mark it
            // delivered. Off the HTTP path and error-swallowed, so the answer
            // never waits on the mark and never fails with it. Only an `ok`
            // verdict marks: an unknown id, a message in a chat the caller may
            // not see, and a muted or hidden chat all answer 404 above and mark
            // nothing; the test wake marks nothing either.
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
            // T-1897: the chat's unread count, which the phone shows as the
            // badge of that chat's one notification. A failed read only omits
            // the field: the preview itself must still answer.
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
              // T-1893: the archive id, so a notification's Mark as read can
              // store this row's mark.
              archiveId: String(row.timestamp),
              // T-1897: absent when the count is 0 or the read failed.
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
