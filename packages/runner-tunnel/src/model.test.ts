import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { closeTunnelPair, httpThrough, startTunnelPair, type TunnelPair } from './test-harness.ts';

let pair: TunnelPair | null = null;

afterEach(async () => {
  if (pair !== null) {
    await closeTunnelPair(pair);
    pair = null;
  }
});

describe('model traffic through the tunnel (runner to server)', () => {
  it('reaches the configured gateway with the body intact', async () => {
    pair = await startTunnelPair();
    const modelUrl = pair.runner.modelUrl;
    expect(modelUrl).not.toBeNull();
    const payload = JSON.stringify({ model: 'deepseek-chat', messages: [] });
    const result = await httpThrough(`${modelUrl as string}/chat`, {
      method: 'POST',
      body: payload,
      headers: { 'content-type': 'application/json' },
    });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body.toString('utf8'))).toEqual({ ok: true, url: '/chat' });
    expect(pair.gateway.received).toHaveLength(1);
    expect(pair.gateway.received[0]?.method).toBe('POST');
    expect(pair.gateway.received[0]?.body.toString('utf8')).toBe(payload);
  });

  it('listens on 127.0.0.1 only', async () => {
    pair = await startTunnelPair();
    expect(pair.runner.modelBindAddress).toBe('127.0.0.1');
  });

  it('pins absolute-form URLs and foreign Host headers to the gateway', async () => {
    pair = await startTunnelPair();
    let evilConnections = 0;
    const evil = net.createServer((socket) => {
      evilConnections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => {
      evil.listen(0, '127.0.0.1', resolve);
    });
    const evilAddress = evil.address();
    if (typeof evilAddress === 'string' || evilAddress === null) {
      throw new Error('evil server is not listening');
    }
    try {
      // A compromised desk asks for another host outright. The bytes still
      // travel to the one configured gateway; the destination is never parsed.
      const modelPort = new URL(pair.runner.modelUrl as string).port;
      const raw = net.connect(Number(modelPort), '127.0.0.1');
      const response = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        raw.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        raw.on('close', () => {
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
        raw.on('error', reject);
        raw.write(
          `GET http://127.0.0.1:${evilAddress.port}/steal HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${evilAddress.port}\r\n` +
            'Connection: close\r\n\r\n',
        );
      });
      expect(response).toContain('"ok":true');
      expect(pair.gateway.received.map((r) => r.url)).toContain(
        `http://127.0.0.1:${evilAddress.port}/steal`,
      );
      expect(evilConnections).toBe(0);
    } finally {
      await new Promise<void>((resolve) => {
        evil.close(() => resolve());
      });
    }
  });
});
