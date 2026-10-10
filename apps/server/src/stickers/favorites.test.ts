import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testSql,
  TEST_BASE_URL,
  type SignedInUser,
  type TestContext,
} from '../test-support';
import { STICKER_FAVORITES_MAX, STICKERS_MAX_PER_PACK } from './service';

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  user: SignedInUser,
  body?: unknown,
): Promise<Response> {
  return app.request(`${TEST_BASE_URL}${path}`, {
    method,
    headers: { cookie: user.cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function uploadBytes(
  app: ReturnType<typeof createApp>,
  packId: string,
  user: SignedInUser,
  bytes: Uint8Array,
): Promise<Response> {
  const headers: Record<string, string> = {
    cookie: user.cookie,
    'content-type': 'application/octet-stream',
  };
  return app.request(`${TEST_BASE_URL}/api/sticker-packs/${packId}/stickers`, {
    method: 'POST',
    headers,
    body: bytes as unknown as string,
  });
}

describe('sticker favorites', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;
  let storageDir: string;
  let owner: SignedInUser;
  let stranger: SignedInUser;

  beforeEach(async () => {
    context = await createTestContext();
    storageDir = await mkdtemp(join(tmpdir(), 'zilar-favorites-'));
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      stickerStorageDir: storageDir,
    });
    owner = await bootstrapUser(context, app, 'owner@example.com');
    stranger = await contactOf(context, app, owner.id, 'stranger@example.com');
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true }).catch(() => {});
    await context.close();
  });

  async function packWithSticker(
    user: SignedInUser,
    title = 'Cats',
  ): Promise<{ packId: string; stickerId: string }> {
    const created = await jsonRequest(app, 'POST', '/api/sticker-packs', user, { title });
    expect(created.status).toBe(201);
    const pack = (await created.json()) as { id: string };
    const uploaded = await uploadBytes(app, pack.id, user, pngBytes(64, 64));
    expect(uploaded.status).toBe(201);
    const sticker = (await uploaded.json()) as { id: string };
    return { packId: pack.id, stickerId: sticker.id };
  }

  // Writes `count` stickers for `userId` straight into the tables the upload
  // route writes (pack, owner link, sticker rows), in packs of 120. Only the
  // cap tests use it: 200 HTTP uploads cost seconds per test.
  async function seedStickers(userId: string, count: number): Promise<string[]> {
    const ids: string[] = [];
    const now = new Date().toISOString();
    for (let start = 0; start < count; start += STICKERS_MAX_PER_PACK) {
      const packId = randomUUID();
      const packIndex = start / STICKERS_MAX_PER_PACK;
      const stickers = Array.from(
        { length: Math.min(STICKERS_MAX_PER_PACK, count - start) },
        (_, position) => ({ id: randomUUID(), position }),
      );
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO sticker_packs (id, owner_id, title, visibility, created_at, updated_at)
            VALUES (${packId}, ${userId}, ${`Seeded ${packIndex}`}, 'private', ${now}, ${now})`;
          yield* sql`INSERT INTO user_sticker_packs (user_id, pack_id, position, added_at)
            VALUES (${userId}, ${packId}, ${packIndex}, ${now})`;
          for (const sticker of stickers) {
            yield* sql`INSERT INTO stickers
                (id, pack_id, position, emoji, mime, width, height, bytes, storage_key)
              VALUES (${sticker.id}, ${packId}, ${sticker.position}, NULL, 'image/png', 8, 8, 33,
                ${`${sticker.id}.png`})`;
          }
        }),
      );
      ids.push(...stickers.map((sticker) => sticker.id));
    }
    return ids;
  }

  it('stars, lists and unstars a sticker', async () => {
    const { stickerId } = await packWithSticker(owner);

    const put = await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, {
      sticker_id: stickerId,
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { id: string }).id).toBe(stickerId);

    const listed = await jsonRequest(app, 'GET', '/api/sticker-favorites', owner);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { favorites: Array<{ id: string }> };
    expect(body.favorites.map((favorite) => favorite.id)).toEqual([stickerId]);

    const removed = await jsonRequest(
      app,
      'DELETE',
      `/api/sticker-favorites?sticker_id=${stickerId}`,
      owner,
    );
    expect(removed.status).toBe(200);
    const empty = (await (
      await jsonRequest(app, 'GET', '/api/sticker-favorites', owner)
    ).json()) as { favorites: unknown[] };
    expect(empty.favorites).toEqual([]);
  });

  it('stars idempotently and unstars idempotently', async () => {
    const { stickerId } = await packWithSticker(owner);

    expect(
      (await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, { sticker_id: stickerId }))
        .status,
    ).toBe(200);
    expect(
      (await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, { sticker_id: stickerId }))
        .status,
    ).toBe(200);
    const body = (await (
      await jsonRequest(app, 'GET', '/api/sticker-favorites', owner)
    ).json()) as { favorites: unknown[] };
    expect(body.favorites).toHaveLength(1);

    const missing = '00000000-0000-4000-8000-000000000000';
    expect(
      (await jsonRequest(app, 'DELETE', `/api/sticker-favorites?sticker_id=${missing}`, owner))
        .status,
    ).toBe(200);
  });

  it('404s an unknown sticker id like a missing one', async () => {
    const response = await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, {
      sticker_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('400s a malformed body and query', async () => {
    const badPut = await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, {
      sticker_id: 'not-a-uuid',
    });
    expect(badPut.status).toBe(400);
    const badDelete = await jsonRequest(
      app,
      'DELETE',
      '/api/sticker-favorites?sticker_id=nope',
      owner,
    );
    expect(badDelete.status).toBe(400);
  });

  it('keeps favorites per user', async () => {
    const { stickerId } = await packWithSticker(owner);
    await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, { sticker_id: stickerId });

    const strangerList = (await (
      await jsonRequest(app, 'GET', '/api/sticker-favorites', stranger)
    ).json()) as { favorites: unknown[] };
    expect(strangerList.favorites).toEqual([]);
  });

  it('lets a stranger star a sticker from a shared message (no visibility oracle)', async () => {
    const { stickerId } = await packWithSticker(owner);
    const put = await jsonRequest(app, 'PUT', '/api/sticker-favorites', stranger, {
      sticker_id: stickerId,
    });
    expect(put.status).toBe(200);
  });

  it('drops the favorite when the sticker is deleted', async () => {
    const { packId, stickerId } = await packWithSticker(owner);
    await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, { sticker_id: stickerId });
    const removed = await jsonRequest(
      app,
      'DELETE',
      `/api/sticker-packs/${packId}/stickers/${stickerId}`,
      owner,
    );
    expect(removed.status).toBe(200);
    const body = (await (
      await jsonRequest(app, 'GET', '/api/sticker-favorites', owner)
    ).json()) as { favorites: unknown[] };
    expect(body.favorites).toEqual([]);
  });

  it('enforces the 200-favorites cap', async () => {
    // 200 favorites span two packs (120 + 80); one more sticker is the 201st.
    const ids = await seedStickers(owner.id, STICKER_FAVORITES_MAX + 1);
    for (const stickerId of ids.slice(0, STICKER_FAVORITES_MAX)) {
      const put = await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, {
        sticker_id: stickerId,
      });
      expect(put.status).toBe(200);
    }
    const over = await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, {
      sticker_id: ids[STICKER_FAVORITES_MAX],
    });
    expect(over.status).toBe(400);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe('favorites_full');
  });

  it('re-stars an existing favorite at the cap with 200, not favorites_full', async () => {
    // Fill to the cap with seeded stickers, then star through the route.
    const ids = await seedStickers(owner.id, STICKER_FAVORITES_MAX);
    for (const stickerId of ids) {
      expect(
        (await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, { sticker_id: stickerId }))
          .status,
      ).toBe(200);
    }
    // Re-starring the first one at the cap stays idempotent 200.
    const retry = await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, {
      sticker_id: ids[0],
    });
    expect(retry.status).toBe(200);
  });

  it('reorders the panel atomically and rejects a non-permutation', async () => {
    const first = await jsonRequest(app, 'POST', '/api/sticker-packs', owner, { title: 'One' });
    const second = await jsonRequest(app, 'POST', '/api/sticker-packs', owner, { title: 'Two' });
    const firstId = ((await first.json()) as { id: string }).id;
    const secondId = ((await second.json()) as { id: string }).id;

    const swapped = await jsonRequest(app, 'PUT', '/api/sticker-panel', owner, {
      order: [secondId, firstId],
    });
    expect(swapped.status).toBe(200);
    const panel = (await (await jsonRequest(app, 'GET', '/api/sticker-packs', owner)).json()) as {
      packs: Array<{ id: string }>;
    };
    expect(panel.packs.map((pack) => pack.id)).toEqual([secondId, firstId]);

    // A stranger's panel is untouched, and a bogus order 400s with the
    // server order intact.
    const partial = await jsonRequest(app, 'PUT', '/api/sticker-panel', owner, {
      order: [firstId],
    });
    expect(partial.status).toBe(400);
    const kept = (await (await jsonRequest(app, 'GET', '/api/sticker-packs', owner)).json()) as {
      packs: Array<{ id: string }>;
    };
    expect(kept.packs.map((pack) => pack.id)).toEqual([secondId, firstId]);

    const strangerPanel = (await (
      await jsonRequest(app, 'GET', '/api/sticker-packs', stranger)
    ).json()) as { packs: unknown[] };
    expect(strangerPanel.packs).toEqual([]);

    // Unknown ids and duplicates are rejected too.
    const unknown = await jsonRequest(app, 'PUT', '/api/sticker-panel', owner, {
      order: [secondId, '00000000-0000-4000-8000-000000000000'],
    });
    expect(unknown.status).toBe(400);
    const dupes = await jsonRequest(app, 'PUT', '/api/sticker-panel', owner, {
      order: [secondId, secondId],
    });
    expect(dupes.status).toBe(400);
  });

  it('lists 200 favorites in star order with a bounded number of queries', async () => {
    // Star the full cap in a known order (two packs: 120 + 80).
    const ids = await seedStickers(owner.id, STICKER_FAVORITES_MAX);
    for (const stickerId of ids) {
      expect(
        (await jsonRequest(app, 'PUT', '/api/sticker-favorites', owner, { sticker_id: stickerId }))
          .status,
      ).toBe(200);
    }

    // One list call must not scale with the favorite count: the old
    // per-favorite SELECT needed 200+ round trips for this list.
    const querySpy = vi.spyOn(context.client, 'query');
    querySpy.mockClear();
    const listed = await jsonRequest(app, 'GET', '/api/sticker-favorites', owner);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { favorites: Array<{ id: string }> };
    expect(body.favorites.map((favorite) => favorite.id)).toEqual(ids);
    expect(querySpy.mock.calls.length).toBeLessThanOrEqual(10);
    querySpy.mockRestore();
  });

  it('answers 401 without a session on the favorites and reorder routes', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const get = await app.request(`${TEST_BASE_URL}/api/sticker-favorites`);
    expect(get.status).toBe(401);
    const put = await app.request(`${TEST_BASE_URL}/api/sticker-favorites`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sticker_id: id }),
    });
    expect(put.status).toBe(401);
    const remove = await app.request(`${TEST_BASE_URL}/api/sticker-favorites?sticker_id=${id}`, {
      method: 'DELETE',
    });
    expect(remove.status).toBe(401);
    const reorder = await app.request(`${TEST_BASE_URL}/api/sticker-panel`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: [] }),
    });
    expect(reorder.status).toBe(401);
  });
});
