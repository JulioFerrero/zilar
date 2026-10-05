import { describe, expect, it } from 'vitest';
import { mockRequest, resetMockApi, setMockDelay } from './api';

setMockDelay(0);

async function call(
  method: string,
  path: string,
  payload?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await mockRequest(
    path,
    {
      method,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    },
    { delayMs: 0 },
  );
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

describe('mock group roles API (T-0116)', () => {
  it('seeds the Designers and Devs roles with holders', async () => {
    resetMockApi();
    const { status, body } = await call('GET', '/groups/g-devteam/roles');
    expect(status).toBe(200);
    const roles = (body as { roles: { id: string; name: string; members: unknown[] }[] }).roles;
    expect(roles.map((role) => role.name).sort()).toEqual(['Designers', 'Devs']);
    expect(roles.find((role) => role.id === 'role-designers')?.members).toEqual([
      { userId: 'u-you', name: 'You' },
      { userId: 'u-ana', name: 'Ana' },
    ]);
  });

  it('creates, renames, assigns and deletes a role', async () => {
    resetMockApi();
    const created = await call('POST', '/groups/g-devteam/roles', { name: 'QA' });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;

    const duplicate = await call('POST', '/groups/g-devteam/roles', { name: 'qa' });
    expect(duplicate.status).toBe(409);

    const renamed = await call('PATCH', `/groups/g-devteam/roles/${id}`, { name: 'Quality' });
    expect(renamed.status).toBe(200);
    expect((renamed.body as { name: string }).name).toBe('Quality');

    const assigned = await call('PUT', `/groups/g-devteam/roles/${id}/members`, {
      userIds: ['u-marco'],
    });
    expect(assigned.status).toBe(200);
    expect((assigned.body as { members: { userId: string }[] }).members).toEqual([
      { userId: 'u-marco', name: 'Marco' },
    ]);

    const deleted = await call('DELETE', `/groups/g-devteam/roles/${id}`);
    expect(deleted.status).toBe(204);
    const missing = await call('DELETE', `/groups/g-devteam/roles/${id}`);
    expect(missing.status).toBe(404);
  });

  it('attaches roles and an approver role to a private topic', async () => {
    resetMockApi();
    const hiring = await call('GET', '/topics/t-devteam-hiring');
    expect(hiring.status).toBe(200);
    expect((hiring.body as { roles: { id: string }[] }).roles.map((role) => role.id)).toEqual([
      'role-designers',
    ]);

    const attached = await call('PUT', '/topics/t-devteam-hiring/roles', {
      roleIds: ['role-designers', 'role-devs'],
      approverRoleId: 'role-designers',
    });
    expect(attached.status).toBe(200);
    const body = attached.body as {
      roles: { id: string; memberCount: number }[];
      approverRole: { id: string; name: string } | null;
    };
    expect(body.roles.map((role) => role.id).sort()).toEqual(['role-designers', 'role-devs']);
    expect(body.approverRole).toEqual({ id: 'role-designers', name: 'Designers' });

    // Public topics refuse roles; unknown roles refuse too.
    const publicRefused = await call('PUT', '/topics/t-devteam-bug/roles', {
      roleIds: ['role-designers'],
      approverRoleId: null,
    });
    expect(publicRefused.status).toBe(400);
    const foreign = await call('PUT', '/topics/t-devteam-hiring/roles', {
      roleIds: ['role-nope'],
      approverRoleId: null,
    });
    expect(foreign.status).toBe(400);
  });

  it('answers 404 for unknown groups and roles', async () => {
    resetMockApi();
    expect((await call('GET', '/groups/g-nope/roles')).status).toBe(404);
    expect((await call('DELETE', '/groups/g-devteam/roles/role-nope')).status).toBe(404);
  });
});
