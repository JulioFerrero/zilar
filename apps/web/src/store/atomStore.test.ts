import { describe, expect, it, vi } from 'vitest';
import { createAtomStore } from './atomStore';

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
