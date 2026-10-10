// useQuery: a read a component shows, built once per `deps` (T-0762, plan 3.6).
//
//   const [chats, refresh] = useQuery(() => listChats(userId), [userId]);
//   // chats is an AsyncResult; `refresh()` runs it again.
//
// - It starts when the component mounts and again when `deps` change.
// - A deps change, a refresh or an unmount interrupts the run in flight
//   (its finalizers run), so a slow old answer never replaces a new one.
// - `make` is read once per `deps`, like a `useMemo` factory: list every value
//   it uses in `deps`.
import { useAtomRefresh, useAtomValue } from '@effect/atom-react';
import type { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import type { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import type { ActionRuntime } from './use-action';

const sameDeps = (a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/** Runs `make()` for the current `deps` and returns its AsyncResult and a refresh. */
export const makeUseQuery = (runtime: ActionRuntime) =>
  function useQuery<A, E>(
    make: () => Effect.Effect<A, E, HttpClient.HttpClient>,
    deps: ReadonlyArray<unknown>,
  ): readonly [state: AsyncResult.AsyncResult<A, E>, refresh: () => void] {
    // A `useMemo` over the caller's `deps` cannot be checked statically, so the
    // atom is kept with the deps it was built for and rebuilt when they differ
    // (React re-renders at once). The old atom loses its subscriber, which
    // interrupts its run.
    const [built, setBuilt] = useState(() => ({ deps, atom: runtime.atom(make()) }));
    let current = built;
    if (!sameDeps(built.deps, deps)) {
      current = { deps, atom: runtime.atom(make()) };
      setBuilt(current);
    }
    return [useAtomValue(current.atom), useAtomRefresh(current.atom)];
  };
