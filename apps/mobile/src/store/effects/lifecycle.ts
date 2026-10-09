import { Effect, Fiber, Option, type Scope } from 'effect';
import type { XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';

import { applyChatPrefs } from '../../lib/chat-prefs';
import { trustedMediaHosts } from '../../lib/attachments';
import type { ConnectionStatus } from '../types';
import { Ports } from './ports';
import {
  detached,
  lift,
  onClose,
  orElse,
  recover,
  type StoreCtx,
  type StoreState,
} from './runtime';

export interface Lifecycle {
  start(): void;
  stop(): void;
  /** `reloadChats` while no core exists: ends the generation and boots again. */
  restartBoot(): void;
  /** A resume: reconnects a core that is not online, or waits for / starts the boot. */
  readonly reconnect: Effect.Effect<void, never, Ports>;
}

/**
 * Connect, background / resume and reconnect. The store lives in two scopes
 * (see `Life`): `start()` and `stop()` bound the session; a restart of the
 * boot (`reloadChats` before any core) ends the generation. Boot and
 * reconnect are fibers of the generation, so ending it interrupts them where
 * the old `generation` counter made them bail at their next check.
 */
export function makeLifecycle(ctx: StoreCtx): Lifecycle {
  const { ports, get, set, s, life, h, fx } = ctx;

  // The listeners on a core live as long as the session.
  function subscribeCore(current: XmppCore): void {
    const unsubscribers = [
      current.on('status', (status: ConnectionStatus) => {
        set({ status });
        if (status === 'online') {
          h.flushPending();
        }
      }),
      current.on('message', h.handleMessage),
      current.on('typing', h.handleTyping),
      current.on('displayed', h.handleDisplayed),
      current.on('occupants', h.handleOccupants),
      current.on('presence', h.handlePresence),
      current.on('invited', h.handleInvited),
      current.on('roster', h.handleRoster),
    ];
    onClose(life.session(), () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    });
  }

  // The token the core asks for: the one boot already fetched, once, then a
  // fresh one each time. The trusted media hosts follow the latest token.
  const tokenForCore = Effect.gen(function* () {
    const { api } = yield* Ports;
    if (s.firstToken !== undefined) {
      const fresh = s.firstToken;
      s.firstToken = undefined;
      return fresh;
    }
    const fresh = yield* lift(() => api.getXmppToken());
    s.mediaToken = { service: fresh.service, domain: fresh.domain };
    s.mediaTrustedHosts = trustedMediaHosts(s.mediaToken);
    set({ mediaTrustedHosts: s.mediaTrustedHosts });
    return { jid: fresh.jid, token: fresh.token };
  });

  const boot: Effect.Effect<void, never, Ports> = Effect.gen(function* () {
    const { api, now, createXmpp, ownedAis } = yield* Ports;
    // The five loads start together. Prefs and folders are their own fibers,
    // so a failing sibling does not cancel them (they never fail the boot).
    const loaded = yield* Effect.all(
      [
        lift(() => api.getMe()),
        lift(() => api.getChats()),
        lift(() => api.getContacts()),
        detached(fx.loadPrefRows),
        detached(fx.loadFolders),
      ],
      { concurrency: 'unbounded' },
    ).pipe(Effect.option);
    if (Option.isNone(loaded)) {
      set({ status: 'offline', chatsLoad: 'error' });
      return;
    }
    const [me, entries, contacts, prefs] = loaded.value;

    s.lastRead = {};
    h.rememberGroupIds(entries);
    s.chatPrefRows = prefs;
    set({
      me,
      currentUserId: me.id,
      chats: applyChatPrefs(
        entries.flatMap((entry) => h.summariesFor(entry)),
        prefs,
        now().getTime(),
      ),
      contacts,
      chatsLoad: 'loaded',
      ownedAis: ownedAis ?? get().ownedAis,
    });
    h.startDraftStream();
    h.flushPending();

    const fetched = yield* lift(() => api.getXmppToken()).pipe(Effect.option);
    if (Option.isNone(fetched)) {
      set({ status: 'offline' });
      return;
    }
    const token = fetched.value;
    s.firstToken = { jid: token.jid, token: token.token };
    // The trusted media hosts follow the XMPP token (web does the same):
    // the upload service answers on these hosts in dev and production.
    s.mediaToken = { service: token.service, domain: token.domain };
    s.mediaTrustedHosts = trustedMediaHosts(s.mediaToken);
    set({ mediaTrustedHosts: s.mediaTrustedHosts });

    const options: XmppCoreOptions = {
      service: token.service,
      domain: token.domain,
      getToken: () => ctx.run(tokenForCore),
    };

    const current = createXmpp(options);
    s.core = current;
    subscribeCore(current);
    const connected = yield* lift(() => current.connect()).pipe(Effect.option);
    if (Option.isNone(connected)) {
      set({ status: 'offline' });
      return;
    }
    set({ status: 'online' });
    h.flushPending();
    yield* fx.joinGroups(current, me);
    s.groupsJoined = true;
    h.flushPending();
    yield* Effect.all(
      get().chats.map((chat) => fx.loadPreview(current, chat)),
      { concurrency: 'unbounded' },
    );
    set((state) => ({ chats: h.sortByRecency(state.chats) }));
  });

  // One boot per generation: a second caller waits for it instead of starting
  // another, because two boots would create two cores and double every XMPP
  // subscription. A boot of an older generation was interrupted when that
  // generation ended, so a newer generation starts a fresh one.
  const runBoot = (scope: Scope.Scope): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      if (s.boot === undefined || s.boot.scope !== scope) {
        const record: NonNullable<StoreState['boot']> = { scope, fiber: undefined };
        record.fiber = ctx.fork(
          boot.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (s.boot === record) {
                  s.boot = undefined;
                }
              }),
            ),
          ),
          scope,
        );
        s.boot = record;
      }
      const running = s.boot.fiber;
      if (running !== undefined) {
        yield* Fiber.await(running);
      }
    });

  // A real device suspends the socket in the background, so on resume we must
  // not assume it is alive: reconnect whenever the status is not `online`.
  const reconnect: Effect.Effect<void, never, Ports> = Effect.gen(function* () {
    if (!s.started) {
      return;
    }
    if (s.boot !== undefined) {
      const scope = life.generation();
      const running = s.boot.fiber;
      if (running !== undefined) {
        yield* Fiber.await(running);
      }
      // The awaited boot failed before creating a core (offline token fetch):
      // try again for this generation instead of silently dropping the resume.
      if (s.core === undefined && s.started && scope === life.generation()) {
        yield* runBoot(scope);
      }
      return;
    }
    const current = s.core;
    if (current === undefined) {
      yield* runBoot(life.generation());
      return;
    }
    if (get().status === 'online') {
      return;
    }
    yield* recover(
      Effect.gen(function* () {
        yield* lift(() => current.connect());
        set({ status: 'online' });
        h.flushPending();
        const me = get().me;
        if (me !== undefined) {
          yield* fx.joinGroups(current, me);
          s.groupsJoined = true;
        }
        h.flushPending();
      }),
      () => Effect.sync(() => set({ status: 'offline' })),
    );
  });

  return {
    reconnect,
    restartBoot: () => {
      life.restartGeneration();
      ctx.fork(runBoot(life.generation()));
    },
    start: () => {
      if (s.started) {
        return;
      }
      s.started = true;
      life.restartGeneration();
      if (get().chats.length === 0) {
        set({ chatsLoad: 'loading' });
      }
      onClose(
        life.session(),
        ports.appState.subscribe((state) => {
          if (state !== 'active') {
            return;
          }
          ctx.fork(reconnect);
        }),
      );
      h.startTopicsPolling();
      ctx.fork(runBoot(life.generation()));
    },
    stop: () => {
      s.started = false;
      life.endSession();
      h.teardown();
      s.pendingOpenChatId = undefined;
      s.groupsJoined = false;
      s.mediaToken = undefined;
      s.mediaTrustedHosts = new Set();
      const current = s.core;
      s.core = undefined;
      if (current !== undefined) {
        Effect.runFork(
          orElse(
            lift(() => current.disconnect()),
            undefined,
          ),
        );
      }
      set({ status: 'offline', mediaTrustedHosts: undefined });
    },
  };
}
