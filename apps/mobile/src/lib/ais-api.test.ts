import { describe, expect, it, vi } from 'vitest';

import { AisApiError, buildCreateBody, createAisApi, type CreateAiInput } from './ais-api';
import { jsonResponse } from '@/test/wait';

const createdAi = {
  id: 'a-1',
  name: 'Dev-1',
  template: 'dev',
  persona: 'You are a concise senior engineer.',
  model: 'gpt-4o',
  jid: 'ai-a-1@zilar.test',
  status: 'active',
  providerConnectionId: 'c-1',
  limits: { perDayUsd: 2, perMonthUsd: 20 },
  machineId: null,
  createdAt: '2026-09-28T00:00:00.000Z',
};

const activeConnection = {
  id: 'c-1',
  provider: 'openai',
  label: 'Work',
  status: 'active',
  createdAt: '2026-09-28T00:00:00.000Z',
};

function bodyOf(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return init?.body === undefined ? undefined : JSON.parse(init.body as string);
}

describe('buildCreateBody', () => {
  it('omits persona for an untouched stock template', () => {
    const body = buildCreateBody({
      name: 'Dev-1',
      template: 'dev',
      providerConnectionId: 'c-1',
      model: 'gpt-4o',
      limits: { perDayUsd: 2, perMonthUsd: 20 },
    });
    expect(Object.keys(body)).toEqual([
      'name',
      'template',
      'providerConnectionId',
      'model',
      'limits',
    ]);
    expect(body).not.toHaveProperty('persona');
  });

  it('includes persona when it is supplied', () => {
    expect(
      buildCreateBody({
        name: 'Bot',
        template: 'custom',
        persona: 'Be a pirate.',
        providerConnectionId: 'c-1',
        model: 'gpt-4o',
        limits: { perDayUsd: 2, perMonthUsd: 20 },
      }),
    ).toMatchObject({ template: 'custom', persona: 'Be a pirate.' });
  });
});

