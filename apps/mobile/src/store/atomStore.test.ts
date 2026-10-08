// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, useEffect, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createAtomStore, createBoundStore } from './atomStore';

// `react-dom/client` ships no bundled types and mobile has no `@types/react-dom`,
// so load it through a typed require handle rather than an untyped import.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

type CounterState = {
  count: number;
  label: string;
  double: () => void;
};

function makeStore() {
  return createAtomStore<CounterState>((set, get) => ({
    count: 0,
    label: 'start',
    double: () => {
      set({ count: get().count + 1 });
      set({ label: `count:${get().count}` });
    },
  }));
}

describe('createAtomStore', () => {
  it('merges a partial set and keeps the other fields', () => {
    const store = makeStore();
    store.setState({ count: 3 });
    expect(store.getState().count).toBe(3);
    expect(store.getState().label).toBe('start');
    expect(store.registry.get(store.atom)).toBe(store.getState());
  });

  it('accepts an updater set', () => {
    const store = makeStore();
    store.setState((state) => ({ count: state.count + 2 }));
    expect(store.getState().count).toBe(2);
  });

  it('replaces the whole state when replace is true', () => {
    type ReplaceState = { a: number; b?: string };
    const store = createAtomStore<ReplaceState>(() => ({ a: 1, b: 'keep' }));
    store.setState({ a: 2 }, true);
    expect(store.getState()).toEqual({ a: 2 });
  });

  it('does not notify listeners when the state is unchanged', () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState((state) => state);
    expect(listener).not.toHaveBeenCalled();
  });

  it('calls listeners with the next and previous state', () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const previous = store.getState();
    store.setState({ count: 7 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(store.getState(), previous);
    expect(store.getState()).not.toBe(previous);
    expect(store.getState().count).toBe(7);
  });

  it('stops notifying after unsubscribe', () => {
    const store = makeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setState({ count: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('exposes the initial state', () => {
    const store = makeStore();
    store.setState({ count: 5 });
    expect(store.getInitialState().count).toBe(0);
    expect(store.getState().count).toBe(5);
  });

  it('lets an action see the last set through get', () => {
    const store = makeStore();
    store.getState().double();
    expect(store.getState().count).toBe(1);
    expect(store.getState().label).toBe('count:1');
  });
});

describe('createBoundStore', () => {
  it('attaches the store api to the callable hook', () => {
    const useStore = createBoundStore<CounterState>(() => ({
      count: 1,
      label: 'start',
      double: () => {},
    }));
    expect(useStore.getState().count).toBe(1);
    expect(useStore.getInitialState().count).toBe(1);
    const listener = vi.fn();
    const unsubscribe = useStore.subscribe(listener);
    useStore.setState({ count: 2 });
    expect(useStore.getState().count).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('re-renders only when the selected value changes', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const useStore = createBoundStore<CounterState>((set) => ({
      count: 0,
      label: 'start',
      double: () => set((state) => ({ count: state.count + 1 })),
    }));

    let commits = 0;
    function Probe() {
      const count = useStore((state) => state.count);
      // A commit effect only runs when React actually re-renders, so the
      // count stays put while the selected value is unchanged.
      useEffect(() => {
        commits += 1;
      });
      return createElement('span', null, String(count));
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(commits).toBe(1);

    await act(async () => {
      useStore.setState({ label: 'changed' });
    });
    expect(commits).toBe(1);

    await act(async () => {
      useStore.setState({ count: 1 });
    });
    expect(commits).toBe(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
