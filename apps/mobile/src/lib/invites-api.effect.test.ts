import { describe, expect, it, vi } from 'vitest';

import { createInvitesApi } from './invites-api';
import { jsonResponse } from '@/test/wait';

describe('invites schema', () => {
  it('drops an unknown extra field', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 'abc123',
        url: 'https://chat.zilar.app/invite/abc123',
        extra: 'ignored',
      }),
    );
    const api = createInvitesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.createInvite()).resolves.toEqual({
      code: 'abc123',
      url: 'https://chat.zilar.app/invite/abc123',
    });
  });

  it('rejects a non-string expiresAt as invalid_response', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 'abc123', url: 'https://chat.zilar.app/invite/abc123', expiresAt: 7 }),
    );
    const api = createInvitesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.createInvite()).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('keeps a valid error code when the message is malformed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'rate_limited', message: 123 } }, 429),
    );
    const api = createInvitesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.createInvite()).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      message: 'Request failed (429)',
    });
  });

  it('keeps a valid error message when the code is malformed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 123, message: 'slow down' } }, 429),
    );
    const api = createInvitesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.createInvite()).rejects.toMatchObject({
      status: 429,
      code: 'request_failed',
      message: 'slow down',
    });
  });
});
