import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import { ApiError } from '@/lib/api';
import {
  approveMachine,
  createConnection,
  createPairingCode,
  decideApproval,
  deleteConnection,
  deleteMachine,
  denyMachine,
  getApproval,
  listAis,
  listApprovals,
  listAudit,
  listMachines,
  listConnections,
  machineSchema,
  publicApprovalSchema,
  renameMachine,
  resumeAi,
  revokeMachine,
  stopAi,
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

const approvalFixture = {
  id: 'apr-42',
  aiId: 'ai-dev-1',
  groupId: 'dev-team',
  action: 'merge_pull_request',
  summary: 'Merge PR #42',
  details: null,
  argsHash: 'a'.repeat(64),
  worstCase: { currency: 'EUR' as const, amount: 0.4 },
  requestedBy: 'dev-1@ai.galena.test',
  status: 'pending' as const,
  decidedAt: null,
  note: null,
  expiresAt: '2026-09-29T10:00:00.000Z',
  createdAt: '2026-09-29T09:55:00.000Z',
};

describe('approvals API', () => {
  it('publicApprovalSchema parses a server-shaped approval', () => {
    const parsed = publicApprovalSchema.parse(approvalFixture);
    expect(parsed.status).toBe('pending');
    expect(parsed.worstCase).toEqual({ currency: 'EUR', amount: 0.4 });
  });

  it('publicApprovalSchema rejects an unknown status', () => {
    expect(publicApprovalSchema.safeParse({ ...approvalFixture, status: 'gone' }).success).toBe(
      false,
    );
  });

  it('getApproval hits GET /api/approvals/:id and URL-encodes the id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ...approvalFixture, status: 'approved_once' }));
    vi.stubGlobal('fetch', fetchMock);

    const approval = await getApproval('apr/42 with space');
    expect(approval.status).toBe('approved_once');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/approvals/apr%2F42%20with%20space');
  });

  it('decideApproval POSTs approve_once by default and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...approvalFixture,
        status: 'approved_once',
        decidedAt: '2026-09-29T09:59:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const approval = await decideApproval('apr-42', 'approve_once');
    expect(approval.status).toBe('approved_once');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/approvals/apr-42/decision');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'approve_once' });
  });

  it('decideApproval includes the note when provided', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { ...approvalFixture, status: 'denied', note: 'looks risky' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await decideApproval('apr-42', 'deny', 'looks risky');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'deny', note: 'looks risky' });
  });

  it('decideApproval omits the note key when none is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, approvalFixture));
    vi.stubGlobal('fetch', fetchMock);

    await decideApproval('apr-42', 'approve_once');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'approve_once' });
  });

  it('a 409 not_pending surfaces the server code through ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          error: { code: 'not_pending', message: 'Approval request has already been decided' },
        }),
      ),
    );

    await expect(decideApproval('apr-42', 'deny')).rejects.toMatchObject({
      status: 409,
      code: 'not_pending',
    } satisfies Partial<ApiError>);
  });

  it('a 404 on getApproval surfaces as a not_found ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(404, { error: { code: 'not_found', message: 'Approval not found' } }),
        ),
    );

    await expect(getApproval('missing')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    } satisfies Partial<ApiError>);
  });

  it('a wrong response shape becomes an invalid_response ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { not: 'an approval' })));

    await expect(getApproval('apr-42')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    } satisfies Partial<ApiError>);
  });

  it('listApprovals hits GET /api/approvals and parses an array', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, [approvalFixture, { ...approvalFixture, id: 'apr-43' }]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const list = await listApprovals();
    expect(list).toHaveLength(2);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/approvals');
  });

  it('listApprovals throws an invalid_response ApiError when the body is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { not: 'a list' })));

    await expect(listApprovals()).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    } satisfies Partial<ApiError>);
  });
});

