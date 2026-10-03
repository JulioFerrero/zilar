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
  decideApproval,
  deleteAi,
  deleteMachine,
  denyMachine,
  getAi,
  getApproval,
  getChats,
  getContacts,
  getMe,
  listAiApprovalRules,
  listAis,
  listAudit,
  listChatPrefs,
  listConnections,
  listGroupApprovalRules,
  listMachines,
  listPushDevices,
  putChatPref,
  registerPushDevice,
  removePushDevice,
  renameMachine,
  resumeAi,
  revokeApprovalRule,
  revokeMachine,
  stopAi,
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

  it('checks and claims handles through the real schemas', async () => {
    const { checkHandle, claimHandle } = await import('@/lib/api');
    const { RESERVED_HANDLES } = await import('@/lib/handles');
    expect((await getMe()).handle ?? null).toBeNull();
    expect(await checkHandle('ab')).toEqual({ available: false, reason: 'invalid' });
    expect(await checkHandle('taken_user')).toEqual({ available: false, reason: 'taken' });
    expect(await checkHandle('ada_new')).toEqual({ available: true });
    // Every reserved word maps to `reserved`, like the server.
    expect(RESERVED_HANDLES.size).toBeGreaterThan(0);
    for (const word of RESERVED_HANDLES) {
      expect(await checkHandle(word)).toEqual({ available: false, reason: 'reserved' });
    }
    expect(await claimHandle('ada_new')).toEqual({ handle: 'ada_new' });
    expect((await getMe()).handle).toBe('ada_new');
  });

  it('serves chats and contacts that pass the real schemas', async () => {
    const chats = await getChats();
    expect(chats.some((chat) => chat.kind === 'dm')).toBe(true);
    expect(chats.some((chat) => chat.kind === 'group')).toBe(true);

    const contacts = await getContacts();
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts[0]?.jid).toMatch(/@zilar\.test$/);
  });

  it('stores chat prefs in memory with defaults-delete semantics', async () => {
    expect(await listChatPrefs()).toEqual([]);

    const pinned = await putChatPref('c-ana', { pinned: true });
    expect(pinned?.pinnedAt).toBeDefined();

    const muted = await putChatPref('c-ana', { mutedUntil: '2027-01-01T00:00:00.000Z' });
    expect(muted?.mutedUntil).toBe('2027-01-01T00:00:00.000Z');
    expect(muted?.pinnedAt).toBe(pinned?.pinnedAt);

    const cleared = await putChatPref('c-ana', {
      mutedUntil: null,
      archived: false,
      pinned: false,
    });
    expect(cleared).toBeNull();
    expect(await listChatPrefs()).toEqual([]);
  });

  it('registers, lists and removes push devices in memory', async () => {
    const { getPushConfig, getPushSettings, setPushSettings, sendTestPushNotification } =
      await import('@/lib/api');
    expect(await listPushDevices()).toEqual([]);
    expect((await getPushConfig()).pushJid).toBe('push.mock.test');
    expect(await getPushSettings()).toEqual({ showPreviews: true });

    const registered = await registerPushDevice({
      endpoint: 'https://push.example.com/mock-1',
      keys: { p256dh: 'p', auth: 'a' },
      userAgent: 'Test · Browser',
    });
    expect(registered.jid).toBe('push.mock.test');
    const devices = await listPushDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: registered.id, userAgent: 'Test · Browser' });
    expect(JSON.stringify(devices)).not.toContain('push.example.com');

    expect(await setPushSettings(false)).toEqual({ showPreviews: false });
    await sendTestPushNotification(registered.id);
    await removePushDevice(registered.id);
    expect(await listPushDevices()).toEqual([]);
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
    expect(created.jid).toBe(`ai-${created.id}@zilar.test`);
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

  it('searches the in-memory messages newest-first with marks', async () => {
    const { searchMessages } = await import('@/lib/api');
    const page = await searchMessages({ q: 'concert' });
    expect(page.items.length).toBeGreaterThan(0);
    const first = page.items[0]!;
    expect(first.chatJid).toBe('c-ana');
    expect(first.snippet.toLowerCase()).toContain('concert');
    const [start, end] = first.marks[0]!;
    expect([...first.snippet].slice(start, end).join('').toLowerCase()).toBe('concert');
    const ats = page.items.map((item) => item.at);
    expect([...ats].sort().reverse()).toEqual(ats);
  });

  it('mock search narrows to one chat and rejects short queries', async () => {
    const { searchMessages } = await import('@/lib/api');
    const page = await searchMessages({ q: 'concert', chat: 'c-ana' });
    expect(page.items.every((item) => item.chatJid === 'c-ana')).toBe(true);
    const other = await searchMessages({ q: 'concert', chat: 'c-marta' });
    expect(other.items).toHaveLength(0);
    await expect(searchMessages({ q: 'x' })).rejects.toMatchObject({ status: 400 });
  });

  it('mock search finds messages inside topic threads', async () => {
    // Fix 8: the index used to cover `mockMessages` only, so the short
    // per-topic threads (`mockTopicMessages`) were invisible to search.
    const { searchMessages } = await import('@/lib/api');
    const page = await searchMessages({ q: 'checkout' });
    const topicHit = page.items.find((item) => item.chatJid === 'c-devteam-bug');
    expect(topicHit).toBeDefined();
    expect(topicHit?.snippet.toLowerCase()).toContain('checkout');
    // ...and the chat filter reaches a topic chat id too.
    const narrowed = await searchMessages({ q: 'checkout', chat: 'c-devteam-bug' });
    expect(narrowed.items.length).toBeGreaterThan(0);
    expect(narrowed.items.every((item) => item.chatJid === 'c-devteam-bug')).toBe(true);
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

  it('seeds one pending approval matching the mock card', async () => {
    const approval = await getApproval('apr-42');
    expect(approval.id).toBe('apr-42');
    expect(approval.status).toBe('pending');
    expect(approval.action).toBe('merge_pull_request');
  });

  // T-0100: the seeded card is always-eligible in the personal chat;
  // `approve_always` stands it and creates a rule the AI panel lists,
  // and the mock DELETE removes it again.
  it('seeds apr-42 as always-eligible with a null groupId', async () => {
    const approval = await getApproval('apr-42');
    expect(approval.alwaysEligible).toBe(true);
    expect(approval.groupId).toBeNull();
  });

  it('approve_always creates a rule visible in the AI panel list, DELETE removes it', async () => {
    const decided = await decideApproval('apr-42', 'approve_always');
    expect(decided.status).toBe('approved_always');
    expect(decided.alwaysEligible).toBe(true);

    const rules = await listAiApprovalRules('ai-mock-dev');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      action: 'merge_pull_request',
      scope: 'personal',
      groupId: null,
    });

    await revokeApprovalRule(rules[0]!.id);
    await expect(listAiApprovalRules('ai-mock-dev')).resolves.toEqual([]);
  });

  it('the AI rules list starts empty and the group list 404s for a non-manager group', async () => {
    await expect(listAiApprovalRules('ai-mock-dev')).resolves.toEqual([]);
    await expect(listGroupApprovalRules('g-viernes')).rejects.toMatchObject({ status: 404 });
    const groupRules = await listGroupApprovalRules('g-devteam');
    expect(groupRules).toEqual([]);
  });

  it('approve flips the seeded approval to approved_once and a second decision answers 409', async () => {
    const approved = await decideApproval('apr-42', 'approve_once');
    expect(approved.status).toBe('approved_once');
    expect(approved.decidedAt).not.toBeNull();

    const refreshed = await getApproval('apr-42');
    expect(refreshed.status).toBe('approved_once');

    const response = await mockRequest('/approvals/apr-42/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'deny' }),
    });
    expect(response.status).toBe(409);
    const body = z
      .object({ error: z.object({ code: z.string(), message: z.string() }) })
      .parse(await response.json());
    expect(body.error.code).toBe('not_pending');
  });

  it('deny on the seeded approval flips it to denied', async () => {
    const denied = await decideApproval('apr-42', 'deny', 'looks risky');
    expect(denied.status).toBe('denied');
    expect(denied.note).toBe('looks risky');
  });

  it('an unknown approval id answers 404 not_found', async () => {
    const response = await mockRequest('/approvals/no-such', { method: 'GET' });
    expect(response.status).toBe(404);
    const body = z.object({ error: z.object({ code: z.string() }) }).parse(await response.json());
    expect(body.error.code).toBe('not_found');
  });

  it('an invalid decision body answers 400 invalid_request', async () => {
    const response = await mockRequest('/approvals/apr-42/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'maybe' }),
    });
    expect(response.status).toBe(400);
    const body = z.object({ error: z.object({ code: z.string() }) }).parse(await response.json());
    expect(body.error.code).toBe('invalid_request');
  });

  // T-0080: the mock layer serves the kill-switch routes the same way
  // the real server does: stop flips status to `stopped`, resume flips it
  // back, both runs are reflected in subsequent listAi calls.
  it('stops an active AI and reflects the new status in the list', async () => {
    const created = await createAi({
      name: 'Stoppable',
      template: 'dev',
      persona: 'Be brief.',
      providerConnectionId: 'conn-openai',
      model: 'gpt-4o',
      limits: { perDayUsd: 1, perMonthUsd: 10 },
    });
    const stopped = await stopAi(created.id);
    expect(stopped.status).toBe('stopped');

    const refreshed = await getAi(created.id);
    expect(refreshed.status).toBe('stopped');

    const list = await listAis();
    const found = list.find((ai) => ai.id === created.id);
    expect(found?.status).toBe('stopped');
  });

  it('resumes a stopped AI and reflects the new status in the list', async () => {
    const created = await createAi({
      name: 'Resumable',
      template: 'dev',
      persona: 'Be brief.',
      providerConnectionId: 'conn-openai',
      model: 'gpt-4o',
      limits: { perDayUsd: 1, perMonthUsd: 10 },
    });
    await stopAi(created.id);
    const resumed = await resumeAi(created.id);
    expect(resumed.status).toBe('active');

    const refreshed = await getAi(created.id);
    expect(refreshed.status).toBe('active');
  });

  it('a second stop on an already-stopped AI is idempotent (returns it unchanged)', async () => {
    const created = await createAi({
      name: 'Stop again',
      template: 'dev',
      persona: 'Be brief.',
      providerConnectionId: 'conn-openai',
      model: 'gpt-4o',
      limits: { perDayUsd: 1, perMonthUsd: 10 },
    });
    await stopAi(created.id);
    const second = await stopAi(created.id);
    expect(second.status).toBe('stopped');
  });

  it('stop / resume on an unknown AI answers 404 not_found', async () => {
    const stop = await mockRequest('/ais/no-such/stop', { method: 'POST' });
    expect(stop.status).toBe(404);
    const stopBody = z.object({ error: z.object({ code: z.string() }) }).parse(await stop.json());
    expect(stopBody.error.code).toBe('not_found');

    const resume = await mockRequest('/ais/no-such/resume', { method: 'POST' });
    expect(resume.status).toBe(404);
    const resumeBody = z
      .object({ error: z.object({ code: z.string() }) })
      .parse(await resume.json());
    expect(resumeBody.error.code).toBe('not_found');
  });

  it('serves audit entries for a seeded AI through the real schema', async () => {
    const page = await listAudit({ aiId: 'ai-mock-dev', limit: 20 });
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.next).toBeNull();
    const actions = new Set(page.entries.map((entry) => entry.action));
    expect(actions.has('ai.stopped')).toBe(true);
    expect(actions.has('ai.resumed')).toBe(true);
    expect(actions.has('approval.decided')).toBe(true);
  });

  it('returns an empty page for an unknown AI id', async () => {
    const page = await listAudit({ aiId: 'no-such', limit: 20 });
    expect(page.entries).toEqual([]);
    expect(page.next).toBeNull();
  });

  // T-0086: the group panel asks for `?groupId=…`. The mock serves the
  // seeded room activity and answers an empty page for unknown rooms.
  it('serves audit entries for a seeded group through the real schema', async () => {
    const page = await listAudit({ groupId: 'g-devteam', limit: 20 });
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.entries.every((entry) => entry.groupId === 'g-devteam')).toBe(true);
    const actions = new Set(page.entries.map((entry) => entry.action));
    expect(actions.has('approval.decided')).toBe(true);
  });

  it('returns an empty page for an unknown group id', async () => {
    const page = await listAudit({ groupId: 'no-such-group', limit: 20 });
    expect(page.entries).toEqual([]);
    expect(page.next).toBeNull();
  });

  it('rejects an audit request with both groupId and aiId with 400 invalid_request', async () => {
    const response = await mockRequest('/audit?aiId=a-1&groupId=g-devteam', { method: 'GET' });
    expect(response.status).toBe(400);
    const body = z.object({ error: z.object({ code: z.string() }) }).parse(await response.json());
    expect(body.error.code).toBe('invalid_request');
  });

  it('rejects an audit request without aiId with 400 invalid_request', async () => {
    const response = await mockRequest('/audit', { method: 'GET' });
    expect(response.status).toBe(400);
    const body = z.object({ error: z.object({ code: z.string() }) }).parse(await response.json());
    expect(body.error.code).toBe('invalid_request');
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
