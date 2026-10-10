import { describe, expect, it, vi } from 'vitest';

import {
  buildVisibilityBody,
  createDirectoryApi,
  DirectoryApiError,
  type DirectoryEntry,
} from './directory-api';

const ENTRY: DirectoryEntry = {
  id: 'group-hiking',
  kind: 'group',
  title: 'Hiking club',
  handle: 'hiking_club',
  description: 'Weekend trails.',
  memberCount: 42,
  joined: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function apiFor(body: unknown, status = 200, seen?: { url?: string; init?: RequestInit }) {
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (seen !== undefined) {
      seen.url = url;
      seen.init = init;
    }
    return jsonResponse(status, body);
  });
  const api = createDirectoryApi(
    async () => 'token',
    fetchImpl as unknown as typeof fetch,
    'https://srv.test',
  );
  return { api, fetchImpl };
}

describe('directory-api', () => {
  it('searches the directory and pages by cursor', async () => {
    const seen: { url?: string } = {};
    const { api } = apiFor({ entries: [ENTRY], next: 'cursor-1' }, 200, seen);
    const page = await api.searchDirectory({ q: 'hiking', kind: 'group' });
    expect(page.entries).toHaveLength(1);
    expect(page.next).toBe('cursor-1');
    expect(seen.url).toContain('/api/directory?');
    expect(seen.url).toContain('q=hiking');
    expect(seen.url).toContain('kind=group');

    const { api: nextApi } = apiFor({ entries: [], next: null });
    const second = await nextApi.searchDirectory({ cursor: 'cursor-1' });
    expect(second.entries).toEqual([]);
    expect(second.next).toBeNull();
  });

  it('looks up a group by handle', async () => {
    const seen: { url?: string } = {};
    const { api } = apiFor(ENTRY, 200, seen);
    const entry = await api.lookupGroupByHandle('Hiking_Club');
    expect(entry.handle).toBe('hiking_club');
    expect(seen.url).toContain('/api/groups/by-handle/Hiking_Club');
  });

  it('joins a public group', async () => {
    const { api } = apiFor({ groupId: 'group-hiking', alreadyMember: false });
    const result = await api.joinPublicGroup('group-hiking');
    expect(result).toEqual({ groupId: 'group-hiking', alreadyMember: false });
  });

  it('reads visibility truth and treats older servers as private', async () => {
    const { api } = apiFor({ visibility: 'public', handle: 'hiking_club' });
    await expect(api.getGroupVisibility('g1')).resolves.toEqual({
      visibility: 'public',
      handle: 'hiking_club',
    });
    const { api: legacy } = apiFor({ id: 'g1', title: 'G' });
    await expect(legacy.getGroupVisibility('g1')).resolves.toEqual({
      visibility: 'private',
      handle: null,
    });
  });

  it('sends the exact visibility body', () => {
    expect(buildVisibilityBody({ visibility: 'private' })).toEqual({ visibility: 'private' });
    expect(buildVisibilityBody({ visibility: 'public', handle: 'hiking_club' })).toEqual({
      visibility: 'public',
      handle: 'hiking_club',
    });
  });

  it('checks a handle', async () => {
    const seen: { url?: string } = {};
    const { api } = apiFor({ available: false, reason: 'taken' }, 200, seen);
    await expect(api.checkGroupHandle('hiking_club')).resolves.toEqual({
      available: false,
      reason: 'taken',
    });
    expect(seen.url).toContain('/api/handles/check?');
    expect(seen.url).toContain('kind=group');
  });

  it('keeps status and code on errors, and rejects malformed payloads', async () => {
    const { api } = apiFor({ error: { code: 'rate_limited', message: 'Slow down' } }, 429);
    const failure = await api.searchDirectory().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DirectoryApiError);
    expect(failure).toMatchObject({ status: 429, code: 'rate_limited' });

    const { api: broken } = apiFor({ entries: [{ id: 1 }] });
    await expect(broken.searchDirectory()).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('throws unauthorized without a session and network_error offline', async () => {
    const offline = createDirectoryApi(
      async () => 'token',
      (async () => {
        throw new TypeError('down');
      }) as unknown as typeof fetch,
      'https://srv.test',
    );
    await expect(offline.searchDirectory()).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
    const guest = createDirectoryApi(async () => undefined);
    await expect(guest.searchDirectory()).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
  });
});
