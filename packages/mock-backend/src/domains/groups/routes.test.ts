import type { ChatEntry, GroupChatEntry } from '@zilar/api-contract';
import { describe, expect, it } from 'vitest';
import { createMockBackend } from '../../index';

function groupEntries(entries: readonly ChatEntry[]): GroupChatEntry[] {
  return entries.filter((entry): entry is GroupChatEntry => entry.kind === 'group');
}

/**
 * T-1314: `POST /groups` must leave the created group on `/chats` with its
 * General topic, like the real server in the create transaction
 * (`apps/server/src/groups/service.ts:157-171`). Without the chat row the group
 * screen opened after Create found no topic rows and bounced to the chat list.
 */
describe('group create route', () => {
  it('lists the created group and its General topic on /chats', async () => {
    const backend = createMockBackend({ delayMs: 0 });

    const created = await backend.http('/groups', {
      method: 'POST',
      body: JSON.stringify({ title: 'Night QA', memberIds: ['u-ana', 'u-marta'] }),
    });
    expect(created?.status).toBe(201);
    const detail = (await created?.json()) as { id: string };
    expect(detail.id).toBe('g-mock-1');

    const chats = (await (await backend.http('/chats'))?.json()) as { chats: ChatEntry[] };
    const group = groupEntries(chats.chats).find((entry) => entry.groupId === detail.id);
    expect(group?.title).toBe('Night QA');
    expect(group?.role).toBe('owner');
    expect(group?.topics).toHaveLength(1);
    const general = group?.topics?.[0] as { isGeneral?: boolean; name?: string } | undefined;
    expect(general?.isGeneral).toBe(true);
    expect(general?.name).toBe('General');
  });

  it('keeps the channel fields on the created channel row', async () => {
    const backend = createMockBackend({ delayMs: 0 });

    const created = await backend.http('/groups', {
      method: 'POST',
      body: JSON.stringify({ title: 'Night news', kind: 'channel', memberIds: [] }),
    });
    const detail = (await created?.json()) as { id: string };

    const chats = (await (await backend.http('/chats'))?.json()) as { chats: ChatEntry[] };
    const group = groupEntries(chats.chats).find((entry) => entry.groupId === detail.id);
    expect(group?.chatKind).toBe('channel');
    expect(group?.subscriberCount).toBe(1);
    expect(group?.topics).toHaveLength(1);
  });

  /**
   * T-1314 fix 1: the step-2 screen sends `visibility: 'public'` + `handle`,
   * and the server stores the claim in the create transaction
   * (`apps/server/src/groups/service.ts:173-199`). The mock stored every group
   * private, so the public group the user made did not exist.
   */
  it('stores a public group with its handle and lists it on /chats', async () => {
    const backend = createMockBackend({ delayMs: 0 });

    const created = await backend.http('/groups', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Nightclub',
        memberIds: [],
        visibility: 'public',
        handle: 'nightclub',
      }),
    });
    expect(created?.status).toBe(201);
    const detail = (await created?.json()) as {
      id: string;
      visibility?: string;
      handle?: string | null;
    };
    expect(detail.visibility).toBe('public');
    expect(detail.handle).toBe('nightclub');

    const chats = (await (await backend.http('/chats'))?.json()) as { chats: ChatEntry[] };
    const group = groupEntries(chats.chats).find((entry) => entry.groupId === detail.id);
    expect(group?.visibility).toBe('public');
    expect(group?.handle).toBe('nightclub');
  });

  it('rejects a public group with a taken handle and creates nothing', async () => {
    const backend = createMockBackend({ delayMs: 0 });

    const created = await backend.http('/groups', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Copycat',
        memberIds: [],
        visibility: 'public',
        handle: 'acme',
      }),
    });
    expect(created?.status).toBe(409);

    const chats = (await (await backend.http('/chats'))?.json()) as { chats: ChatEntry[] };
    expect(groupEntries(chats.chats).some((entry) => entry.title === 'Copycat')).toBe(false);
  });
});
