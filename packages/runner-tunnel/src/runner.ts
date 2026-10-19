import net from 'node:net';
import { Cause, Duration, Effect, Exit, Fiber, Schedule, Schema } from 'effect';
import { WebSocket } from 'ws';
import { DeskRunner, type DeskRunnerHandler } from './desk-runner.ts';
import { signNonce, type RunnerKeypair } from './keys.ts';
import { StreamMux, TunnelClosedError, attachSocketToStream } from './mux.ts';
import {
  CLOSE_AUTH,
  CLOSE_MALFORMED,
  CLOSE_REVOKED,
  CLOSE_UNKNOWN_TYPE,
  CLOSE_VERSION,
  MAX_WS_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  parseControlMessage,
  type ControlMessage,
} from './protocol.ts';
import { closeQuietly } from './ws-close.ts';

const stringUrl: Schema.String = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }),
);

const portSchema: Schema.Number = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(65535),
);

const RunnerOptionsSchema = Schema.Struct({
  serverUrl: stringUrl.check(
    Schema.makeFilter((value) => value.startsWith('ws://') || value.startsWith('wss://'), {
      message: 'serverUrl must use ws:// or wss://',
    }),
  ),
  runnerId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  runnerVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)).pipe(
    Schema.withDecodingDefault(Effect.succeed('0.1.0')),
  ),
  exposedPorts: Schema.Array(portSchema).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  reconnectBaseMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(10),
    Schema.isLessThanOrEqualTo(60000),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(250))),
  reconnectMaxMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(50),
    Schema.isLessThanOrEqualTo(300000),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(5000))),
  handshakeTimeoutMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(100),
    Schema.isLessThanOrEqualTo(60000),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(10000))),
  highWaterMarkBytes: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(4096),
    Schema.isLessThanOrEqualTo(64 * 1024 * 1024),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(1024 * 1024))),
});

type RunnerOptionsDecoded = typeof RunnerOptionsSchema.Type;

export interface RunnerOptions {
  serverUrl: string;
  runnerId: string;
  keypair: RunnerKeypair;
  runnerVersion?: string | undefined;
  /** Ports the server may open on this machine. Anything else is refused. */
  exposedPorts?: number[] | undefined;
  /** The runner's desk handler (plan §6.1); absent means the runner refuses desks. */
  deskRunner?: DeskRunnerHandler | undefined;
  reconnectBaseMs?: number | undefined;
  reconnectMaxMs?: number | undefined;
  handshakeTimeoutMs?: number | undefined;
  highWaterMarkBytes?: number | undefined;
}

export function computeBackoff(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
}

/**
 * The mutable state of one `RunnerClient`; the class keeps it private and hands it to
 * the sibling modules.
 */
interface RunnerRuntime {
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

function createRunnerRuntime(
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

function onRunnerEvent(
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

async function startRunner(rt: RunnerRuntime): Promise<void> {
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
    // The reconnect loop never rejects: failures are retried or reported through 'failed'.
    rt.runFiber = Effect.runFork(runEffect(rt));
  });
}

async function stopRunner(rt: RunnerRuntime): Promise<void> {
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

/** How often a ready connection sends a liveness heartbeat. */
const HEARTBEAT_INTERVAL_MS = 10000;

function installReadyConnection(rt: RunnerRuntime, ws: WebSocket): void {
  const mux = new StreamMux(ws, 1, { highWaterMarkBytes: rt.highWaterMarkBytes });
  rt.mux = mux;
  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      const parsed = parseControlMessage(data.toString('utf8'), 'server-to-runner');
      if (!parsed.ok) {
        closeQuietly(ws, parsed.code, parsed.reason);
        return;
      }
      routeControl(rt, mux, parsed.message);
    } else {
      mux.handleBinary(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
    }
  });
  ws.on('close', (code: number) => {
    teardownConnection(rt, mux, ws, code);
  });
  ws.on('error', () => {
    // The close event below does the cleanup.
  });
  startHeartbeat(rt, mux);
}

function startHeartbeat(rt: RunnerRuntime, mux: StreamMux): void {
  // Replace a previous heartbeat: an orphaned fiber would ping a dead mux and, since
  // Effect timers are not unref'd, keep the process alive.
  void interruptHeartbeat(rt);
  const heartbeat = Effect.repeat(
    Effect.sync(() => {
      try {
        mux.sendControl({ type: 'heartbeat', at: Date.now() });
      } catch {
        // The tunnel is dying; the close handler cleans up.
      }
    }).pipe(Effect.catchDefect(() => Effect.void)),
    Schedule.spaced(Duration.millis(HEARTBEAT_INTERVAL_MS)),
  ).pipe(Effect.delay(Duration.millis(HEARTBEAT_INTERVAL_MS)));
  rt.heartbeatFiber = Effect.runFork(heartbeat);
}

