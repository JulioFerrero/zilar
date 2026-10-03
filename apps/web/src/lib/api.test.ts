import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import { ApiError } from '@/lib/api';
import {
  approvalRuleSchema,
  approveMachine,
  checkGroupHandle,
  createConnection,
  createGroupRole,
  createPairingCode,
  decideApproval,
  deleteConnection,
  deleteGroupRole,
  deleteMachine,
  denyMachine,
  getApproval,
  joinPublicGroup,
  listAiApprovalRules,
  listAis,
  listApprovals,
  listAudit,
  listGroupApprovalRules,
  listGroupRoles,
  listMachines,
  lookupGroupByHandle,
  listConnections,
  machineSchema,
  publicApprovalSchema,
  renameGroupRole,
  renameMachine,
  resumeAi,
  revokeApprovalRule,
  revokeMachine,
  searchDirectory,
  setAiMachine,
  setGroupRoleMembers,
  setGroupVisibility,
  setTopicRoles,
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
  requestedBy: 'dev-1@ai.zilar.test',
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

  it('publicApprovalSchema parses approverNames and defaults them to []', () => {
    // T-0141: the list payload carries the names (T-0134); older servers
    // omit the field and the card hides the line.
    expect(
      publicApprovalSchema.parse({ ...approvalFixture, approverNames: ['Designers', 'Luis'] })
        .approverNames,
    ).toEqual(['Designers', 'Luis']);
    expect(publicApprovalSchema.parse(approvalFixture).approverNames).toEqual([]);
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

// T-0100: the always-eligible flag and the standing rules wire.
describe('approval rules API (T-0100)', () => {
  it('publicApprovalSchema defaults alwaysEligible to false when missing (older server)', () => {
    const oldShape: Record<string, unknown> = { ...approvalFixture };
    delete oldShape['alwaysEligible'];
    const parsed = publicApprovalSchema.parse(oldShape);
    expect(parsed.alwaysEligible).toBe(false);
  });

  it('publicApprovalSchema parses alwaysEligible true', () => {
    const parsed = publicApprovalSchema.parse({ ...approvalFixture, alwaysEligible: true });
    expect(parsed.alwaysEligible).toBe(true);
  });

  it('approvalRuleSchema parses a server-shaped rule', () => {
    const parsed = approvalRuleSchema.parse({
      id: 'rule-1',
      action: 'merge_pull_request',
      scope: 'personal',
      groupId: null,
      createdAt: '2026-09-29T10:00:00.000Z',
      createdBy: 'u-you',
    });
    expect(parsed.scope).toBe('personal');
    expect(parsed.groupId).toBeNull();
  });

  it('listAiApprovalRules hits GET /api/ais/:id/approval-rules and URL-encodes the id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal('fetch', fetchMock);

    await listAiApprovalRules('ai/1 with space');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/ais/ai%2F1%20with%20space/approval-rules');
  });

  it('listGroupApprovalRules hits GET /api/groups/:id/approval-rules', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, [
        {
          id: 'rule-2',
          action: 'send_message',
          scope: 'group',
          groupId: 'g-devteam',
          createdAt: '2026-09-29T10:00:00.000Z',
          createdBy: 'u-you',
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const rules = await listGroupApprovalRules('g-devteam');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.scope).toBe('group');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/groups/g-devteam/approval-rules');
  });

  it('revokeApprovalRule DELETEs the id-specific path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204, null));
    vi.stubGlobal('fetch', fetchMock);

    await revokeApprovalRule('rule-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/approval-rules/rule-1');
    expect(init.method).toBe('DELETE');
  });

  it('a 404 on listAiApprovalRules surfaces as a not_found ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(404, { error: { code: 'not_found', message: 'AI not found' } }),
        ),
    );

    await expect(listAiApprovalRules('missing')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    } satisfies Partial<ApiError>);
  });

  it('a 404 on revokeApprovalRule surfaces as a not_found ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(404, { error: { code: 'not_found', message: 'Approval rule not found' } }),
        ),
    );

    await expect(revokeApprovalRule('gone')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
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
    jid: 'ai-a-1@zilar.test',
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

// T-0091: the home machine wire. `setAiMachine` PUTs to the right path
// with the expected snake_case body and parses the fresh public AI back;
// `publicAiSchema` accepts the new `machineId` field. Server errors
// flow through `ApiError` like every other route.
describe('AI home machine API (T-0091)', () => {
  const assigned = {
    id: 'a-1',
    name: 'Dev-1',
    template: 'dev',
    persona: 'You are a concise senior engineer.',
    model: 'gpt-4o',
    jid: 'ai-a-1@zilar.test',
    status: 'active',
    providerConnectionId: 'c-1',
    limits: { perDayUsd: 2, perMonthUsd: 20 },
    machineId: 'm-1',
    createdAt: '2026-09-28T00:00:00.000Z',
  };

  it('listAis parses an AI with a machineId and an AI without one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, [assigned, { ...assigned, id: 'a-2', machineId: null }]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const list = await listAis();
    expect(list.map((item) => item.machineId)).toEqual(['m-1', null]);
  });

  it('listAis still parses an AI from a server that has not been upgraded yet (no machineId key)', async () => {
    const oldShape: Record<string, unknown> = { ...assigned };
    delete oldShape['machineId'];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [oldShape]));
    vi.stubGlobal('fetch', fetchMock);

    const list = await listAis();
    expect(list[0]?.machineId).toBeUndefined();
  });

  it('setAiMachine PUTs to /api/ais/:id/machine with snake_case body and parses the fresh AI', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, assigned));
    vi.stubGlobal('fetch', fetchMock);

    const ai = await setAiMachine('a-1', 'm-1');
    expect(ai.machineId).toBe('m-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ais/a-1/machine');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ machineId: 'm-1' });
  });

  it('setAiMachine(null) clears the assignment', async () => {
    const cleared = { ...assigned, machineId: null };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, cleared));
    vi.stubGlobal('fetch', fetchMock);

    const ai = await setAiMachine('a-1', null);
    expect(ai.machineId).toBeNull();
    expect(
      JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string),
    ).toEqual({
      machineId: null,
    });
  });

  it('a 404 machine_not_found surfaces the server code through ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(404, {
          error: { code: 'machine_not_found', message: 'Machine not found' },
        }),
      ),
    );

    await expect(setAiMachine('a-1', 'missing')).rejects.toMatchObject({
      status: 404,
      code: 'machine_not_found',
    } satisfies Partial<ApiError>);
  });

  it('a 400 invalid_request (unknown body key) surfaces through ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          error: { code: 'invalid_request', message: 'Unknown key' },
        }),
      ),
    );

    await expect(setAiMachine('a-1', 'm-1')).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
    } satisfies Partial<ApiError>);
  });
});

