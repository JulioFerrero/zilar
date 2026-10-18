import { Cause, Effect, Exit, Fiber, Runtime } from 'effect';
import type { Logger } from 'pino';
import type { AgentGateway } from '../agents/gateway';
import type { ServerDatabase } from '../db/client';
import { disposeSqlRuntime } from '../effect/sql';
import { markDraining } from '../health-status';
import type { LeaderLock } from '../leader/lock';

// How long open connections (SSE streams) get before they are closed, and when a stuck
// shutdown gives up and exits.
export const CONNECTION_GRACE_MS = 3_000;
export const FORCE_EXIT_MS = 15_000;

/** `startServer` fills each field as soon as the thing it names exists, so a stop during
 * startup closes exactly what was started. */
export interface RunningServer {
  logger: Logger | null;
  db: ServerDatabase | null;
  closeDb: (() => Promise<void>) | null;
  closeHttp: (() => Promise<void>) | null;
  gateway: Pick<AgentGateway, 'stop' | 'postToChat' | 'stopTurn' | 'runScheduledTurn'> | null;
  leader: Pick<LeaderLock, 'stepDown' | 'close'> | null;
  drainMs: number;
}

export function emptyRunning(): RunningServer {
  return {
    logger: null,
    db: null,
    closeDb: null,
    closeHttp: null,
    gateway: null,
    leader: null,
    drainMs: 0,
  };
}

/**
 * The zero-downtime order: mark draining so `/health` answers 503, keep serving for
 * `drainMs` so Traefik stops routing here while requests finish, stop the leader-only work
 * and release the lock, then close HTTP, the SQL runtime and the database, and finally
 * the lock connection.
 */
export function stopServer(running: RunningServer): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { leader, closeHttp, db, closeDb } = running;
    markDraining();
    if (running.drainMs > 0) {
      yield* Effect.sleep(running.drainMs);
    }
    if (leader !== null) {
      yield* Effect.promise(() => leader.stepDown());
    }
    if (closeHttp !== null) {
      yield* Effect.promise(() => closeHttp());
    }
    // The `effect/sql` runtime owns the pool, so dispose it; `closeDb` is a no-op kept for
    // shape.
    if (db !== null) {
      yield* Effect.promise(() => disposeSqlRuntime(db));
    }
    if (closeDb !== null) {
      yield* Effect.promise(() => closeDb());
    }
    if (leader !== null) {
      yield* Effect.promise(() => leader.close());
    }
  });
}

/** Arms the force-exit (a stuck stop logs and exits 1), then runs `stopServer`. */
export function shutdownServer(
  running: RunningServer,
  forceExitMs: number = FORCE_EXIT_MS,
): Effect.Effect<void> {
  const forceExit = Effect.sleep(forceExitMs).pipe(
    Effect.andThen(
      Effect.sync(() => {
        running.logger?.error('shutdown timed out; exiting');
        return process.exit(1);
      }),
    ),
  );
  return Effect.gen(function* () {
    const timer = yield* Effect.forkDetach(forceExit, { startImmediately: true });
    yield* stopServer(running).pipe(Effect.ensuring(Fiber.interrupt(timer)));
  });
}

/** Logs `shutting down` with the signal name, once, when the first SIGINT or SIGTERM
 * arrives. */
export function logShutdownSignals(running: RunningServer): Effect.Effect<void> {
  return Effect.sync(() => {
    let logged = false;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        if (logged) {
          return;
        }
        logged = true;
        running.logger?.info({ signal }, 'shutting down');
      });
    }
  });
}

/** A stop that began with a signal ends with the main fiber interrupted and no other
 * failure, which is exit 0; a failed startup or stop keeps the default 1. */
export const serverTeardown: Runtime.Teardown = (exit, onExit) => {
  if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
    onExit(0);
    return;
  }
  Runtime.defaultTeardown(exit, onExit);
};
