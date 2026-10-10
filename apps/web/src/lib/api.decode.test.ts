import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import { ApiError, getMe, listConnections } from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';
import { jsonResponseAt as jsonResponse } from '@/test/wait';

const mockEnabled = vi.mocked(isMockApiEnabled);

beforeEach(() => {
  mockEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decodeResponse (T-0505)', () => {
  it('decodes an Effect-schema response and drops unknown fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'u-1',
        email: 'ada@zilar.test',
        name: 'Ada',
        jid: null,
        unexpected: 'dropped',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const me = await getMe();
    expect(me.id).toBe('u-1');
    expect(me.name).toBe('Ada');
    expect('unexpected' in me).toBe(false);
  });

  it('answers invalid_response for a malformed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'u-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await getMe().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: 'invalid_response' });
  });

  it('still decodes a zod-schema response through the same helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, [
        {
          id: 'c-1',
          provider: 'openai',
          label: null,
          status: 'active',
          createdAt: '2026-10-08T00:00:00.000Z',
          unexpected: 'dropped',
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const connections = await listConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0]?.id).toBe('c-1');
    expect(connections[0] !== undefined && 'unexpected' in connections[0]).toBe(false);
  });
});
