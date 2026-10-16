// The server's lifecycle (T-0838, T-1316): the handles `startServer` fills and
// the steps that stop them. `main.ts` holds `serverProgram` and `startServer`;
// this file owns `stopServer`, `shutdownServer` and the `runMain` teardown, so
// the zero-downtime shutdown order lives in one place.
import { Cause, Effect, Exit, Fiber, Runtime } from 'effect';
import type { Logger } from 'pino';
import type { AgentGateway } from '../agents/gateway';
import type { ServerDatabase } from '../db/client';
import { disposeSqlRuntime } from '../effect/sql';
import { markDraining } from '../health-status';
import type { LeaderLock } from '../leader/lock';

// How long open connections (SSE streams) get before they are closed, and the
// point at which a stuck shutdown gives up and exits.
export const CONNECTION_GRACE_MS = 3_000;
export const FORCE_EXIT_MS = 15_000;

/**
 * The handles `stopServer` closes. `startServer` fills each field as soon as
 * the thing it names exists, so a stop that begins during startup closes
 * exactly what was started. The leader-only work lives behind `leader`; a
 * follower has nothing there to stop beyond releasing the lock.
 */
export interface RunningServer {
  logger: Logger | null;
  db: ServerDatabase | null;
  closeDb: (() => Promise<void>) | null;
  closeHttp: (() => Promise<void>) | null;
  gateway: Pick<AgentGateway, 'stop' | 'postToChat' | 'stopTurn' | 'runScheduledTurn'> | null;
  leader: Pick<LeaderLock, 'stepDown' | 'close'> | null;
  /** How long to keep serving (health 503) before stepping down. 0 in tests. */
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
 * Shuts the server down in the zero-downtime order (T-1316): mark draining so
 * `/health` answers 503, keep serving for `drainMs` so Traefik stops routing
 * here while in-flight requests finish, stop the leader-only work and release
 * the advisory lock (so the new instance takes over), then close HTTP, the SQL
 * runtime and the database, and finally the lock connection. A step that fails
 * ends the sequence, like the old sequential awaits.
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
    // The `effect/sql` runtime owns the database pool: dispose it. `closeDb`
    // is the no-op from `createDb`, kept so the shutdown path reads the same.
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

/**
 * The shutdown run by the scope finalizer: arms the force-exit (a stuck stop
 * logs `shutdown timed out; exiting` and exits 1), then runs `stopServer`.
 */
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

/**
 * Logs `shutting down` with the signal name, once, when the first SIGINT or
 * SIGTERM arrives. `NodeRuntime.runMain` does the interrupting but does not
 * say which signal it was; a second signal logs nothing more.
 */
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

/**
 * Exit codes for `runMain`: a stop that began with a signal ends with the main
 * fiber interrupted and nothing else, which is a clean stop (0). A failed
 * startup or a failed stop keeps the default code (1).
 */
export const serverTeardown: Runtime.Teardown = (exit, onExit) => {
  if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
    onExit(0);
    return;
  }
  Runtime.defaultTeardown(exit, onExit);
};