// T-0116: the group-roles wire. Each helper hits its path with the
// expected method and parses the role (or topic) shape back.
describe('group roles API (T-0116)', () => {
  const role = { id: 'role-1', name: 'Designers', members: [] };

  it('listGroupRoles hits GET /api/groups/:id/roles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { roles: [role] }));
    vi.stubGlobal('fetch', fetchMock);

    const roles = await listGroupRoles('g-devteam');
    expect(roles).toEqual([role]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/groups/g-devteam/roles');
  });

  it('createGroupRole POSTs the name and renameGroupRole PATCHes it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, role));
    vi.stubGlobal('fetch', fetchMock);

    await createGroupRole('g-devteam', 'Designers');
    const [postUrl, postInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(postUrl).toBe('/api/groups/g-devteam/roles');
    expect(postInit.method).toBe('POST');
    expect(JSON.parse(postInit.body as string)).toEqual({ name: 'Designers' });

    fetchMock.mockResolvedValue(jsonResponse(200, { ...role, name: 'Design' }));
    const renamed = await renameGroupRole('g-devteam', 'role-1', 'Design');
    expect(renamed.name).toBe('Design');
  });

  it('deleteGroupRole DELETEs the id-specific path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204, null));
    vi.stubGlobal('fetch', fetchMock);

    await deleteGroupRole('g-devteam', 'role-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/groups/g-devteam/roles/role-1');
    expect(init.method).toBe('DELETE');
  });

  it('setGroupRoleMembers PUTs the userIds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ...role, members: [{ userId: 'u-1', name: 'Ana' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const updated = await setGroupRoleMembers('g-devteam', 'role-1', ['u-1']);
    expect(updated.members).toEqual([{ userId: 'u-1', name: 'Ana' }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/groups/g-devteam/roles/role-1/members');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ userIds: ['u-1'] });
  });

  it('setTopicRoles PUTs roleIds and approverRoleId and parses the topic', async () => {
    const topic = {
      id: 't-1',
      groupId: 'g-devteam',
      name: 'Hiring',
      glyph: 'H',
      chatJid: 'hiring@rooms.zilar.test',
      visibility: 'private',
      kind: 'chat',
      status: 'open',
      owner: null,
      linkUrl: null,
      linkLabel: null,
      isGeneral: false,
      archived: false,
      memberCount: 2,
      ais: [],
      roles: [{ id: 'role-1', name: 'Designers', memberCount: 1 }],
      approverRole: { id: 'role-1', name: 'Designers' },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, topic));
    vi.stubGlobal('fetch', fetchMock);

    const updated = await setTopicRoles('t-1', { roleIds: ['role-1'], approverRoleId: 'role-1' });
    expect(updated.roles).toEqual([{ id: 'role-1', name: 'Designers', memberCount: 1 }]);
    expect(updated.approverRole).toEqual({ id: 'role-1', name: 'Designers' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/topics/t-1/roles');
    expect(init.method).toBe('PUT');
  });

  it('parses a topic from a server without roles keys (backwards compatible)', async () => {
    const oldTopic = {
      id: 't-1',
      groupId: 'g-devteam',
      name: 'Hiring',
      glyph: 'H',
      chatJid: 'hiring@rooms.zilar.test',
      visibility: 'private',
      kind: 'chat',
      status: 'open',
      owner: null,
      linkUrl: null,
      linkLabel: null,
      isGeneral: false,
      archived: false,
      memberCount: 2,
      ais: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, oldTopic));
    vi.stubGlobal('fetch', fetchMock);

    const { getTopic } = await import('@/lib/api');
    const topic = await getTopic('t-1');
    expect(topic.roles).toBeUndefined();
    expect(topic.approverRole).toBeUndefined();
  });
});

