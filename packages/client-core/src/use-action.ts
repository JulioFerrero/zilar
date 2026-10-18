// useAction: the one way a component runs a user action: it hands an Effect in and
// renders the AsyncResult. `fn` may be an inline lambda (the latest runs), mode 'ignore'
// drops a run while one waits, 'replace' interrupts it, and unmounting interrupts a
// running call. User-facing text comes from a fixed map of typed errors, never the
// failure's message.
import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import { Atom, AsyncResult } from 'effect/reactivity';
import { useCallback, useContext, useLayoutEffect, useMemo, useRef } from 'react';

export type ActionRuntime = Atom.AtomRuntime<HttpClient.HttpClient, never>;

export type ActionMode = 'ignore' | 'replace';

export interface UseActionOptions {
  readonly mode?: ActionMode;
}

export interface ActionControls {
  readonly reset: () => void;
  readonly interrupt: () => void;
}

export type ActionState<A, E> = AsyncResult.AsyncResult<A, E>;

export const isWaiting = <A, E>(state: ActionState<A, E>): boolean => AsyncResult.isWaiting(state);

/** The typed failure of the last call, or `undefined`: defects and interruptions are
 * not typed failures. */
export const failureOf = <A, E>(state: ActionState<A, E>): E | undefined => {
  const error = AsyncResult.error(state);
  return error._tag === 'Some' ? error.value : undefined;
};

export const shownFailure = <A, E>(state: ActionState<A, E>): E | undefined => {
  return isWaiting(state) ? undefined : failureOf(state);
};

/**
 * Runs `fn(input)` when `run(input)` is called and returns its AsyncResult. `run` and
 * `controls` keep their identity across renders, and no provider is needed.
 */
export const makeUseAction = (runtime: ActionRuntime) =>
  function useAction<I, A, E>(
    fn: (input: I) => Effect.Effect<A, E, HttpClient.HttpClient>,
    options?: UseActionOptions,
  ): readonly [state: ActionState<A, E>, run: (input: I) => void, controls: ActionControls] {
    const mode = options?.mode ?? 'ignore';
    const registry = useContext(RegistryContext);
    // The atom runs the Effect `run` hands it, so it never needs the latest `fn`.
    const atom = useMemo(
      () => runtime.fn<Effect.Effect<A, E, HttpClient.HttpClient>>()((effect) => effect),
      [],
    );
    const latest = useRef(fn);
    useLayoutEffect(() => {
      latest.current = fn;
    });

    // Unmounting drops the last subscriber, the registry disposes the node and that
    // interrupts a running call (its finalizers run).
    const state = useAtomValue(atom);

    const run = useCallback(
      (input: I) => {
        if (mode === 'ignore' && AsyncResult.isWaiting(registry.get(atom))) {
          return;
        }
        registry.set(atom, latest.current(input));
      },
      [registry, atom, latest, mode],
    );
    const controls = useMemo<ActionControls>(
      () => ({
        reset: () => registry.set(atom, Atom.Reset),
        interrupt: () => registry.set(atom, Atom.Interrupt),
      }),
      [registry, atom],
    );

    return [state, run, controls];
  };
