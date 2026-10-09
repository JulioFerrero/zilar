import { RegistryContext } from '@effect/atom-react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Data, Deferred, Effect } from 'effect';
import { AsyncResult, AtomRegistry } from 'effect/reactivity';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';

class Boom extends Data.TaggedError('Boom')<{ readonly reason: string }> {}

interface Probe {
  started: number;
  interrupted: number;
  finalized: number;
}

const makeProbe = (): Probe => ({ started: 0, interrupted: 0, finalized: 0 });

/** Waits on `gate`; counts starts, interruptions and finalizer runs for real. */
const gated = (probe: Probe, gate: Deferred.Deferred<string>) =>
  Effect.gen(function* () {
    probe.started += 1;
    return yield* Deferred.await(gate);
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

const complete = (gate: Deferred.Deferred<string>, value: string) =>
  act(async () => {
    Effect.runSync(Deferred.succeed(gate, value));
    await Promise.resolve();
  });

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
])('useAction %s', (_name, makeWrapper) => {
  it('starts as an initial, idle state', () => {
    const { result } = renderHook(
      () => useAction<string, string, never>(() => Effect.succeed('x')),
      {
        wrapper: makeWrapper(),
      },
    );

    expect(AsyncResult.isInitial(result.current[0])).toBe(true);
    expect(isWaiting(result.current[0])).toBe(false);
    expect(failureOf(result.current[0])).toBeUndefined();
  });

  it('goes waiting, then success with the value', async () => {
    const gate = Deferred.makeUnsafe<string>();
    const probe = makeProbe();
    const { result } = renderHook(
      () => useAction((suffix: string) => gated(probe, gate).pipe(Effect.map((v) => v + suffix))),
      { wrapper: makeWrapper() },
    );

    act(() => result.current[1]('!'));
    await waitFor(() => expect(isWaiting(result.current[0])).toBe(true));
    expect(probe.started).toBe(1);

    await complete(gate, 'done');
    await waitFor(() => expect(AsyncResult.isSuccess(result.current[0])).toBe(true));
    const state = result.current[0];
    expect(isWaiting(state)).toBe(false);
    expect(AsyncResult.isSuccess(state) && state.value).toBe('done!');
    expect(failureOf(state)).toBeUndefined();
  });

  it('exposes the typed failure through failureOf', async () => {
    const { result } = renderHook(
      () => useAction((reason: string) => Effect.fail(new Boom({ reason }))),
      { wrapper: makeWrapper() },
    );

    act(() => result.current[1]('nope'));
    await waitFor(() => expect(AsyncResult.isFailure(result.current[0])).toBe(true));

    const failure = failureOf(result.current[0]);
    expect(failure).toBeInstanceOf(Boom);
    expect(failure?.reason).toBe('nope');
    expect(isWaiting(result.current[0])).toBe(false);
  });

  it('does not report a defect as a typed failure', async () => {
    const { result } = renderHook(
      () => useAction<string, never, Boom>(() => Effect.die(new Error('defect'))),
      { wrapper: makeWrapper() },
    );

    act(() => result.current[1]('x'));
    await waitFor(() => expect(AsyncResult.isFailure(result.current[0])).toBe(true));

    expect(failureOf(result.current[0])).toBeUndefined();
  });

  it("'ignore' mode (the default) drops a run while waiting: the effect runs once", async () => {
    const gate = Deferred.makeUnsafe<string>();
    const probe = makeProbe();
    const { result } = renderHook(
      () => useAction<string, string, never>(() => gated(probe, gate)),
      {
        wrapper: makeWrapper(),
      },
    );

    act(() => result.current[1]('a'));
    await waitFor(() => expect(probe.started).toBe(1));
    act(() => result.current[1]('b'));
    act(() => result.current[1]('c'));

    expect(probe.started).toBe(1);
    expect(probe.interrupted).toBe(0);

    await complete(gate, 'first');
    await waitFor(() => expect(AsyncResult.isSuccess(result.current[0])).toBe(true));
    expect(probe.started).toBe(1);

    // Once the call is done, the next run goes through (the gate is open).
    act(() => result.current[1]('d'));
    await waitFor(() => expect(probe.started).toBe(2));
  });

  it("'ignore' mode accepts a new run after the previous one finished", async () => {
    const probe = makeProbe();
    const { result } = renderHook(
      () =>
        useAction((value: string) =>
          Effect.sync(() => {
            probe.started += 1;
            return value;
          }),
        ),
      { wrapper: makeWrapper() },
    );

    act(() => result.current[1]('one'));
    await waitFor(() => expect(AsyncResult.isSuccess(result.current[0])).toBe(true));
    act(() => result.current[1]('two'));
    await waitFor(() => {
      const state = result.current[0];
      expect(AsyncResult.isSuccess(state) && state.value).toBe('two');
    });

    expect(probe.started).toBe(2);
  });

  it("'replace' mode interrupts the running call and starts the new one", async () => {
    const firstGate = Deferred.makeUnsafe<string>();
    const secondGate = Deferred.makeUnsafe<string>();
    const gates = [firstGate, secondGate];
    const firstProbe = makeProbe();
    const secondProbe = makeProbe();
    const probes = [firstProbe, secondProbe];
    let call = 0;
    const { result } = renderHook(
      () =>
        useAction<string, string, never>(
          () => {
            const index = call;
            call += 1;
            return gated(probes[index] ?? makeProbe(), gates[index] ?? firstGate);
          },
          { mode: 'replace' },
        ),
      { wrapper: makeWrapper() },
    );

    act(() => result.current[1]('a'));
    await waitFor(() => expect(firstProbe.started).toBe(1));
    act(() => result.current[1]('b'));

    await waitFor(() => expect(secondProbe.started).toBe(1));
    expect(firstProbe.interrupted).toBe(1);
    expect(firstProbe.finalized).toBe(1);
    expect(secondProbe.interrupted).toBe(0);

    await complete(secondGate, 'second');
    await waitFor(() => expect(AsyncResult.isSuccess(result.current[0])).toBe(true));
    const state = result.current[0];
    expect(AsyncResult.isSuccess(state) && state.value).toBe('second');
  });

  it('runs the latest fn without rebuilding the atom or the run function', async () => {
    const { result, rerender } = renderHook(
      ({ prefix }: { prefix: string }) =>
        useAction((value: string) => Effect.succeed(`${prefix}${value}`)),
      { wrapper: makeWrapper(), initialProps: { prefix: 'old:' } },
    );
    const firstRun = result.current[1];

    rerender({ prefix: 'new:' });
    expect(result.current[1]).toBe(firstRun);

    act(() => result.current[1]('x'));
    await waitFor(() => expect(AsyncResult.isSuccess(result.current[0])).toBe(true));
    const state = result.current[0];
    expect(AsyncResult.isSuccess(state) && state.value).toBe('new:x');
  });

  it('interrupts a running call on unmount: its finalizer runs', async () => {
    const gate = Deferred.makeUnsafe<string>();
    const probe = makeProbe();
    const { result, unmount } = renderHook(
      () => useAction<string, string, never>(() => gated(probe, gate)),
      {
        wrapper: makeWrapper(),
      },
    );

    act(() => result.current[1]('a'));
    await waitFor(() => expect(probe.started).toBe(1));
    expect(probe.finalized).toBe(0);

    unmount();

    await waitFor(() => expect(probe.interrupted).toBe(1));
    expect(probe.finalized).toBe(1);
  });

  it('does not interrupt anything on unmount when the action is idle', async () => {
    const probe = makeProbe();
    const gate = Deferred.makeUnsafe<string>();
    const { result, unmount } = renderHook(
      () => useAction<string, string, never>(() => gated(probe, gate)),
      {
        wrapper: makeWrapper(),
      },
    );
    const [initial] = result.current;

    unmount();

    expect(AsyncResult.isInitial(initial)).toBe(true);
    expect(probe.started).toBe(0);
    expect(probe.interrupted).toBe(0);
  });

  it('interrupt() stops the running call and shows an interrupted failure', async () => {
    const gate = Deferred.makeUnsafe<string>();
    const probe = makeProbe();
    const { result } = renderHook(
      () => useAction<string, string, never>(() => gated(probe, gate)),
      {
        wrapper: makeWrapper(),
      },
    );

    act(() => result.current[1]('a'));
    await waitFor(() => expect(probe.started).toBe(1));
    act(() => result.current[2].interrupt());

    await waitFor(() => expect(probe.interrupted).toBe(1));
    await waitFor(() => expect(isWaiting(result.current[0])).toBe(false));
    expect(AsyncResult.isInterrupted(result.current[0])).toBe(true);
    expect(failureOf(result.current[0])).toBeUndefined();
  });

  it('reset() returns a finished action to its initial state', async () => {
    const { result } = renderHook(() => useAction((value: string) => Effect.succeed(value)), {
      wrapper: makeWrapper(),
    });

    act(() => result.current[1]('x'));
    await waitFor(() => expect(AsyncResult.isSuccess(result.current[0])).toBe(true));
    act(() => result.current[2].reset());

    await waitFor(() => expect(AsyncResult.isInitial(result.current[0])).toBe(true));
    expect(isWaiting(result.current[0])).toBe(false);
  });

  it('reset() also interrupts a running call', async () => {
    const gate = Deferred.makeUnsafe<string>();
    const probe = makeProbe();
    const { result } = renderHook(
      () => useAction<string, string, never>(() => gated(probe, gate)),
      {
        wrapper: makeWrapper(),
      },
    );

    act(() => result.current[1]('a'));
    await waitFor(() => expect(probe.started).toBe(1));
    act(() => result.current[2].reset());

    await waitFor(() => expect(probe.interrupted).toBe(1));
    await waitFor(() => expect(AsyncResult.isInitial(result.current[0])).toBe(true));
    expect(isWaiting(result.current[0])).toBe(false);
  });
});