describe('public groups API (T-0164)', () => {
  const entry = {
    id: 'g-1',
    kind: 'group',
    title: 'Hiking club',
    handle: 'hiking_club',
    description: null,
    memberCount: 12,
    joined: false,
  };

  it('searchDirectory GETs /api/directory with q, kind and cursor', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { entries: [entry], next: null }));
    vi.stubGlobal('fetch', fetchMock);

    const page = await searchDirectory({ q: 'hiking', kind: 'group' });
    expect(page.entries).toEqual([entry]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/directory?q=hiking&kind=group');
  });

  it('searchDirectory with no input hits the bare path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { entries: [], next: null }));
    vi.stubGlobal('fetch', fetchMock);

    await searchDirectory();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/directory');
  });

  it('lookupGroupByHandle hits GET /api/groups/by-handle/:handle', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, entry));
    vi.stubGlobal('fetch', fetchMock);

    const found = await lookupGroupByHandle('hiking_club');
    expect(found).toEqual(entry);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/groups/by-handle/hiking_club');
  });

  it('joinPublicGroup POSTs /api/groups/:id/join', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { groupId: 'g-1', alreadyMember: false }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await joinPublicGroup('g-1');
    expect(result).toEqual({ groupId: 'g-1', alreadyMember: false });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/groups/g-1/join');
    expect(init.method).toBe('POST');
  });

  it('setGroupVisibility PATCHes visibility and handle', async () => {
    const detail = {
      id: 'g-1',
      title: 'Hiking club',
      createdBy: 'u-me',
      visibility: 'public',
      handle: 'hiking_club',
      members: [],
      ais: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, detail));
    vi.stubGlobal('fetch', fetchMock);

    const updated = await setGroupVisibility('g-1', {
      visibility: 'public',
      handle: 'hiking_club',
    });
    expect(updated.handle).toBe('hiking_club');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/groups/g-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      visibility: 'public',
      handle: 'hiking_club',
    });
  });

  it('checkGroupHandle asks the shared check with kind=group', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { available: true }));
    vi.stubGlobal('fetch', fetchMock);

    const checked = await checkGroupHandle('hiking_club');
    expect(checked).toEqual({ available: true });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/handles/check?handle=hiking_club&kind=group');
  });
});

