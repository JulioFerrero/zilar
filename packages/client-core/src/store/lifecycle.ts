import { Effect, Exit, Fiber, Schema } from 'effect';
import type { MediaTokenShape } from '@zilar/chat-core';
import type { XmppCore } from '@zilar/xmpp-core';
import { connectXmpp } from './connect';
import { fromPromise, setConnectionStatus, type StoreAppHooks } from './ctx';
import { flushPending, type HistoryCtx } from './history';
import { flushOnline, wakeAndResend } from './online';
import type { KeyValue } from './ports';
import { LAST_READ_PREFIX } from './reads';
import type { Fibers } from './lifetime';
import {
  clearFinishedTurns,
  startChatsPolling,
  startDraftStream,
  startPinsPolling,
  type DraftTurns,
} from './polling';

/** Parks the XMPP session when the app leaves the foreground; a core without
 * `suspend` stays as it is. Best effort and silent: the next resume reconnects. */
export const suspendStore = (ctx: { core: XmppCore | undefined }): Effect.Effect<void, unknown> =>
  Effect.suspend(() => {
    const current = ctx.core;
    const suspend = current?.suspend;
    if (current === undefined || suspend === undefined) {
      return Effect.void;
    }
    return fromPromise(() => suspend()).pipe(
      Effect.asVoid,
      Effect.catchCause(() => Effect.void),
    );
  });

// Reads the last-read map a user's storage saved; anything unusable reads as none.
const parseJson = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

export const readLastRead = (
  storage: KeyValue | null,
  userId: string,
): Effect.Effect<Record<string, string>> => {
  const none: Record<string, string> = {};
  if (storage === null) {
    return Effect.succeed(none);
  }
  return Effect.try(() => storage.getItem(`${LAST_READ_PREFIX}${userId}`)).pipe(
    Effect.map((raw) => {
      if (raw === null) {
        return none;
      }
      const parsed = parseJson(raw);
      if (Exit.isFailure(parsed)) {
        return none;
      }
      const value = parsed.value;
      if (value === null || typeof value !== 'object') {
        return none;
      }
      const result: Record<string, string> = {};
      for (const [chatId, messageId] of Object.entries(value)) {
        if (typeof messageId === 'string') {
          result[chatId] = messageId;
        }
      }
      return result;
    }),
    Effect.orElseSucceed(() => none),
  );
};

/** The boot in flight: a resume waits for it. */
export interface LifecycleBoot {
  readonly session: Fibers<never>;
  fiber: Fiber.Fiber<unknown, never> | undefined;
}

export interface LifecycleCtx extends HistoryCtx, DraftTurns {
  readonly fx: StoreAppHooks;
  /** True from `start()` until `stop()`: a second `start()` is a no-op. */
  started: boolean;
  cachedUserId: string | undefined;
  connectRetryAttempt: number;
  connectRetryPending: boolean;
  mediaToken: MediaTokenShape | undefined;
  boot: LifecycleBoot | undefined;
}

export const startStore = (ctx: LifecycleCtx): Effect.Effect<void> =>
  Effect.sync(() => {
    if (ctx.started) {
      return;
    }
    ctx.started = true;
    const session = ctx.rt.beginSession();
    ctx.fx.prepareStart();
    beginBoot(ctx, session);
  });

export const retryBoot = (ctx: LifecycleCtx): Effect.Effect<void> =>
  Effect.sync(() => {
    ctx.connectRetryPending = false;
    const session = ctx.rt.beginSession();
    ctx.fx.setChatsLoad('loading');
    beginBoot(ctx, session);
  });

// Forks the boot and clears `ctx.boot` when it settles, so a later resume can reconnect
// instead of booting twice. The record is set before the fork: a boot that settles
// synchronously must not leave a stale record.
const beginBoot = (ctx: LifecycleCtx, session: Fibers<never>): void => {
  const record: LifecycleBoot = { session, fiber: undefined };
  ctx.boot = record;
  record.fiber = session.fork(
    boot(ctx, session).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (ctx.boot === record) {
            ctx.boot = undefined;
          }
        }),
      ),
    ),
  );
};

/** Closes the store Scope: every fiber, listener and the connection go. The message ledger
 * stays; `reset()` clears it. */
export const stopStore = (ctx: LifecycleCtx): Effect.Effect<void> =>
  Effect.sync(() => {
    ctx.started = false;
    ctx.boot = undefined;
    clearFinishedTurns(ctx);
    ctx.set({ drafts: {}, finishedDraftMessages: {} });
    ctx.pendingOpenChatId = undefined;
    ctx.rt.closeStore();
    ctx.connectRetryAttempt = 0;
    ctx.connectRetryPending = false;
    ctx.groupsJoined = false;
    ctx.joinedRooms?.clear();
    ctx.mediaToken = undefined;
    ctx.fx.applyStop();
  });

