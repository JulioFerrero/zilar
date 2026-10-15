// The server's startup and shutdown as Effect programs (T-0838). `index.ts`
// runs `serverProgram` with `NodeRuntime.runMain`; nothing else imports this
// file except its test.
//
// `startServer` builds the shared objects, starts the HTTP listener, then
// wires the leader lock (T-1316): the leader-only work lives in
// `leader/start.ts` and runs only on the instance that holds the Postgres
// advisory lock. `stopServer` follows the zero-downtime order below (drain,
// step down the leader, close HTTP, then the SQL runtime and the lock).
//
// `serverProgram` holds ONE scope finalizer, registered before startup begins:
// `runMain` interrupts the main fiber on SIGINT/SIGTERM, the scope closes, and
// the finalizer runs `stopServer` under the force-exit.
//
// The steps live in `startup/`: `lifecycle.ts` (the handles and shutdown),
// `boot.ts` (fail-fast setup) and `components.ts` (auth, gateways, listen).
import { Effect } from 'effect';
import { bootServer } from './startup/boot';
import { startComponents } from './startup/components';
import {
  emptyRunning,
  logShutdownSignals,
  shutdownServer,
  type RunningServer,
} from './startup/lifecycle';

// `index.ts` and `main.test.ts` import these names from here; the
// implementation lives in `startup/lifecycle.ts`.
export {
  CONNECTION_GRACE_MS,
  FORCE_EXIT_MS,
  emptyRunning,
  stopServer,
  shutdownServer,
  serverTeardown,
} from './startup/lifecycle';
export type { RunningServer } from './startup/lifecycle';

/**
 * The whole server as one program: start, then run until interrupted. Closing
 * its scope (a signal, or a failed startup) runs the shutdown finalizer.
 */
export const serverProgram: Effect.Effect<never> = Effect.scoped(
  Effect.gen(function* () {
    const running = emptyRunning();
    yield* Effect.addFinalizer(() => shutdownServer(running));
    yield* logShutdownSignals(running);
    yield* startServer(running);
    return yield* Effect.never;
  }),
);

/**
 * Builds and starts the server: fail-fast setup, database, migrations,
 * storage checks, components, the HTTP listener, then the work that must
 * never block the API (runner hub, agent gateway, timers, routine scheduler).
 * Resolves once everything is started.
 */
export function startServer(running: RunningServer): Effect.Effect<void> {
  return Effect.gen(function* () {
    const boot = yield* bootServer(running);
    yield* startComponents(boot, running);
  });
}
