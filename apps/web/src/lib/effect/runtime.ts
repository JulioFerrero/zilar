// The single web Effect runtime (guide: one runtime per process). Components
// keep calling api.ts; the functions that need Effect run through `runWeb`.
// Later tasks merge more services into `webLayer` rather than building a
// second runtime.
import { Effect, ManagedRuntime } from 'effect';
import { FetchHttpClient, type HttpClient } from 'effect/http';
import { Atom } from 'effect/reactivity';

export const webLayer = FetchHttpClient.layer;

export const webRuntime = ManagedRuntime.make(webLayer);

export const runWeb = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>): Promise<A> =>
  webRuntime.runPromise(effect);

// The atom runtime over `webLayer`. Atoms that need HTTP (or any service a
// later task adds to `webLayer`) are built from it: `useAction` and `useQuery`
// do, so a component never builds its own.
export const webAtomRuntime = Atom.runtime(webLayer);
