// useAction: the one way a component runs a user action (T-0762, plan 3.6).
// A component has no `async`, `await`, `.then`, `try` or timer of its own; it
// hands useAction an Effect and renders the AsyncResult it gets back.
//
// Before (three pieces of state and a try/catch in the component):
//
//   const [busy, setBusy] = useState(false);
//   const [error, setError] = useState<string>();
//   const createLink = async (input: LinkInput) => {
//     setBusy(true); setError(undefined);
//     try { await createGroupInviteLink(groupId, input); }
//     catch { setError('Could not create the link.'); }
//     finally { setBusy(false); }
//   };
//
// After (no async code in the component):
//
//   const [state, createLink] = useAction((input: LinkInput) =>
//     Effect.tryPromise({
//       try: () => createGroupInviteLink(groupId, input),
//       catch: () => new LinkCreateFailed(),
//     }));
//   <button disabled={isWaiting(state)} onClick={() => createLink(input)}>
//   {failureOf(state) !== undefined && <p>{LINK_ERRORS[failureOf(state)._tag]}</p>}
//
// Rules the hook gives you:
// - `fn` may be an inline lambda: the latest one runs, the atom is not rebuilt.
// - mode 'ignore' (default) drops a `run` while one is waiting, so a double
//   click sends once. mode 'replace' interrupts the running call and starts
//   the new one.
// - Unmounting interrupts a running call (its finalizers run).
// - User-facing text comes from a fixed map of typed errors, never from the
//   failure's message (AGENTS.md).
import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import { Atom, AsyncResult } from 'effect/reactivity';
import { useCallback, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { webAtomRuntime } from '@/lib/effect/runtime';

export type ActionMode = 'ignore' | 'replace';

export interface UseActionOptions {
  /** What `run` does while a call is waiting. Default 'ignore'. */
  readonly mode?: ActionMode;
}

export interface ActionControls {
  /** Back to the initial state; a running call is interrupted. */
  readonly reset: () => void;
  /** Interrupts a running call; the state becomes an interrupted failure. */
  readonly interrupt: () => void;
}

/** The state of an action: initial, waiting, success or failure. */
export type ActionState<A, E> = AsyncResult.AsyncResult<A, E>;

/** True while a call is running (also during a retry after a success or failure). */
export const isWaiting = <A, E>(state: ActionState<A, E>): boolean => AsyncResult.isWaiting(state);

/**
 * The typed failure of the last call, or `undefined`. Defects and
 * interruptions are not typed failures, so they give `undefined`.
 */
export const failureOf = <A, E>(state: ActionState<A, E>): E | undefined => {
  const error = AsyncResult.error(state);
  return error._tag === 'Some' ? error.value : undefined;
};

/**
 * Runs `fn(input)` when `run(input)` is called and returns its AsyncResult.
 * `run` and `controls` keep their identity across renders. Needs no provider:
 * it uses the `RegistryContext` registry (the default one when none is set).
 */
export function useAction<I, A, E>(
  fn: (input: I) => Effect.Effect<A, E, HttpClient.HttpClient>,
  options?: UseActionOptions,
): readonly [state: ActionState<A, E>, run: (input: I) => void, controls: ActionControls] {
  const mode = options?.mode ?? 'ignore';
  const registry = useContext(RegistryContext);
  // The atom runs the Effect `run` hands it, so it never needs the latest `fn`.
  const atom = useMemo(
    () => webAtomRuntime.fn<Effect.Effect<A, E, HttpClient.HttpClient>>()((effect) => effect),
    [],
  );
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });

  // Unmounting drops the last subscriber, the registry disposes the node and
  // that interrupts a running call (its finalizers run).
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
}
