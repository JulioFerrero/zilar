import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { CLOSE_MALFORMED } from './protocol.ts';
import { generateRunnerKeypair } from './keys.ts';
import { RunnerClient } from './runner.ts';
import { waitFor } from './test-harness.ts';

function toBuffer(data: unknown): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
}

type StagedSend = { afterMs: number; send: unknown };

/**
 * A hostile platform: completes the handshake, then sends staged attack
 * messages. Records the close code the runner answers with.
 */
async function startHostilePlatform(
  staged: StagedSend[],
  exposedPorts: number[],
): Promise<{ closeCode: () => number | null; done: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', maxPayload: 100 * 1024 * 1024 });
  await once(wss, 'listening');
  const address = wss.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('fake platform is not listening');
  }
  let runnerCloseCode: number | null = null;
  const timers: NodeJS.Timeout[] = [];
  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        return;
      }
      const message = JSON.parse(toBuffer(data).toString('utf8')) as { type?: string };
      if (message.type === 'hello') {
        ws.send(JSON.stringify({ type: 'challenge', nonce: randomBytes(32).toString('base64') }));
      } else if (message.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        for (const { afterMs, send } of staged) {
          const timer = setTimeout(() => {
            try {
              if (send === '__big-binary__') {
                ws.send(Buffer.alloc(300 * 1024, 0xaa));
              } else {
                ws.send(JSON.stringify(send));
              }
            } catch {
              // Runner already gone.
            }
          }, afterMs);
          timer.unref();
          timers.push(timer);
        }
      }
    });
    ws.on('close', (code: number) => {
      runnerCloseCode = code;
    });
  });
  const runner = new RunnerClient({
    serverUrl: `ws://127.0.0.1:${address.port}/tunnel`,
    runnerId: 'runner-1',
    keypair: generateRunnerKeypair(),
    exposedPorts,
  });
  await runner.start();
  return {
    closeCode: () => runnerCloseCode,
    done: async () => {
      await runner.stop().catch(() => undefined);
      for (const timer of timers) {
        clearTimeout(timer);
      }
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}

describe('runner protocol enforcement', () => {
  it('closes on tunnel.open with an odd stream id (runner ids only)', async () => {
    const session = await startHostilePlatform(
      [{ afterMs: 50, send: { type: 'tunnel.open', stream_id: 3, port: 80 } }],
      [],
    );
    try {
      await waitFor(() => session.closeCode() !== null, 5000, 'runner close');
      expect(session.closeCode()).toBe(CLOSE_MALFORMED);
    } finally {
      await session.done();
    }
  });

  it('closes on tunnel.open with an already-live stream id', async () => {
    const desk = net.createServer((socket) => {
      socket.on('data', () => undefined);
    });
    await new Promise<void>((resolve) => {
      desk.listen(0, '127.0.0.1', resolve);
    });
    const deskAddress = desk.address();
    if (typeof deskAddress === 'string' || deskAddress === null) {
      throw new Error('no desk port');
    }
    let deskConnections = 0;
    desk.on('connection', () => {
      deskConnections += 1;
    });
    const open = { type: 'tunnel.open', stream_id: 2, port: deskAddress.port };
    const session = await startHostilePlatform(
      [
        { afterMs: 50, send: open },
        { afterMs: 400, send: open },
      ],
      [deskAddress.port],
    );
    try {
      // The first open is accepted (the desk sees the runner dial in)…
      await waitFor(() => deskConnections >= 1, 5000, 'first open dial');
      // …so the identical second open is a duplicate, and the runner drops
      // the hostile platform instead of re-registering the stream.
      await waitFor(() => session.closeCode() !== null, 5000, 'runner close');
      expect(session.closeCode()).toBe(CLOSE_MALFORMED);
    } finally {
      await session.done();
      await new Promise<void>((resolve) => {
        desk.close(() => resolve());
      });
    }
  });

  it('closes an oversized inbound frame', async () => {
    const session = await startHostilePlatform([{ afterMs: 50, send: '__big-binary__' }], []);
    try {
      await waitFor(() => session.closeCode() !== null, 5000, 'runner close');
      expect(session.closeCode()).toBe(1009);
    } finally {
      await session.done();
    }
  });
});

describe('serverUrl validation', () => {
  function buildClient(serverUrl: string): void {
    new RunnerClient({
      serverUrl,
      runnerId: 'runner-1',
      keypair: generateRunnerKeypair(),
    });
  }

  const accepted = [
    'ws://127.0.0.1:9000/tunnel',
    'wss://hub.example.com/tunnel',
    'wss://host:1234/tunnel',
  ];
  const rejected = [
    { value: 'http://host:1234/tunnel', reason: 'http scheme' },
    { value: 'https://host:1234/tunnel', reason: 'https scheme' },
    { value: 'ftp://host:1234/tunnel', reason: 'ftp scheme' },
    { value: '', reason: 'empty string' },
    { value: 'host:1234/tunnel', reason: 'no scheme' },
    { value: 'javascript:alert(1)', reason: 'javascript scheme' },
    { value: 'file:///etc/passwd', reason: 'file scheme' },
  ];

  for (const url of accepted) {
    it(`accepts ${url}`, () => {
      expect(() => buildClient(url)).not.toThrow();
    });
  }

  for (const { value, reason } of rejected) {
    it(`rejects ${reason} (${JSON.stringify(value)})`, () => {
      expect(() => buildClient(value)).toThrow();
    });
  }
});