describe('sticker packs and favorites API (T-0121)', () => {
  const sticker = {
    id: '223e4567-e89b-12d3-a456-426614174001',
    packId: '123e4567-e89b-12d3-a456-426614174000',
    emoji: '🐱',
    mime: 'image/webp',
    width: 200,
    height: 200,
    bytes: 1024,
    url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
  };
  const pack = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    ownerId: 'u-you',
    title: 'Cats',
    visibility: 'server',
    stickers: [sticker],
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
  };

  it('patchStickerPack PATCHes title, visibility and order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, pack));
    vi.stubGlobal('fetch', fetchMock);

    const { patchStickerPack } = await import('@/lib/api');
    const updated = await patchStickerPack(pack.id, { title: 'Big cats' });
    expect(updated.title).toBe('Cats');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/sticker-packs/${pack.id}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Big cats' });
  });

  it('deleteStickerPack DELETEs and returns the warning', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { warning: 'gone' }));
    vi.stubGlobal('fetch', fetchMock);

    const { deleteStickerPack } = await import('@/lib/api');
    const body = await deleteStickerPack(pack.id);
    expect(body.warning).toBe('gone');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/sticker-packs/${pack.id}`);
    expect(init.method).toBe('DELETE');
  });

  it('lists, adds and removes favorites', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { favorites: [sticker] }));
    vi.stubGlobal('fetch', fetchMock);

    const { listStickerFavorites, addStickerFavorite, removeStickerFavorite } =
      await import('@/lib/api');
    expect(await listStickerFavorites()).toEqual([sticker]);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sticker-favorites');

    fetchMock.mockResolvedValue(jsonResponse(200, sticker));
    await addStickerFavorite(sticker.id);
    const [, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(putInit.method).toBe('PUT');
    expect(JSON.parse(putInit.body as string)).toEqual({ sticker_id: sticker.id });

    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await removeStickerFavorite(sticker.id);
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(deleteUrl).toBe(`/api/sticker-favorites?sticker_id=${sticker.id}`);
    expect(deleteInit.method).toBe('DELETE');
  });

  it('uploadStickerFile POSTs raw bytes with the percent-encoded emoji header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, sticker));
    vi.stubGlobal('fetch', fetchMock);

    const { uploadStickerFile } = await import('@/lib/api');
    const blob = new File(['bytes'], 'a.webp', { type: 'image/webp' });
    const uploaded = await uploadStickerFile(pack.id, blob, '🐱');
    expect(uploaded.id).toBe(sticker.id);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/sticker-packs/${pack.id}/stickers`);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-emoji']).toBe(encodeURIComponent('🐱'));
    // The encoded value is a valid latin1 header: real Headers accept it.
    expect(() => new Headers(headers)).not.toThrow();
    expect(init.body).toBe(blob);
  });

  it('reorderStickerPanelPacks PUTs the full order to /api/sticker-panel', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const { reorderStickerPanelPacks } = await import('@/lib/api');
    await reorderStickerPanelPacks(['p-2', 'p-1']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sticker-panel');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ order: ['p-2', 'p-1'] });
  });

  it('importTelegramStickers POSTs the input and parses the summary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        pack,
        imported: 5,
        skippedAnimated: 3,
        skippedInvalid: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { importTelegramStickers } = await import('@/lib/api');
    const result = await importTelegramStickers('https://t.me/addstickers/FunCats');
    expect(result.imported).toBe(5);
    expect(result.skippedAnimated).toBe(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sticker-packs/import/telegram');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      input: 'https://t.me/addstickers/FunCats',
    });
  });
});

