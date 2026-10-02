import { describe, expect, it, vi } from 'vitest';

import type { ChatEntry } from '../lib/chat-api';
import type { InviteLinksApi } from '../lib/invite-links-api';
import { resolveGroupChat } from '../lib/invite-links-api';
import { createRealChatStore, type RealStoreDeps } from './real-store';
import type { AppStateLike } from './real-store';

function fakeAppState(): AppStateLike {
  return { current: () => 'active', subscribe: () => () => {} };
}

function fakeApi() {
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@zilar.test',
      name: 'Me',
      jid: 'me@zilar.test',
    })),
    getChats: vi.fn(async (): Promise<ChatEntry[]> => []),
    getContacts: vi.fn(async () => []),
    getGroup: vi.fn(async () => ({
      id: 'g1',
      title: 'Dev team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    getXmppToken: vi.fn(async () => ({
      jid: 'me@zilar.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://x',
      domain: 'zilar.test',
      mucDomain: 'rooms.zilar.test',
    })),
  };
}

function fakeCore(): unknown {
  return {
    status: () => 'online',
    connect: async () => {},
    disconnect: async () => {},
    joinRoom: async () => {},
    occupants: () => [],
    sendMessage: async () => ({ id: 'srv-1' }),
    sendReactions: async () => {},
    sendCorrection: async () => ({ id: 'srv-c' }),
    sendRetraction: async () => {},
    loadHistory: async () => ({ messages: [], complete: true, first: undefined }),
    sendTyping: () => {},
    markDisplayed: () => {},
    on: () => () => {},
  };
}

function fakeInviteLinks(): InviteLinksApi {
  return {
    createGroupInviteLink: vi.fn(async () => ({
      id: 'link-1',
      token: 'a'.repeat(64),
      url: `http://web.test/j/${'a'.repeat(64)}`,
    })),
    listGroupInviteLinks: vi.fn(async () => [
      {
        id: 'link-1',
        label: 'Friends',
        tokenHint: 'aaaa',
        uses: 0,
        maxUses: null,
        expiresAt: null,
        revoked: false,
        createdAt: '2026-09-30T10:00:00.000Z',
      },
    ]),
    revokeGroupInviteLink: vi.fn(async () => {}),
    previewJoinLink: vi.fn(async () => ({
      groupTitle: 'Dev team',
      memberCount: 6,
      alreadyMember: false,
    })),
    joinByLink: vi.fn(async () => ({ groupId: 'g1', alreadyMember: false })),
  };
}

describe('real store invite links (T-0136)', () => {
  function setup(deps: Partial<RealStoreDeps> = {}) {
    const api = fakeApi();
    const inviteLinksApi = fakeInviteLinks();
    const store = createRealChatStore({
      api: api as never,
      appState: fakeAppState(),
      openDrafts: () => () => {},
      createXmpp: () => fakeCore() as never,
      inviteLinksApi,
      ...deps,
    });
    return { store, api, inviteLinksApi };
  }

  it('creates, lists, revokes, previews and joins through the API layer', async () => {
    const { store, api, inviteLinksApi } = setup();

    await expect(store.getState().listInviteLinks('g1')).resolves.toHaveLength(1);
    expect(inviteLinksApi.listGroupInviteLinks).toHaveBeenCalledWith('g1');

    const created = await store.getState().createInviteLink('g1', { label: 'Friends' });
    expect(created.id).toBe('link-1');
    expect(inviteLinksApi.createGroupInviteLink).toHaveBeenCalledWith('g1', { label: 'Friends' });

    await store.getState().revokeInviteLink('g1', 'link-1');
    expect(inviteLinksApi.revokeGroupInviteLink).toHaveBeenCalledWith('g1', 'link-1');

    await expect(store.getState().previewJoinLink('a'.repeat(64))).resolves.toMatchObject({
      groupTitle: 'Dev team',
    });
    // Join refreshes the chat list, so the new membership appears.
    const chatsBefore = vi.mocked(api.getChats).mock.calls.length;
    await expect(store.getState().joinByLink('a'.repeat(64))).resolves.toMatchObject({
      groupId: 'g1',
    });
    expect(inviteLinksApi.joinByLink).toHaveBeenCalledWith('a'.repeat(64));
    expect(vi.mocked(api.getChats).mock.calls.length).toBeGreaterThan(chatsBefore);
  });

  it('joining then opens the group: the refresh lands before resolve', async () => {
    // The round-2 bug: the route resolved against its render-time chats, so
    // the just-joined group was never found and every success fell through
    // to `/`. The route now reads the store fresh at call time; this proves
    // the store's chats contain the group right after the join resolves.
    const { store, api } = setup();
    const groupRow: ChatEntry = {
      kind: 'group',
      chatJid: 'general@rooms.zilar.test',
      title: 'Dev team',
      groupId: 'g1',
      memberCount: 7,
      role: 'member',
      topics: [
        {
          id: 't-g',
          groupId: 'g1',
          name: 'General',
          glyph: 'G',
          chatJid: 'general@rooms.zilar.test',
          visibility: 'public',
          kind: 'chat',
          status: 'open',
          owner: null,
          linkUrl: null,
          linkLabel: null,
          isGeneral: true,
          archived: false,
          memberCount: 7,
          ais: [],
          roles: [],
          approverRole: null,
        },
      ],
    };
    vi.mocked(api.getChats).mockResolvedValue([groupRow]);
    const result = await store.getState().joinByLink('a'.repeat(64));
    expect(result.groupId).toBe('g1');
    const target = resolveGroupChat(store.getState().chats, result.groupId);
    expect(target).toEqual({ kind: 'chat', chatId: 'general@rooms.zilar.test' });
  });

  it('propagates API failures without adding the token', async () => {
    const { store, inviteLinksApi } = setup();
    const token = 'b'.repeat(64);
    vi.mocked(inviteLinksApi.previewJoinLink).mockRejectedValueOnce(
      Object.assign(new Error('request failed'), { status: 404, code: 'invalid_link' }),
    );
    const failure = await store
      .getState()
      .previewJoinLink(token)
      .then(
        () => 'resolved',
        (error: Error) => error,
      );
    expect(failure).not.toBe('resolved');
    expect(String(failure)).not.toContain(token);
  });
});
