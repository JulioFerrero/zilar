import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import { ApiError } from '@/lib/api';
import {
  approveMachine,
  createConnection,
  createPairingCode,
  deleteConnection,
  deleteMachine,
  denyMachine,
  listMachines,
  listConnections,
  machineSchema,
  renameMachine,
  revokeMachine,
  testConnection,
} from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';

const mockEnabled = vi.mocked(isMockApiEnabled);

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  mockEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('machines API', () => {
  it('parses a server-shaped machine response', () => {
    const parsed = machineSchema.parse({
      id: 'm-1',
      name: 'julio-mbp',
      status: 'approved',
      os: 'macos',
      osVersion: '27.0',
      arch: 'arm64',
      cpu: 'Apple M3 Pro',
      cores: 11,
      ramGb: 18,
      diskFreeGb: 200,
      drivers: ['docker', 'apple-container'],
      fingerprint: 'a1b2c3d4e5f60718',
      createdAt: '2026-09-25T10:00:00.000Z',
      approvedAt: '2026-09-25T10:01:00.000Z',
      lastSeenAt: '2026-09-29T07:55:00.000Z',
      online: true,
    });
    expect(parsed.status).toBe('approved');
    expect(parsed.online).toBe(true);
  });

  it('accepts a machine response without `online`', () => {
    const parsed = machineSchema.parse({
      id: 'm-2',
      name: 'office-linux',
      status: 'pending',
      os: 'linux',
      osVersion: '6.6.0',
      arch: 'x86_64',
      cpu: 'AMD Ryzen 9',
      cores: 16,
      ramGb: 64,
      diskFreeGb: 920,
      drivers: ['docker'],
      fingerprint: 'cafef00d',
      createdAt: '2026-09-29T08:00:00.000Z',
      approvedAt: null,
      lastSeenAt: null,
    });
    expect(parsed.online).toBeUndefined();
    expect(parsed.approvedAt).toBeNull();
  });

  it('listMachines hits GET /api/machines', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, [
        {
          id: 'm-1',
          name: 'a',
          status: 'approved',
          os: 'macos',
          osVersion: '27.0',
          arch: 'arm64',
          cpu: 'M3',
          cores: 1,
          ramGb: 1,
          diskFreeGb: 1,
          drivers: [],
          fingerprint: 'abc',
          createdAt: '2026-09-25T10:00:00.000Z',
          approvedAt: '2026-09-25T10:00:00.000Z',
          lastSeenAt: null,
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const list = await listMachines();
    expect(list).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/machines', expect.objectContaining({}));
  });

  it('createPairingCode POSTs to /api/machines/pairing-codes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(201, { code: 'K7QX-M2PA', expiresAt: '2026-09-29T10:10:00.000Z' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const code = await createPairingCode();
    expect(code.code).toBe('K7QX-M2PA');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/machines/pairing-codes');
    expect(init.method).toBe('POST');
  });

  it('approveMachine POSTs and parses a fresh machine', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'm-2',
        name: 'a',
        status: 'approved',
        os: 'linux',
        osVersion: '6.6',
        arch: 'x86_64',
        cpu: 'AMD',
        cores: 1,
        ramGb: 1,
        diskFreeGb: 1,
        drivers: [],
        fingerprint: 'x',
        createdAt: '2026-09-25T10:00:00.000Z',
        approvedAt: '2026-09-29T10:00:00.000Z',
        lastSeenAt: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const machine = await approveMachine('m-2');
    expect(machine.status).toBe('approved');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/machines/m-2/approve');
    expect(init.method).toBe('POST');
  });

  it('denyMachine POSTs and tolerates an empty body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204, null));
    vi.stubGlobal('fetch', fetchMock);

    await denyMachine('m-2');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/machines/m-2/deny');
    expect(init.method).toBe('POST');
  });

  it('revokeMachine POSTs and returns the updated machine', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'm-3',
        name: 'a',
        status: 'revoked',
        os: 'macos',
        osVersion: '27.0',
        arch: 'arm64',
        cpu: 'M3',
        cores: 1,
        ramGb: 1,
        diskFreeGb: 1,
        drivers: [],
        fingerprint: 'x',
        createdAt: '2026-09-25T10:00:00.000Z',
        approvedAt: '2026-09-25T10:01:00.000Z',
        lastSeenAt: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const machine = await revokeMachine('m-3');
    expect(machine.status).toBe('revoked');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/machines/m-3/revoke');
    expect(init.method).toBe('POST');
  });

  it('renameMachine PATCHes the new name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'm-3',
        name: 'renamed',
        status: 'approved',
        os: 'macos',
        osVersion: '27.0',
        arch: 'arm64',
        cpu: 'M3',
        cores: 1,
        ramGb: 1,
        diskFreeGb: 1,
        drivers: [],
        fingerprint: 'x',
        createdAt: '2026-09-25T10:00:00.000Z',
        approvedAt: '2026-09-25T10:01:00.000Z',
        lastSeenAt: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const machine = await renameMachine('m-3', 'renamed');
    expect(machine.name).toBe('renamed');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/machines/m-3');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'renamed' });
  });

  it('deleteMachine DELETEs the id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204, null));
    vi.stubGlobal('fetch', fetchMock);

    await deleteMachine('m-3');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/machines/m-3');
    expect(init.method).toBe('DELETE');
  });

  it('a 409 becomes an ApiError carrying the server code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          error: { code: 'invalid_transition', message: 'Only pending machines can be approved' },
        }),
      ),
    );

    await expect(approveMachine('m-2')).rejects.toMatchObject({
      status: 409,
      code: 'invalid_transition',
    } satisfies Partial<ApiError>);
  });
});

