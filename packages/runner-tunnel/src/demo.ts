// effect-plain: manual demo script (npm run demo), not shipped
import http from 'node:http';
import { createHash } from 'node:crypto';
import { InMemoryKeyRegistry, generateRunnerKeypair } from './keys.ts';
import { RunnerClient } from './runner.ts';
import { TunnelServer } from './server.ts';
import { httpThrough, patternBytes, sha256Hex, startFakeDesk } from './test-harness.ts';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function timeOnce(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function main(): Promise<void> {
  const desk = await startFakeDesk();
  const registry = new InMemoryKeyRegistry();
  const keypair = generateRunnerKeypair();
  registry.approve('demo-runner', keypair.publicKey);
  const server = await TunnelServer.start({ registry }, 0);
  const runner = new RunnerClient({
    serverUrl: server.wsUrl,
    runnerId: 'demo-runner',
    keypair,
    exposedPorts: [desk.port],
  });
  const rows: Array<[string, string, string]> = [];
  const check = (proven: string, ok: boolean, detail: string): void => {
    rows.push([proven, ok ? 'ok' : 'FAIL', detail]);
    if (!ok) {
      throw new Error(`demo step failed: ${proven} (${detail})`);
    }
  };

  try {
    await runner.start();
    const agent = server.engineAgent('demo-runner');

    const echo = await httpThrough(`${desk.url}/echo`, {
      agent,
      method: 'POST',
      body: JSON.stringify({ demo: true }),
      headers: { 'content-type': 'application/json' },
    });
    check(
      'engine JSON round-trip',
      echo.status === 200 && JSON.parse(echo.body.toString()).you_sent.demo === true,
      `status ${echo.status}`,
    );

    const sseStart = performance.now();
    const sse = await httpThrough(`${desk.url}/sse`, { agent });
    const sseMs = performance.now() - sseStart;
    check(
      'engine SSE stream',
      sse.status === 200 && sse.body.toString().split('data:').length === 5,
      `${sseMs.toFixed(0)} ms end to end`,
    );

    const fiveMb = 5 * 1024 * 1024;
    const big = await httpThrough(`${desk.url}/big?bytes=${fiveMb}`, { agent });
    check(
      'engine 5 MB byte-identical',
      sha256Hex(big.body) === sha256Hex(patternBytes(fiveMb)),
      `${(big.body.length / 1024 / 1024).toFixed(0)} MB hashed`,
    );

    const twenty = await Promise.all(
      Array.from({ length: 20 }, () => httpThrough(`${desk.url}/hello`, { agent })),
    );
    check(
      'engine 20 concurrent',
      twenty.every((r) => r.status === 200),
      'one WebSocket',
    );

    const token = server.createPreviewToken('demo-runner', desk.port);
    const page = await httpThrough(`${server.previewBaseUrl}/preview/${token}/hello`);
    check(
      'preview page load',
      page.status === 200 && page.body.toString() === 'hello-desk:/hello',
      `token ${token.slice(0, 8)}…`,
    );

    const direct: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      direct.push(await timeOnce(() => httpThrough(`${desk.url}/hello`).then(() => undefined)));
    }
    const tunneled: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      tunneled.push(
        await timeOnce(() => httpThrough(`${desk.url}/hello`, { agent }).then(() => undefined)),
      );
    }
    const directMs = median(direct);
    const tunnelMs = median(tunneled);
    rows.push([
      'latency median of 50 (direct vs tunnel)',
      'ok',
      `${directMs.toFixed(2)} ms vs ${tunnelMs.toFixed(2)} ms (overhead ${(tunnelMs - directMs).toFixed(2)} ms)`,
    ]);

    const fiftyMb = 50 * 1024 * 1024;
    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }, 25);
    sampler.unref();
    const digest = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const request = http.get(`${desk.url}/big?bytes=${fiftyMb}`, { agent }, (res) => {
        res.on('data', (chunk: Buffer) => {
          digest.update(chunk);
          res.pause();
          setTimeout(() => res.resume(), 10);
        });
        res.on('end', () => resolve());
        res.on('error', reject);
      });
      request.on('error', reject);
    });
    clearInterval(sampler);
    const peakDeltaMb = (peak - baseline) / 1024 / 1024;
    check(
      '50 MB to a slow reader, bounded memory',
      digest.digest('hex') === sha256Hex(patternBytes(fiftyMb)) && peakDeltaMb < 64,
      `peak heap +${peakDeltaMb.toFixed(1)} MB`,
    );
  } finally {
    await runner.stop().catch(() => undefined);
    await server.close().catch(() => undefined);
    await desk.close().catch(() => undefined);
  }

  const width = Math.max(...rows.map(([a]) => a.length));
  console.log('\nrunner-tunnel demo: one WebSocket carries engine API + previews\n');
  for (const [proven, result, detail] of rows) {
    console.log(`${proven.padEnd(width)}  ${result}  ${detail}`);
  }
  console.log('');
}

await main();