async function interruptHeartbeat(rt: RunnerRuntime): Promise<void> {
  const fiber = rt.heartbeatFiber;
  rt.heartbeatFiber = null;
  if (fiber !== null) {
    await Effect.runPromise(Fiber.interrupt(fiber));
  }
}

function teardownConnection(rt: RunnerRuntime, mux: StreamMux, ws: WebSocket, code: number): void {
  if (rt.ws === ws) {
    rt.ws = null;
  }
  rt.lastCloseCode = code;
  if (rt.mux === mux) {
    rt.mux = null;
  }
  void interruptHeartbeat(rt);
  mux.failAll(new TunnelClosedError('connection to the server was lost'));
  notifyClosed(rt);
}

function notifyClosed(rt: RunnerRuntime): void {
  for (const resolve of rt.closeResolvers.splice(0)) {
    resolve();
  }
}

function routeControl(rt: RunnerRuntime, mux: StreamMux, message: ControlMessage): void {
  switch (message.type) {
    case 'tunnel.open':
      handleTunnelOpen(rt, mux, message.stream_id, message.port);
      break;
    case 'tunnel.closed':
      mux.failStream(
        message.stream_id,
        new TunnelClosedError(`server closed stream: ${message.reason}`),
      );
      break;
    case 'tunnel.pause':
      mux.handlePause(message.stream_id);
      break;
    case 'tunnel.resume':
      mux.handleResume(message.stream_id);
      break;
    case 'desk.provision':
    case 'desk.exec':
    case 'desk.stop':
      rt.deskRunner.handle(mux, message);
      break;
    case 'challenge':
    case 'ready':
      if (rt.ws !== null) {
        closeQuietly(rt.ws, CLOSE_UNKNOWN_TYPE, `unexpected ${message.type}`);
      }
      break;
    default:
      if (rt.ws !== null) {
        closeQuietly(rt.ws, CLOSE_UNKNOWN_TYPE, 'message not allowed');
      }
      break;
  }
}

function handleTunnelOpen(rt: RunnerRuntime, mux: StreamMux, streamId: number, port: number): void {
  // Stream ids are split by parity: the server opens even ids, this runner
  // odd ones. An odd or already-live id is a buggy or hostile server.
  if (streamId % 2 !== 0 || mux.hasStream(streamId)) {
    if (rt.ws !== null) {
      closeQuietly(rt.ws, CLOSE_MALFORMED, `bad tunnel.open stream id ${streamId}`);
    }
    return;
  }
  if (!rt.exposedPorts.includes(port)) {
    try {
      mux.sendControl({
        type: 'tunnel.refused',
        stream_id: streamId,
        reason: `port ${port} is not exposed`,
      });
    } catch {
      // The tunnel is dying anyway.
    }
    return;
  }
  const desk = net.connect(port, '127.0.0.1');
  attachSocketToStream(mux, streamId, desk);
}

/** Dial the server once and run the hello/challenge/auth/ready exchange. */
function connectOnce(rt: RunnerRuntime): Effect.Effect<void, TunnelClosedError> {
  const ws = new WebSocket(rt.serverUrl, { maxPayload: MAX_WS_PAYLOAD_BYTES });
  rt.ws = ws;
  return Effect.gen(function* () {
    yield* openSocket(ws, rt.handshakeTimeoutMs);
    if (rt.stopped) {
      return yield* Effect.fail(new TunnelClosedError('runner stopped'));
    }
    yield* Effect.sync(() => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          runner_id: rt.runnerId,
          runner_version: rt.runnerVersion,
          protocol_version: PROTOCOL_VERSION,
        }),
      );
    });
    const challenge = yield* waitForType(ws, 'challenge', rt.handshakeTimeoutMs);
    if (challenge.type !== 'challenge') {
      return yield* Effect.fail(new TunnelClosedError('expected challenge'));
    }
    yield* Effect.sync(() => {
      ws.send(
        JSON.stringify({
          type: 'auth',
          signature: signNonce(rt.keypair.privateKey, Buffer.from(challenge.nonce, 'base64')),
        }),
      );
    });
    yield* waitForType(ws, 'ready', rt.handshakeTimeoutMs);
    if (rt.stopped) {
      return yield* Effect.fail(new TunnelClosedError('runner stopped'));
    }
    installReadyConnection(rt, ws);
  }).pipe(
    Effect.onExit((exit) => {
      if (Exit.isFailure(exit)) {
        closeQuietly(ws);
      }
      return Effect.void;
    }),
  );
}

