import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/mock/gate', () => ({
  isMockMode: vi.fn(() => true),
  isMockApiEnabled: vi.fn(() => false),
}));

import {
  approveMachine,
  createAi,
  createPairingCode,
  deleteAi,
  deleteMachine,
  denyMachine,
  getAi,
  getChats,
  getContacts,
  getMe,
  listAis,
  listConnections,
  listMachines,
  renameMachine,
  revokeMachine,
  updateAi,
  updateMe,
} from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';
import { mockRequest, resetMockApi, setMockDelay } from './api';

const mockEnabled = vi.mocked(isMockApiEnabled);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  resetMockApi();
  setMockDelay(0);
  mockEnabled.mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('mockRequest', () => {
  it('serves and patches the profile through the real schemas', async () => {
    const me = await getMe();
    expect(me.id).toBe('u-you');
    expect(me.name).toBe('You');

    const updated = await updateMe('Ada');
    expect(updated.name).toBe('Ada');
    expect((await getMe()).name).toBe('Ada');
  });

  it('serves chats and contacts that pass the real schemas', async () => {
    const chats = await getChats();
    expect(chats.some((chat) => chat.kind === 'dm')).toBe(true);
    expect(chats.some((chat) => chat.kind === 'group')).toBe(true);

    const contacts = await getContacts();
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts[0]?.jid).toMatch(/@galena\.test$/);
  });

  it('seeds two AIs, one without usage and one at 85% of its daily limit', async () => {
    const ais = await listAis();
    expect(ais).toHaveLength(2);
    expect(ais.some((ai) => ai.usage == null)).toBe(true);

    const near = ais.find((ai) => ai.usage != null);
    expect(near).toBeDefined();
    if (near?.usage != null) {
      expect(near.usage.todayUsd / near.limits.perDayUsd).toBeCloseTo(0.85);
    }
  });

  it('creates, reads, updates and deletes AIs in memory', async () => {
    const created = await createAi({
      name: 'Researcher',
      template: 'custom',
      persona: 'Be curious.',
      providerConnectionId: 'conn-openai',
      model: 'gpt-4o',
      limits: { perDayUsd: 1, perMonthUsd: 10 },
    });
    expect(created.id).toBeTruthy();
    expect(created.jid).toBe(`ai-${created.id}@galena.test`);
    expect((await listAis()).some((ai) => ai.id === created.id)).toBe(true);

    const patched = await updateAi(created.id, { name: 'Renamed' });
    expect(patched.name).toBe('Renamed');
    expect((await getAi(created.id)).name).toBe('Renamed');

    await deleteAi(created.id);
    expect((await listAis()).some((ai) => ai.id === created.id)).toBe(false);
  });

  it('serves two connections and handles create, test and delete', async () => {
    const connections = await listConnections();
    expect(connections).toHaveLength(2);

    const created = await mockRequest('/connections', {
      method: 'POST',
      body: JSON.stringify({ provider: 'github', key: 'ghp_test', label: 'Work' }),
    });
    expect(created.status).toBe(201);
    const createdBody = z
      .object({
        id: z.string(),
        provider: z.string(),
        label: z.string().nullable(),
        status: z.string(),
        createdAt: z.string(),
      })
      .parse(await created.json());
    expect(createdBody.provider).toBe('github');
    expect(createdBody.label).toBe('Work');
    expect(await listConnections()).toHaveLength(3);

    const tested = await mockRequest('/connections/conn-openai/test', { method: 'POST' });
    expect(tested.status).toBe(200);
    expect(await tested.json()).toEqual({ ok: true });

    const removed = await mockRequest('/connections/conn-openai', { method: 'DELETE' });
    expect(removed.status).toBe(204);
    expect(await listConnections()).toHaveLength(2);
  });

  it('test on an unknown connection answers 404', async () => {
    const response = await mockRequest('/connections/no-such/test', { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('answers 404 mock_not_implemented for anything else', async () => {
    const response = await mockRequest('/nope');
    expect(response.status).toBe(404);
    const body = z.object({ error: z.object({ code: z.string() }) }).parse(await response.json());
    expect(body.error.code).toBe('mock_not_implemented');
  });

  it('seeds three machines (1 pending, 1 approved, 1 revoked)', async () => {
    const machines = await listMachines();
    expect(machines).toHaveLength(3);
    const statuses = new Set(machines.map((machine) => machine.status));
    expect(statuses).toEqual(new Set(['pending', 'approved', 'revoked']));
  });

  it('mints a pairing code with the K7QX-M2PA shape and an expiry 10 minutes ahead', async () => {
    const before = Date.now();
    const code = await createPairingCode();
    expect(code.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const expiry = new Date(code.expiresAt).getTime();
    expect(expiry).toBeGreaterThan(before);
    expect(expiry - before).toBeGreaterThanOrEqual(10 * 60 * 1000 - 5000);
    expect(expiry - before).toBeLessThanOrEqual(10 * 60 * 1000 + 5000);
  });

  it('approve moves a pending machine to approved', async () => {
    const before = await listMachines();
    const pending = before.find((machine) => machine.status === 'pending');
    expect(pending).toBeDefined();
    const updated = await approveMachine(pending!.id);
    expect(updated.status).toBe('approved');
    expect(updated.approvedAt).not.toBeNull();
  });

  it('deny removes a pending machine from the list', async () => {
    const before = await listMachines();
    const pending = before.find((machine) => machine.status === 'pending');
    expect(pending).toBeDefined();
    await denyMachine(pending!.id);
    const after = await listMachines();
    expect(after.find((machine) => machine.id === pending!.id)).toBeUndefined();
  });

  it('rename changes the name', async () => {
    const machines = await listMachines();
    const approved = machines.find((machine) => machine.status === 'approved');
    expect(approved).toBeDefined();
    const renamed = await renameMachine(approved!.id, 'renamed-mac');
    expect(renamed.name).toBe('renamed-mac');
  });

  it('revoke moves an approved machine to revoked', async () => {
    const machines = await listMachines();
    const approved = machines.find((machine) => machine.status === 'approved');
    expect(approved).toBeDefined();
    const revoked = await revokeMachine(approved!.id);
    expect(revoked.status).toBe('revoked');
  });

  it('delete removes a non-approved machine', async () => {
    const machines = await listMachines();
    const revoked = machines.find((machine) => machine.status === 'revoked');
    expect(revoked).toBeDefined();
    await deleteMachine(revoked!.id);
    const after = await listMachines();
    expect(after.find((machine) => machine.id === revoked!.id)).toBeUndefined();
  });

  it('approve on an approved machine is a 409 invalid_transition', async () => {
    const machines = await listMachines();
    const approved = machines.find((machine) => machine.status === 'approved');
    expect(approved).toBeDefined();
    const response = await mockRequest(`/machines/${approved!.id}/approve`, { method: 'POST' });
    expect(response.status).toBe(409);
    const body = z
      .object({ error: z.object({ code: z.string(), message: z.string() }) })
      .parse(await response.json());
    expect(body.error.code).toBe('invalid_transition');
  });

  it('delete on an approved machine is a 409 revoke_first', async () => {
    const machines = await listMachines();
    const approved = machines.find((machine) => machine.status === 'approved');
    expect(approved).toBeDefined();
    const response = await mockRequest(`/machines/${approved!.id}`, { method: 'DELETE' });
    expect(response.status).toBe(409);
    const body = z.object({ error: z.object({ code: z.string() }) }).parse(await response.json());
    expect(body.error.code).toBe('revoke_first');
  });

  it('revoke on an already revoked machine is a 409 invalid_transition', async () => {
    const machines = await listMachines();
    const revoked = machines.find((machine) => machine.status === 'revoked');
    expect(revoked).toBeDefined();
    const response = await mockRequest(`/machines/${revoked!.id}/revoke`, { method: 'POST' });
    expect(response.status).toBe(409);
    const body = z.object({ error: z.object({ code: z.string() }) }).parse(await response.json());
    expect(body.error.code).toBe('invalid_transition');
  });

  it('waits before answering, so loading states are real', async () => {
    vi.useFakeTimers();
    setMockDelay(150);
    let resolved = false;
    const pending = mockRequest('/me').then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(149);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toBe(true);
  });
});

describe('the mock layer is gated', () => {
  it('uses the real fetch when the gate is closed', async () => {
    mockEnabled.mockReturnValue(false);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: 'u-1', email: 'a@b.com', name: 'A' }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await getMe()).name).toBe('A');
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.anything());
  });
});
