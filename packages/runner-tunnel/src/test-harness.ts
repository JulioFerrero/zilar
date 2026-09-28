import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { WebSocket } from 'ws';
import { InMemoryKeyRegistry, generateRunnerKeypair } from './keys.ts';
import { RunnerClient } from './runner.ts';
import { TunnelClosedError } from './mux.ts';
import { TunnelServer } from './server.ts';

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Deterministic N bytes, so both ends can compare hashes without fixtures. */
export function patternBytes(length: number): Buffer {
  const out = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = i % 251;
  }
  return out;
}

export async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export interface FakeDesk {
  port: number;
  url: string;
  requests: number;
  deskSocketsClosed: number;
  close(): Promise<void>;
}

/** A fake engine/desk: JSON echo, SSE, big byte-identical bodies, hanging endpoints. */
export async function startFakeDesk(): Promise<FakeDesk> {
  const state = { requests: 0, deskSocketsClosed: 0 };
  const server = http.createServer((req, res) => {
    state.requests += 1;
    const url = new URL(req.url ?? '/', 'http://desk');
    if (req.method === 'POST' && url.pathname === '/echo') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ you_sent: JSON.parse(body as string) }));
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/sse') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'close',
      });
      let n = 0;
      const timer = setInterval(() => {
        if (n >= 4) {
          clearInterval(timer);
          res.end();
          return;
        }
        res.write(`data: {"n":${n}}\n\n`);
        n += 1;
      }, 200);
      timer.unref();
      req.on('close', () => {
        clearInterval(timer);
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/big') {
      const bytes = Number(url.searchParams.get('bytes') ?? '0');
      res.writeHead(200, { 'content-type': 'application/octet-stream', connection: 'close' });
      const chunkSize = 64 * 1024;
      let sent = 0;
      const writeMore = (): void => {
        while (sent < bytes) {
          const size = Math.min(chunkSize, bytes - sent);
          const chunk = patternBytes(size);
          // Keep the pattern position-independent: offset by bytes sent so far.
          for (let i = 0; i < size; i += 1) {
            chunk[i] = (sent + i) % 251;
          }
          sent += size;
          if (!res.write(chunk)) {
            res.once('drain', writeMore);
            return;
          }
        }
        res.end();
      };
      writeMore();
      return;
    }
    if (url.pathname === '/hang') {
      // Never responds: used to prove in-flight requests fail instead of hanging.
      req.on('close', () => {
        res.destroy();
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain', connection: 'close' });
    res.end(`hello-desk:${url.pathname}`);
  });
  server.on('connection', (socket) => {
    socket.on('close', () => {
      state.deskSocketsClosed += 1;
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('fake desk is not listening');
  }
  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    get requests() {
      return state.requests;
    },
    get deskSocketsClosed() {
      return state.deskSocketsClosed;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export interface FakeGateway {
  port: number;
  url: string;
  received: Array<{ method: string; url: string; host: string; body: Buffer }>;
  connections: number;
  close(): Promise<void>;
}

export async function startFakeGateway(): Promise<FakeGateway> {
  const received: FakeGateway['received'] = [];
  const state = { connections: 0 };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        host: req.headers.host ?? '',
        body: Buffer.concat(chunks),
      });
      if ((req.url ?? '').startsWith('/hang')) {
        return; // Never respond: the tunnel drop must fail the request.
      }
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify({ ok: true, url: req.url ?? '' }));
    });
  });
  server.on('connection', () => {
    state.connections += 1;
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('fake gateway is not listening');
  }
  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    received,
    get connections() {
      return state.connections;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export interface TunnelPair {
  registry: InMemoryKeyRegistry;
  server: TunnelServer;
  runner: RunnerClient;
  desk: FakeDesk;
  gateway: FakeGateway;
  runnerId: string;
  keypair: { publicKey: string; privateKey: string };
}

export async function startTunnelPair(options?: {
  exposedPorts?: number[];
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  enableModelListener?: boolean;
}): Promise<TunnelPair> {
  const gateway = await startFakeGateway();
  const desk = await startFakeDesk();
  const registry = new InMemoryKeyRegistry();
  const runnerId = 'runner-1';
  const keypair = generateRunnerKeypair();
  registry.approve(runnerId, keypair.publicKey);
  const server = await TunnelServer.start(
    {
      registry,
      gatewayUrl: gateway.url,
      heartbeatIntervalMs: options?.heartbeatIntervalMs,
      heartbeatTimeoutMs: options?.heartbeatTimeoutMs,
      handshakeTimeoutMs: options?.handshakeTimeoutMs,
    },
    0,
  );
  const runner = new RunnerClient({
    serverUrl: server.wsUrl,
    runnerId,
    keypair,
    exposedPorts: options?.exposedPorts ?? [desk.port],
    reconnectBaseMs: options?.reconnectBaseMs,
    reconnectMaxMs: options?.reconnectMaxMs,
    handshakeTimeoutMs: options?.handshakeTimeoutMs,
    enableModelListener: options?.enableModelListener,
  });
  await runner.start();
  return { registry, server, runner, desk, gateway, runnerId, keypair };
}

export async function closeTunnelPair(pair: TunnelPair): Promise<void> {
  await pair.runner.stop().catch(() => undefined);
  await pair.server.close().catch(() => undefined);
  await pair.desk.close().catch(() => undefined);
  await pair.gateway.close().catch(() => undefined);
}

export interface HttpResult {
  status: number;
  body: Buffer;
}

/** One GET/POST with an optional agent. Rejects on socket errors (no hangs). */
export function httpThrough(
  url: string,
  options?: {
    agent?: http.Agent;
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  },
): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    const request = http.request(
      url,
      { agent: options?.agent, method: options?.method ?? 'GET', headers: options?.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) });
        });
        res.on('error', reject);
      },
    );
    request.on('error', reject);
    if (options?.body !== undefined) {
      request.write(options.body);
    }
    request.end();
  });
}

