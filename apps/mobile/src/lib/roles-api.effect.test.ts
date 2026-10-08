import { describe, expect, it, vi } from 'vitest';

import { createRolesApi, parseCustomGroupRole } from './roles-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ROLE = {
  id: 'role-designers',
  name: 'Designers',
  members: [{ userId: 'u-me', name: 'Me' }],
};

describe('roles schema', () => {
  it('drops an unknown extra field from a role row', () => {
    expect(parseCustomGroupRole({ ...ROLE, extra: 'ignored' })).toEqual(ROLE);
  });
});

describe('roles api effect pipeline', () => {
  it('fails the whole list when one role row is malformed', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ roles: [ROLE, { ...ROLE, id: 7 }] }));
    const api = createRolesApi(
      async () => 'tok',
      fetchImpl as unknown as typeof fetch,
      'http://127.0.0.1:3188',
    );

    await expect(api.listGroupRoles('g1')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
      message: 'The server sent an unexpected response',
    });
  });

  it('maps a network throw to network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const api = createRolesApi(
      async () => 'tok',
      fetchImpl as unknown as typeof fetch,
      'http://127.0.0.1:3188',
    );

    await expect(api.listGroupRoles('g1')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
      message: 'Could not reach the server',
    });
  });
});
