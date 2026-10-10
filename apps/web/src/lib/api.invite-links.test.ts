import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Schema } from 'effect';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import { InviteLink as groupInviteLinkSchema } from '@zilar/api-contract';
import {
  createGroupInviteLink,
  joinByLink,
  listGroupInviteLinks,
  previewJoinLink,
  revokeGroupInviteLink,
} from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';
import { jsonResponseAt as jsonResponse } from '@/test/wait';

const mockEnabled = vi.mocked(isMockApiEnabled);

beforeEach(() => {
  mockEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function linkFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'link-1',
    label: 'Friends',
    tokenHint: 'ab12',
    uses: 2,
    maxUses: 10,
    expiresAt: null,
    revoked: false,
    createdAt: '2026-09-30T10:00:00.000Z',
    ...overrides,
  };
}

describe('group invite links API (T-0115)', () => {
  it('groupInviteLinkSchema parses a server-shaped link without a token', () => {
    const parsed = Schema.decodeUnknownSync(groupInviteLinkSchema)(linkFixture());
    expect(parsed.tokenHint).toBe('ab12');
    expect('token' in parsed).toBe(false);
  });

  it('createGroupInviteLink POSTs the options and returns id, token and url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        id: 'link-1',
        token: 'a'.repeat(64),
        url: `http://localhost:5173/j/${'a'.repeat(64)}`,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const created = await createGroupInviteLink('g-1', {
      label: 'Friends',
      expiresInHours: 48,
      maxUses: 10,
    });
    expect(created.token).toBe('a'.repeat(64));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/groups/g-1/invite-links');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      label: 'Friends',
      expiresInHours: 48,
      maxUses: 10,
    });
  });

  it('createGroupInviteLink sends an empty object when no options are given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        id: 'link-1',
        token: 'a'.repeat(64),
        url: `http://localhost:5173/j/${'a'.repeat(64)}`,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createGroupInviteLink('g-1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('listGroupInviteLinks unwraps the links list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { links: [linkFixture()] }));
    vi.stubGlobal('fetch', fetchMock);

    const links = await listGroupInviteLinks('g-1');
    expect(links).toHaveLength(1);
    expect(links[0]?.tokenHint).toBe('ab12');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/groups/g-1/invite-links');
  });

  it('revokeGroupInviteLink DELETEs the link URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await revokeGroupInviteLink('g-1', 'link-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/groups/g-1/invite-links/link-1');
    expect(init.method).toBe('DELETE');
  });

  it('previewJoinLink returns the group title and member count', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { groupTitle: 'Hiking club', memberCount: 4, alreadyMember: false }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const preview = await previewJoinLink('a'.repeat(64));
    expect(preview).toEqual({ groupTitle: 'Hiking club', memberCount: 4, alreadyMember: false });
    expect(preview.groupId).toBeUndefined();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`/api/join/${'a'.repeat(64)}`);
  });

  it('previewJoinLink parses the member-only groupId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        groupTitle: 'Hiking club',
        memberCount: 4,
        alreadyMember: true,
        groupId: 'g-1',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const preview = await previewJoinLink('a'.repeat(64));
    expect(preview.groupId).toBe('g-1');
  });

  it('joinByLink POSTs and returns the group id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { groupId: 'g-1', alreadyMember: false }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await joinByLink('a'.repeat(64));
    expect(result).toEqual({ groupId: 'g-1', alreadyMember: false });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/join/${'a'.repeat(64)}`);
    expect(init.method).toBe('POST');
  });
});
