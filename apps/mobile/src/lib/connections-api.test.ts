import { describe, expect, it, vi } from 'vitest';

import {
  buildCreateConnectionBody,
  ConnectionsApiError,
  createConnectionsApi,
} from './connections-api';
import { jsonResponse } from '@/test/wait';

const connection = {
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

describe('buildCreateConnectionBody', () => {
  it('carries the provider and key without a label', () => {
    expect(buildCreateConnectionBody({ provider: 'openai', key: 'k' })).toEqual({
      provider: 'openai',
      key: 'k',
    });
  });

  it('includes the label when one is supplied', () => {
    expect(buildCreateConnectionBody({ provider: 'openai', key: 'k', label: 'Work' })).toEqual({
      provider: 'openai',
      key: 'k',
      label: 'Work',
    });
  });
});

describe('createConnectionsApi', () => {
  it('lists connections with the bearer header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([connection]));
    const api = createConnectionsApi(
      async () => 'session-token',
      fetchImpl as unknown as typeof fetch,
    );

    await expect(api.listConnections()).resolves.toEqual([connection]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/connections');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('creates a connection with exactly the contract body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(connection, 201));
    const api = createConnectionsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(
      api.createConnection({ provider: 'openai', key: 'k', label: 'Work' }),
    ).resolves.toEqual(connection);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/connections');
    expect(init.method).toBe('POST');
    expect(bodyOf(fetchImpl.mock.calls[0] as unknown[])).toEqual({
      provider: 'openai',
      key: 'k',
      label: 'Work',
    });
  });

  it('tests a connection with POST and parses the ok result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createConnectionsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.testConnection('c-1')).resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/connections/c-1/test');
    expect(init.method).toBe('POST');
  });

  it('deletes a connection and accepts the empty 204 body', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 204, headers: { 'content-type': 'application/json' } }),
    );
    const api = createConnectionsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.deleteConnection('c-1')).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/connections/c-1');
    expect(init.method).toBe('DELETE');
  });

  it('keeps the server error code and status', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'connection_in_use', message: 'nope' } }, 409),
    );
    const api = createConnectionsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.deleteConnection('c-1')).rejects.toBeInstanceOf(ConnectionsApiError);
    await expect(api.deleteConnection('c-1')).rejects.toMatchObject({
      status: 409,
      code: 'connection_in_use',
      message: 'nope',
    });
  });

  it('reports a network failure as network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const api = createConnectionsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listConnections()).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('rejects an unexpected response shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));
    const api = createConnectionsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listConnections()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('fails before the network when there is no session', async () => {
    const fetchImpl = vi.fn();
    const api = createConnectionsApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(api.listConnections()).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
