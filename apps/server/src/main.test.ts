import { Effect, Exit, Fiber } from 'effect';
import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostgresServerDatabase } from './db/client';
import { disposeSqlRuntime, registerSqlRuntime, sqlRuntimeFor } from './effect/sql';
import {
  emptyRunning,
  serverTeardown,
  shutdownServer,
  stopServer,
  type RunningServer,
} from './main';

function fakeLogger(): { logger: Logger; error: ReturnType<typeof vi.fn> } {
  const error = vi.fn();
  return { logger: { info: vi.fn(), error } as unknown as Logger, error };
}

function sqlIsRegistered(db: PostgresServerDatabase): boolean {
  try {
    sqlRuntimeFor(db);
    return true;
  } catch {
    return false;
  }
}

// Every handle records its call; the SQL runtime is a real, unused one so the
// test can see when it is disposed.
function fullRunning(calls: string[], db: PostgresServerDatabase): RunningServer {
  const record = (name: string): void => {
    calls.push(`${name}${sqlIsRegistered(db) ? '' : ' (sql gone)'}`);
  };
  return {
    ...emptyRunning(),
    db,
    closeDb: () => {
      record('closeDb');
      return Effect.runPromise(Effect.void);
    },
    closeHttp: () => {
      record('http');
      return Effect.runPromise(Effect.void);
    },
    runnerHub: {
      isOnline: () => false,
      close: () => {
        record('runnerHub');
        return Effect.runPromise(Effect.void);
      },
    },
    pushComponent: {
      stop: () => {
        record('push');
        return Effect.runPromise(Effect.void);
      },
    },
    gateway: {
      postToChat: () => Effect.runPromise(Effect.succeed(false)),
      stop: () => {
        record('gateway');
        return Effect.runPromise(Effect.void);
      },
    },
    approvalsSweeper: { close: () => record('approvalsSweeper') },
    recoveryStuck: { close: () => record('recoveryStuck') },
    routineScheduler: { stop: () => record('routineScheduler') },
  };
}

function freshDb(name: string): PostgresServerDatabase {
  const db: PostgresServerDatabase = { kind: 'postgres', url: `postgres://unused/${name}` };
  registerSqlRuntime(db, db.url);
  return db;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stopServer', () => {
  it('stops the HTTP server first and the SQL runtime last, in the old order', async () => {
    const db = freshDb('order');
    const calls: string[] = [];
    await Effect.runPromise(stopServer(fullRunning(calls, db)));
    expect(calls).toEqual([
      'http',
      'runnerHub',
      'push',
      'gateway',
      'approvalsSweeper',
      'recoveryStuck',
      'routineScheduler',
      'closeDb (sql gone)',
    ]);
  });

  it('stops only what was started when startup was still in flight', async () => {
    const db = freshDb('partial');
    const calls: string[] = [];
    const running: RunningServer = {
      ...emptyRunning(),
      db,
      closeDb: () => {
        calls.push('closeDb');
        return Effect.runPromise(Effect.void);
      },
    };
    await Effect.runPromise(stopServer(running));
    expect(calls).toEqual(['closeDb']);
    expect(sqlIsRegistered(db)).toBe(false);
  });

  it('does nothing when nothing was started', async () => {
    await Effect.runPromise(stopServer(emptyRunning()));
  });

  it('ends the sequence at a step that fails, like the old sequential awaits', async () => {
    const db = freshDb('failing');
    const calls: string[] = [];
    const running = fullRunning(calls, db);
    running.runnerHub = {
      isOnline: () => false,
      close: () => Effect.runPromise(Effect.fail(new Error('hub close failed'))),
    };
    const exit = await Effect.runPromiseExit(stopServer(running));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(calls).toEqual(['http']);
    await disposeSqlRuntime(db);
  });
});

describe('shutdownServer', () => {
  it('logs and exits 1 when the stop hangs past the force-exit time', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { logger, error } = fakeLogger();
    const running: RunningServer = {
      ...emptyRunning(),
      logger,
      closeHttp: () => new Promise<void>(() => undefined),
    };
    const fiber = Effect.runFork(shutdownServer(running, 30));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(error).toHaveBeenCalledWith('shutdown timed out; exiting');
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  it('does not exit when the stop finishes in time', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { logger, error } = fakeLogger();
    const running: RunningServer = { ...emptyRunning(), logger };
    await Effect.runPromise(shutdownServer(running, 30));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 80);
    });
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('runs the stop from a scope finalizer once, even when interrupted twice', async () => {
    const db = freshDb('scope');
    const calls: string[] = [];
    const running = fullRunning(calls, db);
    const slowHttp = running.closeHttp;
    running.closeHttp = async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 40);
      });
      await slowHttp?.();
    };
    const program = Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => shutdownServer(running));
        return yield* Effect.never;
      }),
    );
    const fiber = Effect.runFork(program);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    fiber.interruptUnsafe(fiber.id);
    fiber.interruptUnsafe(fiber.id);
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(calls).toEqual([
      'http',
      'runnerHub',
      'push',
      'gateway',
      'approvalsSweeper',
      'recoveryStuck',
      'routineScheduler',
      'closeDb (sql gone)',
    ]);
  });
});

describe('serverTeardown', () => {
  const codeFor = (exit: Exit.Exit<unknown, unknown>): number => {
    let code = -1;
    serverTeardown(exit, (value) => {
      code = value;
    });
    return code;
  };

  it('exits 0 after an interruption only', () => {
    expect(codeFor(Exit.interrupt(1))).toBe(0);
  });

  it('exits 0 on success', () => {
    expect(codeFor(Exit.succeed(undefined))).toBe(0);
  });

  it('exits 1 on a failure or a defect', () => {
    expect(codeFor(Exit.fail('boom'))).toBe(1);
    expect(codeFor(Exit.die(new Error('boom')))).toBe(1);
  });
});
