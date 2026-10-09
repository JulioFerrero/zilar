// The single mobile Effect runtime (guide: one runtime per process), mirroring
// `apps/web/src/lib/effect/runtime.ts`. The *-api.ts modules keep their
// Promise signatures; code that needs Effect runs through `runMobile`. Later
// tasks merge more services into `mobileLayer` rather than building a second
// runtime.
import { Effect, ManagedRuntime } from 'effect';
import { FetchHttpClient, type HttpClient } from 'effect/http';
import { Atom } from 'effect/reactivity';

export const mobileLayer = FetchHttpClient.layer;

export const mobileRuntime = ManagedRuntime.make(mobileLayer);

export const runMobile = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>): Promise<A> =>
  mobileRuntime.runPromise(effect);

// The atom runtime over `mobileLayer`. Atoms that need HTTP (or any service a
// later task adds to `mobileLayer`) are built from it: `useAction` and
// `useQuery` do, so a component never builds its own.
export const mobileAtomRuntime = Atom.runtime(mobileLayer);
