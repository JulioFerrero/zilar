// Server Effect runtime conventions:
//
// - One runtime per process, created at the edge (index.ts) from the app layer
//   and disposed on shutdown. `makeServerRuntime` owns that wiring.
// - Modules export Effects, or plain Promise functions built through a runtime
//   they are handed. `Effect.runPromise`/`runFork` belong at the edge, not in
//   domain code.
// - Tests build their own runtime from test layers (see runtime.test.ts); they
//   never reuse the process runtime.
//
// `ServerLayer` is the fully-provided layer the runtime is built from: it may
// require nothing, but it produces the services every Effect in the server can
// ask for.
import { Effect, type Fiber, Layer, ManagedRuntime } from 'effect';

export type ServerLayer<R = never, ER = never> = Layer.Layer<R, ER, never>;

// One memo map shared by every runtime built here, following
// docs/effect-reference/examples/10_managed-runtime.ts.txt:60-69. Memoization
// across runtimes is what keeps a single instance of a resource in a process.
const serverMemoMap = Layer.makeMemoMapUnsafe();

export interface ServerRuntime<R, ER> {
  readonly runtime: ManagedRuntime.ManagedRuntime<R, ER>;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E | ER>;
  readonly dispose: () => Promise<void>;
}

export function makeServerRuntime<R, ER>(layer: ServerLayer<R, ER>): ServerRuntime<R, ER> {
  const runtime = ManagedRuntime.make(layer, { memoMap: serverMemoMap });

  return {
    runtime,
    runPromise: (effect) => runtime.runPromise(effect),
    runFork: (effect) => runtime.runFork(effect),
    dispose: () => runtime.dispose(),
  };
}
