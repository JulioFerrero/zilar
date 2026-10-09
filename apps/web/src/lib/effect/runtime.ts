// The single web Effect runtime (guide: one runtime per process). Components
// keep calling api.ts; the functions that need Effect run through `runWeb`.
// Later tasks merge more services into `webLayer` rather than building a
// second runtime.
import { Effect, ManagedRuntime } from 'effect';
import { FetchHttpClient, type HttpClient } from 'effect/http';

export const webLayer = FetchHttpClient.layer;

export const webRuntime = ManagedRuntime.make(webLayer);

export const runWeb = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>): Promise<A> =>
  webRuntime.runPromise(effect);