// T-0080: the owner kill switch on the wire. `publicAiSchema` accepts the
// new `stopped` value; `stopAi` and `resumeAi` POST to the right paths and
// parse the fresh public AI back. Server errors flow through `ApiError`
// like every other route.
describe('AIs stop / resume API (T-0080)', () => {
  const stopped = {
    id: 'a-1',
    name: 'Dev-1',
    template: 'dev',
    persona: 'You are a concise senior engineer.',
    model: 'gpt-4o',
    jid: 'ai-a-1@galena.test',
    status: 'stopped',
    providerConnectionId: 'c-1',
    limits: { perDayUsd: 2, perMonthUsd: 20 },
    createdAt: '2026-09-28T00:00:00.000Z',
  };

  it('publicAiSchema parses an AI with status `stopped`', () => {
    // The schema is internal but listAis must accept the new value, so
    // round-tripping a stopped AI through the list endpoint is the proof.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [stopped]));
    vi.stubGlobal('fetch', fetchMock);

    return expect(listAis()).resolves.toEqual([stopped]);
  });

  it('stopAi POSTs to /api/ais/:id/stop and parses the fresh AI', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, stopped));
    vi.stubGlobal('fetch', fetchMock);

    const ai = await stopAi('a-1');
    expect(ai.status).toBe('stopped');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ais/a-1/stop');
    expect(init.method).toBe('POST');
  });

  it('resumeAi POSTs to /api/ais/:id/resume and parses the fresh AI', async () => {
    const active = { ...stopped, status: 'active' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, active));
    vi.stubGlobal('fetch', fetchMock);

    const ai = await resumeAi('a-1');
    expect(ai.status).toBe('active');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ais/a-1/resume');
    expect(init.method).toBe('POST');
  });

  it('a 409 not_active surfaces the server code through ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          error: { code: 'not_active', message: 'AI is not active' },
        }),
      ),
    );

    await expect(stopAi('a-1')).rejects.toMatchObject({
      status: 409,
      code: 'not_active',
    } satisfies Partial<ApiError>);
  });

  it('a 409 not_active on resume surfaces through ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          error: { code: 'not_active', message: 'AI is not active' },
        }),
      ),
    );

    await expect(resumeAi('a-1')).rejects.toMatchObject({
      status: 409,
      code: 'not_active',
    } satisfies Partial<ApiError>);
  });

  it('a 404 on stop / resume surfaces as a not_found ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(404, { error: { code: 'not_found', message: 'AI not found' } }),
        ),
    );

    await expect(stopAi('missing')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    } satisfies Partial<ApiError>);
  });
});

const auditFixture = {
  id: 'audit-1',
  at: '2026-09-29T09:00:00.000Z',
  aiId: 'a-1',
  groupId: null,
  action: 'ai.stopped',
  subjectId: 'a-1',
  argsHash: null,
  cost: null,
  result: 'ok' as const,
  detail: null,
  actorUserId: 'u-you',
};

describe('audit list API (T-0084)', () => {
  it('listAudit hits GET /api/audit with the aiId query string', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { entries: [auditFixture], next: null }));
    vi.stubGlobal('fetch', fetchMock);

    const page = await listAudit({ aiId: 'a-1' });
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.action).toBe('ai.stopped');
    expect(page.next).toBeNull();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/audit?aiId=a-1');
  });

  // T-0086: the same endpoint serves a group's audit log. The signature is a
  // discriminated union (`aiId` xor `groupId`); the constraint is compile-time
  // only, so the test exercises the runtime query string for `groupId`.
  it('listAudit hits GET /api/audit with the groupId query string', async () => {
    const groupFixture = { ...auditFixture, aiId: null, groupId: 'g-devteam' };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { entries: [groupFixture], next: null }));
    vi.stubGlobal('fetch', fetchMock);

    const page = await listAudit({ groupId: 'g-devteam' });
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.groupId).toBe('g-devteam');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/audit?groupId=g-devteam');
  });

  it('listAudit encodes the aiId and includes limit + before when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { entries: [], next: 'cursor' }));
    vi.stubGlobal('fetch', fetchMock);

    await listAudit({ aiId: 'a/1 with space', limit: 20, before: 'cursor' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/audit?aiId=a%2F1+with+space&limit=20&before=cursor');
  });

  it('listAudit accepts a page with a next cursor and parses cost', async () => {
    const withCost = {
      ...auditFixture,
      cost: { currency: 'USD' as const, amount: 0.42 },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { entries: [withCost], next: 'next-cursor' }));
    vi.stubGlobal('fetch', fetchMock);

    const page = await listAudit({ aiId: 'a-1' });
    expect(page.next).toBe('next-cursor');
    expect(page.entries[0]?.cost).toEqual({ currency: 'USD', amount: 0.42 });
  });

  it('a wrong response shape becomes an invalid_response ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { entries: 'oops' })));

    await expect(listAudit({ aiId: 'a-1' })).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    } satisfies Partial<ApiError>);
  });

  it('a 404 on listAudit surfaces as a not_found ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(404, { error: { code: 'not_found', message: 'AI not found' } }),
        ),
    );

    await expect(listAudit({ aiId: 'missing' })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    } satisfies Partial<ApiError>);
  });
});
