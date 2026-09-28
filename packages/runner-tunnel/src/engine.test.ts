import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import {
  closeTunnelPair,
  httpThrough,
  patternBytes,
  sha256Hex,
  startTunnelPair,
  type TunnelPair,
} from './test-harness.ts';

let pair: TunnelPair | null = null;

afterEach(async () => {
  if (pair !== null) {
    await closeTunnelPair(pair);
    pair = null;
  }
});

interface SseEvent {
  at: number;
  data: string;
}

function getSseEvents(url: string, agent: http.Agent): Promise<SseEvent[]> {
  return new Promise<SseEvent[]>((resolve, reject) => {
    const events: SseEvent[] = [];
    let buffer = '';
    const request = http.get(url, { agent }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`sse status ${res.statusCode ?? 0}`));
        return;
      }
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let index = buffer.indexOf('\n\n');
        while (index !== -1) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
          if (dataLine !== undefined) {
            events.push({ at: Date.now(), data: dataLine.slice('data:'.length).trim() });
          }
          index = buffer.indexOf('\n\n');
        }
      });
      res.on('end', () => {
        resolve(events);
      });
      res.on('error', reject);
    });
    request.on('error', reject);
  });
}

describe('engine API through the tunnel (server to runner)', () => {
  it('round-trips a JSON request and response', async () => {
    pair = await startTunnelPair();
    const agent = pair.server.engineAgent(pair.runnerId);
    const payload = JSON.stringify({ hello: 'world', n: 42 });
    const result = await httpThrough(`${pair.desk.url}/echo`, {
      agent,
      method: 'POST',
      body: payload,
      headers: { 'content-type': 'application/json' },
    });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body.toString('utf8'))).toEqual({
      you_sent: { hello: 'world', n: 42 },
    });
  });

  it('delivers an SSE stream incrementally, not buffered until the end', async () => {
    pair = await startTunnelPair();
    const agent = pair.server.engineAgent(pair.runnerId);
    const events = await getSseEvents(`${pair.desk.url}/sse`, agent);
    expect(events.map((e) => JSON.parse(e.data))).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }]);
    const first = events[0]?.at ?? 0;
    const last = events[events.length - 1]?.at ?? 0;
    // Events are sent 200 ms apart; a buffered-until-end delivery would show
    // millisecond gaps. The thresholds leave wide room for slow CI.
    expect(last - first).toBeGreaterThanOrEqual(400);
    for (let i = 1; i < events.length; i += 1) {
      expect((events[i]?.at ?? 0) - (events[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(30);
    }
  });

  it('moves a 5 MB body byte-identical', async () => {
    pair = await startTunnelPair();
    const agent = pair.server.engineAgent(pair.runnerId);
    const bytes = 5 * 1024 * 1024;
    const result = await httpThrough(`${pair.desk.url}/big?bytes=${bytes}`, { agent });
    expect(result.status).toBe(200);
    expect(result.body.length).toBe(bytes);
    expect(sha256Hex(result.body)).toBe(sha256Hex(patternBytes(bytes)));
  }, 60000);

  it('completes 20 concurrent requests over one WebSocket', async () => {
    pair = await startTunnelPair();
    const agent = pair.server.engineAgent(pair.runnerId);
    const current = pair;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        httpThrough(`${current.desk.url}/hello?i=${i}`, { agent }),
      ),
    );
    expect(results).toHaveLength(20);
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.body.toString('utf8')).toBe('hello-desk:/hello');
    }
  });

  it('refuses tunnel.open for a port the runner did not expose', async () => {
    pair = await startTunnelPair();
    const agent = pair.server.engineAgent(pair.runnerId);
    const unexposedPort = pair.desk.port === 65535 ? 65534 : pair.desk.port + 1;
    await expect(httpThrough(`http://127.0.0.1:${unexposedPort}/hello`, { agent })).rejects.toThrow(
      /refused|not exposed/,
    );
    expect(pair.runner.connected).toBe(true);
  });

  it('fails engine requests with a clear error when the tunnel drops', async () => {
    pair = await startTunnelPair();
    const agent = pair.server.engineAgent(pair.runnerId);
    const pending = httpThrough(`${pair.desk.url}/hang`, { agent });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await pair.runner.stop();
    await expect(pending).rejects.toBeInstanceOf(Error);
    await expect(pending).rejects.toThrow(/tunnel closed/);
  });
});
