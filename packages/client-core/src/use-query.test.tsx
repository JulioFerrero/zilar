import { RegistryContext } from '@effect/atom-react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Data, Deferred, Effect } from 'effect';
import { AsyncResult, AtomRegistry } from 'effect/reactivity';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { FetchHttpClient } from 'effect/http';
import { Atom } from 'effect/reactivity';
import { failureOf, isWaiting } from './use-action';
import { makeUseQuery } from './use-query';

const useQuery = makeUseQuery(Atom.runtime(FetchHttpClient.layer));

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

const registryWrapper = () => {
  const registry = AtomRegistry.make();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
  );
  return wrapper;
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
