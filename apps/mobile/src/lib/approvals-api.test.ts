import { describe, expect, it, vi } from 'vitest';

import {
  ApprovalsApiError,
  buildDecisionBody,
  createApprovalsApi,
  type ApprovalRule,
  type PublicApproval,
} from './approvals-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const PENDING_APPROVAL: PublicApproval = {
  id: 'apr-42',
  aiId: 'ai-dev-1',
  groupId: null,
  action: 'Rotate the staging API token',
  summary: 'The staging token leaked in a CI log.',
  details: 'Rotate and update the CI secret.',
  argsHash: '8f14e45fceea167a5a36dedd4bea2543c9f4d5a7b0c1e2d3f4a5b6c7d8e9f0a1',
  worstCase: { currency: 'EUR', amount: 0.02 },
  requestedBy: 'me@zilar.chat',
  status: 'pending',
  decidedAt: null,
  note: null,
  expiresAt: '2026-09-28T03:00:00.000Z',
  createdAt: '2026-09-28T01:00:00.000Z',
};

function bodyOf(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return init?.body === undefined ? undefined : JSON.parse(init.body as string);
}

describe('buildDecisionBody', () => {
  it('omits note when it is undefined', () => {
    expect(Object.keys(buildDecisionBody('approve_once'))).toEqual(['decision']);
    expect(buildDecisionBody('approve_once')).toEqual({ decision: 'approve_once' });
  });

  it('includes note when it is supplied', () => {
    expect(buildDecisionBody('deny', 'bad idea')).toEqual({
      decision: 'deny',
      note: 'bad idea',
    });
  });
});

describe('createApprovalsApi', () => {
  it('GETs the approval with the bearer header and URL-encodes the id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PENDING_APPROVAL));
    const api = createApprovalsApi(
      async () => 'session-token',
      fetchImpl as unknown as typeof fetch,
    );

    await expect(api.getApproval('apr/with spaces')).resolves.toEqual(PENDING_APPROVAL);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/approvals/apr%2Fwith%20spaces');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
    expect(init.method).toBe('GET');
  });

  it('POSTs approve_once without a note', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PENDING_APPROVAL));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.decideApproval('apr-42', 'approve_once');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/approvals/apr-42/decision');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(bodyOf(fetchImpl.mock.calls[0] as unknown[])).toEqual({ decision: 'approve_once' });
  });

  it('POSTs deny with the note when supplied', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...PENDING_APPROVAL, status: 'denied' }));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.decideApproval('apr-42', 'deny', 'no thanks');

    expect(bodyOf(fetchImpl.mock.calls[0] as unknown[])).toEqual({
      decision: 'deny',
      note: 'no thanks',
    });
  });

  it('returns the typed PublicApproval on a 200', async () => {
    const decided = {
      ...PENDING_APPROVAL,
      status: 'approved_once' as const,
      decidedAt: '2026-09-28T02:00:00.000Z',
    };
    const fetchImpl = vi.fn(async () => jsonResponse(decided));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.decideApproval('apr-42', 'approve_once')).resolves.toEqual(decided);
  });

  it('keeps the server error code and status for 404', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'not_found', message: 'Approval not found' } }, 404),
    );
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getApproval('apr-42')).rejects.toBeInstanceOf(ApprovalsApiError);
    await expect(api.getApproval('apr-42')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('keeps the server error code and status for 409', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'not_pending', message: 'already decided' } }, 409),
    );
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.decideApproval('apr-42', 'approve_once')).rejects.toMatchObject({
      status: 409,
      code: 'not_pending',
    });
  });

  it('reports a network failure as network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getApproval('apr-42')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('rejects an unexpected response shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getApproval('apr-42')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects an approval whose wire shape is wrong (e.g. status not in the enum)', async () => {
    const broken = { ...PENDING_APPROVAL, status: 'maybe' };
    const fetchImpl = vi.fn(async () => jsonResponse(broken));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getApproval('apr-42')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects an approval whose worstCase has the wrong currency', async () => {
    const broken = { ...PENDING_APPROVAL, worstCase: { currency: 'GBP', amount: 1 } };
    const fetchImpl = vi.fn(async () => jsonResponse(broken));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getApproval('apr-42')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('fails before the network when there is no session', async () => {
    const fetchImpl = vi.fn();
    const api = createApprovalsApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(api.getApproval('apr-42')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

const APPROVAL_RULE: ApprovalRule = {
  id: 'rule-1',
  action: 'Rotate the staging API token',
  scope: 'personal',
  groupId: null,
  topicId: null,
  topicName: null,
  createdAt: '2026-09-28T01:30:00.000Z',
  createdBy: 'me',
};

describe('createApprovalsApi lists and rules', () => {
  it('GETs /api/approvals and returns the typed list', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([PENDING_APPROVAL]));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listApprovals()).resolves.toEqual([PENDING_APPROVAL]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/approvals');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
  });

  it('returns an empty list when nothing is pending', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listApprovals()).resolves.toEqual([]);
  });

  it('rejects a list whose row shape is wrong', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ nope: true }]));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listApprovals()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('GETs the AI rules route and URL-encodes the AI id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([APPROVAL_RULE]));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiApprovalRules('ai/with spaces')).resolves.toEqual([APPROVAL_RULE]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/ais/ai%2Fwith%20spaces/approval-rules');
    expect(init.method).toBe('GET');
  });

  it('GETs the group rules route and URL-encodes the group id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([APPROVAL_RULE]));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listGroupApprovalRules('g/1')).resolves.toEqual([APPROVAL_RULE]);

    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/groups/g%2F1/approval-rules');
  });

  it('parses a rule without the optional topic fields (older servers)', async () => {
    const legacy = { ...APPROVAL_RULE, topicId: undefined, topicName: undefined };
    const fetchImpl = vi.fn(async () => jsonResponse([legacy]));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiApprovalRules('ai-1')).resolves.toEqual([APPROVAL_RULE]);
  });

  it('rejects a rule whose scope is not in the enum', async () => {
    const broken = { ...APPROVAL_RULE, scope: 'org' };
    const fetchImpl = vi.fn(async () => jsonResponse([broken]));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiApprovalRules('ai-1')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('keeps the 404 when the viewer may not manage the rules', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'not_found', message: 'AI not found' } }, 404),
    );
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiApprovalRules('ai-1')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('DELETEs the rule route and URL-encodes the id', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.revokeApprovalRule('rule/with spaces')).resolves.toBeUndefined();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/approval-rules/rule%2Fwith%20spaces');
    expect(init.method).toBe('DELETE');
  });

  it('keeps the 404 when the rule is already gone', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'not_found', message: 'Approval rule not found' } }, 404),
    );
    const api = createApprovalsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.revokeApprovalRule('rule-1')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });
});
