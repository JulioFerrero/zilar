import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
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
import { randomNonce, verifyNonce, type KeyRegistry } from './keys.ts';
import { StreamMux, TunnelClosedError, attachSocketToStream } from './mux.ts';
import { TunnelHttpAgent, createLoopbackPair } from './http-agent.ts';

const HOP_BY_HOP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade']);

const ServerOptionsSchema = z.strictObject({
  gatewayUrl: z.string().url().startsWith('http://'),
  heartbeatIntervalMs: z.number().int().min(10).max(60000).default(15000),
  heartbeatTimeoutMs: z.number().int().min(50).max(300000).default(45000),
  handshakeTimeoutMs: z.number().int().min(100).max(60000).default(10000),
  highWaterMarkBytes: z
    .number()
    .int()
    .min(4096)
    .max(64 * 1024 * 1024)
    .default(1024 * 1024),
});

export interface TunnelServerOptions {
  registry: KeyRegistry;
  /** The one gateway model traffic may reach, e.g. `http://127.0.0.1:4000`. HTTP only for the spike. */
  gatewayUrl: string;
  heartbeatIntervalMs?: number | undefined;
  heartbeatTimeoutMs?: number | undefined;
  handshakeTimeoutMs?: number | undefined;
  highWaterMarkBytes?: number | undefined;
}

interface ServerConn {
  ws: WebSocket;
  state: 'hello' | 'auth' | 'ready';
  runnerId: string | null;
  nonce: Buffer | null;
  mux: StreamMux | null;
  lastPongAt: number;
  handshakeTimer: NodeJS.Timeout | null;
  /** Engine streams this connection opened but the runner has not settled yet. */
  pendingOpens: Map<number, PendingOpen>;
}

interface PendingOpen {
  client: net.Socket;
  bridge: net.Socket;
  fail: (err: Error) => void;
}

export class TunnelServer {
  private readonly registry: KeyRegistry;
  private readonly gatewayHost: string;
  private readonly gatewayPort: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly highWaterMarkBytes: number;

  private readonly httpServer: http.Server;
  private readonly wsServer: WebSocketServer;
  private readonly conns = new Set<ServerConn>();
  private readonly live = new Map<string, ServerConn>();
  private readonly previews = new Map<string, { runnerId: string; port: number }>();
  private readonly heartbeatTimer: NodeJS.Timeout;
  private readonly unsubscribeRevoke: () => void;
  private closed = false;
  private droppedFromDeadConns = 0;

