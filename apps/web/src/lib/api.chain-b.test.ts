// The chain B groups (T-0893) over the derived contract client: the exact
// request bodies. A field the caller left out must not reach the wire, not
// even as `null` (the JSON codec encodes an explicit `undefined` on a
// nullable optional field as `null`, which would clear it on the server).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import { createAi, createConnection, decideApproval, setAiMachine, updateAi } from '@/lib/api';
import { revertTool, runToolNow } from '@/lib/tools';
import { isMockApiEnabled } from '@/mock/gate';

const AI = {
  id: 'a-1',
  name: 'Dev',
  template: 'dev',
  persona: 'p',
  model: 'm',
  jid: 'ai@x',
  status: 'active',
  providerConnectionId: 'c-1',
  limits: { perDayUsd: 1, perMonthUsd: 2 },
  createdAt: '2026-01-01T00:00:00.000Z',
};

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>): unknown {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(init?.body as string);
}

beforeEach(() => {
  vi.mocked(isMockApiEnabled).mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chain B request bodies', () => {
  it('updateAi sends only the fields that were set, trimmed', async () => {
    const fetchMock = stubFetch(AI);
    await updateAi('a-1', { name: ' Dev-2 ', canDelegate: false });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ais/a-1');
    expect(init.method).toBe('PATCH');
    expect(sentBody(fetchMock)).toEqual({ name: 'Dev-2', canDelegate: false });
  });

  it('createAi leaves persona out when it is not set', async () => {
    const fetchMock = stubFetch(AI, 201);
    await createAi({
      name: 'Dev',
      template: 'dev',
      providerConnectionId: 'c-1',
      model: 'm',
      limits: { perDayUsd: 1, perMonthUsd: 2 },
    });
    expect(sentBody(fetchMock)).toEqual({
      name: 'Dev',
      template: 'dev',
      providerConnectionId: 'c-1',
      model: 'm',
      limits: { perDayUsd: 1, perMonthUsd: 2 },
    });
  });

  it('setAiMachine(null) sends an explicit null', async () => {
    const fetchMock = stubFetch(AI);
    await setAiMachine('a-1', null);
    expect(sentBody(fetchMock)).toEqual({ machineId: null });
  });

  it('createConnection leaves the label out and trims the key', async () => {
    const fetchMock = stubFetch(
      { id: 'c', provider: 'openai', label: null, status: 'active', createdAt: 'x' },
      201,
    );
    await createConnection({ provider: 'openai', key: ' sk-1\n' });
    expect(sentBody(fetchMock)).toEqual({ provider: 'openai', key: 'sk-1' });
  });

  it('decideApproval leaves the note out when there is none', async () => {
    const fetchMock = stubFetch({ nope: true });
    await decideApproval('apr-1', 'deny').catch(() => undefined);
    expect(sentBody(fetchMock)).toEqual({ decision: 'deny' });
  });

  it('revertTool and runToolNow send the bodies the server decodes by hand', async () => {
    const revertMock = stubFetch({ nope: true });
    await revertTool('t-1', 2).catch(() => undefined);
    expect(sentBody(revertMock)).toEqual({ version: 2 });

    const runMock = stubFetch({ nope: true });
    await runToolNow('t-1').catch(() => undefined);
    expect(sentBody(runMock)).toEqual({});
    const inputMock = stubFetch({ nope: true });
    await runToolNow('t-1', { a: 1 }).catch(() => undefined);
    expect(sentBody(inputMock)).toEqual({ input: { a: 1 } });
  });
});
