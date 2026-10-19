import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import http, { type Server } from 'node:http';
import net, { type Socket } from 'node:net';
import { Duration, Effect, Fiber, Schedule, Schema } from 'effect';
import { WebSocketServer, type WebSocket } from 'ws';
import { DeskServer } from './desk-server.ts';
import { TunnelHttpAgent, createLoopbackPair } from './http-agent.ts';
import { randomNonce, verifyNonce, type KeyRegistry } from './keys.ts';
import { StreamMux, TunnelClosedError, attachSocketToStream } from './mux.ts';
import {
  CLOSE_AUTH,
  CLOSE_MALFORMED,
  CLOSE_REVOKED,
  CLOSE_UNKNOWN_TYPE,
  CLOSE_VERSION,
  MAX_WS_PAYLOAD_BYTES,
  isAcceptedProtocolVersion,
  parseControlMessage,
  type ControlMessage,
} from './protocol.ts';
import { closeQuietly } from './ws-close.ts';

const HOP_BY_HOP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade']);

const ServerOptionsSchema = Schema.Struct({
  heartbeatIntervalMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(10),
    Schema.isLessThanOrEqualTo(60000),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(15000))),
  heartbeatTimeoutMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(50),
    Schema.isLessThanOrEqualTo(300000),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(45000))),
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

/** The server options after the schema applied its defaults. */
type ServerOptionsDecoded = typeof ServerOptionsSchema.Type;

export interface TunnelServerOptions {
  registry: KeyRegistry;
  heartbeatIntervalMs?: number | undefined;
  heartbeatTimeoutMs?: number | undefined;
  handshakeTimeoutMs?: number | undefined;
  highWaterMarkBytes?: number | undefined;
}

export interface ServerConn {
  ws: WebSocket;
  state: 'hello' | 'auth' | 'ready';
  runnerId: string | null;
  nonce: Buffer | null;
  mux: StreamMux | null;
  lastPongAt: number;
  handshakeFiber: Fiber.Fiber<void, never> | null;
  pendingOpens: Map<number, PendingOpen>;
}

export interface PendingOpen {
  client: net.Socket;
  bridge: net.Socket;
  fail: (err: Error) => void;
}

/**
 * The mutable state of one `TunnelServer`; the class keeps it private and hands it to
 * the sibling modules.
 */
export interface ServerRuntime {
  readonly registry: KeyRegistry;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTimeoutMs: number;
  readonly handshakeTimeoutMs: number;
  readonly highWaterMarkBytes: number;
  readonly httpServer: Server;
  readonly wsServer: WebSocketServer;
  readonly conns: Set<ServerConn>;
  readonly live: Map<string, ServerConn>;
  readonly previews: Map<string, { runnerId: string; port: number }>;
  readonly desk: DeskServer;
  readonly unsubscribeRevoke: () => void;
  readonly heartbeatFiber: Fiber.Fiber<number, never>;
  closed: boolean;
  droppedFromDeadConns: number;
}

function handleConnection(rt: ServerRuntime, ws: WebSocket): void {
  const conn: ServerConn = {
    ws,
    state: 'hello',
    runnerId: null,
    nonce: null,
    mux: null,
    lastPongAt: Date.now(),
    handshakeFiber: null,
    pendingOpens: new Map(),
  };
  rt.conns.add(conn);
  // One fiber per connection: the handshake deadline. It is interrupted
  // where the old `clearTimeout` ran (on ready, on drop and in `close`).
  conn.handshakeFiber = Effect.runFork(
    Effect.sleep(Duration.millis(rt.handshakeTimeoutMs)).pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (conn.state !== 'ready') {
            closeWith(conn, CLOSE_AUTH, 'handshake timeout');
          }
        }),
      ),
    ),
  );

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      handleBinary(conn, bytes);
    } else {
      handleText(rt, conn, data.toString('utf8'));
    }
  });
  ws.on('pong', () => {
    conn.lastPongAt = Date.now();
  });
  ws.on('close', (code: number, reason: Buffer) => {
    dropConn(rt, conn, code, reason.toString());
  });
  ws.on('error', () => {
    // The close handler below does the cleanup.
  });
}

