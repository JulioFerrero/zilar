import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/mock/gate', () => ({
  isMockMode: vi.fn(() => true),
  isMockApiEnabled: vi.fn(() => false),
}));

import {
  createAi,
  deleteAi,
  getAi,
  getChats,
  getContacts,
  getMe,
  listAis,
  listConnections,
  updateAi,
  updateMe,
} from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';
import { createMockFetch, mockRequest, resetMockApi, setMockDelay } from './api';

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

  it('serves two connections and handles test and delete', async () => {
    const connections = await listConnections();
    expect(connections).toHaveLength(2);

    const tested = await mockRequest('/connections/conn-openai/test', { method: 'POST' });
    expect(tested.status).toBe(200);
    expect(await tested.json()).toEqual({ ok: true });

    const removed = await mockRequest('/connections/conn-openai', { method: 'DELETE' });
    expect(removed.status).toBe(204);
    expect(await listConnections()).toHaveLength(1);
  });

  it('answers 404 mock_not_implemented for anything else', async () => {
    const response = await mockRequest('/nope');
    expect(response.status).toBe(404);
    const body = z.object({ error: z.object({ code: z.string() }) }).parse(await response.json());
    expect(body.error.code).toBe('mock_not_implemented');
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

  it('wraps fetch only for /api URLs and passes the rest through', async () => {
    const realFetch = vi.fn(async () => jsonResponse(200, { ok: true }));
    const mockFetch = createMockFetch(realFetch as unknown as typeof globalThis.fetch);

    await mockFetch('/health');
    expect(realFetch).toHaveBeenCalledWith('/health', undefined);

    const response = await mockFetch('/api/me');
    expect(response.status).toBe(200);
    expect(realFetch).toHaveBeenCalledTimes(1);
  });
});
