import { describe, expect, it, vi } from 'vitest';

import {
  createInviteLinksApi,
  extractJoinToken,
  InviteLinksApiError,
  joinFailureMessage,
  resolveGroupChat,
} from './invite-links-api';
import { jsonResponse } from '@/test/wait';

function apiFor(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return createInviteLinksApi(
    async () => 'session-token',
    fetchImpl as unknown as typeof fetch,
    'http://127.0.0.1:3188',
  );
}

const LINK = {
  id: 'link-1',
  label: 'Friends',
  tokenHint: 'abcd',
  uses: 2,
  maxUses: 10,
  expiresAt: null,
  revoked: false,
  createdAt: '2026-09-30T10:00:00.000Z',
};

describe('createInviteLinksApi', () => {
  it('creates, lists and revokes invite links', async () => {
    const calls: string[] = [];
    const api = apiFor(async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/invite-links')) {
        return jsonResponse(
          {
            id: 'link-1',
            token: 'a'.repeat(64),
            url: `http://web.test/j/${'a'.repeat(64)}`,
          },
          201,
        );
      }
      if (method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ links: [LINK] });
    });

    const created = await api.createGroupInviteLink('g1', { label: 'Friends', maxUses: 10 });
    expect(created).toMatchObject({ id: 'link-1', token: 'a'.repeat(64) });
    await expect(api.listGroupInviteLinks('g1')).resolves.toEqual([LINK]);
    await expect(api.revokeGroupInviteLink('g1', 'link-1')).resolves.toBeUndefined();

    expect(calls).toContain('POST http://127.0.0.1:3188/api/groups/g1/invite-links');
    expect(calls).toContain('GET http://127.0.0.1:3188/api/groups/g1/invite-links');
    expect(calls).toContain('DELETE http://127.0.0.1:3188/api/groups/g1/invite-links/link-1');
  });

  it('sends the create input as JSON', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ id: 'link-1', token: 't', url: 'http://web.test/j/t' }, 201),
    ) as unknown as typeof fetch;
    const api = createInviteLinksApi(async () => 'session-token', fetchImpl, 'http://x.test');
    await api.createGroupInviteLink('g1', { label: 'Friends', expiresInHours: 48, maxUses: 10 });
    const [, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ label: 'Friends', expiresInHours: 48, maxUses: 10 }));
  });

  it('previews and joins by link', async () => {
    const api = apiFor(async (url, init) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return jsonResponse({ groupId: 'g1', alreadyMember: false });
      }
      return jsonResponse({ groupTitle: 'Dev team', memberCount: 6, alreadyMember: false });
    });

    await expect(api.previewJoinLink('a'.repeat(64))).resolves.toMatchObject({
      groupTitle: 'Dev team',
      memberCount: 6,
    });
    await expect(api.joinByLink('a'.repeat(64))).resolves.toEqual({
      groupId: 'g1',
      alreadyMember: false,
    });
  });

  it('parses the preview kind for channels', async () => {
    const api = apiFor(async () =>
      jsonResponse({
        groupTitle: 'Acme Announcements',
        memberCount: 4,
        alreadyMember: false,
        kind: 'channel',
      }),
    );

    await expect(api.previewJoinLink('a'.repeat(64))).resolves.toEqual({
      groupTitle: 'Acme Announcements',
      memberCount: 4,
      alreadyMember: false,
      kind: 'channel',
    });
  });

  it('throws a typed error on a failed request', async () => {
    const api = apiFor(async () =>
      jsonResponse(
        { error: { code: 'invalid_link', message: 'This invite link is invalid' } },
        404,
      ),
    );
    await expect(api.previewJoinLink('a'.repeat(64))).rejects.toBeInstanceOf(InviteLinksApiError);
    await expect(api.previewJoinLink('a'.repeat(64))).rejects.toMatchObject({
      status: 404,
      code: 'invalid_link',
    });
  });

  it('rejects an unexpected response shape', async () => {
    const api = apiFor(async () => jsonResponse({ nope: true }));
    await expect(api.listGroupInviteLinks('g1')).rejects.toMatchObject({
      code: 'invalid_response',
    });
    await expect(api.previewJoinLink('a'.repeat(64))).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('fails before the network when there is no session', async () => {
    const fetchImpl = vi.fn();
    const api = createInviteLinksApi(
      async () => undefined,
      fetchImpl as unknown as typeof fetch,
      'http://127.0.0.1:3188',
    );
    await expect(api.listGroupInviteLinks('g1')).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('extractJoinToken', () => {
  const token = 'a'.repeat(64);

  it('accepts the custom scheme, the web URL shape and a bare token', () => {
    expect(extractJoinToken(`zilar://join/${token}`)).toBe(token);
    expect(extractJoinToken(`https://zilar.example/j/${token}`)).toBe(token);
    expect(extractJoinToken(`https://zilar.example/join/${token}`)).toBe(token);
    expect(extractJoinToken(`  ${token}  `)).toBe(token);
  });

  it('rejects anything else, so junk never reaches the server', () => {
    expect(extractJoinToken('')).toBeUndefined();
    expect(extractJoinToken('hello friends')).toBeUndefined();
    expect(extractJoinToken('zilar://invite/abc')).toBeUndefined();
    expect(extractJoinToken('zilar://join/short')).toBeUndefined();
    expect(extractJoinToken('https://zilar.example/j/short')).toBeUndefined();
    expect(extractJoinToken('https://zilar.example/groups/g1')).toBeUndefined();
    expect(extractJoinToken('javascript:alert(1)')).toBeUndefined();
    expect(extractJoinToken(token.slice(0, 32))).toBeUndefined();
  });

  it('lowercases an uppercase token', () => {
    expect(extractJoinToken('A'.repeat(64))).toBe(token);
  });
});

describe('joinFailureMessage', () => {
  it('shows one neutral message for every failure kind', () => {
    for (const code of ['invalid_link', 'group_full', 'not_found', 'forbidden', 'request_failed']) {
      expect(joinFailureMessage({ status: 404, code })).toBe('This link does not work');
    }
    expect(joinFailureMessage({ status: 409, code: 'group_full' })).toBe('This link does not work');
  });

  it('shows a retry text for rate limits', () => {
    expect(joinFailureMessage({ status: 429, code: 'rate_limited' })).toBe(
      'Too many attempts. Try again later.',
    );
  });

  it('never echoes the token', () => {
    const token = 'a'.repeat(64);
    for (const code of ['invalid_link', 'group_full', 'rate_limited']) {
      expect(joinFailureMessage({ status: 404, code })).not.toContain(token);
    }
  });
});

describe('resolveGroupChat', () => {
  const general = { id: 'general@rooms.test', groupId: 'g1', topic: { isGeneral: true } };
  const other = { id: 't-1@rooms.test', groupId: 'g1', topic: { isGeneral: false } };

  it('opens the General topic chat when present', () => {
    expect(resolveGroupChat([other, general], 'g1')).toEqual({
      kind: 'chat',
      chatId: 'general@rooms.test',
    });
  });

  it('falls back to the group screen and then the chats list', () => {
    expect(resolveGroupChat([other], 'g1')).toEqual({ kind: 'group', groupId: 'g1' });
    expect(resolveGroupChat([], 'g1')).toEqual({ kind: 'list' });
    expect(resolveGroupChat([general], 'g2')).toEqual({ kind: 'list' });
  });
});
