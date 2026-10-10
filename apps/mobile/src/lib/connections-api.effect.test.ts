import { describe, expect, it, vi } from 'vitest';

import { createConnectionsApi } from './connections-api';
import { jsonResponse } from '@/test/wait';

describe('connections schema', () => {
  it('decodes a missing or non-string label to null', async () => {
    const rows = [
      { id: 'c-1', provider: 'openai', status: 'active', createdAt: '2026-09-28T00:00:00.000Z' },
      {
        id: 'c-2',
        provider: 'openai',
        label: 7,
        status: 'active',
        createdAt: '2026-09-28T00:00:00.000Z',
      },
    ];
    const fetchImpl = vi.fn(async () => jsonResponse(rows));
    const api = createConnectionsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listConnections()).resolves.toEqual([
      { ...rows[0], label: null },
      { ...rows[1], label: null },
    ]);
  });

  it('fails the whole list when one connection is malformed', async () => {
    const good = {
      id: 'c-1',
      provider: 'openai',
      label: null,
      status: 'active',
      createdAt: '2026-09-28T00:00:00.000Z',
    };
    const fetchImpl = vi.fn(async () => jsonResponse([good, { ...good, id: 7 }]));
    const api = createConnectionsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listConnections()).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });
});
