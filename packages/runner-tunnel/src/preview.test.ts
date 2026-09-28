import { afterEach, describe, expect, it } from 'vitest';
import {
  closeTunnelPair,
  httpThrough,
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

describe('preview URLs', () => {
  it('loads a page through the preview token', async () => {
    pair = await startTunnelPair();
    const token = pair.server.createPreviewToken(pair.runnerId, pair.desk.port);
    expect(token.length).toBeGreaterThanOrEqual(22);
    const result = await httpThrough(`${pair.server.previewBaseUrl}/preview/${token}/hello?x=1`);
    expect(result.status).toBe(200);
    expect(result.body.toString('utf8')).toBe('hello-desk:/hello');
  });

  it('returns 404 for an unknown token', async () => {
    pair = await startTunnelPair();
    const result = await httpThrough(`${pair.server.previewBaseUrl}/preview/no-such-token/hello`);
    expect(result.status).toBe(404);
  });

  it('returns 404 when the token runner is gone', async () => {
    pair = await startTunnelPair();
    const token = pair.server.createPreviewToken(pair.runnerId, pair.desk.port);
    await pair.runner.stop();
    // The server drops the live entry on its own close event, a tick after
    // the runner sees the close: wait for it before requesting.
    const current = pair;
    await waitFor(
      () => !current.server.isRunnerLive(current.runnerId),
      5000,
      'disconnected runner gone',
    );
    const result = await httpThrough(`${pair.server.previewBaseUrl}/preview/${token}/hello`);
    expect(result.status).toBe(404);
  });
});
