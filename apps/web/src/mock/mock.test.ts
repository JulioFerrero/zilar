import { describe, expect, it } from 'vitest';
import type { UiMessage } from '@zilar/chat-core';
import { ApprovalRequestSchema, PayloadSchema, StickerSchema } from '@zilar/protocol';
import { mockChats, mockMessages } from '@/mock';
import { mockDemoStickerPacks } from './helpers';
import { mockRequest, resetMockApi, setMockDelay } from './api';

const allMessages: UiMessage[] = Object.values(mockMessages).flat();

describe('mock data', () => {
  it('has at least ten chats', () => {
    expect(mockChats.length).toBeGreaterThanOrEqual(10);
  });

  it('covers the required chat cases', () => {
    expect(mockChats.some((chat) => chat.id === 'c-ana' && chat.unread === 2 && chat.online)).toBe(
      true,
    );
    expect(mockChats.some((chat) => chat.title === 'Viernes 🍻' && chat.memberCount === 5)).toBe(
      true,
    );
    expect(mockChats.some((chat) => chat.muted && chat.unread > 0)).toBe(true);
    expect(mockChats.some((chat) => chat.title === 'Dev team')).toBe(true);
    expect(mockChats.some((chat) => chat.isAI && chat.aiStatus === 'working')).toBe(true);
    expect(mockChats.some((chat) => chat.isAI && chat.aiStatus === 'idle')).toBe(true);
  });

  it('has at least three threads with twenty or more messages', () => {
    expect(Object.values(mockMessages).filter((list) => list.length >= 20).length).toBe(3);
  });

  it('includes replies, voice, image, progress and approval messages', () => {
    expect(allMessages.some((message) => message.voice?.transcript !== undefined)).toBe(true);
    expect(allMessages.some((message) => message.image !== undefined)).toBe(true);
    expect(allMessages.some((message) => message.card?.type === 'progress')).toBe(true);
    expect(allMessages.some((message) => message.card?.type === 'approval.request')).toBe(true);
    expect(allMessages.some((message) => message.replyTo !== undefined)).toBe(true);
  });

  it('uses only inline data URIs for images', () => {
    const urls = allMessages.flatMap((message) =>
      message.image === undefined ? [] : [message.image.url],
    );
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith('data:image/svg+xml'))).toBe(true);
  });

  it('has only valid card payloads and a valid approval request', () => {
    for (const message of allMessages) {
      if (message.card !== undefined) {
        expect(PayloadSchema.safeParse(message.card).success).toBe(true);
      }
    }

    const approval = allMessages.find((message) => message.card?.type === 'approval.request');
    expect(approval).toBeDefined();
    if (approval?.card?.type === 'approval.request') {
      expect(ApprovalRequestSchema.safeParse(approval.card.data).success).toBe(true);
    }
  });
});

