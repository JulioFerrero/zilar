// T-0484: Effect-level behaviour the plain result tests cannot see. `node:https`
// is mocked so no socket is opened: the fake request never responds, so the
// overall deadline (`Effect.timeoutOrElse`) must fire, map to `fetch timed out`
// and — because the timeout interrupts the fetch — run the callback's
// finalizer, destroying the request.
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface FakeRequest {
  setTimeout: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const httpsMock = vi.hoisted(() => {
  const requests: FakeRequest[] = [];
  return { requests };
});

vi.mock('node:https', () => ({
  request: () => {
    const req = Object.assign(new EventEmitter(), {
      setTimeout: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    });
    httpsMock.requests.push(req);
    return req;
  },
}));

import { guardedGet, type DnsLookup, type PinnedFetcher } from './guarded-fetch';

const PUBLIC_IP = '93.184.215.14';

const resolver: DnsLookup = async () => [PUBLIC_IP];

afterEach(() => {
  httpsMock.requests.length = 0;
});

describe('guardedGet effect pipeline (T-0484)', () => {
  it('times out a stalled pinned request and destroys it', async () => {
    const result = await guardedGet('https://example.com/', {
      allowedHosts: ['example.com'],
      resolver,
      timeoutMs: 20,
    });
    expect(result).toEqual({ ok: false, summary: 'fetch timed out' });
    expect(httpsMock.requests).toHaveLength(1);
    expect(httpsMock.requests[0]?.destroy).toHaveBeenCalled();
  });

  it('applies the same deadline to an injected fetcher', async () => {
    const hanging: PinnedFetcher = () => new Promise(() => {});
    const result = await guardedGet('https://example.com/', {
      allowedHosts: ['example.com'],
      resolver,
      timeoutMs: 20,
      fetcher: hanging,
    });
    expect(result).toEqual({ ok: false, summary: 'fetch timed out' });
  });
});