describe('createAisApi', () => {
  it('lists AIs with the bearer header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([createdAi]));
    const api = createAisApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    await expect(api.listAis()).resolves.toEqual([createdAi]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/ais');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('POSTs exactly the contract body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(createdAi, 201));
    const api = createAisApi(async () => 't', fetchImpl as unknown as typeof fetch);
    const input: CreateAiInput = {
      name: 'Dev-1',
      template: 'dev',
      providerConnectionId: 'c-1',
      model: 'gpt-4o',
      limits: { perDayUsd: 2, perMonthUsd: 20 },
    };

    await api.createAi(input);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/ais');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(bodyOf(fetchImpl.mock.calls[0] as unknown[])).toEqual({
      name: 'Dev-1',
      template: 'dev',
      providerConnectionId: 'c-1',
      model: 'gpt-4o',
      limits: { perDayUsd: 2, perMonthUsd: 20 },
    });
  });

  it('PATCHes only the changed fields', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(createdAi));
    const api = createAisApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.updateAi('a-1', { name: 'Dev-2' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/ais/a-1');
    expect(init.method).toBe('PATCH');
    expect(bodyOf(fetchImpl.mock.calls[0] as unknown[])).toEqual({ name: 'Dev-2' });
  });

  it('DELETEs an AI and accepts the empty 204 body', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 204, headers: { 'content-type': 'application/json' } }),
    );
    const api = createAisApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.deleteAi('a-1')).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/ais/a-1');
    expect(init.method).toBe('DELETE');
  });

  it('lists connections', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([activeConnection]));
    const api = createAisApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listConnections()).resolves.toEqual([activeConnection]);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/connections');
  });

  it('keeps the server error code and status', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'ais_unavailable', message: 'nope' } }, 503),
    );
    const api = createAisApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAis()).rejects.toBeInstanceOf(AisApiError);
    await expect(api.listAis()).rejects.toMatchObject({
      status: 503,
      code: 'ais_unavailable',
      message: 'nope',
    });
  });

  it('reports a network failure as network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const api = createAisApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAis()).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });

  it('rejects an unexpected response shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));
    const api = createAisApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAis()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('fails before the network when there is no session', async () => {
    const fetchImpl = vi.fn();
    const api = createAisApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(api.listAis()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // T-0080: a stopped AI is still a valid AI — the type guard accepts the
  // new value so the list screen renders a paused AI instead of failing
  // the whole response. Mobile only consumes the AI list today, so we just
  // exercise the guard.
  it('lists AIs with status `stopped` (T-0080 kill switch)', async () => {
    const stopped = {
      ...createdAi,
      status: 'stopped',
    };
    const fetchImpl = vi.fn(async () => jsonResponse([stopped]));
    const api = createAisApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    await expect(api.listAis()).resolves.toEqual([stopped]);
  });

  // T-0095: the kill switch is reachable from the phone. The bearer header
  // and POST verb match the server's `routes.ts`; the server's answer is
  // parsed with the same type guard as the list, so a 200 with the expected
  // shape swaps into the list state at once.
  it('stops an AI with POST and the bearer header (T-0095)', async () => {
    const stopped = { ...createdAi, status: 'stopped' };
    const fetchImpl = vi.fn(async () => jsonResponse(stopped));
    const api = createAisApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    await expect(api.stopAi('a-1')).resolves.toEqual(stopped);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/ais/a-1/stop');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('resumes an AI with POST and the bearer header (T-0095)', async () => {
    const active = { ...createdAi, status: 'active' };
    const fetchImpl = vi.fn(async () => jsonResponse(active));
    const api = createAisApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    await expect(api.resumeAi('a-1')).resolves.toEqual(active);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/ais/a-1/resume');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('accepts an AI with `machineId` in the response (T-0095)', async () => {
    // The list route decorates each AI with `usage`, and `PublicAiWithUsage`
    // carries `machineId`. The mobile client never reads those fields, so a
    // 200 from stop / resume must still parse cleanly when the server adds
    // more shape to the payload.
    const withMachine = { ...createdAi, status: 'stopped', machineId: 'm-1', usage: null };
    const fetchImpl = vi.fn(async () => jsonResponse(withMachine));
    const api = createAisApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    await expect(api.stopAi('a-1')).resolves.toMatchObject({ id: 'a-1', status: 'stopped' });
  });

  // T-0185: the server sends `machineId` (T-0091) on the public AI. A string
  // survives the boundary so the machine picker can show the current home;
  // a missing or non-string value means the platform, never a failure.
  it('keeps a string machineId on the parsed AI (T-0185)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ ...createdAi, machineId: 'm-1' }]));
    const api = createAisApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAis()).resolves.toEqual([{ ...createdAi, machineId: 'm-1' }]);
  });

  it('maps a missing or non-string machineId to null (T-0185)', async () => {
    const missing = { ...createdAi };
    delete (missing as Record<string, unknown>)['machineId'];
    const malformed = { ...createdAi, machineId: 42 };

    const fetchMissing = vi.fn(async () => jsonResponse([missing]));
    const apiMissing = createAisApi(async () => 't', fetchMissing as unknown as typeof fetch);
    await expect(apiMissing.listAis()).resolves.toEqual([{ ...createdAi, machineId: null }]);

    const fetchMalformed = vi.fn(async () => jsonResponse([malformed]));
    const apiMalformed = createAisApi(async () => 't', fetchMalformed as unknown as typeof fetch);
    await expect(apiMalformed.listAis()).resolves.toEqual([{ ...createdAi, machineId: null }]);
  });

  it('maps a 409 to AisApiError with the server code (T-0095)', async () => {
    // The server answers 409 `not_active` for a stop on a `disabled` AI or a
    // resume on one that just left `stopped`. The mobile client must see the
    // exact code so it can reload the list and tell the owner.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'not_active', message: 'AI is not active' } }, 409),
    );
    const api = createAisApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.stopAi('a-1')).rejects.toBeInstanceOf(AisApiError);
    await expect(api.stopAi('a-1')).rejects.toMatchObject({
      status: 409,
      code: 'not_active',
      message: 'AI is not active',
    });
  });
});
