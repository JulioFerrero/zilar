import { describe, expect, it, vi } from 'vitest';

import { createRolesApi, parseCustomGroupRole, RolesApiError } from './roles-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function roleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'role-designers',
    name: 'Designers',
    members: [
      { userId: 'u-me', name: 'Me' },
      { userId: 'u-ana', name: 'Ana' },
    ],
    ...overrides,
  };
}

describe('parseCustomGroupRole', () => {
  it('parses a valid role row', () => {
    expect(parseCustomGroupRole(roleRow())).toEqual({
      id: 'role-designers',
      name: 'Designers',
      members: [
        { userId: 'u-me', name: 'Me' },
        { userId: 'u-ana', name: 'Ana' },
      ],
    });
  });

  it('parses an empty holder set', () => {
    expect(parseCustomGroupRole(roleRow({ members: [] }))).toMatchObject({
      id: 'role-designers',
      members: [],
    });
  });

  it('rejects malformed rows', () => {
    expect(parseCustomGroupRole({})).toBeNull();
    expect(parseCustomGroupRole(roleRow({ id: undefined }))).toBeNull();
    expect(parseCustomGroupRole(roleRow({ members: [{ userId: 'u-me' }] }))).toBeNull();
    expect(parseCustomGroupRole(roleRow({ members: 'nope' }))).toBeNull();
  });
});

describe('createRolesApi', () => {
  function apiFor(handler: (url: string, init: RequestInit) => Promise<Response>) {
    const fetchImpl = vi.fn(handler);
    const api = createRolesApi(
      async () => 'session-token',
      fetchImpl as unknown as typeof fetch,
      'http://127.0.0.1:3188',
    );
    return { api, fetchImpl };
  }

  it('lists roles with the bearer token', async () => {
    const { api, fetchImpl } = apiFor(async () =>
      jsonResponse({ roles: [roleRow(), roleRow({ id: 'role-devs', name: 'Devs' })] }),
    );

    const roles = await api.listGroupRoles('g1');

    expect(roles.map((role) => role.name)).toEqual(['Designers', 'Devs']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/groups/g1/roles');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('creates, renames and deletes with the right methods', async () => {
    const { api, fetchImpl } = apiFor(async (url, init) => {
      if (init.method === 'POST') {
        return jsonResponse(roleRow({ name: 'QA' }), 201);
      }
      if (init.method === 'PATCH') {
        return jsonResponse(roleRow({ name: 'Quality' }));
      }
      return new Response(null, { status: 204 });
    });

    await expect(api.createGroupRole('g1', 'QA')).resolves.toMatchObject({ name: 'QA' });
    await expect(api.renameGroupRole('g1', 'role-designers', 'Quality')).resolves.toMatchObject({
      name: 'Quality',
    });
    await expect(api.deleteGroupRole('g1', 'role-designers')).resolves.toBeUndefined();

    const calls = fetchImpl.mock.calls.map(
      ([url, init]) => `${(init as RequestInit).method} ${(url as string).split('/api')[1]}`,
    );
    expect(calls).toEqual([
      'POST /groups/g1/roles',
      'PATCH /groups/g1/roles/role-designers',
      'DELETE /groups/g1/roles/role-designers',
    ]);
  });

  it('replaces the holder set with one PUT of the full desired list', async () => {
    let seenBody: unknown;
    const { api } = apiFor(async (_url, init) => {
      seenBody = JSON.parse((init.body as string) ?? '{}');
      return jsonResponse(roleRow());
    });

    await api.setGroupRoleMembers('g1', 'role-designers', ['u-me']);

    expect(seenBody).toEqual({ userIds: ['u-me'] });
  });

  it('throws a typed error carrying the server code and status', async () => {
    const { api } = apiFor(async () =>
      jsonResponse({ error: { code: 'forbidden', message: 'Only group owners...' } }, 403),
    );

    await expect(api.deleteGroupRole('g1', 'role-designers')).rejects.toBeInstanceOf(RolesApiError);
    await expect(api.deleteGroupRole('g1', 'role-designers')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('rejects an unexpected response shape', async () => {
    const { api } = apiFor(async () => jsonResponse({ nope: true }));

    await expect(api.listGroupRoles('g1')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('fails before the network when there is no session', async () => {
    const fetchImpl = vi.fn();
    const api = createRolesApi(
      async () => undefined,
      fetchImpl as unknown as typeof fetch,
      'http://127.0.0.1:3188',
    );

    await expect(api.listGroupRoles('g1')).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
