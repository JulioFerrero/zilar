import { Context, Effect, Layer, Ref } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeServerRuntime, type ServerLayer } from './runtime';

class Counter extends Context.Service<
  Counter,
  {
    readonly increment: Effect.Effect<void>;
    readonly value: Effect.Effect<number>;
  }
>()('test/Counter') {
  static readonly layer = Layer.effect(
    Counter,
    Effect.gen(function* () {
      const ref = yield* Ref.make(0);
      const increment = Ref.update(ref, (n) => n + 1);
      const value = Ref.get(ref);
      return Counter.of({ increment, value });
    }),
  );
}

describe('makeServerRuntime', () => {
  it('runs an effect that uses a test service', async () => {
    const serverRuntime = makeServerRuntime(Counter.layer);

    try {
      const result = await serverRuntime.runPromise(
        Effect.gen(function* () {
          yield* Counter.use((counter) => counter.increment);
          yield* Counter.use((counter) => counter.increment);
          return yield* Counter.use((counter) => counter.value);
        }),
      );

      expect(result).toBe(2);
    } finally {
      await serverRuntime.dispose();
    }
  });

  it('dispose runs the layer finalizers', async () => {
    const events: string[] = [];
    const layer: ServerLayer = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push('acquired');
        }),
        () =>
          Effect.sync(() => {
            events.push('released');
          }),
      ),
    );
    const serverRuntime = makeServerRuntime(layer);

    await serverRuntime.runPromise(Effect.void);
    expect(events).toEqual(['acquired']);

    await serverRuntime.dispose();
    expect(events).toEqual(['acquired', 'released']);
  });
});
