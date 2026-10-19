// The pack link (T-1495): any signed-in user may read a pack by its id, private
// or shared, and add it to their panel; only the owner may edit or delete it.
// An imported pack stays personal to its importer, so anyone else gets the same
// 404 as an unknown id. Permissions are crucial code, so they are tested here.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { StickerPackDetail } from '@zilar/api-contract';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  testSql,
  TEST_BASE_URL,
  type SignedInUser,
  type TestApp,
  type TestContext,
} from '../test-support';

const IMPORTED_ID = '33333333-3333-4333-8333-333333333333';
const STICKER_ID = '22222222-2222-4222-8222-222222222222';

describe('sticker pack links', () => {
  let context: TestContext;
  let app: TestApp;
  let owner: SignedInUser;
  let other: SignedInUser;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
    owner = await bootstrapUser(context, app, 'owner-link@example.com');
    other = await bootstrapUser(context, app, 'other-link@example.com');
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO handles (handle_lower, handle, user_id)
          VALUES (${'alice'}, ${'alice'}, ${owner.id})`;
      }),
    );
  });

  afterEach(async () => {
    await context.close();
  });

  async function createPack(visibility: 'private' | 'server'): Promise<string> {
    const response = await app.request(`${TEST_BASE_URL}/api/sticker-packs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ title: visibility === 'private' ? 'Private' : 'Shared', visibility }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  async function getPack(cookie: string, packId: string): Promise<StickerPackDetail> {
    const response = await app.request(`${TEST_BASE_URL}/api/sticker-packs/${packId}`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    return (await response.json()) as StickerPackDetail;
  }

  async function insertImportedPack(): Promise<void> {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO sticker_packs (id, owner_id, title, visibility, imported_from)
          VALUES (${IMPORTED_ID}, ${owner.id}, ${'Telegram Cats'}, ${'private'}, ${'telegram:cats'})`;
      }),
    );
  }

  it('lets a non-owner open a private pack by id', async () => {
    const packId = await createPack('private');
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO stickers
            (id, pack_id, position, emoji, mime, width, height, bytes, storage_key)
          VALUES (${STICKER_ID}, ${packId}, 0, ${'🐱'}, ${'image/png'}, 200, 200, 1024,
            ${`${STICKER_ID}.png`})`;
      }),
    );

    const detail = await getPack(other.cookie, packId);

    expect(detail).toMatchObject({
      id: packId,
      ownerId: owner.id,
      title: 'Private',
      visibility: 'private',
      ownerHandle: 'alice',
      inPanel: false,
    });
    expect(detail.stickers).toHaveLength(1);
    expect(detail.stickers[0]).toMatchObject({ id: STICKER_ID, emoji: '🐱' });
  });

  it('keeps editing and deleting owner-only', async () => {
    const packId = await createPack('private');

    const patched = await app.request(`${TEST_BASE_URL}/api/sticker-packs/${packId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: other.cookie },
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    expect(patched.status).toBe(404);

    const deleted = await app.request(`${TEST_BASE_URL}/api/sticker-packs/${packId}`, {
      method: 'DELETE',
      headers: { cookie: other.cookie },
    });
    expect(deleted.status).toBe(404);
  });

  it('hides an imported pack from everyone but its importer', async () => {
    await insertImportedPack();

    expect((await getPack(owner.cookie, IMPORTED_ID)).importedFrom).toBe('telegram:cats');

    const hiddenRead = await app.request(`${TEST_BASE_URL}/api/sticker-packs/${IMPORTED_ID}`, {
      headers: { cookie: other.cookie },
    });
    expect(hiddenRead.status).toBe(404);

    const hiddenAdd = await app.request(`${TEST_BASE_URL}/api/sticker-panel/${IMPORTED_ID}`, {
      method: 'PUT',
      headers: { cookie: other.cookie },
    });
    expect(hiddenAdd.status).toBe(404);
  });
});
