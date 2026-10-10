import { useSyncExternalStore } from 'react';
import { Atom, AtomRegistry } from 'effect/reactivity';

export type SetState<T> = (
  partial: T | Partial<T> | ((state: T) => T | Partial<T>),
  replace?: boolean,
) => void;

export type StoreApi<T> = {
  getState: () => T;
  getInitialState: () => T;
  setState: SetState<T>;
  subscribe: (listener: (state: T, prevState: T) => void) => () => void;
  atom: Atom.Writable<T>;
  registry: AtomRegistry.AtomRegistry;
};

// A store whose whole state lives in one registry atom. The actions still see
// a synchronous `set` / `get`, and `subscribe` keeps the `(state, prevState)`
// contract and its skip-on-unchanged rule.
export function createAtomStore<T>(
  initializer: (setState: SetState<T>, getState: () => T, api: StoreApi<T>) => T,
  providedRegistry?: AtomRegistry.AtomRegistry,
): StoreApi<T> {
  const registry = providedRegistry ?? AtomRegistry.make();
  const listeners = new Set<(state: T, prevState: T) => void>();

  let state: T;
  let initialState: T;

  const getState = (): T => state;
  const getInitialState = (): T => initialState;
  const subscribe = (listener: (state: T, prevState: T) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  // Reading through the closure (instead of a captured value) keeps the atom
  // correct even if its registry node is disposed while no React reader holds
  // it. Writing updates the closure and the node in one step.
  const atom = Atom.writable<T, T>(
    () => state,
    (ctx, next) => {
      state = next;
      ctx.setSelf(next);
    },
  );

  const setState: SetState<T> = (partial, replace) => {
    const prevState = state;
    const partialState =
      typeof partial === 'function'
        ? (partial as (state: T) => T | Partial<T>)(prevState)
        : partial;
    if (Object.is(partialState, prevState)) {
      return;
    }
    const nextState =
      (replace ?? (typeof partialState !== 'object' || partialState === null))
        ? (partialState as T)
        : (Object.assign({}, prevState, partialState) as T);
    registry.set(atom, nextState);
    listeners.forEach((listener) => listener(nextState, prevState));
  };

  const api: StoreApi<T> = { getState, getInitialState, setState, subscribe, atom, registry };

  initialState = initializer(setState, getState, api);
  state = initialState;

  return api;
}

/**
 * Reads `selector(state)` from a store and re-renders only when `Object.is` on
 * the result changes (zustand v5's `useStore`). `useSyncExternalStore` also
 * avoids a per-render derived atom for an inline selector.
 */
export function useStoreSelector<T, U>(store: StoreApi<T>, selector: (state: T) => U): U {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getInitialState()),
  );
}

// The zustand `UseBoundStore` shape: a callable hook `(selector) => selected`
// plus the store api attached to the function.
export type UseBoundStore<T> = {
  (): T;
  <U>(selector: (state: T) => U): U;
} & StoreApi<T>;

export function createBoundStore<T>(
  initializer: (setState: SetState<T>, getState: () => T, api: StoreApi<T>) => T,
): UseBoundStore<T> {
  const store = createAtomStore(initializer);
  const bound = ((selector?: (state: T) => unknown): unknown =>
    useStoreSelector(store, selector ?? ((state: T) => state))) as UseBoundStore<T>;
  return Object.assign(bound, store);
}
