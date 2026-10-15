import { Cause, Duration, Effect, Exit, Fiber } from 'effect';
import type { WebSocket } from 'ws';
import { DeskRunner } from '../desk-runner.ts';
import type { RunnerKeypair } from '../keys.ts';
import { TunnelClosedError, type StreamMux } from '../mux.ts';
import {
  CLOSE_AUTH,
  CLOSE_MALFORMED,
  CLOSE_REVOKED,
  CLOSE_UNKNOWN_TYPE,
  CLOSE_VERSION,
} from '../protocol.ts';
import { closeQuietly } from '../ws-close.ts';
import { interruptHeartbeat, notifyClosed } from './connection.ts';
import { connectOnce } from './handshake.ts';
import { computeBackoff, type RunnerOptions, type RunnerOptionsDecoded } from './options.ts';

/**
 * The mutable state of one `RunnerClient`. The class keeps it private and hands
 * it to the sibling modules, so the connection, handshake and lifecycle code can
 * share state without widening the public class.
 */
export interface RunnerRuntime {
  readonly serverUrl: string;
  readonly runnerId: string;
  readonly keypair: RunnerKeypair;
  readonly runnerVersion: string;
  readonly exposedPorts: readonly number[];
  readonly reconnectBaseMs: number;
  readonly reconnectMaxMs: number;
  readonly handshakeTimeoutMs: number;
  readonly highWaterMarkBytes: number;
  readonly deskRunner: DeskRunner;

  ws: WebSocket | null;
  mux: StreamMux | null;
  heartbeatFiber: Fiber.Fiber<unknown, unknown> | null;
  runFiber: Fiber.Fiber<unknown, unknown> | null;
  started: boolean;
  stopped: boolean;
  lastCloseCode: number | null;
  readonly readyListeners: Set<() => void>;
  readonly failedListeners: Set<(err: Error) => void>;
  closeResolvers: Array<() => void>;
  readyCountValue: number;
  reconnectAttemptsValue: number;
}

export function createRunnerRuntime(
  validated: RunnerOptionsDecoded,
  options: RunnerOptions,
): RunnerRuntime {
  return {
    serverUrl: validated.serverUrl,
    runnerId: validated.runnerId,
    keypair: options.keypair,
    runnerVersion: validated.runnerVersion,
    exposedPorts: validated.exposedPorts,
    reconnectBaseMs: validated.reconnectBaseMs,
    reconnectMaxMs: validated.reconnectMaxMs,
    handshakeTimeoutMs: validated.handshakeTimeoutMs,
    highWaterMarkBytes: validated.highWaterMarkBytes,
    deskRunner: new DeskRunner(options.deskRunner ?? null),
    ws: null,
    mux: null,
    heartbeatFiber: null,
    runFiber: null,
    started: false,
    stopped: false,
    lastCloseCode: null,
    readyListeners: new Set<() => void>(),
    failedListeners: new Set<(err: Error) => void>(),
    closeResolvers: [],
    readyCountValue: 0,
    reconnectAttemptsValue: 0,
  };
}

export function onRunnerEvent(
  rt: RunnerRuntime,
  event: 'ready' | 'failed',
  listener: (err?: Error) => void,
): () => void {
  if (event === 'ready') {
    const wrapper = (): void => {
      listener();
    };
    rt.readyListeners.add(wrapper);
    return () => {
      rt.readyListeners.delete(wrapper);
    };
  }
  const wrapper = (err: Error): void => {
    listener(err);
  };
  rt.failedListeners.add(wrapper);
  return () => {
    rt.failedListeners.delete(wrapper);
  };
}

function emitReady(rt: RunnerRuntime): void {
  rt.readyCountValue += 1;
  for (const listener of rt.readyListeners) {
    listener();
  }
}

function emitFailed(rt: RunnerRuntime, err: Error): void {
  for (const listener of rt.failedListeners) {
    listener(err);
  }
}

/** Connect. Resolves on the first authentication. */
export async function startRunner(rt: RunnerRuntime): Promise<void> {
  if (rt.started) {
    throw new Error('runner already started');
  }
  rt.started = true;
  await new Promise<void>((resolve, reject) => {
    const offReady = onRunnerEvent(rt, 'ready', () => {
      offReady();
      offFailed();
      resolve();
    });
    const offFailed = onRunnerEvent(rt, 'failed', (err?: Error) => {
      offReady();
      offFailed();
      reject(err ?? new TunnelClosedError('runner failed'));
    });
    // The reconnect loop never rejects: every failure is either retried or
    // reported through 'failed'.
    rt.runFiber = Effect.runFork(runEffect(rt));
  });
}

export async function stopRunner(rt: RunnerRuntime): Promise<void> {
  rt.stopped = true;
  await interruptHeartbeat(rt);
  if (rt.ws !== null) {
    closeQuietly(rt.ws);
  }
  rt.ws = null;
  notifyClosed(rt);
  const fiber = rt.runFiber;
  rt.runFiber = null;
  if (fiber !== null) {
    await Effect.runPromise(Fiber.interrupt(fiber));
  }
}

function runEffect(rt: RunnerRuntime): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    let attempt = 0;
    for (;;) {
      if (rt.stopped) {
        return;
      }
      const outcome = yield* Effect.exit(
        Effect.gen(function* () {
          yield* connectOnce(rt);
          attempt = 0;
          emitReady(rt);
          rt.lastCloseCode = null;
          yield* waitForClose(rt);
          if (rt.lastCloseCode !== null && FATAL_CLOSE_CODES.has(rt.lastCloseCode)) {
            return yield* Effect.fail(
              new TunnelClosedError(
                `connection closed (${rt.lastCloseCode}): rejected by the server`,
              ),
            );
          }
        }),
      );
      let fatal: Error | null = null;
      if (Exit.isFailure(outcome)) {
        fatal = toError(Cause.squash(outcome.cause));
      }
      if (rt.stopped) {
        return;
      }
      if (fatal !== null && isFatalError(fatal)) {
        emitFailed(rt, fatal);
        rt.stopped = true;
        return;
      }
      const waitMs = computeBackoff(attempt, rt.reconnectBaseMs, rt.reconnectMaxMs);
      attempt += 1;
      rt.reconnectAttemptsValue += 1;
      yield* Effect.sleep(Duration.millis(waitMs));
    }
  });
}

function waitForClose(rt: RunnerRuntime): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    const resolve = (): void => {
      resume(Effect.void);
    };
    rt.closeResolvers.push(resolve);
    return Effect.sync(() => {
      const index = rt.closeResolvers.indexOf(resolve);
      if (index !== -1) {
        rt.closeResolvers.splice(index, 1);
      }
    });
  });
}

/** Auth and version rejections are final; anything else is worth a reconnect. */
const FATAL_CLOSE_CODES = new Set([
  CLOSE_AUTH,
  CLOSE_VERSION,
  CLOSE_REVOKED,
  CLOSE_MALFORMED,
  CLOSE_UNKNOWN_TYPE,
]);

function isFatalError(err: Error): boolean {
  return (
    err.message.includes(`(${CLOSE_AUTH})`) ||
    err.message.includes(`(${CLOSE_VERSION})`) ||
    err.message.includes(`(${CLOSE_REVOKED})`) ||
    err.message.includes(`(${CLOSE_MALFORMED})`) ||
    err.message.includes(`(${CLOSE_UNKNOWN_TYPE})`)
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