describe('mock sticker demo packs (T-0120)', () => {
  it('ships two packs of relative-URL stickers that pass StickerSchema', async () => {
    const { StickerSchema: Schema } = await import('@zilar/protocol');
    const packs = mockDemoStickerPacks();
    expect(packs).toHaveLength(2);
    for (const pack of packs) {
      expect(pack.title.length).toBeGreaterThan(0);
      expect(pack.stickers.length).toBeGreaterThan(0);
      for (const sticker of pack.stickers) {
        expect(sticker.url.startsWith('data:')).toBe(false);
        expect(sticker.emoji.length).toBeGreaterThan(0);
        // The exact shape a send builds: it must validate, or the panel
        // shows "That sticker could not be sent."
        expect(
          Schema.safeParse({
            pack_id: pack.id,
            sticker_id: sticker.id,
            url: sticker.url,
            emoji: sticker.emoji,
            width: 200,
            height: 200,
            mime: 'image/png',
          }).success,
        ).toBe(true);
      }
    }
  });

  it('serves the demo packs as the panel list and discover results', async () => {
    setMockDelay(0);
    resetMockApi();
    try {
      const panel = (await (await mockRequest('/sticker-packs')).json()) as {
        packs: Array<{ id: string; stickers: unknown[] }>;
      };
      expect(panel.packs).toHaveLength(2);
      expect(panel.packs.every((pack) => pack.stickers.length > 0)).toBe(true);

      const discover = (await (await mockRequest('/sticker-packs/discover')).json()) as {
        packs: Array<{ id: string }>;
        next: null;
      };
      expect(discover.packs).toHaveLength(2);
      expect(discover.next).toBeNull();
    } finally {
      resetMockApi();
    }
  });

  it('serves the demo sticker bytes from the file route (unknown ids 404)', async () => {
    setMockDelay(0);
    resetMockApi();
    try {
      const packs = mockDemoStickerPacks();
      const first = packs[0]!.stickers[0]!;
      const file = await mockRequest(`/stickers/${first.id}/file`);
      expect(file.status).toBe(200);
      const body = await file.text();
      expect(body).toContain('<svg');
      const missing = await mockRequest('/stickers/00000000-0000-4000-8000-000000000000/file');
      expect(missing.status).toBe(404);
    } finally {
      resetMockApi();
    }
  });

  it('keeps demo sticker payloads valid against the protocol schema', () => {
    // The actual demo packs (not hand-built ids): their file URLs are
    // relative `/api/stickers/` paths, so they parse as sent.
    const packs = mockDemoStickerPacks();
    const first = packs[0]!.stickers[0]!;
    const url = first.url;
    expect(
      StickerSchema.safeParse({
        pack_id: packs[0]!.id,
        sticker_id: first.id,
        url,
        emoji: first.emoji,
        width: 200,
        height: 200,
        mime: 'image/png',
      }).success,
    ).toBe(true);
  });

  it('creates packs, uploads stickers and stars favorites in memory', async () => {
    setMockDelay(0);
    resetMockApi();
    try {
      const created = await mockRequest('/sticker-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Mine', visibility: 'server' }),
      });
      expect(created.status).toBe(201);
      const pack = (await created.json()) as { id: string; title: string };
      expect(pack.title).toBe('Mine');

      const uploaded = await mockRequest(`/sticker-packs/${pack.id}/stickers`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/webp', 'x-emoji': '🐱' },
        body: 'bytes' as unknown as string,
      });
      expect(uploaded.status).toBe(201);
      const sticker = (await uploaded.json()) as {
        id: string;
        packId: string;
        url: string;
        emoji: string | null;
        width: number;
        height: number;
        mime: 'image/webp' | 'image/png';
      };
      expect(sticker.emoji).toBe('🐱');
      expect(sticker.url).toBe(`/api/stickers/${sticker.id}/file`);

      // The uploaded sticker sends through the real protocol schema: mock
      // packs/stickers mint UUIDs, so a user-created mock sticker validates
      // exactly like a server one (the mock send swaps nothing here).
      expect(
        StickerSchema.safeParse({
          pack_id: pack.id,
          sticker_id: sticker.id,
          url: sticker.url,
          emoji: sticker.emoji ?? undefined,
          width: sticker.width,
          height: sticker.height,
          mime: sticker.mime,
        }).success,
      ).toBe(true);

      const starred = await mockRequest('/sticker-favorites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sticker_id: sticker.id }),
      });
      expect(starred.status).toBe(200);
      const listed = (await (await mockRequest('/sticker-favorites')).json()) as {
        favorites: Array<{ id: string }>;
      };
      expect(listed.favorites.map((row) => row.id)).toContain(sticker.id);

      const unstarred = await mockRequest(`/sticker-favorites?sticker_id=${sticker.id}`, {
        method: 'DELETE',
      });
      expect(unstarred.status).toBe(200);
      const empty = (await (await mockRequest('/sticker-favorites')).json()) as {
        favorites: unknown[];
      };
      expect(empty.favorites).toEqual([]);

      const deleted = await mockRequest(`/sticker-packs/${pack.id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(200);
      const warning = (await deleted.json()) as { warning: string };
      expect(warning.warning).toContain('no longer loads');
    } finally {
      resetMockApi();
    }
  });

  it('searches discover and adds/removes panel packs', async () => {
    setMockDelay(0);
    resetMockApi();
    try {
      const found = (await (await mockRequest('/sticker-packs/discover?q=cats')).json()) as {
        packs: Array<{ title: string }>;
      };
      expect(found.packs.map((pack) => pack.title)).toEqual(['Cats']);

      const missing = (await (
        await mockRequest('/sticker-packs/discover?q=zzz-no-such-pack')
      ).json()) as { packs: unknown[] };
      expect(missing.packs).toEqual([]);

      const panel = (await (await mockRequest('/sticker-packs')).json()) as {
        packs: Array<{ id: string }>;
      };
      const firstId = panel.packs[0]!.id;
      await mockRequest(`/sticker-panel/${firstId}`, { method: 'DELETE' });
      const removed = (await (await mockRequest('/sticker-packs')).json()) as {
        packs: Array<{ id: string }>;
      };
      expect(removed.packs.map((pack) => pack.id)).not.toContain(firstId);
      await mockRequest(`/sticker-panel/${firstId}`, { method: 'PUT' });
      const added = (await (await mockRequest('/sticker-packs')).json()) as {
        packs: Array<{ id: string }>;
      };
      expect(added.packs.map((pack) => pack.id)).toContain(firstId);
    } finally {
      resetMockApi();
    }
  });

  it('reorders the mock panel atomically and rejects a bad order', async () => {
    setMockDelay(0);
    resetMockApi();
    try {
      const panel = (await (await mockRequest('/sticker-packs')).json()) as {
        packs: Array<{ id: string }>;
      };
      const reversed = panel.packs.map((pack) => pack.id).reverse();
      const reordered = await mockRequest('/sticker-panel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: reversed }),
      });
      expect(reordered.status).toBe(200);
      const listed = (await (await mockRequest('/sticker-packs')).json()) as {
        packs: Array<{ id: string }>;
      };
      expect(listed.packs.map((pack) => pack.id)).toEqual(reversed);

      const bad = await mockRequest('/sticker-panel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [reversed[0]] }),
      });
      expect(bad.status).toBe(400);

      // A trailing slash is no route (404 like the server), never a
      // silent `{ ok: true }`.
      const slashed = await mockRequest('/sticker-panel/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(slashed.status).toBe(404);
    } finally {
      resetMockApi();
    }
  });

  it('imports a fake Telegram pack of generated stickers (re-runs add nothing)', async () => {
    setMockDelay(0);
    resetMockApi();
    try {
      const first = await mockRequest('/sticker-packs/import/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'https://t.me/addstickers/FunCats' }),
      });
      expect(first.status).toBe(200);
      const created = (await first.json()) as {
        pack: { id: string; title: string; visibility: string; importedFrom: string };
        imported: number;
        skippedAnimated: number;
        partial?: boolean;
      };
      expect(created.imported).toBeGreaterThan(0);
      expect(created.pack.visibility).toBe('private');
      expect(created.pack.importedFrom).toBe('telegram:FunCats');
      expect(created.skippedAnimated).toBe(1);
      expect(created.partial).toBeUndefined();

      const second = await mockRequest('/sticker-packs/import/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'FunCats' }),
      });
      const rerun = (await second.json()) as { pack: { id: string }; imported: number };
      expect(rerun.pack.id).toBe(created.pack.id);
      expect(rerun.imported).toBe(0);

      const partial = await mockRequest('/sticker-packs/import/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: '__mock_partial' }),
      });
      expect(((await partial.json()) as { partial?: boolean }).partial).toBe(true);

      const off = await mockRequest('/sticker-packs/import/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: '__mock_unavailable' }),
      });
      expect(off.status).toBe(501);
    } finally {
      resetMockApi();
    }
  });
});

describe('mock directory (T-0164)', () => {
  interface DirectoryPage {
    entries: Array<{ id: string; handle: string }>;
    next: string | null;
  }

  async function makePublic(title: string, handle: string): Promise<string> {
    const created = await mockRequest('/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, memberIds: [] }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const patched = await mockRequest(`/groups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: 'public', handle }),
    });
    expect(patched.status).toBe(200);
    return id;
  }

  it('pages with a real cursor the mock parses back', async () => {
    setMockDelay(0);
    resetMockApi();
    try {
      // 21 public groups (20 created + the seeded `@acme` channel): the
      // first page carries 20 rows and a cursor, the second the last row.
      for (let index = 0; index < 20; index += 1) {
        await makePublic(`Club ${index}`, `club_${index}_pub`);
      }
      const first = (await (await mockRequest('/directory')).json()) as DirectoryPage;
      expect(first.entries).toHaveLength(20);
      expect(first.next).not.toBeNull();

      const second = (await (
        await mockRequest(`/directory?cursor=${encodeURIComponent(first.next ?? '')}`)
      ).json()) as DirectoryPage;
      expect(second.entries).toHaveLength(1);
      expect(second.next).toBeNull();
      // No row repeats across the two pages.
      const seen = new Set([...first.entries, ...second.entries].map((entry) => entry.id));
      expect(seen.size).toBe(21);

      // A cursor that is not ours is a 400, like the server.
      const bad = await mockRequest('/directory?cursor=bogus');
      expect(bad.status).toBe(400);
    } finally {
      resetMockApi();
    }
  });

  it('serves the seeded public channel by exact handle', async () => {
    setMockDelay(0);
    resetMockApi();
    try {
      const found = await mockRequest('/groups/by-handle/acme');
      expect(found.status).toBe(200);
      expect(((await found.json()) as { handle: string }).handle).toBe('acme');
      expect((await mockRequest('/groups/by-handle/nope')).status).toBe(404);
    } finally {
      resetMockApi();
    }
  });
});
