import { describe, expect, it, vi } from 'vitest';

import { ChatApiError, createChatApi } from './chat-api';

function apiFor(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);
}

describe('chat-api Effect pipeline', () => {
  it('maps a network throw to network_error', async () => {
    const api = apiFor(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(api.getChats()).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });

  it('keeps per-field fallbacks on a non-JSON error body', async () => {
    const api = apiFor(async () => new Response('not json', { status: 500 }));
    await expect(api.getChats()).rejects.toMatchObject({
      status: 500,
      code: 'request_failed',
      message: 'Request failed (500)',
    });
  });

  it('tolerates a non-array ais on group detail as no AIs', async () => {
    const api = apiFor(
      async () =>
        new Response(
          JSON.stringify({
            id: 'g1',
            title: 'Team',
            createdBy: 'u-me',
            members: [{ userId: 'u-ana', name: 'Ana', role: 'member' }],
            ais: 'oops',
          }),
          { status: 200 },
        ),
    );
    await expect(api.getGroup('g1')).resolves.toMatchObject({ id: 'g1', ais: [] });
  });

  it('fails with unauthorized before touching the network', async () => {
    const fetchImpl = vi.fn();
    const api = createChatApi(async () => undefined, fetchImpl as unknown as typeof fetch);
    const error = await api.getMe().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
