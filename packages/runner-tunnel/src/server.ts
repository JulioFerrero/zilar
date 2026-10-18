import { once } from 'node:events';
import http from 'node:http';
import type { Socket } from 'node:net';
import { Duration, Effect, Fiber, Schedule, Schema } from 'effect';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { DeskServer } from './desk-server.ts';
import type { TunnelHttpAgent } from './http-agent.ts';
import type { KeyRegistry } from './keys.ts';
import { TunnelClosedError } from './mux.ts';
import { CLOSE_REVOKED, MAX_WS_PAYLOAD_BYTES } from './protocol.ts';
import {
  handleConnection,
  takeHandshakeFiber,
  type ServerConn,
  type ServerRuntime,
} from './server/conn.ts';
import { engineAgent, openEngineStream } from './server/engine.ts';
import { checkHeartbeats } from './server/heartbeat.ts';
import { ServerOptionsSchema, type ServerOptionsDecoded } from './server/options.ts';
import type { TunnelServerOptions } from './server/options.ts';
import { createPreviewToken, handlePreviewRequest } from './server/preview.ts';
import { closeQuietly } from './ws-close.ts';

export type { TunnelServerOptions } from './server/options.ts';

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