/** Clears the message ledger and the per-session state; mobile calls it from sign-out
 * after `stop()`, web in its own signOutStore adapter. */
export function reset(ctx: LifecycleCtx): void {
  ctx.pendingOutgoing.clear();
  ctx.outbox?.clear();
  for (const chatId of Object.keys(ctx.cursors)) {
    delete ctx.cursors[chatId];
  }
  ctx.lastRead = {};
  clearFinishedTurns(ctx);
  ctx.set({
    messagesByChat: {},
    edits: {},
    reactions: {},
    typing: {},
    drafts: {},
    finishedDraftMessages: {},
    historyComplete: {},
  });
}

/**
 * A resume from the background, behind `flags.reconnectOnResume` (mobile only): wait for
 * the boot in flight, reconnect a dropped core, or boot when there is none.
 */
export const reconnect = (ctx: LifecycleCtx): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (!ctx.ports.flags.reconnectOnResume || !ctx.started) {
      return Effect.void;
    }
    const pending = ctx.boot;
    if (pending !== undefined && pending.fiber !== undefined) {
      return Fiber.await(pending.fiber).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (ctx.core === undefined && ctx.started && ctx.rt.session() === pending.session) {
              return retryBoot(ctx);
            }
            return Effect.void;
          }),
        ),
      );
    }
    const current = ctx.core;
    if (current === undefined) {
      return retryBoot(ctx);
    }
    // A resume from the background: wake the suspended core instead of trusting a stale
    // `online` status. A `rebound` (a new session) rejoins the groups below.
    return wakeAndResend(ctx, current).pipe(
      Effect.andThen((outcome) =>
        Effect.gen(function* () {
          setConnectionStatus(ctx, 'online');
          flushOnline(ctx);
          const me = ctx.get().me;
          // A resumed stream kept the room occupancy and its queued stanzas, so only a
          // fresh session (or a core without wake) rejoins.
          if (outcome !== 'resumed' && me !== undefined && me !== null) {
            yield* fromPromise(() =>
              ctx.fx.joinGroups(current, me, {
                first: ctx.pendingOpenChatId,
                onJoined: (chatId) => {
                  ctx.joinedRooms?.add(chatId);
                  flushPending(ctx);
                },
              }),
            ).pipe(Effect.ignore);
          }
          ctx.groupsJoined = true;
          flushPending(ctx);
          // Catch up the messages missed while suspended here.
        }),
      ),
      Effect.catchCause(() => Effect.sync(() => setConnectionStatus(ctx, 'offline'))),
    );
  });

const boot = (ctx: LifecycleCtx, session: Fibers<never>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { api, storage } = ctx.ports;
    const tokenFiber = yield* Effect.exit(fromPromise(() => api.getXmppToken())).pipe(
      Effect.forkIn(session.scope, { startImmediately: true }),
    );
    const prefs = Effect.suspend(() => {
      const list = api.listChatPrefs;
      return list === undefined
        ? Effect.succeed([] as readonly unknown[])
        : fromPromise(() => list()).pipe(
            Effect.catchCause(() => Effect.succeed([] as readonly unknown[])),
          );
    });
    const loaded = yield* Effect.exit(
      Effect.all(
        [
          fromPromise(() => api.getMe()),
          fromPromise(() => api.getChats()),
          fromPromise(() => api.getContacts()),
          prefs,
        ],
        { concurrency: 'unbounded' },
      ),
    );
    if (Exit.isFailure(loaded)) {
      yield* Fiber.interrupt(tokenFiber);
      setConnectionStatus(ctx, 'offline');
      ctx.fx.setChatsLoad('error');
      return;
    }
    const [me, entries, contacts, prefRows] = loaded.value;

    ctx.lastReadUserId = me.id;
    ctx.lastRead = yield* readLastRead(storage, me.id);
    ctx.fx.rememberGroupIds(entries);
    const freshRows = entries.flatMap((entry) => ctx.ports.rows.summariesFor(entry));
    ctx.fx.applyBoot({
      me,
      freshRows,
      previousChats: ctx.get().chats,
      sameUser: ctx.cachedUserId === me.id,
      contacts,
      prefs: prefRows,
    });
    // The global background default is a nice-to-have; load it without holding up the
    // chat list, and leave it null on failure.
    yield* Effect.sync(() => ctx.fx.refreshDefaultBackground());
    // The app's chat folders load beside the rest of the boot; web has no store folders
    // and leaves the hook unset.
    yield* Effect.sync(() => ctx.fx.loadFolders?.());
    yield* startDraftStream(ctx, session);
    yield* startChatsPolling(ctx, session);
    yield* startPinsPolling(ctx, session);
    flushPending(ctx);
    yield* connectXmpp(ctx, session, me, Fiber.join(tokenFiber));
  });
