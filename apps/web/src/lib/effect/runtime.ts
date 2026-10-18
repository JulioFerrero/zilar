// The single web Effect runtime; components keep calling api.ts, and functions that need
// Effect run through runWeb.
import { Effect, ManagedRuntime } from 'effect';
import { FetchHttpClient, type HttpClient } from 'effect/http';
import { Atom } from 'effect/reactivity';

export const webLayer = FetchHttpClient.layer;

export const webRuntime = ManagedRuntime.make(webLayer);

export const runWeb = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>): Promise<A> =>
  webRuntime.runPromise(effect);

export const webAtomRuntime = Atom.runtime(webLayer);
