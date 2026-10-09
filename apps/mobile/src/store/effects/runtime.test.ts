import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { PortsTest } from './ports';
import { Ports } from './ports';
import { isClosed, lift, makeLife, makeRunners, onClose, orElse, recover } from './runtime';

async function ports() {
  return Effect.runPromise(Ports.use(Effect.succeed).pipe(Effect.provide(PortsTest())));
}

describe('Life', () => {
  it('restarting the generation closes the old scope and interrupts its fibers', async () => {
    const life = makeLife();
    const { fork } = makeRunners(await ports(), life);
    const finished = vi.fn();
    const interrupted = vi.fn();
    const old = life.generation();
    fork(Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted))), old);
    fork(Effect.sync(finished));
    expect(finished).toHaveBeenCalledTimes(1);

    life.restartGeneration();
    expect(isClosed(old)).toBe(true);
    expect(isClosed(life.generation())).toBe(false);
    expect(interrupted).toHaveBeenCalledTimes(1);
  });

  it('ending the session runs its finalizers once and opens fresh scopes', () => {
    const life = makeLife();
    const unsubscribe = vi.fn();
    onClose(life.session(), unsubscribe);
    const session = life.session();
    const generation = life.generation();

    life.endSession();
    life.endSession();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(isClosed(session)).toBe(true);
    expect(isClosed(generation)).toBe(true);
    expect(isClosed(life.session())).toBe(false);
    expect(isClosed(life.generation())).toBe(false);
  });
});

describe('recover', () => {
  it('turns a rejection or a throw into the fallback, like catch {}', async () => {
    const rejected = lift(() => Promise.reject(new Error('down')));
    const thrown = Effect.sync((): number => {
      throw new Error('boom');
    });
    expect(await Effect.runPromise(orElse(rejected, 'fallback'))).toBe('fallback');
    expect(await Effect.runPromise(orElse(thrown, 7))).toBe(7);
    expect(
      await Effect.runPromise(
        recover(
          lift(() => Promise.resolve(1)),
          () => Effect.succeed(0),
        ),
      ),
    ).toBe(1);
  });

  it('does not run the handler for an interrupted fiber', async () => {
    const handler = vi.fn();
    const life = makeLife();
    const { fork } = makeRunners(await ports(), life);
    fork(recover(Effect.never, () => Effect.sync(handler)));
    life.restartGeneration();
    expect(handler).not.toHaveBeenCalled();
  });
});