const openaiConnection = {
  id: 'c-1',
  provider: 'openai',
  label: 'Work',
  status: 'active',
  createdAt: '2026-09-28T00:00:00.000Z',
};

describe('connections API', () => {
  it('listConnections hits GET /api/connections', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [openaiConnection]));
    vi.stubGlobal('fetch', fetchMock);

    const list = await listConnections();
    expect(list).toHaveLength(1);
    expect(list[0]?.provider).toBe('openai');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/connections');
  });

  it('createConnection POSTs the body and parses the new connection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, openaiConnection));
    vi.stubGlobal('fetch', fetchMock);

    const created = await createConnection({ provider: 'openai', key: 'sk-test', label: 'Work' });
    expect(created.id).toBe('c-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/connections');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      provider: 'openai',
      key: 'sk-test',
      label: 'Work',
    });
  });

  it('createConnection omits the label when none is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, openaiConnection));
    vi.stubGlobal('fetch', fetchMock);

    await createConnection({ provider: 'openai', key: 'sk-test' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ provider: 'openai', key: 'sk-test' });
  });

  it('testConnection POSTs to the id-specific test path', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: false, message: 'Key was rejected' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection('c-1');
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Key was rejected');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/connections/c-1/test');
    expect(init.method).toBe('POST');
  });

  it('testConnection tolerates a response without a message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection('c-1');
    expect(result.ok).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('deleteConnection DELETEs and tolerates an empty body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204, null));
    vi.stubGlobal('fetch', fetchMock);

    await deleteConnection('c-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/connections/c-1');
    expect(init.method).toBe('DELETE');
  });

  it('createConnection throws ApiError when the response shape is wrong', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(201, { not: 'a connection' })));

    await expect(createConnection({ provider: 'openai', key: 'sk-test' })).rejects.toMatchObject({
      status: 201,
      code: 'invalid_response',
    } satisfies Partial<ApiError>);
  });

  it('a 503 on listConnections surfaces the server message through ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(503, {
          error: {
            code: 'connections_unavailable',
            message: 'Provider connections are not configured on this server',
          },
        }),
      ),
    );

    await expect(listConnections()).rejects.toMatchObject({
      status: 503,
      code: 'connections_unavailable',
      message: 'Provider connections are not configured on this server',
    } satisfies Partial<ApiError>);
  });
});
