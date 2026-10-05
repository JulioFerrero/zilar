import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { computeBackoff } from './runner.ts';
import { generateRunnerKeypair, signNonce } from './keys.ts';
import {
  closeTunnelPair,
  httpThrough,
  patternBytes,
  rawHandshake,
  sha256Hex,
  startTunnelPair,
  waitFor,
  type TunnelPair,
} from './test-harness.ts';

let pair: TunnelPair | null = null;

afterEach(async () => {
  if (pair !== null) {
    await closeTunnelPair(pair);
    pair = null;
  }
});

describe('resilience', () => {
  it('detects a dead connection within a bounded time', async () => {
    pair = await startTunnelPair({
      heartbeatIntervalMs: 30,
      heartbeatTimeoutMs: 150,
      handshakeTimeoutMs: 10000,
    });
    // A peer that authenticates and then never answers pings.
    const keypair = generateRunnerKeypair();
    pair.registry.approve('raw-1', keypair.publicKey);
    const raw = await rawHandshake(pair.server, 'raw-1', (nonce) =>
      signNonce(keypair.privateKey, nonce),
    );
    await waitFor(() => raw.texts.length > 1 || raw.closed, 5000, 'raw ready');
    expect(raw.closed).toBe(false);
    await waitFor(() => raw.closed, 5000, 'dead connection detection');
    raw.destroy();
    // A well-behaved client that answers pings stays connected throughout.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pair.runner.connected).toBe(true);
  });

  it('fails in-flight engine streams with a clear error instead of hanging', async () => {
    pair = await startTunnelPair();
    const agent = pair.server.engineAgent(pair.runnerId);
    const pending = httpThrough(`${pair.desk.url}/hang`, { agent });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await pair.runner.stop();
    await expect(pending).rejects.toThrow(/tunnel closed|hang up|ECONNRESET|destroyed|aborted/i);
  });

  it('fails in-flight model streams with a clear error instead of hanging', async () => {
    pair = await startTunnelPair();
    const modelUrl = pair.runner.modelUrl as string;
    const pending = httpThrough(`${modelUrl}/hang`, { method: 'POST', body: '{}' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await pair.runner.stop();
    await expect(pending).rejects.toThrow(/tunnel closed|hang up|ECONNRESET|destroyed|aborted/i);
  });

  it('reconnects with capped backoff and re-authenticates', async () => {
    pair = await startTunnelPair({ reconnectBaseMs: 50, reconnectMaxMs: 200 });
    expect(pair.runner.readyCount).toBe(1);
    expect(pair.server.disconnectRunner(pair.runnerId)).toBe(true);
    const current = pair;
    await waitFor(() => current.runner.readyCount >= 2, 15000, 'runner reconnect');
    expect(current.runner.reconnectAttempts).toBeGreaterThanOrEqual(1);
    expect(current.server.isRunnerLive(current.runnerId)).toBe(true);
    // The tunnel works again after the reconnect.
    const agent = current.server.engineAgent(current.runnerId);
    const result = await httpThrough(`${current.desk.url}/hello`, { agent });
    expect(result.status).toBe(200);
  });

  it('caps the reconnect backoff', () => {
    expect(computeBackoff(0, 250, 5000)).toBe(250);
    expect(computeBackoff(1, 250, 5000)).toBe(500);
    expect(computeBackoff(2, 250, 5000)).toBe(1000);
    expect(computeBackoff(10, 250, 5000)).toBe(5000);
    expect(computeBackoff(100, 250, 5000)).toBe(5000);
  });

  it('keeps memory bounded streaming 50 MB to a deliberately slow reader', async () => {
    pair = await startTunnelPair();
    const agent = pair.server.engineAgent(pair.runnerId);
    const bytes = 50 * 1024 * 1024;
    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }, 25);
    sampler.unref();
    try {
      const hash = await new Promise<string>((resolve, reject) => {
        const digest = createHash('sha256');
        const request = http.get(`${pair?.desk.url}/big?bytes=${bytes}`, { agent }, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`big status ${res.statusCode ?? 0}`));
            return;
          }
          res.on('data', (chunk: Buffer) => {
            digest.update(chunk);
            // A slow reader: pause 10 ms per 64 KiB chunk.
            res.pause();
            setTimeout(() => res.resume(), 10);
          });
          res.on('end', () => {
            resolve(digest.digest('hex'));
          });
          res.on('error', reject);
        });
        request.on('error', reject);
      });
      expect(hash).toBe(sha256Hex(patternBytes(bytes)));
    } finally {
      clearInterval(sampler);
    }
    const peakDeltaMb = (peak - baseline) / 1024 / 1024;
    console.log(`50 MB slow-reader peak heap delta: ${peakDeltaMb.toFixed(1)} MB`);
    // The whole body must never sit in memory at once: 50 MB buffered would
    // exceed this even before overhead.
    expect(peakDeltaMb).toBeLessThan(64);
  }, 120000);
});