export function dropConn(rt: ServerRuntime, conn: ServerConn, code: number, reason: string): void {
  const handshake = takeHandshakeFiber(conn);
  if (handshake !== null) {
    Effect.runFork(Fiber.interrupt(handshake));
  }
  rt.conns.delete(conn);
  if (conn.mux !== null) {
    rt.droppedFromDeadConns += conn.mux.unknownStreamsDropped;
    conn.mux.failAll(
      new TunnelClosedError(`connection closed (${code}): ${reason || 'no reason'}`),
    );
  }
  if (conn.runnerId !== null) {
    const wasLive = rt.live.get(conn.runnerId) === conn;
    if (wasLive) {
      rt.live.delete(conn.runnerId);
    }
    // A connection that only sent `hello`, or that a newer one replaced, must not fail
    // the requests that belong to the live connection.
    if (wasLive || (conn.state === 'ready' && !rt.live.has(conn.runnerId))) {
      rt.desk.failRunner(conn.runnerId);
    }
  }
}

function closeWith(conn: ServerConn, code: number, reason: string): void {
  closeQuietly(conn.ws, code, reason);
}

function takeHandshakeFiber(conn: ServerConn): Fiber.Fiber<void, never> | null {
  const fiber = conn.handshakeFiber;
  conn.handshakeFiber = null;
  return fiber;
}

function handleBinary(conn: ServerConn, bytes: Buffer): void {
  if (conn.state !== 'ready' || conn.mux === null) {
    closeWith(conn, CLOSE_MALFORMED, 'binary frame before authentication');
    return;
  }
  conn.mux.handleBinary(bytes);
}

function handleText(rt: ServerRuntime, conn: ServerConn, raw: string): void {
  const parsed = parseControlMessage(raw, 'runner-to-server');
  if (!parsed.ok) {
    closeWith(conn, parsed.code, parsed.reason);
    return;
  }
  const message = parsed.message;
  if (conn.state === 'hello') {
    if (message.type !== 'hello') {
      closeWith(conn, CLOSE_UNKNOWN_TYPE, 'expected hello first');
      return;
    }
    handleHello(rt, conn, message.runner_id, message.protocol_version);
    return;
  }
  if (conn.state === 'auth') {
    if (message.type !== 'auth') {
      closeWith(conn, CLOSE_UNKNOWN_TYPE, 'expected auth');
      return;
    }
    handleAuth(rt, conn, message.signature);
    return;
  }
  handleReadyMessage(rt, conn, message);
}

function handleHello(
  rt: ServerRuntime,
  conn: ServerConn,
  runnerId: string,
  protocolVersion: number,
): void {
  if (!isAcceptedProtocolVersion(protocolVersion)) {
    closeWith(conn, CLOSE_VERSION, `unsupported protocol version ${protocolVersion}`);
    return;
  }
  const publicKey = rt.registry.getPublicKey(runnerId);
  if (publicKey === null) {
    closeWith(conn, CLOSE_AUTH, 'unknown runner');
    return;
  }
  conn.runnerId = runnerId;
  conn.nonce = randomNonce();
  conn.state = 'auth';
  try {
    conn.ws.send(JSON.stringify({ type: 'challenge', nonce: conn.nonce.toString('base64') }));
  } catch {
    // The close handler cleans up.
  }
}