/**
 * A minimal raw WebSocket client over a real TCP socket: completes the HTTP
 * upgrade, sends masked client frames, and reports server frames. Used to
 * test handshake rejections, dead peers that never pong, and protocol
 * violations the polite RunnerClient would never send.
 */
export class RawRunner {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private upgraded = false;
  readonly texts: string[] = [];
  closeCode: number | null = null;
  closeReason = '';
  closed = false;
  pongs = 0;

  async connect(port: number): Promise<void> {
    this.socket = net.connect(port, '127.0.0.1');
    await once(this.socket, 'connect');
    this.socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.upgraded) {
        this.pump();
      }
    });
    this.socket.on('close', () => {
      this.closed = true;
    });
    const key = randomBytes(16).toString('base64');
    this.socket.write(
      'GET /tunnel HTTP/1.1\r\n' +
        'Host: 127.0.0.1\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n',
    );
    await waitFor(() => this.buffer.includes('\r\n\r\n'), 5000, 'websocket upgrade');
    const head = this.buffer.toString('utf8', 0, this.buffer.indexOf('\r\n\r\n'));
    if (!head.includes(' 101 ')) {
      throw new Error(`upgrade failed: ${head}`);
    }
    this.buffer = this.buffer.subarray(this.buffer.indexOf('\r\n\r\n') + 4);
    this.upgraded = true;
  }

  sendText(text: string): void {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'));
  }

  sendBinary(data: Buffer): void {
    this.sendFrame(0x2, data);
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    const mask = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.allocUnsafe(payload.length);
    for (let i = 0; i < payload.length; i += 1) {
      masked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
    }
    const header = Buffer.allocUnsafe(payload.length < 126 ? 6 : 8);
    header[0] = 0x80 | opcode;
    if (payload.length < 126) {
      header[1] = 0x80 | payload.length;
      mask.copy(header, 2);
    } else {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      mask.copy(header, 4);
    }
    this.socket?.write(Buffer.concat([header, masked]));
  }

  private pump(): void {
    for (;;) {
      if (this.buffer.length < 2) {
        return;
      }
      const opcode = (this.buffer[0] ?? 0) & 0x0f;
      let length = (this.buffer[1] ?? 0) & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) {
          return;
        }
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) {
          return;
        }
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + length) {
        return;
      }
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x1) {
        this.texts.push(payload.toString('utf8'));
      } else if (opcode === 0x9) {
        // Ping: deliberately ignored by default, so the server must notice.
      } else if (opcode === 0xa) {
        this.pongs += 1;
      } else if (opcode === 0x8) {
        this.closeCode = length >= 2 ? payload.readUInt16BE(0) : 1005;
        this.closeReason = length > 2 ? payload.subarray(2).toString('utf8') : '';
        this.closed = true;
        this.socket?.destroy();
        return;
      }
    }
  }

  destroy(): void {
    this.socket?.destroy();
    this.socket = null;
  }
}

export async function rawHandshake(
  server: TunnelServer,
  runnerId: string,
  sign: (nonce: Buffer) => string,
  protocolVersion = 1,
): Promise<RawRunner> {
  const raw = new RawRunner();
  await raw.connect(server.port);
  raw.sendText(
    JSON.stringify({
      type: 'hello',
      runner_id: runnerId,
      runner_version: '0.1.0',
      protocol_version: protocolVersion,
    }),
  );
  await waitFor(() => raw.texts.length > 0 || raw.closed, 5000, 'challenge');
  if (raw.closed) {
    return raw;
  }
  const challenge = JSON.parse(raw.texts[0] as string) as { nonce?: string };
  raw.sendText(
    JSON.stringify({ type: 'auth', signature: sign(Buffer.from(challenge.nonce ?? '', 'base64')) }),
  );
  return raw;
}

/** A ws-library client that fails the handshake on purpose (malformed frames, old version). */
export async function wsCloseCode(
  server: TunnelServer,
  send: (ws: WebSocket) => void,
): Promise<{ code: number; reason: string }> {
  const ws = new WebSocket(server.wsUrl);
  await once(ws, 'open');
  const closed = once(ws, 'close') as Promise<[number, Buffer]>;
  send(ws);
  const [code, reason] = await closed;
  return { code, reason: reason.toString() };
}

export { TunnelClosedError };