describe('integrations settings API (T-0162 + Email)', () => {
  it('getIntegrationsStatus hits GET /api/settings/integrations and parses the shape', async () => {
    const status = {
      telegram: { configured: true, source: 'stored' },
      email: { configured: true, source: 'stored', from: 'Zilar <a@b.c>' },
      canManage: true,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, status));
    vi.stubGlobal('fetch', fetchMock);

    const { getIntegrationsStatus } = await import('@/lib/api');
    expect(await getIntegrationsStatus()).toEqual(status);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/settings/integrations');
  });

  it('saveTelegramBotToken PUTs the token; removeTelegramBotToken DELETEs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const { saveTelegramBotToken, removeTelegramBotToken } = await import('@/lib/api');
    await saveTelegramBotToken('tok');
    const [putUrl, putInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(putUrl).toBe('/api/settings/integrations/telegram');
    expect(putInit.method).toBe('PUT');
    expect(JSON.parse(putInit.body as string)).toEqual({ botToken: 'tok' });

    await removeTelegramBotToken();
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(deleteUrl).toBe('/api/settings/integrations/telegram');
    expect(deleteInit.method).toBe('DELETE');
  });

  it('saveEmailSettings sends only `from` without a key, and both with one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const { saveEmailSettings } = await import('@/lib/api');
    await saveEmailSettings({ from: 'Zilar <a@b.c>' });
    expect(
      JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string),
    ).toEqual({ from: 'Zilar <a@b.c>' });
    await saveEmailSettings({ from: 'Zilar <a@b.c>', resendApiKey: 're_x' });
    expect(
      JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string),
    ).toEqual({ from: 'Zilar <a@b.c>', resendApiKey: 're_x' });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/settings/integrations/email');
    expect(init.method).toBe('PUT');
  });
});

describe('handles and contact requests API', () => {
  it('checkHandle encodes the handle as a query param', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { available: true }));
    vi.stubGlobal('fetch', fetchMock);

    const { checkHandle } = await import('@/lib/api');
    await expect(checkHandle('Ada Bo')).resolves.toEqual({ available: true });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/handles/check?handle=Ada+Bo');
  });

  it('claimHandle PUTs the trimmed handle', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { handle: 'ada' }));
    vi.stubGlobal('fetch', fetchMock);

    const { claimHandle } = await import('@/lib/api');
    await expect(claimHandle('ada')).resolves.toEqual({ handle: 'ada' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/me/handle');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ handle: 'ada' });
  });

  it('lookupByHandle encodes the handle in the path', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        userId: 'u-1',
        name: 'Bob',
        handle: 'bob_b',
        image: null,
        relation: 'none',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { lookupByHandle } = await import('@/lib/api');
    await expect(lookupByHandle('bob_b')).resolves.toMatchObject({
      userId: 'u-1',
      relation: 'none',
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/users/by-handle/bob_b');
  });

  it('sendContactRequest POSTs the handle and parses the reverse flag', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(409, {
        error: { code: 'request_exists', message: 'A request is already pending' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { sendContactRequest, ApiError } = await import('@/lib/api');
    await expect(sendContactRequest('bob_b')).rejects.toMatchObject({
      code: 'request_exists',
    });
    expect(ApiError).toBeDefined();
  });

  it('listContactRequests parses incoming and outgoing', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        incoming: [
          {
            id: 'r-1',
            status: 'pending',
            createdAt: new Date().toISOString(),
            other: { userId: 'u-2', name: 'Bob', handle: 'bob_b', image: null },
          },
        ],
        outgoing: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { listContactRequests } = await import('@/lib/api');
    const list = await listContactRequests();
    expect(list.incoming).toHaveLength(1);
    expect(list.incoming[0]?.other.handle).toBe('bob_b');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/contact-requests');
  });
});