  private constructor(registry: KeyRegistry, validated: z.infer<typeof ServerOptionsSchema>) {
    this.registry = registry;
    const gateway = new URL(validated.gatewayUrl);
    this.gatewayHost = gateway.hostname;
    this.gatewayPort = gateway.port === '' ? 80 : Number(gateway.port);
    this.heartbeatIntervalMs = validated.heartbeatIntervalMs;
    this.heartbeatTimeoutMs = validated.heartbeatTimeoutMs;
    this.handshakeTimeoutMs = validated.handshakeTimeoutMs;
    this.highWaterMarkBytes = validated.highWaterMarkBytes;

    this.httpServer = http.createServer((req, res) => {
      void this.handlePreviewRequest(req, res);
    });
    this.httpServer.on('upgrade', (req, socket, head) => {
      const pathname = (req.url ?? '/').split('?')[0];
      if (pathname !== '/tunnel') {
        socket.destroy();
        return;
      }
      this.wsServer.handleUpgrade(req, socket, head, (ws) => {
        this.wsServer.emit('connection', ws, req);
      });
    });
    this.wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });
    this.wsServer.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeats();
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();

    this.unsubscribeRevoke = registry.onRevoke((runnerId) => {
      const conn = this.live.get(runnerId);
      if (conn !== undefined) {
        try {
          conn.ws.close(CLOSE_REVOKED, 'runner key revoked');
        } catch {
          // Already dying; the close handler cleans up.
        }
      }
    });
  }

  static async start(options: TunnelServerOptions, port = 0): Promise<TunnelServer> {
    const validated = ServerOptionsSchema.parse({
      gatewayUrl: options.gatewayUrl,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs,
      handshakeTimeoutMs: options.handshakeTimeoutMs,
      highWaterMarkBytes: options.highWaterMarkBytes,
    });
    const server = new TunnelServer(options.registry, validated);
    await new Promise<void>((resolve, reject) => {
      server.httpServer.once('error', reject);
      server.httpServer.listen(port, '127.0.0.1', () => {
        server.httpServer.removeListener('error', reject);
        resolve();
      });
    });
    return server;
  }

  get port(): number {
    const address = this.httpServer.address();
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
    let total = this.droppedFromDeadConns;
    for (const conn of this.conns) {
      if (conn.mux !== null) {
        total += conn.mux.unknownStreamsDropped;
      }
    }
    return total;
  }

  isRunnerLive(runnerId: string): boolean {
    return this.live.has(runnerId);
  }

  /** Drop one runner's connection (admin kill switch). It may reconnect. */
  disconnectRunner(runnerId: string): boolean {
    const conn = this.live.get(runnerId);
    if (conn === undefined) {
      return false;
    }
    try {
      conn.ws.close(1001, 'server is going away');
    } catch {
      // Already dying; the close handler cleans up.
    }
    return true;
  }

  /**
   * Mint a preview token for one runner port. The 16 random bytes are
   * 128 bits, base64url-encoded; the token is the capability (room-member
   * authorization is M3 work, see the task Report).
   */
  createPreviewToken(runnerId: string, port: number): string {
    const token = randomBytes(16).toString('base64url');
    this.previews.set(token, { runnerId, port });
    return token;
  }

  /**
   * Open a stream to a runner port and return the local end as a connected
   * TCP socket. Refusals and drops destroy the socket with a TunnelClosedError.
   */
  async openEngineStream(runnerId: string, port: number): Promise<net.Socket> {
    const conn = this.live.get(runnerId);
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
  engineAgent(runnerId: string): TunnelHttpAgent {
    return new TunnelHttpAgent((port) => this.openEngineStream(runnerId, port));
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearInterval(this.heartbeatTimer);
    this.unsubscribeRevoke();
    for (const conn of this.conns) {
      try {
        conn.ws.terminate();
      } catch {
        // Already gone.
      }
    }
    this.wsServer.close();
    await once(this.httpServer.close(), 'close').catch(() => undefined);
  }

  private handleConnection(ws: WebSocket): void {
    const conn: ServerConn = {
      ws,
      state: 'hello',
      runnerId: null,
      nonce: null,
      mux: null,
      lastPongAt: Date.now(),
      handshakeTimer: null,
      pendingOpens: new Map(),
    };
    this.conns.add(conn);
    conn.handshakeTimer = setTimeout(() => {
      if (conn.state !== 'ready') {
        try {
          ws.close(CLOSE_AUTH, 'handshake timeout');
        } catch {
          // Already gone.
        }
      }
    }, this.handshakeTimeoutMs);
    conn.handshakeTimer.unref();

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        this.handleBinary(conn, bytes);
      } else {
        this.handleText(conn, data.toString('utf8'));
      }
    });
    ws.on('pong', () => {
      conn.lastPongAt = Date.now();
    });
    ws.on('close', (code: number, reason: Buffer) => {
      this.dropConn(conn, code, reason.toString());
    });
    ws.on('error', () => {
      // The close handler below does the cleanup.
    });
  }

  private dropConn(conn: ServerConn, code: number, reason: string): void {
    if (conn.handshakeTimer !== null) {
      clearTimeout(conn.handshakeTimer);
      conn.handshakeTimer = null;
    }
    this.conns.delete(conn);
    if (conn.mux !== null) {
      this.droppedFromDeadConns += conn.mux.unknownStreamsDropped;
      conn.mux.failAll(
        new TunnelClosedError(`connection closed (${code}): ${reason || 'no reason'}`),
      );
    }
    if (conn.runnerId !== null && this.live.get(conn.runnerId) === conn) {
      this.live.delete(conn.runnerId);
    }
  }

  private closeWith(conn: ServerConn, code: number, reason: string): void {
    try {
      conn.ws.close(code, reason);
    } catch {
      // Already dying.
    }
  }

  private handleBinary(conn: ServerConn, bytes: Buffer): void {
    if (conn.state !== 'ready' || conn.mux === null) {
      this.closeWith(conn, CLOSE_MALFORMED, 'binary frame before authentication');
      return;
    }
    conn.mux.handleBinary(bytes);
  }

  private handleText(conn: ServerConn, raw: string): void {
    const parsed = parseControlMessage(raw, 'runner-to-server');
    if (!parsed.ok) {
      this.closeWith(conn, parsed.code, parsed.reason);
      return;
    }
    const message = parsed.message;
    if (conn.state === 'hello') {
      if (message.type !== 'hello') {
        this.closeWith(conn, CLOSE_UNKNOWN_TYPE, 'expected hello first');
        return;
      }
      this.handleHello(conn, message.runner_id, message.protocol_version);
      return;
    }
    if (conn.state === 'auth') {
      if (message.type !== 'auth') {
        this.closeWith(conn, CLOSE_UNKNOWN_TYPE, 'expected auth');
        return;
      }
      this.handleAuth(conn, message.signature);
      return;
    }
    this.handleReadyMessage(conn, message);
  }

  private handleHello(conn: ServerConn, runnerId: string, protocolVersion: number): void {
    if (protocolVersion !== PROTOCOL_VERSION) {
      this.closeWith(conn, CLOSE_VERSION, `unsupported protocol version ${protocolVersion}`);
      return;
    }
    const publicKey = this.registry.getPublicKey(runnerId);
    if (publicKey === null) {
      this.closeWith(conn, CLOSE_AUTH, 'unknown runner');
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

  private handleAuth(conn: ServerConn, signature: string): void {
    const runnerId = conn.runnerId;
    const nonce = conn.nonce;
    conn.nonce = null;
    if (runnerId === null || nonce === null) {
      this.closeWith(conn, CLOSE_AUTH, 'authentication failed');
      return;
    }
    // Re-read the key: it may have been revoked mid-handshake.
    const publicKey = this.registry.getPublicKey(runnerId);
    if (publicKey === null || !verifyNonce(publicKey, nonce, signature)) {
      this.closeWith(conn, CLOSE_AUTH, 'authentication failed');
      return;
    }
    const previous = this.live.get(runnerId);
    if (previous !== undefined && previous !== conn) {
      try {
        previous.ws.close(1000, 'replaced by a new connection');
      } catch {
        // Already gone.
      }
    }
    conn.state = 'ready';
    conn.mux = new StreamMux(conn.ws, 2, { highWaterMarkBytes: this.highWaterMarkBytes });
    conn.lastPongAt = Date.now();
    if (conn.handshakeTimer !== null) {
      clearTimeout(conn.handshakeTimer);
      conn.handshakeTimer = null;
    }
    this.live.set(runnerId, conn);
    try {
      conn.ws.send(JSON.stringify({ type: 'ready' }));
    } catch {
      // The close handler cleans up.
    }
  }

  private handleReadyMessage(conn: ServerConn, message: ControlMessage): void {
    const mux = conn.mux;
    if (mux === null) {
      return;
    }
    switch (message.type) {
      case 'model.open':
        this.handleModelOpen(conn, mux, message.stream_id);
        break;
      case 'tunnel.refused':
        this.failStream(conn, message.stream_id, `tunnel refused: ${message.reason}`);
        break;
      case 'tunnel.closed':
        this.failStream(conn, message.stream_id, `tunnel closed by runner: ${message.reason}`);
        break;
      case 'tunnel.pause':
        mux.handlePause(message.stream_id);
        break;
      case 'tunnel.resume':
        mux.handleResume(message.stream_id);
        break;
      case 'heartbeat':
        // Validated and accepted; liveness itself is tracked by ping/pong.
        break;
      default:
        this.closeWith(conn, CLOSE_UNKNOWN_TYPE, 'message not allowed after authentication');
        break;
    }
  }

  private failStream(conn: ServerConn, streamId: number, reason: string): void {
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

  private handleModelOpen(conn: ServerConn, mux: StreamMux, streamId: number): void {
    // Stream ids are split by parity: the server opens even ids, the runner
    // odd ones. An even or already-live id is a buggy or hostile runner.
    if (streamId % 2 === 0 || mux.hasStream(streamId)) {
      this.closeWith(conn, CLOSE_MALFORMED, `bad model.open stream id ${streamId}`);
      return;
    }
    // The bytes are piped to the one configured gateway, whatever they say:
    // absolute-form URLs and foreign Host headers still land on the gateway
    // because the destination never comes from the request.
    const gateway = net.connect(this.gatewayPort, this.gatewayHost);
    attachSocketToStream(mux, streamId, gateway);
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    for (const conn of this.conns) {
      if (conn.state !== 'ready') {
        continue;
      }
      if (now - conn.lastPongAt > this.heartbeatTimeoutMs) {
        try {
          conn.ws.terminate();
        } catch {
          // Already gone; the close handler cleans up.
        }
      } else {
        try {
          conn.ws.ping();
        } catch {
          // The next check terminates it.
        }
      }
    }
  }

  private async handlePreviewRequest(
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
    const entry = this.previews.get(token);
    if (entry === undefined || !this.live.has(entry.runnerId)) {
      // Unknown token, or the token's runner is gone: same answer either way.
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const rest = `/${segments.slice(3).join('/')}${query === '' ? '' : `?${query}`}`;
    const agent = new TunnelHttpAgent((port) => this.openEngineStream(entry.runnerId, port));
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
      if (!this.live.has(entry.runnerId)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
      } else {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end(`preview failed: ${err.message}`);
      }
    });
    req.pipe(upstream);
  }
}
