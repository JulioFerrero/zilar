import { describe, expect, it, vi } from 'vitest';

import { AisApiError, buildCreateBody, createAisApi, type CreateAiInput } from './ais-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const createdAi = {
  id: 'a-1',
  name: 'Dev-1',
  template: 'dev',
  persona: 'You are a concise senior engineer.',
  model: 'gpt-4o',
  jid: 'ai-a-1@galena.test',
  status: 'active',
  providerConnectionId: 'c-1',
  limits: { perDayUsd: 2, perMonthUsd: 20 },
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
});