function handleAuth(rt: ServerRuntime, conn: ServerConn, signature: string): void {
  const runnerId = conn.runnerId;
  const nonce = conn.nonce;
  conn.nonce = null;
  if (runnerId === null || nonce === null) {
    closeWith(conn, CLOSE_AUTH, 'authentication failed');
    return;
  }
  // Re-read the key: it may have been revoked mid-handshake.
  const publicKey = rt.registry.getPublicKey(runnerId);
  if (publicKey === null || !verifyNonce(publicKey, nonce, signature)) {
    closeWith(conn, CLOSE_AUTH, 'authentication failed');
    return;
  }
  const previous = rt.live.get(runnerId);
  if (previous !== undefined && previous !== conn) {
    closeQuietly(previous.ws, 1000, 'replaced by a new connection');
  }
  conn.state = 'ready';
  conn.mux = new StreamMux(conn.ws, 2, { highWaterMarkBytes: rt.highWaterMarkBytes });
  conn.lastPongAt = Date.now();
  const handshake = takeHandshakeFiber(conn);
  if (handshake !== null) {
    Effect.runFork(Fiber.interrupt(handshake));
  }
  rt.live.set(runnerId, conn);
  try {
    conn.ws.send(JSON.stringify({ type: 'ready' }));
  } catch {
    // The close handler cleans up.
  }
}

function handleReadyMessage(rt: ServerRuntime, conn: ServerConn, message: ControlMessage): void {
  const mux = conn.mux;
  if (mux === null) {
    return;
  }
  switch (message.type) {
    case 'tunnel.refused':
      failStream(conn, message.stream_id, `tunnel refused: ${message.reason}`);
      break;
    case 'tunnel.closed':
      failStream(conn, message.stream_id, `tunnel closed by runner: ${message.reason}`);
      break;
    case 'tunnel.pause':
      mux.handlePause(message.stream_id);
      break;
    case 'tunnel.resume':
      mux.handleResume(message.stream_id);
      break;
    case 'heartbeat':
      break;
    default:
      if (rt.desk.route(conn.runnerId, message)) break;
      closeWith(conn, CLOSE_UNKNOWN_TYPE, 'message not allowed after authentication');
      break;
  }
}

function failStream(conn: ServerConn, streamId: number, reason: string): void {
  // Only the connection that sent the message is affected: stream ids are
  // allocated per connection, so another runner routinely uses the same id.
  const pending = conn.pendingOpens.get(streamId);
  if (pending !== undefined) {
    pending.fail(new TunnelClosedError(reason));
    return;
  }
  if (conn.mux !== null) {
    conn.mux.failStream(streamId, new TunnelClosedError(reason));
  }
}

// effect-plain: the heartbeat sweep runs on one Effect fiber in server.ts.
/** Terminate ready connections that stopped responding, ping the rest. */
function checkHeartbeats(rt: ServerRuntime): void {
  const now = Date.now();
  for (const conn of rt.conns) {
    if (conn.state !== 'ready') {
      continue;
    }
    if (now - conn.lastPongAt > rt.heartbeatTimeoutMs) {
      closeQuietly(conn.ws);
    } else {
      try {
        conn.ws.ping();
      } catch {
        // The next check terminates it.
      }
    }
  }
}

// effect-plain: the engine streams are loopback sockets over the mux, which owns the Effect.
/**
 * Opens a stream to a runner port and returns a connected TCP socket; refusals and
 * drops destroy it with a `TunnelClosedError`.
 */
async function openEngineStream(
  rt: ServerRuntime,
  runnerId: string,
  port: number,
): Promise<Socket> {
  const conn = rt.live.get(runnerId);
  if (conn === undefined || conn.state !== 'ready' || conn.mux === null) {
    throw new TunnelClosedError(`runner ${runnerId} is not connected`);
  }
  const mux = conn.mux;
  const streamId = mux.allocateId();
  const { client, server: bridge } = await createLoopbackPair();
  if (conn.state !== 'ready') {
    client.destroy();
    bridge.destroy();
    throw new TunnelClosedError(`runner ${runnerId} disconnected while opening the stream`);
  }
  attachSocketToStream(mux, streamId, bridge, {
    onStreamFailed: (err) => {
      if (!client.destroyed) {
        client.destroy(err);
      }
    },
  });
  const fail = (err: Error): void => {
    conn.pendingOpens.delete(streamId);
    mux.unregisterStream(streamId);
    if (!client.destroyed) {
      client.destroy(err);
    }
    if (!bridge.destroyed) {
      bridge.destroy();
    }
  };
  conn.pendingOpens.set(streamId, { client, bridge, fail });
  bridge.on('close', () => {
    conn.pendingOpens.delete(streamId);
  });
  try {
    mux.sendControl({ type: 'tunnel.open', stream_id: streamId, port });
  } catch (err) {
    fail(err instanceof Error ? err : new TunnelClosedError('send failed'));
    throw err;
  }
  return client;
}

