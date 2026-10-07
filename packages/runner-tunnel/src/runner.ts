import net from 'node:net';
import { Cause, Duration, Effect, Exit, Fiber, Schedule, Schema } from 'effect';
import { WebSocket } from 'ws';
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
import { signNonce, type RunnerKeypair } from './keys.ts';
import { StreamMux, TunnelClosedError, attachSocketToStream } from './mux.ts';

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

export const RunnerOptionsSchema = Schema.Struct({
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
  enableModelListener: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
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

export interface RunnerOptions {
  serverUrl: string;
  runnerId: string;
  keypair: RunnerKeypair;
  runnerVersion?: string | undefined;
  /** Ports the server may open on this machine. Anything else is refused. */
  exposedPorts?: number[] | undefined;
  /** Listen on 127.0.0.1 as the desk's LLM base URL. Default true. */
  enableModelListener?: boolean | undefined;
  reconnectBaseMs?: number | undefined;
  reconnectMaxMs?: number | undefined;
  handshakeTimeoutMs?: number | undefined;
  highWaterMarkBytes?: number | undefined;
}

/** Capped exponential backoff: base, doubled per attempt, never above max. */
export function computeBackoff(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
}

type RunnerEvent = 'ready' | 'failed';

/**
 * The runner side: dials out to the server (never the reverse, so it works
 * behind home routers), authenticates with its ed25519 key, serves engine
 * streams from its allowlisted ports, and exposes the model listener.
 */
export class RunnerClient {
  readonly runnerId: string;
  private readonly keypair: RunnerKeypair;
  private readonly serverUrl: string;
  private readonly runnerVersion: string;
  private readonly exposedPorts: readonly number[];
  private readonly enableModelListener: boolean;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly highWaterMarkBytes: number;

  private ws: WebSocket | null = null;
  private mux: StreamMux | null = null;
  private modelServer: net.Server | null = null;
  private heartbeatFiber: Fiber.Fiber<unknown, unknown> | null = null;
  private runFiber: Fiber.Fiber<unknown, unknown> | null = null;
  private started = false;
  private stopped = false;
  private lastCloseCode: number | null = null;
  private readonly readyListeners = new Set<() => void>();
  private readonly failedListeners = new Set<(err: Error) => void>();
  private closeResolvers: Array<() => void> = [];

  private readyCountValue = 0;
  private reconnectAttemptsValue = 0;

  constructor(options: RunnerOptions) {
    const validated = Schema.decodeUnknownSync(RunnerOptionsSchema, {
      onExcessProperty: 'error',
    })({
      serverUrl: options.serverUrl,
      runnerId: options.runnerId,
      runnerVersion: options.runnerVersion,
      exposedPorts: options.exposedPorts,
      enableModelListener: options.enableModelListener,
      reconnectBaseMs: options.reconnectBaseMs,
      reconnectMaxMs: options.reconnectMaxMs,
      handshakeTimeoutMs: options.handshakeTimeoutMs,
      highWaterMarkBytes: options.highWaterMarkBytes,
    });
    this.serverUrl = validated.serverUrl;
    this.runnerId = validated.runnerId;
    this.keypair = options.keypair;
    this.runnerVersion = validated.runnerVersion;
    this.exposedPorts = validated.exposedPorts;
    this.enableModelListener = validated.enableModelListener;
    this.reconnectBaseMs = validated.reconnectBaseMs;
    this.reconnectMaxMs = validated.reconnectMaxMs;
    this.handshakeTimeoutMs = validated.handshakeTimeoutMs;
    this.highWaterMarkBytes = validated.highWaterMarkBytes;
  }

  /** Successful authentications since start (reconnects re-authenticate). */
  get readyCount(): number {
    return this.readyCountValue;
  }

  /** Reconnect waits scheduled since start. */
  get reconnectAttempts(): number {
    return this.reconnectAttemptsValue;
  }

  get connected(): boolean {
    return this.mux !== null;
  }

  /** `http://127.0.0.1:<port>`: the LLM base URL desks use. Null when disabled. */
  get modelUrl(): string | null {
    const address = this.modelServer?.address();
    if (typeof address === 'string' || address === null || address === undefined) {
      return null;
    }
    return `http://127.0.0.1:${address.port}`;
  }

  /** The local address the model listener is bound to (null when disabled). */
  get modelBindAddress(): string | null {
    const address = this.modelServer?.address();
    if (typeof address === 'string' || address === null || address === undefined) {
      return null;
    }
    return address.address;
  }

  on(event: RunnerEvent, listener: (err?: Error) => void): () => void {
    if (event === 'ready') {
      const wrapper = (): void => {
        listener();
      };
      this.readyListeners.add(wrapper);
      return () => {
        this.readyListeners.delete(wrapper);
      };
    }
    const wrapper = (err: Error): void => {
      listener(err);
    };
    this.failedListeners.add(wrapper);
    return () => {
      this.failedListeners.delete(wrapper);
    };
  }

  /** Start the model listener and connect. Resolves on the first authentication. */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error('runner already started');
    }
    if (this.enableModelListener) {
      await this.startModelListener();
    }
    this.started = true;
    await new Promise<void>((resolve, reject) => {
      const offReady = this.on('ready', () => {
        offReady();
        offFailed();
        resolve();
      });
      const offFailed = this.on('failed', (err?: Error) => {
        offReady();
        offFailed();
        reject(err ?? new TunnelClosedError('runner failed'));
      });
      // The reconnect loop never rejects: every failure is either retried or
      // reported through 'failed'.
      this.runFiber = Effect.runFork(this.runEffect());
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.interruptHeartbeat();
    try {
      this.ws?.terminate();
    } catch {
      // Already gone.
    }
    this.ws = null;
    if (this.modelServer !== null) {
      const server = this.modelServer;
      this.modelServer = null;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    for (const resolve of this.closeResolvers.splice(0)) {
      resolve();
    }
    const fiber = this.runFiber;
    this.runFiber = null;
    if (fiber !== null) {
      await Effect.runPromise(Fiber.interrupt(fiber));
    }
  }

  private emitReady(): void {
    this.readyCountValue += 1;
    for (const listener of this.readyListeners) {
      listener();
    }
  }

  private emitFailed(err: Error): void {
    for (const listener of this.failedListeners) {
      listener(err);
    }
  }

  private runEffect(): Effect.Effect<void, never> {
    return Effect.gen({ self: this }, function* () {
      let attempt = 0;
      for (;;) {
        if (this.stopped) {
          return;
        }
        const outcome = yield* Effect.exit(
          Effect.gen({ self: this }, function* () {
            yield* this.connectOnce();
            attempt = 0;
            this.emitReady();
            this.lastCloseCode = null;
            yield* this.waitForClose();
            if (this.lastCloseCode !== null && FATAL_CLOSE_CODES.has(this.lastCloseCode)) {
              return yield* Effect.fail(
                new TunnelClosedError(
                  `connection closed (${this.lastCloseCode}): rejected by the server`,
                ),
              );
            }
          }),
        );
        let fatal: Error | null = null;
        if (Exit.isFailure(outcome)) {
          fatal = toError(Cause.squash(outcome.cause));
        }
        if (this.stopped) {
          return;
        }
        if (fatal !== null && isFatalError(fatal)) {
          this.emitFailed(fatal);
          this.stopped = true;
          return;
        }
        const waitMs = computeBackoff(attempt, this.reconnectBaseMs, this.reconnectMaxMs);
        attempt += 1;
        this.reconnectAttemptsValue += 1;
        yield* Effect.sleep(Duration.millis(waitMs));
      }
    });
  }

  private waitForClose(): Effect.Effect<void> {
    return Effect.callback<void>((resume) => {
      const resolve = (): void => {
        resume(Effect.void);
      };
      this.closeResolvers.push(resolve);
      return Effect.sync(() => {
        const index = this.closeResolvers.indexOf(resolve);
        if (index !== -1) {
          this.closeResolvers.splice(index, 1);
        }
      });
    });
  }

  private notifyClosed(): void {
    for (const resolve of this.closeResolvers.splice(0)) {
      resolve();
    }
  }

  private async interruptHeartbeat(): Promise<void> {
    const fiber = this.heartbeatFiber;
    this.heartbeatFiber = null;
    if (fiber !== null) {
      await Effect.runPromise(Fiber.interrupt(fiber));
    }
  }

  private connectOnce(): Effect.Effect<void, TunnelClosedError> {
    const ws = new WebSocket(this.serverUrl, { maxPayload: MAX_WS_PAYLOAD_BYTES });
    this.ws = ws;
    return Effect.gen({ self: this }, function* () {
      yield* this.openSocket(ws);
      if (this.stopped) {
        return yield* Effect.fail(new TunnelClosedError('runner stopped'));
      }
      yield* Effect.sync(() => {
        ws.send(
          JSON.stringify({
            type: 'hello',
            runner_id: this.runnerId,
            runner_version: this.runnerVersion,
            protocol_version: PROTOCOL_VERSION,
          }),
        );
      });
      const challenge = yield* this.waitForType(ws, 'challenge');
      if (challenge.type !== 'challenge') {
        return yield* Effect.fail(new TunnelClosedError('expected challenge'));
      }
      yield* Effect.sync(() => {
        ws.send(
          JSON.stringify({
            type: 'auth',
            signature: signNonce(this.keypair.privateKey, Buffer.from(challenge.nonce, 'base64')),
          }),
        );
      });
      yield* this.waitForType(ws, 'ready');
      if (this.stopped) {
        return yield* Effect.fail(new TunnelClosedError('runner stopped'));
      }
      this.installReadyConnection(ws);
    }).pipe(
      Effect.onExit((exit) => {
        if (Exit.isFailure(exit)) {
          try {
            ws.terminate();
          } catch {
            // Already gone.
          }
        }
        return Effect.void;
      }),
    );
  }

  private openSocket(ws: WebSocket): Effect.Effect<void, TunnelClosedError> {
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
        duration: Duration.millis(this.handshakeTimeoutMs),
        orElse: () => Effect.fail(new TunnelClosedError('connection timeout')),
      }),
    );
  }

  private waitForType(
    ws: WebSocket,
    expected: 'challenge' | 'ready',
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
          try {
            ws.close(CLOSE_MALFORMED, 'binary frame during handshake');
          } catch {
            // Already dying.
          }
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
        duration: Duration.millis(this.handshakeTimeoutMs),
        orElse: () => Effect.fail(new TunnelClosedError(`timeout waiting for ${expected}`)),
      }),
    );
  }

  private installReadyConnection(ws: WebSocket): void {
    const mux = new StreamMux(ws, 1, { highWaterMarkBytes: this.highWaterMarkBytes });
    this.mux = mux;
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const parsed = parseControlMessage(data.toString('utf8'), 'server-to-runner');
        if (!parsed.ok) {
          try {
            ws.close(parsed.code, parsed.reason);
          } catch {
            // Already dying.
          }
          return;
        }
        this.routeControl(mux, parsed.message);
      } else {
        mux.handleBinary(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
      }
    });
    ws.on('close', (code: number) => {
      this.teardownConnection(mux, ws, code);
    });
    ws.on('error', () => {
      // The close event below does the cleanup.
    });
    this.startHeartbeat(mux);
  }

  private startHeartbeat(mux: StreamMux): void {
    // Replace a previous connection's heartbeat if one is still running: an
    // orphaned fiber would keep pinging a dead mux and, since Effect timers are
    // not unref'd, keep the process alive.
    void this.interruptHeartbeat();
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
    this.heartbeatFiber = Effect.runFork(heartbeat);
  }

  private teardownConnection(mux: StreamMux, ws: WebSocket, code: number): void {
    if (this.ws === ws) {
      this.ws = null;
    }
    this.lastCloseCode = code;
    if (this.mux === mux) {
      this.mux = null;
    }
    void this.interruptHeartbeat();
    mux.failAll(new TunnelClosedError('connection to the server was lost'));
    this.notifyClosed();
  }

  private routeControl(mux: StreamMux, message: ControlMessage): void {
    switch (message.type) {
      case 'tunnel.open':
        this.handleTunnelOpen(mux, message.stream_id, message.port);
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
      case 'challenge':
      case 'ready':
        try {
          this.ws?.close(CLOSE_UNKNOWN_TYPE, `unexpected ${message.type}`);
        } catch {
          // Already dying.
        }
        break;
      default:
        try {
          this.ws?.close(CLOSE_UNKNOWN_TYPE, 'message not allowed');
        } catch {
          // Already dying.
        }
        break;
    }
  }

  private handleTunnelOpen(mux: StreamMux, streamId: number, port: number): void {
    // Stream ids are split by parity: the server opens even ids, this runner
    // odd ones. An odd or already-live id is a buggy or hostile server.
    if (streamId % 2 !== 0 || mux.hasStream(streamId)) {
      try {
        this.ws?.close(CLOSE_MALFORMED, `bad tunnel.open stream id ${streamId}`);
      } catch {
        // Already dying.
      }
      return;
    }
    if (!this.exposedPorts.includes(port)) {
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

  private async startModelListener(): Promise<void> {
    const server = net.createServer((socket) => {
      const mux = this.mux;
      if (mux === null) {
        socket.destroy();
        return;
      }
      const streamId = mux.allocateId();
      attachSocketToStream(mux, streamId, socket);
      try {
        mux.sendControl({ type: 'model.open', stream_id: streamId });
      } catch {
        socket.destroy();
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      // 127.0.0.1 only: the desk's LLM key travels here, so it must never be
      // reachable from the LAN. The test asserts the bound address.
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    this.modelServer = server;
  }
}

/** How often a ready connection sends a liveness heartbeat. */
const HEARTBEAT_INTERVAL_MS = 10000;

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
