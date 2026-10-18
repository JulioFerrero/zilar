import { Effect, type Fiber } from 'effect';
import { listActiveAisForGateway, onAiLifecycle, type ActiveAiForGateway } from '../../ais/service';
import { onGroupAi, onTopicAi } from '../../groups/events';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import {
  AI_DRAIN_MS,
  AI_DRAIN_POLL_MS,
  AI_RESTART_REPLY,
  attempt,
  cancelTimer,
  toRedactedError,
  type AgentGatewayConfig,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
} from './contracts';
import { loadActiveAi, loadAiOwnerId } from './db';

interface GatewayLifecycleContext {
  deps: AgentGatewayDeps;
  config: AgentGatewayConfig;
  logger: GatewayLogger;
  reconcileIntervalMs: number;
  secretsFor: (secret?: string) => string[];
  sessions: Map<string, AiSession>;
  superseded: Set<string>;
  connectAi: (record: ActiveAiForGateway) => Promise<void>;
  disconnectAi: (aiId: string) => Promise<void>;
  syncAiRooms: (session: AiSession, aiName: string) => Promise<void>;
  clearAllListeners: () => void;
}

export function createGatewayLifecycle(ctx: GatewayLifecycleContext) {
  const {
    deps,
    config,
    logger,
    reconcileIntervalMs,
    secretsFor,
    sessions,
    superseded,
    connectAi,
    disconnectAi,
    syncAiRooms,
    clearAllListeners,
  } = ctx;

  let started = false;
  let timer: Fiber.Fiber<void> | undefined;
  let unsubscribes: Array<() => void> = [];

  function isStarted(): boolean {
    return started;
  }

  const reconcileEffect = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    const active = yield* attempt(() => listActiveAisForGateway(deps.db)).pipe(
      Effect.catch((error: unknown) =>
        Effect.sync(() => {
          logger.warn({ err: toRedactedError(error, secretsFor()) }, 'AI reconcile failed');
          return null;
        }),
      ),
    );
    if (active === null) {
      return;
    }
    const wanted = new Set(active.map((ai) => ai.id));
    for (const ai of active) {
      yield* Effect.suspend(() => {
        const existing = sessions.get(ai.id);
        // Rooms drift without a reconnect: a missed group event, a failed
        // join, or a stale nick is picked up here at the latest.
        return existing === undefined
          ? attempt(() => connectAi(ai))
          : attempt(() => syncAiRooms(existing, ai.name));
      }).pipe(
        Effect.catch((error: unknown) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: ai.id },
              'AI reconcile connect failed',
            );
          }),
        ),
      );
    }
    for (const aiId of sessions.keys()) {
      if (!wanted.has(aiId)) {
        yield* attempt(() => disconnectAi(aiId)).pipe(
          Effect.catch((error: unknown) =>
            Effect.sync(() => {
              logger.warn(
                { err: toRedactedError(error, secretsFor()), aiId },
                'AI reconcile disconnect failed',
              );
            }),
          ),
        );
      }
    }
  });

  // Loads the active AI row and runs `next` on it when there is one. Fire and
  // forget: a failure is logged with `failureMessage` (the AI id only).
  function withActiveAi(
    aiId: string,
    next: (record: ActiveAiForGateway) => Effect.Effect<void, unknown>,
    failureMessage: string,
  ): void {
    Effect.runFork(
      attempt(() => loadActiveAi(deps.db, aiId)).pipe(
        Effect.flatMap((record) => (record === null ? Effect.void : next(record))),
        Effect.catch((error: unknown) =>
          Effect.sync(() => {
            logger.warn({ err: toRedactedError(error, secretsFor()), aiId }, failureMessage);
          }),
        ),
      ),
    );
  }

  const startEffect = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    if (started) {
      return;
    }
    if (!config.enabled) {
      logger.info({}, 'agent gateway is disabled');
      return;
    }
    if (deps.cipher === undefined) {
      logger.warn({}, 'agent gateway needs the key cipher; staying off');
      return;
    }
    started = true;
    superseded.clear();
    yield* reconcileEffect();
    unsubscribes.push(
      onAiLifecycle((event) => {
        if (!started) {
          return;
        }
        if (event.type === 'created' || event.type === 'resumed') {
          // `loadActiveAi` uses the same `WHERE status = 'active'` filter as
          // reconcile: a `stopped` or `disabled` row never wakes the gateway.
          withActiveAi(
            event.aiId,
            (record) => attempt(() => connectAi(record)),
            event.type === 'created'
              ? 'AI post-create connect failed'
              : 'AI post-resume connect failed',
          );
        } else {
          // `stopped` and `deleted` both go through `disconnectAi`: the
          // session is removed from the map, `session.stopped` is set so
          // every send path skips, and queued turns are dropped with the
          // session. For `stopped` the periodic safety net never reconnects
          // (the row is no longer in `listActiveAisForGateway`); a delete
          // tears the row down on its own.
          Effect.runFork(
            attempt(() => disconnectAi(event.aiId)).pipe(
              Effect.catch((error: unknown) =>
                Effect.sync(() => {
                  logger.warn(
                    { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
                    event.type === 'stopped'
                      ? 'AI post-stop disconnect failed'
                      : 'AI post-delete disconnect failed',
                  );
                }),
              ),
            ),
          );
        }
      }),
      onGroupAi((event) => {
        if (!started) {
          return;
        }
        // A join or leave for a live session syncs right away; anything
        // missed (an AI with no session yet) is picked up by `reconcile`.
        // Only ids travel on the event.
        const session = sessions.get(event.aiId);
        if (session === undefined) {
          return;
        }
        syncRoomsOnEvent(event.aiId, session);
      }),
      // The sibling event for per-topic AI membership: a newly added or
      // removed membership syncs right away instead of waiting for reconcile.
      onTopicAi((event) => {
        if (!started) {
          return;
        }
        const session = sessions.get(event.aiId);
        if (session === undefined) {
          return;
        }
        syncRoomsOnEvent(event.aiId, session);
      }),
    );
    timer = Effect.runFork(
      Effect.sleep(reconcileIntervalMs).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (started) {
              Effect.runFork(reconcileEffect());
            }
          }),
        ),
        Effect.forever,
      ),
    );
  });

  // A join or leave for a live session: re-reads the AI and syncs its rooms
  // while the same session is still the one in the map.
  function syncRoomsOnEvent(aiId: string, session: AiSession): void {
    withActiveAi(
      aiId,
      (record) =>
        sessions.get(aiId) === session
          ? attempt(() => syncAiRooms(session, record.name))
          : Effect.void,
      'AI room sync failed',
    );
  }

  // How many turns are in flight: one per busy DM (`session.busy`) plus one
  // per busy room (`session.roomBusy`).
  function runningTurns(): number {
    let count = 0;
    for (const session of sessions.values()) {
      if (session.busy) {
        count += 1;
      }
      count += session.roomBusy.size;
    }
    return count;
  }

  // Tells one AI's owner, through the session that is still connected, that its
  // in-flight DM reply was lost. A missing row sends nothing.
  async function sendRestartToOwner(session: AiSession): Promise<void> {
    const ownerId = await loadAiOwnerId(deps.db, session.aiId);
    if (ownerId === null) {
      return;
    }
    await session.core.sendMessage(
      jidFor(localpartFor(ownerId), deps.xmpp.domain),
      'chat',
      AI_RESTART_REPLY,
    );
  }

  // The drain runs before it disconnects anyone: poll until no turn is in
  // flight or `AI_DRAIN_MS` passes, then notify each one through the session
  // that is still connected. A session with a leftover turn is marked `stopped`
  // first, so its late send is skipped instead of racing the notice.
  const drainEffect = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    const deadline = Date.now() + AI_DRAIN_MS;
    while (runningTurns() > 0 && Date.now() < deadline) {
      yield* Effect.sleep(AI_DRAIN_POLL_MS);
    }
    const remaining = runningTurns();
    logger.info({ turns: remaining }, 'AI drain finished');
    if (remaining === 0) {
      return;
    }
    for (const session of sessions.values()) {
      const busyDm = session.busy;
      const busyRooms = [...session.roomBusy];
      if (!busyDm && busyRooms.length === 0) {
        continue;
      }
      session.stopped = true;
      if (busyDm) {
        yield* attempt(() => sendRestartToOwner(session)).pipe(Effect.ignore);
      }
      for (const roomJid of busyRooms) {
        yield* attempt(() => session.core.sendMessage(roomJid, 'groupchat', AI_RESTART_REPLY)).pipe(
          Effect.ignore,
        );
      }
    }
  });

  const stopEffect = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    started = false;
    superseded.clear();
    cancelTimer(timer);
    timer = undefined;
    // Unsubscribing is best-effort during shutdown.
    yield* Effect.forEach(unsubscribes, (unsub) =>
      Effect.try({ try: unsub, catch: (error) => error }).pipe(Effect.ignore),
    );
    unsubscribes = [];
    // Wait for the turns in flight before tearing the sessions down, so a reply
    // the model already produced is still delivered.
    yield* drainEffect();
    for (const aiId of sessions.keys()) {
      // Shutdown disconnects everyone; one failure stops nothing else.
      yield* attempt(() => disconnectAi(aiId)).pipe(Effect.ignore);
    }
    clearAllListeners();
  });

  const start = (): Promise<void> => Effect.runPromise(startEffect());
  const stop = (): Promise<void> => Effect.runPromise(stopEffect());
  const reconcile = (): Promise<void> => Effect.runPromise(reconcileEffect());

  return { start, stop, reconcile, isStarted };
}