/** An `http.Agent` that reaches one runner's exposed ports through the tunnel. */
function engineAgent(rt: ServerRuntime, runnerId: string): TunnelHttpAgent {
  return new TunnelHttpAgent((port) => openEngineStream(rt, runnerId, port));
}

// effect-plain: the preview proxy is plain node:http; the tunnel supplies the stream.
/**
 * Mint a preview token for one runner port: 16 random bytes (128 bits), base64url; the
 * token itself is the capability.
 */
function createPreviewToken(rt: ServerRuntime, runnerId: string, port: number): string {
  const token = randomBytes(16).toString('base64url');
  rt.previews.set(token, { runnerId, port });
  return token;
}

async function handlePreviewRequest(
  rt: ServerRuntime,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const rawUrl = req.url ?? '/';
  const [pathname = '/', query = ''] = rawUrl.split('?');
  const segments = pathname.split('/');
  if (segments[1] !== 'preview' || !segments[2]) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const token = segments[2];
  const entry = rt.previews.get(token);
  if (entry === undefined || !rt.live.has(entry.runnerId)) {
    // Unknown token, or the token's runner is gone: same answer either way.
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const rest = `/${segments.slice(3).join('/')}${query === '' ? '' : `?${query}`}`;
  const agent = new TunnelHttpAgent((port) => openEngineStream(rt, entry.runnerId, port));
  const headers = { ...req.headers };
  for (const name of HOP_BY_HOP_HEADERS) {
    delete headers[name];
  }
  const upstream = http.request(
    {
      host: 'tunnel',
      port: entry.port,
      method: req.method ?? 'GET',
      path: rest,
      headers,
      agent,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  upstream.on('error', (err: Error) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    if (!rt.live.has(entry.runnerId)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    } else {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`preview failed: ${err.message}`);
    }
  });
  req.pipe(upstream);
}

export class TunnelServer {
  private readonly rt: ServerRuntime;

  private constructor(registry: KeyRegistry, validated: ServerOptionsDecoded) {
    const live = new Map<string, ServerConn>();
    const desk = new DeskServer((runnerId) => live.get(runnerId)?.mux ?? null);
    let rt: ServerRuntime;

    const httpServer = http.createServer((req, res) => {
      void handlePreviewRequest(rt, req, res);
    });
    const wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });

    // One Effect program: `checkHeartbeats` repeated at a fixed spacing, first run after
    // one interval; `catchDefect` keeps the sweep alive and `close` interrupts the fiber.
    const heartbeatFiber = Effect.runFork(
      Effect.repeat(
        Effect.sync(() => {
          checkHeartbeats(rt);
        }).pipe(Effect.catchDefect(() => Effect.sync(() => undefined))),
        Schedule.spaced(Duration.millis(validated.heartbeatIntervalMs)),
      ).pipe(Effect.delay(Duration.millis(validated.heartbeatIntervalMs))),
    );

    const unsubscribeRevoke = registry.onRevoke((runnerId) => {
      const conn = rt.live.get(runnerId);
      if (conn !== undefined) {
        closeQuietly(conn.ws, CLOSE_REVOKED, 'runner key revoked');
      }
    });

    rt = {
      registry,
      heartbeatIntervalMs: validated.heartbeatIntervalMs,
      heartbeatTimeoutMs: validated.heartbeatTimeoutMs,
      handshakeTimeoutMs: validated.handshakeTimeoutMs,
      highWaterMarkBytes: validated.highWaterMarkBytes,
      httpServer,
      wsServer,
      conns: new Set<ServerConn>(),
      live,
      previews: new Map<string, { runnerId: string; port: number }>(),
      desk,
      unsubscribeRevoke,
      heartbeatFiber,
      closed: false,
      droppedFromDeadConns: 0,
    };

    httpServer.on('upgrade', (req, socket, head) => {
      const pathname = (req.url ?? '/').split('?')[0];
      if (pathname !== '/tunnel') {
        socket.destroy();
        return;
      }
      wsServer.handleUpgrade(req, socket, head, (ws) => {
        wsServer.emit('connection', ws, req);
      });
    });
    wsServer.on('connection', (ws: WebSocket) => {
      handleConnection(rt, ws);
    });

    this.rt = rt;
  }

  static async start(options: TunnelServerOptions, port = 0): Promise<TunnelServer> {
    const validated = Schema.decodeUnknownSync(ServerOptionsSchema, {
      onExcessProperty: 'error',
    })({
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs,
      handshakeTimeoutMs: options.handshakeTimeoutMs,
      highWaterMarkBytes: options.highWaterMarkBytes,
    });
    const server = new TunnelServer(options.registry, validated);
    await new Promise<void>((resolve, reject) => {
      server.rt.httpServer.once('error', reject);
      server.rt.httpServer.listen(port, '127.0.0.1', () => {
        server.rt.httpServer.removeListener('error', reject);
        resolve();
      });
    });
    return server;
  }

  get port(): number {
    const address = this.rt.httpServer.address();
    if (typeof address === 'string' || address === null) {
      throw new TunnelClosedError('server is not listening');
    }
    return address.port;
  }

  get wsUrl(): string {
    return `ws://127.0.0.1:${this.port}/tunnel`;
  }

  get previewBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Binary frames for unknown streams, dropped and counted, across all connections. */
  get unknownStreamsDropped(): number {
    let total = this.rt.droppedFromDeadConns;
    for (const conn of this.rt.conns) {
      if (conn.mux !== null) {
        total += conn.mux.unknownStreamsDropped;
      }
    }
    return total;
  }

  get desk(): DeskServer {
    return this.rt.desk;
  }

  isRunnerLive(runnerId: string): boolean {
    return this.rt.live.has(runnerId);
  }

  /** Drop one runner's connection (admin kill switch). It may reconnect. */
  disconnectRunner(runnerId: string): boolean {
    const conn = this.rt.live.get(runnerId);
    if (conn === undefined) {
      return false;
    }
    closeQuietly(conn.ws, 1001, 'server is going away');
    return true;
  }

  /**
   * Mint a preview token for one runner port: 16 random bytes (128 bits),
   * base64url; the token itself is the capability.
   */
  createPreviewToken(runnerId: string, port: number): string {
    return createPreviewToken(this.rt, runnerId, port);
  }

  /** Opens a stream to a runner port and returns a connected TCP socket. */
  openEngineStream(runnerId: string, port: number): Promise<Socket> {
    return openEngineStream(this.rt, runnerId, port);
  }

  /** An `http.Agent` that reaches one runner's exposed ports through the tunnel. */
  engineAgent(runnerId: string): TunnelHttpAgent {
    return engineAgent(this.rt, runnerId);
  }

  async close(): Promise<void> {
    const rt = this.rt;
    if (rt.closed) {
      return;
    }
    rt.closed = true;
    await Effect.runPromise(Fiber.interrupt(rt.heartbeatFiber));
    rt.unsubscribeRevoke();
    for (const conn of rt.conns) {
      const handshake = takeHandshakeFiber(conn);
      if (handshake !== null) {
        await Effect.runPromise(Fiber.interrupt(handshake));
      }
      closeQuietly(conn.ws);
    }
    rt.wsServer.close();
    await once(rt.httpServer.close(), 'close').catch(() => undefined);
  }
}
