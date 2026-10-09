// @vitest-environment jsdom
import { RegistryContext } from '@effect/atom-react';
import { Data, Deferred, Effect } from 'effect';
import { AsyncResult, AtomRegistry } from 'effect/reactivity';
import { createRequire } from 'node:module';
import { act, createElement, type ComponentType, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { failureOf, isWaiting } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

// `react-dom/client` ships no bundled types and mobile has no `@types/react-dom`
// or testing library, so load it through a typed require handle and drive the
// hook with a small renderHook (same pattern as `store/atomStore.test.ts`).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

type Wrapper = ComponentType<{ children?: ReactNode }>;

const mounted: Array<() => void> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

function renderHook<P, R>(
  hook: (props: P) => R,
  options: { wrapper?: Wrapper; initialProps?: P } = {},
) {
  let latest: { value: R } | undefined;
  const Probe = ({ props }: { props: P }) => {
    latest = { value: hook(props) };
    return null;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let live = true;
  const draw = (props: P) => {
    const probe = createElement(Probe, { props });
    root.render(options.wrapper ? createElement(options.wrapper, null, probe) : probe);
  };
  const unmount = () => {
    if (!live) {
      return;
    }
    live = false;
    act(() => root.unmount());
    container.remove();
  };
  mounted.push(unmount);
  act(() => draw(options.initialProps as P));
  return {
    result: {
      get current(): R {
        if (latest === undefined) {
          throw new Error('The hook has not rendered');
        }
        return latest.value;
      },
    },
    rerender: (props: P) => act(() => draw(props)),
    unmount,
  };
}

const waitFor = async (check: () => void): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      check();
      return;
    } catch {
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      });
    }
  }
  check();
};

class LoadFailed extends Data.TaggedError('LoadFailed') {}

interface Probe {
  started: number;
  interrupted: number;
  finalized: number;
}

const makeProbe = (): Probe => ({ started: 0, interrupted: 0, finalized: 0 });

/** Counts starts, interruptions and finalizer runs; then runs `body`. */
const tracked = <A,>(probe: Probe, body: Effect.Effect<A>) =>
  Effect.gen(function* () {
    probe.started += 1;
    return yield* body;
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        probe.interrupted += 1;
      }),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        probe.finalized += 1;
      }),
    ),
  );

const registryWrapper = (): Wrapper => {
  const registry = AtomRegistry.make();
  return ({ children }) => createElement(RegistryContext.Provider, { value: registry }, children);
};

describe.each([
  ['inside a RegistryContext.Provider with a fresh registry', registryWrapper],
  ['with the default registry (no provider)', () => undefined],
])('useQuery %s', (_name, makeWrapper) => {
  it('runs on mount: waiting first, then the value', async () => {
    const gate = Deferred.makeUnsafe<string>();
    const probe = makeProbe();
    const { result } = renderHook(() => useQuery(() => tracked(probe, Deferred.await(gate)), []), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(probe.started).toBe(1));
    expect(isWaiting(result.current[0])).toBe(true);

    await act(async () => {
      Effect.runSync(Deferred.succeed(gate, 'loaded'));
      await Promise.resolve();
    });
    await waitFor(() => expect(AsyncResult.isSuccess(result.current[0])).toBe(true));
    const state = result.current[0];
    expect(AsyncResult.isSuccess(state) && state.value).toBe('loaded');
    expect(isWaiting(state)).toBe(false);
    expect(probe.started).toBe(1);
  });

  it('exposes a typed failure', async () => {
    const { result } = renderHook(() => useQuery(() => Effect.fail(new LoadFailed()), []), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(AsyncResult.isFailure(result.current[0])).toBe(true));
    expect(failureOf(result.current[0])).toBeInstanceOf(LoadFailed);
  });

  it('does not rerun when the component rerenders with the same deps', async () => {
    const probe = makeProbe();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useQuery(() => tracked(probe, Effect.succeed(id)), [id]),
      { wrapper: makeWrapper(), initialProps: { id: 'a' } },
    );
    await waitFor(() => expect(AsyncResult.isSuccess(result.current[0])).toBe(true));

    rerender({ id: 'a' });
    rerender({ id: 'a' });

    expect(probe.started).toBe(1);
  });

  it('refetches on a deps change and interrupts the previous run', async () => {
    const probe = makeProbe();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useQuery(() => tracked(probe, id === 'a' ? Effect.never : Effect.succeed(id)), [id]),
      { wrapper: makeWrapper(), initialProps: { id: 'a' } },
    );
    await waitFor(() => expect(probe.started).toBe(1));
    expect(probe.interrupted).toBe(0);

    rerender({ id: 'b' });

    await waitFor(() => expect(probe.interrupted).toBe(1));
    expect(probe.finalized).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(AsyncResult.isSuccess(result.current[0])).toBe(true));
    const state = result.current[0];
    expect(AsyncResult.isSuccess(state) && state.value).toBe('b');
    expect(probe.started).toBe(2);
  });

  it('refresh() runs the query again', async () => {
    let calls = 0;
    const { result } = renderHook(
      () =>
        useQuery(
          () =>
            Effect.sync(() => {
              calls += 1;
              return calls;
            }),
          [],
        ),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      const state = result.current[0];
      expect(AsyncResult.isSuccess(state) && state.value).toBe(1);
    });

    act(() => result.current[1]());

    await waitFor(() => {
      const state = result.current[0];
      expect(AsyncResult.isSuccess(state) && state.value).toBe(2);
    });
    expect(calls).toBe(2);
  });

  it('refresh() interrupts a run still in flight', async () => {
    const probe = makeProbe();
    const { result } = renderHook(() => useQuery(() => tracked(probe, Effect.never), []), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(probe.started).toBe(1));

    act(() => result.current[1]());

    await waitFor(() => expect(probe.started).toBe(2));
    expect(probe.interrupted).toBe(1);
  });

  it('interrupts the run on unmount: its finalizer runs', async () => {
    const probe = makeProbe();
    const { unmount } = renderHook(() => useQuery(() => tracked(probe, Effect.never), []), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(probe.started).toBe(1));
    expect(probe.finalized).toBe(0);

    unmount();

    await waitFor(() => expect(probe.interrupted).toBe(1));
    expect(probe.finalized).toBe(1);
  });
});
