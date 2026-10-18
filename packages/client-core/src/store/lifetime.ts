// The lifetime of one chat store: a store Scope from `start()` to `stop()`, and one
// session Scope per boot attempt. A fiber interrupted from outside never runs catch
// handlers, so a rollback handler is safe on a forked task.
import { type Context, Effect, Exit, FiberMap, FiberSet, Scope, type Fiber } from 'effect';

export type Task<R> = Effect.Effect<unknown, unknown, R>;

export interface Fibers<R> {
  readonly scope: Scope.Closeable;
  readonly fork: (task: Task<R>) => Fiber.Fiber<unknown, never>;
  readonly forkKeyed: (key: string, task: Task<R>) => Fiber.Fiber<unknown, never>;
  readonly cancel: (key: string) => void;
  readonly has: (key: string) => boolean;
  readonly onClose: (finalizer: Effect.Effect<unknown>) => void;
  readonly isOpen: () => boolean;
}

export interface Lifetime<R> {
  readonly runDetached: (task: Task<R>) => void;
  readonly runPromise: <A, E>(task: Effect.Effect<A, E, R>) => Promise<A>;
  readonly fork: (task: Task<R>) => Fiber.Fiber<unknown, never>;
  readonly forkKeyed: (key: string, task: Task<R>) => Fiber.Fiber<unknown, never>;
  readonly cancel: (key: string) => void;
  readonly has: (key: string) => boolean;
  readonly onStoreClose: (finalizer: Effect.Effect<unknown>) => void;
  readonly isStoreOpen: () => boolean;
  readonly storeScope: () => Scope.Closeable;
  readonly session: () => Fibers<R> | undefined;
  readonly beginSession: () => Fibers<R>;
  readonly closeStore: () => void;
}

// A forked task that fails is logged and the fiber ends: it does not vanish silently or
// take the store down.
const guarded = <R>(task: Task<R>): Effect.Effect<unknown, never, R> =>
  task.pipe(Effect.catchCause((cause) => Effect.logError('chat store task failed', cause)));

function closeScope(scope: Scope.Closeable): void {
  Effect.runFork(Scope.close(scope, Exit.void));
}

function makeFibers<R>(services: Context.Context<R>, parent: Scope.Scope | undefined): Fibers<R> {
  const scope = parent === undefined ? Scope.makeUnsafe() : Scope.forkUnsafe(parent);
  const runSet = Effect.runSync(
    FiberSet.makeRuntime<R>().pipe(Scope.provide(scope), Effect.provideContext(services)),
  );
  const map = Effect.runSync(FiberMap.make<string>().pipe(Scope.provide(scope)));
  const runKeyed = Effect.runSync(FiberMap.runtime(map)<R>().pipe(Effect.provideContext(services)));
  return {
    scope,
    fork: (task) => runSet(guarded(task)),
    forkKeyed: (key, task) => runKeyed(key, guarded(task)),
    cancel: (key) => {
      Effect.runFork(FiberMap.remove(map, key));
    },
    has: (key) => FiberMap.hasUnsafe(map, key),
    onClose: (finalizer) => {
      Effect.runFork(Scope.addFinalizer(scope, finalizer));
    },
    isOpen: () => scope.state._tag !== 'Closed',
  };
}

export function makeLifetime<R>(services: Context.Context<R>): Lifetime<R> {
  let store: Fibers<R> | undefined;
  let session: Fibers<R> | undefined;

  const ensureStore = (): Fibers<R> => {
    store ??= makeFibers(services, undefined);
    return store;
  };

  return {
    runDetached: (task) => {
      Effect.runForkWith(services)(guarded(task));
    },
    runPromise: (task) => Effect.runPromiseWith(services)(task),
    fork: (task) => ensureStore().fork(task),
    forkKeyed: (key, task) => ensureStore().forkKeyed(key, task),
    cancel: (key) => store?.cancel(key),
    has: (key) => store?.has(key) ?? false,
    onStoreClose: (finalizer) => ensureStore().onClose(finalizer),
    isStoreOpen: () => store !== undefined,
    storeScope: () => ensureStore().scope,
    session: () => session,
    beginSession: () => {
      if (session !== undefined) {
        closeScope(session.scope);
      }
      session = makeFibers(services, ensureStore().scope);
      return session;
    },
    closeStore: () => {
      const closing = store;
      store = undefined;
      session = undefined;
      if (closing !== undefined) {
        closeScope(closing.scope);
      }
    },
  };
}
