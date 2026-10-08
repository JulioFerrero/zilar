import { describe, expect, it, vi } from 'vitest';

import { createAuditApi, type PublicAuditEntry } from './audit-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

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

describe('audit schema', () => {
  it('drops an unknown extra entry field', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ entries: [{ ...ENTRY, extra: 'ignored' }], next: null }),
    );
    const api = createAuditApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-1')).resolves.toEqual({ entries: [ENTRY], next: null });
  });

  it('accepts an array detail, as the old type guard did', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ entries: [{ ...ENTRY, detail: [1, 2] }], next: null }),
    );
    const api = createAuditApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-1')).resolves.toEqual({
      entries: [{ ...ENTRY, detail: [1, 2] }],
      next: null,
    });
  });

  it('rejects a detail that is not an object', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ entries: [{ ...ENTRY, detail: 5 }], next: null }),
    );
    const api = createAuditApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-1')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('keeps a valid error code when the message is malformed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'forbidden', message: 123 } }, 403),
    );
    const api = createAuditApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-1')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      message: 'Request failed (403)',
    });
  });

  it('keeps a valid error message when the code is malformed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 123, message: 'Not your AI' } }, 403),
    );
    const api = createAuditApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiAudit('ai-1')).rejects.toMatchObject({
      status: 403,
      code: 'request_failed',
      message: 'Not your AI',
    });
  });
});
