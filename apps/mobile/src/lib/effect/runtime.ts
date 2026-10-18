// One runtime per process, as the guide says: `*-api.ts` keeps its Promise signatures, and Effect code runs through `runMobile`.
import { Effect, ManagedRuntime } from 'effect';
import { FetchHttpClient, type HttpClient } from 'effect/http';
import { Atom } from 'effect/reactivity';

export const mobileLayer = FetchHttpClient.layer;

export const mobileRuntime = ManagedRuntime.make(mobileLayer);

export const runMobile = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>): Promise<A> =>
  mobileRuntime.runPromise(effect);

// The atom runtime over `mobileLayer`, so a component never builds its own.
export const mobileAtomRuntime = Atom.runtime(mobileLayer);
