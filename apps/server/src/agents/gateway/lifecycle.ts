import { Effect, type Fiber } from 'effect';
import { listActiveAisForGateway, onAiLifecycle, type ActiveAiForGateway } from '../../ais/service';
import { onGroupAi, onTopicAi } from '../../groups/events';
import {
  attempt,
  cancelTimer,
  toRedactedError,
  type AgentGatewayConfig,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
} from './contracts';
import { loadActiveAi } from './db';

// T-0562 (plan §3, G9): the gateway lifecycle extracted from
// `createAgentGateway`. The factory owns `started`, the reconcile timer and
// the event unsubscribes, and returns the same `start`, `stop` and
// `reconcile` the gateway exposes, plus `isStarted` for the session
// lifecycle's lazy guard. A pure move: no logic or wording changed.
interface GatewayLifecycleContext {
  deps: AgentGatewayDeps;
  config: AgentGatewayConfig;
  logger: GatewayLogger;
  reconcileIntervalMs: number;
  secretsFor: (virtualKey?: string) => string[];
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
  // The periodic reconcile: a fiber that sleeps and ticks, forever.
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
    if (deps.litellm === undefined || deps.cipher === undefined) {
      logger.warn({}, 'agent gateway needs LiteLLM and the key cipher; staying off');
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
          // `loadActiveAi` is the same `WHERE status = 'active'` filter the
          // periodic reconcile uses (T-0080): a `stopped` or `disabled` row
          // never wakes the gateway back up, even on the notifier path.
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
      // T-0109: the sibling event for per-topic AI membership. A newly added
      // or removed membership shows up without waiting for the next full
      // reconcile, through the same right-away sync as the group event.
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
