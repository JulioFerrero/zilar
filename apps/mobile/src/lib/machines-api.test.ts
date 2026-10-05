import { describe, expect, it, vi } from 'vitest';

import { createMachinesApi, MachinesApiError } from './machines-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const pendingMachine = {
  id: 'm-1',
  name: 'Home server',
  status: 'pending',
  os: 'linux',
  osVersion: '6.8',
  arch: 'x86_64',
  cpu: 'Ryzen 7',
  cores: 8,
  ramGb: 32,
  diskFreeGb: 100,
  drivers: ['nvidia'],
  fingerprint: 'fp-1',
  createdAt: '2026-09-28T00:00:00.000Z',
  approvedAt: null,
  lastSeenAt: null,
};

function bodyOf(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return init?.body === undefined ? undefined : JSON.parse(init.body as string);
}

describe('createMachinesApi', () => {
  it('lists machines with the bearer header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([pendingMachine]));
    const api = createMachinesApi(
      async () => 'session-token',
      fetchImpl as unknown as typeof fetch,
    );

    await expect(api.listMachines()).resolves.toEqual([pendingMachine]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/machines');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('mints a pairing code with POST', async () => {
    const pairing = { code: 'AB12-CD34', expiresAt: '2026-10-03T12:00:00.000Z' };
    const fetchImpl = vi.fn(async () => jsonResponse(pairing, 201));
    const api = createMachinesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.createPairingCode()).resolves.toEqual(pairing);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/machines/pairing-codes');
    expect(init.method).toBe('POST');
  });

  it('approves a pending machine with POST and parses the fresh machine', async () => {
    const approved = { ...pendingMachine, status: 'approved' };
    const fetchImpl = vi.fn(async () => jsonResponse(approved));
    const api = createMachinesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.approveMachine('m-1')).resolves.toEqual(approved);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/machines/m-1/approve');
    expect(init.method).toBe('POST');
  });

  it('denies a pending machine and accepts the empty 204 body', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 204, headers: { 'content-type': 'application/json' } }),
    );
    const api = createMachinesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.denyMachine('m-1')).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/machines/m-1/deny');
    expect(init.method).toBe('POST');
  });

  it('revokes with POST and parses the fresh machine', async () => {
    const revoked = { ...pendingMachine, status: 'revoked' };
    const fetchImpl = vi.fn(async () => jsonResponse(revoked));
    const api = createMachinesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.revokeMachine('m-1')).resolves.toEqual(revoked);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/machines/m-1/revoke');
    expect(init.method).toBe('POST');
  });

  it('renames with PATCH and exactly the contract body', async () => {
    const renamed = { ...pendingMachine, name: 'Office box' };
    const fetchImpl = vi.fn(async () => jsonResponse(renamed));
    const api = createMachinesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.renameMachine('m-1', 'Office box')).resolves.toEqual(renamed);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/machines/m-1');
    expect(init.method).toBe('PATCH');
    expect(bodyOf(fetchImpl.mock.calls[0] as unknown[])).toEqual({ name: 'Office box' });
  });

  it('deletes a revoked machine and accepts the empty 204 body', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 204, headers: { 'content-type': 'application/json' } }),
    );
    const api = createMachinesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.deleteMachine('m-1')).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/machines/m-1');
    expect(init.method).toBe('DELETE');
  });

  it('assigns an AI home machine with PUT and reads the machineId off the fresh AI', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'a-1', machineId: 'm-1' }));
    const api = createMachinesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.setAiMachine('a-1', 'm-1')).resolves.toBe('m-1');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/ais/a-1/machine');
    expect(init.method).toBe('PUT');
    expect(bodyOf(fetchImpl.mock.calls[0] as unknown[])).toEqual({ machineId: 'm-1' });
  });

  it('clears the AI home machine with a null machineId', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'a-1', machineId: null }));
    const api = createMachinesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.setAiMachine('a-1', null)).resolves.toBeNull();
    expect(bodyOf(fetchImpl.mock.calls[0] as unknown[])).toEqual({ machineId: null });
  });

  it('keeps the server error code and status', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'revoke_first', message: 'nope' } }, 409),
    );
    const api = createMachinesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.deleteMachine('m-1')).rejects.toBeInstanceOf(MachinesApiError);
    await expect(api.deleteMachine('m-1')).rejects.toMatchObject({
      status: 409,
      code: 'revoke_first',
      message: 'nope',
    });
  });

  it('reports a network failure as network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const api = createMachinesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listMachines()).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });

  it('rejects an unexpected response shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));
    const api = createMachinesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listMachines()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('fails before the network when there is no session', async () => {
    const fetchImpl = vi.fn();
    const api = createMachinesApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(api.listMachines()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
