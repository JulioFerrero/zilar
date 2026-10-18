// useQuery: a read a component shows, built once per `deps`. It starts on mount and
// again when `deps` change; a deps change, a refresh or an unmount interrupts the run in
// flight, so a slow old answer never replaces a new one. `make` is read once per `deps`,
// like a `useMemo` factory: list every value it uses.
import { useAtomRefresh, useAtomValue } from '@effect/atom-react';
import type { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import type { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import type { ActionRuntime } from './use-action';

const sameDeps = (a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

export const makeUseQuery = (runtime: ActionRuntime) =>
  function useQuery<A, E>(
    make: () => Effect.Effect<A, E, HttpClient.HttpClient>,
    deps: ReadonlyArray<unknown>,
  ): readonly [state: AsyncResult.AsyncResult<A, E>, refresh: () => void] {
    // A `useMemo` over the caller's `deps` cannot be checked statically, so the atom is
    // kept with the deps it was built for and rebuilt when they differ; the old atom loses
    // its subscriber, which interrupts its run.
    const [built, setBuilt] = useState(() => ({ deps, atom: runtime.atom(make()) }));
    let current = built;
    if (!sameDeps(built.deps, deps)) {
      current = { deps, atom: runtime.atom(make()) };
      setBuilt(current);
    }
    return [useAtomValue(current.atom), useAtomRefresh(current.atom)];
  };
