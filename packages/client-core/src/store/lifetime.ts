// The lifetime of one chat store: a store Scope that lives from `start()` to
// `stop()`, and inside it one session Scope per boot attempt (`start()` and
// every "retry"). Fibers forked into a Scope are interrupted when it closes, so
// no timer, loop, listener or connection outlives the lifetime that owns it.
//
// The runners start the fiber at once (its synchronous part runs inline, as an
// `async` function's did), unlike `Effect.forkIn`, which starts a tick later.
//
// A fiber interrupted from outside never runs `Effect.catchCause` or
// `Effect.catch` handlers (probed on effect 4.0.2), so a rollback handler is
// safe to put on a forked task.
import { type Context, Effect, Exit, FiberMap, FiberSet, Scope, type Fiber } from 'effect';

export type Task<R> = Effect.Effect<unknown, unknown, R>;

/** A Scope plus the runners that tie fibers to it. */
export interface Fibers<R> {
  readonly scope: Scope.Closeable;
  /** Starts `task` now; it is interrupted when the scope closes. */
  readonly fork: (task: Task<R>) => Fiber.Fiber<unknown, never>;
  /** Like `fork`, but a task with the same key is interrupted first. */
  readonly forkKeyed: (key: string, task: Task<R>) => Fiber.Fiber<unknown, never>;
  /** Interrupts the task with this key, if any. */
  readonly cancel: (key: string) => void;
  readonly has: (key: string) => boolean;
  /** Runs `finalizer` when the scope closes. */
  readonly onClose: (finalizer: Effect.Effect<unknown>) => void;
  /** False once the scope has closed. */
  readonly isOpen: () => boolean;
}

export interface Lifetime<R> {
  /** Starts `task` now, tied to nothing. */
  readonly runDetached: (task: Task<R>) => void;
  readonly runPromise: <A, E>(task: Effect.Effect<A, E, R>) => Promise<A>;
  /** Fibers of the store Scope (opened on first use, reopened after `closeStore`). */
  readonly fork: (task: Task<R>) => Fiber.Fiber<unknown, never>;
  readonly forkKeyed: (key: string, task: Task<R>) => Fiber.Fiber<unknown, never>;
  readonly cancel: (key: string) => void;
  readonly has: (key: string) => boolean;
  /** Runs `finalizer` when the store Scope closes. */
  readonly onStoreClose: (finalizer: Effect.Effect<unknown>) => void;
  readonly isStoreOpen: () => boolean;
  /** The current session, or undefined before `start()` and after `stop()`. */
  readonly session: () => Fibers<R> | undefined;
  /** Closes the current session and opens a new one inside the store Scope. */
  readonly beginSession: () => Fibers<R>;
  /** Closes the session and the store Scope: every fiber is interrupted. */
  readonly closeStore: () => void;
}

// A forked task that fails must not vanish silently, and must not take the
// store down: the failure is logged and the fiber ends.
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
