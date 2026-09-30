import { describe, expect, it, vi } from 'vitest';

import { extractJoinToken } from '../lib/invite-links-api';
import { MOCK_JOIN_TOKEN } from '../mock/invite-links';
import { createChatStore } from './chat-store';

describe('mock invite links flow (T-0136)', () => {
  it('lists the seeded Dev team links with hints, never tokens', () => {
    const store = createChatStore();
    return store
      .getState()
      .listInviteLinks('g-devteam')
      .then((links) => {
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
          expect(link.id).toBeDefined();
          expect(link.tokenHint).toHaveLength(4);
          expect(link).not.toHaveProperty('token');
          expect(JSON.stringify(link)).not.toContain(MOCK_JOIN_TOKEN);
        }
      });
  });

  it('creates a link shown once, then lists it without the token', async () => {
    const store = createChatStore();
    const created = await store
      .getState()
      .createInviteLink('g-devteam', { label: 'Party', maxUses: 5 });
    expect(created.token).toHaveLength(64);
    expect(created.url).toContain(created.token);
    const links = await store.getState().listInviteLinks('g-devteam');
    expect(links.some((link) => link.id === created.id)).toBe(true);
    expect(JSON.stringify(links)).not.toContain(created.token);
  });

  it('revokes a link and previews Joins against the store', async () => {
    const store = createChatStore();
    const created = await store.getState().createInviteLink('g-devteam', {});
    await store.getState().revokeInviteLink('g-devteam', created.id);
    const links = await store.getState().listInviteLinks('g-devteam');
    expect(links.find((link) => link.id === created.id)?.revoked).toBe(true);
    await expect(store.getState().previewJoinLink(created.token)).rejects.toMatchObject({
      code: 'invalid_link',
    });
  });

  it('keys links per group: two groups see only their own', async () => {
    const store = createChatStore();
    const devteam = await store.getState().createInviteLink('g-devteam', { label: 'Devs' });
    const neighbors = await store.getState().createInviteLink('g-neighbors', { label: 'Hood' });
    const devLinks = await store.getState().listInviteLinks('g-devteam');
    const neighborLinks = await store.getState().listInviteLinks('g-neighbors');
    expect(devLinks.some((link) => link.id === devteam.id)).toBe(true);
    expect(devLinks.some((link) => link.id === neighbors.id)).toBe(false);
    expect(neighborLinks.some((link) => link.id === neighbors.id)).toBe(true);
    expect(neighborLinks.some((link) => link.id === devteam.id)).toBe(false);
    // A revoke in one group leaves the other group's links alone.
    await store.getState().revokeInviteLink('g-neighbors', neighbors.id);
    expect(
      (await store.getState().listInviteLinks('g-neighbors')).find(
        (link) => link.id === neighbors.id,
      )?.revoked,
    ).toBe(true);
    expect(
      (await store.getState().listInviteLinks('g-devteam')).find((link) => link.id === devteam.id)
        ?.revoked,
    ).toBe(false);
    // Joining resolves the link's own group.
    await expect(store.getState().joinByLink(neighbors.token)).rejects.toMatchObject({
      code: 'invalid_link',
    });
    await expect(store.getState().previewJoinLink(devteam.token)).resolves.toMatchObject({
      groupTitle: 'Dev team',
      groupId: 'g-devteam',
    });
  });

  it('fails used-up and expired links with the same neutral error', async () => {
    // The viewer is a Dev team member, so a Dev team join consumes no use
    // (server fast path): exhaustion needs a group the viewer is not in.
    const store = createChatStore();
    const oneUse = await store.getState().createInviteLink('g-neighbors', { maxUses: 1 });
    await expect(store.getState().previewJoinLink(oneUse.token)).resolves.toMatchObject({
      alreadyMember: false,
    });
    await store.getState().joinByLink(oneUse.token);
    await expect(store.getState().previewJoinLink(oneUse.token)).rejects.toMatchObject({
      code: 'invalid_link',
      status: 404,
    });
    await expect(store.getState().joinByLink(oneUse.token)).rejects.toMatchObject({
      code: 'invalid_link',
      status: 404,
    });
  });

  it('fails an expired link with the same neutral error', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));
      const store = createChatStore();
      const link = await store.getState().createInviteLink('g-devteam', { expiresInHours: 1 });
      await expect(store.getState().previewJoinLink(link.token)).resolves.toMatchObject({
        groupTitle: 'Dev team',
      });
      vi.setSystemTime(new Date('2026-09-30T14:00:00.000Z'));
      await expect(store.getState().previewJoinLink(link.token)).rejects.toMatchObject({
        code: 'invalid_link',
        status: 404,
      });
      await expect(store.getState().joinByLink(link.token)).rejects.toMatchObject({
        code: 'invalid_link',
        status: 404,
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it('previews and joins by a pasted link', async () => {
    const store = createChatStore();
    const token = extractJoinToken(`galena://join/${MOCK_JOIN_TOKEN}`);
    expect(token).toBe(MOCK_JOIN_TOKEN);
    await expect(store.getState().previewJoinLink(token as string)).resolves.toMatchObject({
      groupTitle: 'Dev team',
    });
    await expect(store.getState().joinByLink(token as string)).resolves.toMatchObject({
      groupId: 'g-devteam',
    });
  });

  it('derives alreadyMember from the store: a member opens, a stranger joins', async () => {
    const store = createChatStore();
    // The mock viewer owns the Dev team group, so its links preview as a
    // member (the real Join POST path stays untouched for them).
    await expect(store.getState().previewJoinLink(MOCK_JOIN_TOKEN)).resolves.toMatchObject({
      groupTitle: 'Dev team',
      alreadyMember: true,
      groupId: 'g-devteam',
    });
    // The viewer is not in Neighbors: the preview names no group id (like
    // the server) and the join consumes a use and reports the real path.
    const created = await store.getState().createInviteLink('g-neighbors', { maxUses: 10 });
    await expect(store.getState().previewJoinLink(created.token)).resolves.toEqual({
      groupTitle: 'Neighbors',
      memberCount: 8,
      alreadyMember: false,
    });
    await expect(store.getState().joinByLink(created.token)).resolves.toEqual({
      groupId: 'g-neighbors',
      alreadyMember: false,
    });
    const after = await store.getState().listInviteLinks('g-neighbors');
    expect(after.find((link) => link.id === created.id)?.uses).toBe(1);
    // Joined now: the next preview reads as a member, and a second join
    // consumes no use (like the server's already-a-member fast path).
    await expect(store.getState().previewJoinLink(created.token)).resolves.toMatchObject({
      alreadyMember: true,
      groupId: 'g-neighbors',
    });
    await expect(store.getState().joinByLink(created.token)).resolves.toEqual({
      groupId: 'g-neighbors',
      alreadyMember: true,
    });
    const again = await store.getState().listInviteLinks('g-neighbors');
    expect(again.find((link) => link.id === created.id)?.uses).toBe(1);
  });

  it('rejects an unknown token with the neutral error, never the token', async () => {
    const store = createChatStore();
    const token = 'c'.repeat(64);
    const failure = await store
      .getState()
      .previewJoinLink(token)
      .then(
        () => 'resolved',
        (error: { message?: string }) => error.message ?? 'no message',
      );
    expect(failure).toBe('This link does not work');
    expect(failure).not.toContain(token);
  });
});
