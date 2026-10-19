// `serverProgram` registers ONE scope finalizer before startup begins: `runMain`
// interrupts on SIGINT/SIGTERM, the scope closes, and it runs `stopServer` under the force-exit.
import { Effect } from 'effect';
import { bootServer } from './startup/boot';
import { startComponents } from './startup/components';
import {
  emptyRunning,
  logShutdownSignals,
  shutdownServer,
  type RunningServer,
} from './startup/lifecycle';

export const serverProgram: Effect.Effect<never> = Effect.scoped(
  Effect.gen(function* () {
    const running = emptyRunning();
    yield* Effect.addFinalizer(() => shutdownServer(running));
    yield* logShutdownSignals(running);
    yield* startServer(running);
    return yield* Effect.never;
  }),
);

export function startServer(running: RunningServer): Effect.Effect<void> {
  return Effect.gen(function* () {
    const boot = yield* bootServer(running);
    yield* startComponents(boot, running);
  });
}
