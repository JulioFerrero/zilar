import net from 'node:net';
import { WebSocket } from 'ws';
import { z } from 'zod';
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

const RunnerOptionsSchema = z.strictObject({
  serverUrl: z.string().url().startsWith('ws://'),
  runnerId: z.string().min(1).max(128),
  runnerVersion: z.string().min(1).max(64).default('0.1.0'),
  exposedPorts: z.array(z.number().int().min(1).max(65535)).default([]),
  enableModelListener: z.boolean().default(true),
  reconnectBaseMs: z.number().int().min(10).max(60000).default(250),
  reconnectMaxMs: z.number().int().min(50).max(300000).default(5000),
  handshakeTimeoutMs: z.number().int().min(100).max(60000).default(10000),
  highWaterMarkBytes: z
    .number()
    .int()
    .min(4096)
    .max(64 * 1024 * 1024)
    .default(1024 * 1024),
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
  private readonly exposedPorts: number[];
  private readonly enableModelListener: boolean;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly highWaterMarkBytes: number;

  private ws: WebSocket | null = null;
  private mux: StreamMux | null = null;
  private modelServer: net.Server | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private runPromise: Promise<void> | null = null;
  private lastCloseCode: number | null = null;
  private readonly readyListeners = new Set<() => void>();
  private readonly failedListeners = new Set<(err: Error) => void>();
  private closeResolvers: Array<() => void> = [];

  private readyCountValue = 0;
  private reconnectAttemptsValue = 0;

  constructor(options: RunnerOptions) {
    const validated = RunnerOptionsSchema.parse({
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
    if (this.runPromise !== null) {
      throw new Error('runner already started');
    }
    if (this.enableModelListener) {
      await this.startModelListener();
    }
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
      // run() never rejects: every failure is either retried or reported via 'failed'.
      this.runPromise = this.run();
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
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
    await this.runPromise;
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

  private async run(): Promise<void> {
    let attempt = 0;
    for (;;) {
      if (this.stopped) {
        return;
      }
      let fatal: Error | null = null;
      try {
        await this.connectOnce();
        attempt = 0;
        this.emitReady();
        this.lastCloseCode = null;
        await this.waitForClose();
        if (this.lastCloseCode !== null && FATAL_CLOSE_CODES.has(this.lastCloseCode)) {
          throw new TunnelClosedError(
            `connection closed (${this.lastCloseCode}): rejected by the server`,
          );
        }
      } catch (err) {
        fatal = err instanceof Error ? err : new Error(String(err));
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
      await this.delayOrStopped(waitMs);
    }
  }

  private async delayOrStopped(ms: number): Promise<void> {
    if (this.stopped) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref();
      this.closeResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private waitForClose(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.closeResolvers.push(resolve);
    });
  }

  private notifyClosed(): void {
    for (const resolve of this.closeResolvers.splice(0)) {
      resolve();
    }
  }

  private async connectOnce(): Promise<void> {
    const ws = new WebSocket(this.serverUrl, { maxPayload: MAX_WS_PAYLOAD_BYTES });
    this.ws = ws;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new TunnelClosedError('connection timeout'));
        }, this.handshakeTimeoutMs);
        timer.unref();
        ws.once('open', () => {
          clearTimeout(timer);
          resolve();
        });
        ws.once('error', (err: Error) => {
          clearTimeout(timer);
          reject(new TunnelClosedError(`connection failed: ${err.message}`));
        });
      });
      if (this.stopped) {
        throw new TunnelClosedError('runner stopped');
      }
      ws.send(
        JSON.stringify({
          type: 'hello',
          runner_id: this.runnerId,
          runner_version: this.runnerVersion,
          protocol_version: PROTOCOL_VERSION,
        }),
      );
      const challenge = await this.waitForType(ws, 'challenge');
      if (challenge.type !== 'challenge') {
        throw new TunnelClosedError('expected challenge');
      }
      ws.send(
        JSON.stringify({
          type: 'auth',
          signature: signNonce(this.keypair.privateKey, Buffer.from(challenge.nonce, 'base64')),
        }),
      );
      await this.waitForType(ws, 'ready');
      if (this.stopped) {
        throw new TunnelClosedError('runner stopped');
      }
      this.installReadyConnection(ws);
    } catch (err) {
      try {
        ws.terminate();
      } catch {
        // Already gone.
      }
      throw err;
    }
  }

  private waitForType(ws: WebSocket, expected: 'challenge' | 'ready'): Promise<ControlMessage> {
    return new Promise<ControlMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        finish(new TunnelClosedError(`timeout waiting for ${expected}`));
      }, this.handshakeTimeoutMs);
      timer.unref();
      const finish = (outcome: ControlMessage | Error): void => {
        clearTimeout(timer);
        ws.removeListener('message', onMessage);
        ws.removeListener('close', onClose);
        ws.removeListener('error', onError);
        if (outcome instanceof Error) {
          reject(outcome);
        } else {
          resolve(outcome);
        }
      };
      const onMessage = (data: unknown, isBinary: boolean): void => {
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
      };
      const onClose = (code: number, reason: Buffer): void => {
        finish(
          new TunnelClosedError(
            `handshake connection closed (${code}): ${reason.toString() || 'no reason'}`,
          ),
        );
      };
      const onError = (err: Error): void => {
        finish(new TunnelClosedError(`handshake failed: ${err.message}`));
      };
      ws.on('message', onMessage);
      ws.on('close', onClose);
      ws.on('error', onError);
    });
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
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => {
      try {
        mux.sendControl({ type: 'heartbeat', at: Date.now() });
      } catch {
        // The tunnel is dying; the close handler cleans up.
      }
    }, 10000);
    this.heartbeatTimer.unref();
  }

  private teardownConnection(mux: StreamMux, ws: WebSocket, code: number): void {
    if (this.ws === ws) {
      this.ws = null;
    }
    this.lastCloseCode = code;
    if (this.mux === mux) {
      this.mux = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
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
