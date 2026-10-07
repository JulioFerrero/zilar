import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTool } from './run-tool';
import type { HostFetcher } from './host-fetch';

const NO_NETWORK_FETCHER: HostFetcher = async () => {
  throw new Error('network touched in a no-network test');
};

// The worker is an `Effect.acquireRelease` resource, so every exit path must
// terminate it. `terminate` is called synchronously during scope teardown,
// before the returned Promise settles.
describe('runTool effect worker lifetime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('terminates the worker after a normal result', async () => {
    const terminate = vi.spyOn(Worker.prototype, 'terminate');
    const result = await runTool({
      source: `export default async function run() { return 'ok'; }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(true);
    expect(terminate).toHaveBeenCalled();
  });

  it('terminates the worker after a timeout', async () => {
    const terminate = vi.spyOn(Worker.prototype, 'terminate');
    const result = await runTool({
      source: `export default async function run() { while (true) {} }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
      limits: { wallMs: 1000, cpuMs: 1000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('timeout');
    }
    expect(terminate).toHaveBeenCalled();
  });
});
