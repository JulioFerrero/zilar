import { describe, expect, it, vi } from 'vitest';

import { AuditApiError, createAuditApi, type PublicAuditEntry } from './audit-api';
import { jsonResponse } from '@/test/wait';

const ENTRY: PublicAuditEntry = {
  id: 'audit-1',
  at: '2026-10-03T10:00:00.000Z',
  aiId: 'ai-1',
  groupId: null,
  action: 'ai.stopped',
  subjectId: null,
  argsHash: null,
  cost: null,
  result: 'ok',
  detail: null,
  actorUserId: null,
};

const PAGE = { entries: [ENTRY], next: null };

describe('createAuditApi', () => {
  it('GETs the AI audit with aiId and limit=20 and the bearer header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PAGE));
    const api = createAuditApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-1')).resolves.toEqual(PAGE);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/audit?aiId=ai-1&limit=20');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
    expect(init.method).toBe('GET');
  });

  it('appends the before cursor and URL-encodes the id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PAGE));
    const api = createAuditApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.listAiAudit('ai/with spaces', 'cursor-9');

    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'http://127.0.0.1:3188/api/audit?aiId=ai%2Fwith+spaces&limit=20&before=cursor-9',
    );
  });

  it('parses entries with cost, detail and actor', async () => {
    const full: PublicAuditEntry = {
      ...ENTRY,
      id: 'audit-2',
      action: 'approval.decided',
      result: 'denied',
      cost: { currency: 'USD', amount: 0.012 },
      detail: { decision: 'deny' },
      actorUserId: 'user-1',
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ entries: [full], next: 'cursor-1' }));
    const api = createAuditApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-1')).resolves.toEqual({
      entries: [full],
      next: 'cursor-1',
    });
  });

  it('throws invalid_response when one entry does not parse', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ entries: [ENTRY, { ...ENTRY, action: 42 }], next: null }),
    );
    const api = createAuditApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-1')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('throws invalid_response when the page shape is wrong', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ entries: [ENTRY], next: 42 }));
    const api = createAuditApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-1')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('throws an AuditApiError with the server code on HTTP errors', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'forbidden', message: 'Not your AI' } }, 403),
    );
    const api = createAuditApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-2')).rejects.toBeInstanceOf(AuditApiError);
    await expect(api.listAiAudit('ai-2')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('throws unauthorized when there is no session token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PAGE));
    const api = createAuditApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-1')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws network_error when fetch rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const api = createAuditApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-1')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });
});