function openSocket(ws: WebSocket, timeoutMs: number): Effect.Effect<void, TunnelClosedError> {
  return Effect.callback<void, TunnelClosedError>((resume) => {
    function cleanup(): void {
      ws.removeListener('open', onOpen);
      ws.removeListener('error', onError);
    }
    function onOpen(): void {
      cleanup();
      resume(Effect.void);
    }
    function onError(err: Error): void {
      cleanup();
      resume(Effect.fail(new TunnelClosedError(`connection failed: ${err.message}`)));
    }
    ws.on('open', onOpen);
    ws.on('error', onError);
    return Effect.sync(cleanup);
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () => Effect.fail(new TunnelClosedError('connection timeout')),
    }),
  );
}

function waitForType(
  ws: WebSocket,
  expected: 'challenge' | 'ready',
  timeoutMs: number,
): Effect.Effect<ControlMessage, TunnelClosedError> {
  return Effect.callback<ControlMessage, TunnelClosedError>((resume) => {
    function cleanup(): void {
      ws.removeListener('message', onMessage);
      ws.removeListener('close', onClose);
      ws.removeListener('error', onError);
    }
    function finish(outcome: ControlMessage | TunnelClosedError): void {
      cleanup();
      if (outcome instanceof Error) {
        resume(Effect.fail(outcome));
      } else {
        resume(Effect.succeed(outcome));
      }
    }
    function onMessage(data: unknown, isBinary: boolean): void {
      if (isBinary) {
        finish(new TunnelClosedError('binary frame during handshake'));
        closeQuietly(ws, CLOSE_MALFORMED, 'binary frame during handshake');
        return;
      }
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      const parsed = parseControlMessage(text, 'server-to-runner');
      if (!parsed.ok) {
        finish(new TunnelClosedError(`handshake failed: ${parsed.reason}`));
        return;
      }
      if (parsed.message.type !== expected) {
        finish(new TunnelClosedError(`expected ${expected}, got ${parsed.message.type}`));
        return;
      }
      finish(parsed.message);
    }
    function onClose(code: number, reason: Buffer): void {
      finish(
        new TunnelClosedError(
          `handshake connection closed (${code}): ${reason.toString() || 'no reason'}`,
        ),
      );
    }
    function onError(err: Error): void {
      finish(new TunnelClosedError(`handshake failed: ${err.message}`));
    }
    ws.on('message', onMessage);
    ws.on('close', onClose);
    ws.on('error', onError);
    return Effect.sync(cleanup);
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () => Effect.fail(new TunnelClosedError(`timeout waiting for ${expected}`)),
    }),
  );
}

type RunnerEvent = 'ready' | 'failed';

/**
 * The runner dials out to the server (never the reverse, so it works behind home
 * routers), authenticates with its ed25519 key, and serves engine streams from its
 * allowlisted ports.
 */
export class RunnerClient {
  readonly runnerId: string;
  private readonly rt: RunnerRuntime;

  constructor(options: RunnerOptions) {
    const validated = Schema.decodeUnknownSync(RunnerOptionsSchema, {
      onExcessProperty: 'error',
    })({
      serverUrl: options.serverUrl,
      runnerId: options.runnerId,
      runnerVersion: options.runnerVersion,
      exposedPorts: options.exposedPorts,
      reconnectBaseMs: options.reconnectBaseMs,
      reconnectMaxMs: options.reconnectMaxMs,
      handshakeTimeoutMs: options.handshakeTimeoutMs,
      highWaterMarkBytes: options.highWaterMarkBytes,
    });
    this.runnerId = validated.runnerId;
    this.rt = createRunnerRuntime(validated, options);
  }

  get readyCount(): number {
    return this.rt.readyCountValue;
  }

  get reconnectAttempts(): number {
    return this.rt.reconnectAttemptsValue;
  }

  get connected(): boolean {
    return this.rt.mux !== null;
  }

  on(event: RunnerEvent, listener: (err?: Error) => void): () => void {
    return onRunnerEvent(this.rt, event, listener);
  }

  /** Connect. Resolves on the first authentication. */
  start(): Promise<void> {
    return startRunner(this.rt);
  }

  stop(): Promise<void> {
    return stopRunner(this.rt);
  }
}
