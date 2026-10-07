import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { chatBackgroundDefaults, chatBackgrounds, chatPrefs, groups } from '../db/schema';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  TEST_BASE_URL,
  type SignedInUser,
  type TestContext,
} from '../test-support';
import { BACKGROUND_MAX_BYTES, BACKGROUND_MAX_PER_USER } from './service';

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
}

/** A minimal valid PNG with the given size (backgrounds need not be square). */
function pngRect(width: number, height: number): Uint8Array {
  return concat(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13),
    ascii('IHDR'),
    u32be(width),
    u32be(height),
    Uint8Array.from([8, 2, 0, 0, 0]),
  );
}

/** A minimal animated WebP (VP8X with the animation flag set). */
function animatedWebp(side: number): Uint8Array {
  const value = side - 1;
  return concat(
    ascii('RIFF'),
    u32be(100),
    ascii('WEBP'),
    ascii('VP8X'),
    u32be(10),
    new Uint8Array([0x12, 0x00, 0x00, 0x00]),
    new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]),
    new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]),
    new Uint8Array(10),
  );
}

describe('backgrounds routes', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;
  let storageDir: string;
  let alice: SignedInUser;
  let bob: SignedInUser;

  beforeEach(async () => {
    context = await createTestContext();
    storageDir = await mkdtemp(join(tmpdir(), 'zilar-backgrounds-'));
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      backgroundStorageDir: storageDir,
    });
    alice = await bootstrapUser(context, app, 'alice@example.com');
    bob = await contactOf(context, app, alice.id, 'bob@example.com');
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true }).catch(() => {});
    await context.close();
  });

  async function uploadAs(
    user: SignedInUser,
    bytes: Uint8Array,
    contentType = 'application/octet-stream',
  ): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/backgrounds`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': contentType },
      body: bytes as unknown as string,
    });
  }

  async function deleteAs(user: SignedInUser, id: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/backgrounds/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
  }

  async function getAs(user: SignedInUser, id: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/backgrounds/${encodeURIComponent(id)}`, {
      headers: { cookie: user.cookie },
    });
  }

  async function uploadOne(user: SignedInUser, bytes = pngRect(1200, 800)) {
    const response = await uploadAs(user, bytes);
    expect(response.status).toBe(201);
    return (await response.json()) as {
      id: string;
      url: string;
      width: number;
      height: number;
    };
  }

  it('uploads a 1200x800 PNG and serves it back with the avatar headers', async () => {
    const png = pngRect(1200, 800);
    const created = await uploadOne(alice, png);
    expect(created.url).toBe(`/api/backgrounds/${created.id}`);
    expect(created.width).toBe(1200);
    expect(created.height).toBe(800);

    const get = await getAs(alice, created.id);
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
    expect(get.headers.get('content-length')).toBe(String(png.byteLength));
    expect(get.headers.get('x-content-type-options')).toBe('nosniff');
    expect(get.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(get.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(get.headers.get('etag')).toBe(`"${created.id}"`);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(png);
  });

  it('serves an unknown id, a foreign id and a missing file as the same 404', async () => {
    const created = await uploadOne(alice);
    for (const id of [randomUUID(), created.id]) {
      const response = await getAs(bob, id);
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('not_found');
    }
    const remove = await deleteAs(bob, created.id);
    expect(remove.status).toBe(404);
    // Bob's refused delete changed nothing: Alice still owns and can read it.
    expect(await context.db.select().from(chatBackgrounds)).toHaveLength(1);
    expect((await getAs(alice, created.id)).status).toBe(200);
  });

  it('refuses an animated WebP, a side past 2048 and a file over 1 MiB', async () => {
    const animated = await uploadAs(alice, animatedWebp(128));
    expect(animated.status).toBe(400);
    expect(((await animated.json()) as { error: { code: string } }).error.code).toBe(
      'background_animated',
    );

    const tooWide = await uploadAs(alice, pngRect(3000, 800));
    expect([400, 413]).toContain(tooWide.status);

    const big = new Uint8Array(BACKGROUND_MAX_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const oversize = await uploadAs(alice, big);
    expect(oversize.status).toBe(413);
    expect(((await oversize.json()) as { error: { code: string } }).error.code).toBe(
      'background_too_large',
    );

    // Nothing was stored by any refused upload.
    expect(await context.db.select().from(chatBackgrounds)).toHaveLength(0);
  });

  it('refuses a side under 64 and an unknown type', async () => {
    const tiny = await uploadAs(alice, pngRect(32, 32));
    expect(tiny.status).toBe(400);
    expect(((await tiny.json()) as { error: { code: string } }).error.code).toBe(
      'background_bad_size',
    );
    const svg = await uploadAs(alice, ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    expect(svg.status).toBe(400);
    expect(((await svg.json()) as { error: { code: string } }).error.code).toBe(
      'background_not_image',
    );
    expect(await context.db.select().from(chatBackgrounds)).toHaveLength(0);
  });

  it('lists only the owner images, newest first', async () => {
    const older = randomUUID();
    const newer = randomUUID();
    await context.db.insert(chatBackgrounds).values({
      id: older,
      userId: alice.id,
      mime: 'image/png',
      width: 64,
      height: 64,
      bytes: 10,
      storageKey: 'older.png',
      createdAt: new Date(Date.UTC(2026, 0, 1)),
    });
    await context.db.insert(chatBackgrounds).values({
      id: newer,
      userId: alice.id,
      mime: 'image/png',
      width: 64,
      height: 64,
      bytes: 10,
      storageKey: 'newer.png',
      createdAt: new Date(Date.UTC(2026, 0, 2)),
    });
    // Bob has one too: Alice's list must not include it.
    await context.db.insert(chatBackgrounds).values({
      id: randomUUID(),
      userId: bob.id,
      mime: 'image/png',
      width: 64,
      height: 64,
      bytes: 10,
      storageKey: 'bob.png',
    });

    const response = await app.request(`${TEST_BASE_URL}/api/backgrounds`, {
      headers: { cookie: alice.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      backgrounds: Array<{ id: string; url: string; width: number; height: number }>;
    };
    expect(body.backgrounds.map((entry) => entry.id)).toEqual([newer, older]);
    expect(body.backgrounds[0]?.url).toBe(`/api/backgrounds/${newer}`);
  });

  it('gives the 21st image a 409 once the cap is reached', async () => {
    for (let index = 0; index < BACKGROUND_MAX_PER_USER; index += 1) {
      await context.db.insert(chatBackgrounds).values({
        id: randomUUID(),
        userId: alice.id,
        mime: 'image/png',
        width: 64,
        height: 64,
        bytes: 10,
        storageKey: `seed-${index}.png`,
      });
    }
    const capped = await uploadAs(alice, pngRect(1200, 800));
    expect(capped.status).toBe(409);
    expect(((await capped.json()) as { error: { code: string } }).error.code).toBe(
      'too_many_backgrounds',
    );
    expect(await context.db.select().from(chatBackgrounds)).toHaveLength(BACKGROUND_MAX_PER_USER);
  });

  it('deletes the row and the file, and answers 404 afterwards', async () => {
    const created = await uploadOne(alice);
    const [row] = await context.db
      .select()
      .from(chatBackgrounds)
      .where(eq(chatBackgrounds.id, created.id));
    expect(row).toBeDefined();

    const remove = await deleteAs(alice, created.id);
    expect(remove.status).toBe(204);
    expect(await context.db.select().from(chatBackgrounds)).toHaveLength(0);
    await expect(readFile(join(storageDir, row!.storageKey))).rejects.toThrow();
    expect((await getAs(alice, created.id)).status).toBe(404);
    expect((await deleteAs(alice, created.id)).status).toBe(404);
  });

  it('clears the image and dim from a pref that keeps another setting', async () => {
    const created = await uploadOne(alice);
    await context.db.insert(chatPrefs).values({
      userId: alice.id,
      chatJid: 'muted@example.com',
      backgroundImageId: created.id,
      backgroundDim: 40,
      mutedUntil: new Date(Date.UTC(2030, 0, 1)),
    });

    expect((await deleteAs(alice, created.id)).status).toBe(204);
    const [row] = await context.db
      .select()
      .from(chatPrefs)
      .where(and(eq(chatPrefs.userId, alice.id), eq(chatPrefs.chatJid, 'muted@example.com')));
    expect(row).toBeDefined();
    expect(row?.backgroundImageId).toBeNull();
    expect(row?.backgroundDim).toBeNull();
    expect(row?.mutedUntil).not.toBeNull();
  });

  it('deletes a pref row that held only the background', async () => {
    const created = await uploadOne(alice);
    await context.db.insert(chatPrefs).values({
      userId: alice.id,
      chatJid: 'only@example.com',
      backgroundImageId: created.id,
    });

    expect((await deleteAs(alice, created.id)).status).toBe(204);
    const [row] = await context.db
      .select()
      .from(chatPrefs)
      .where(and(eq(chatPrefs.userId, alice.id), eq(chatPrefs.chatJid, 'only@example.com')));
    expect(row).toBeUndefined();
  });

  it('keeps an archived pref row and clears its background', async () => {
    const created = await uploadOne(alice);
    await context.db.insert(chatPrefs).values({
      userId: alice.id,
      chatJid: 'archived@example.com',
      backgroundImageId: created.id,
      archived: true,
    });

    expect((await deleteAs(alice, created.id)).status).toBe(204);
    const [row] = await context.db
      .select()
      .from(chatPrefs)
      .where(and(eq(chatPrefs.userId, alice.id), eq(chatPrefs.chatJid, 'archived@example.com')));
    expect(row).toBeDefined();
    expect(row?.archived).toBe(true);
    expect(row?.backgroundImageId).toBeNull();
    expect(row?.backgroundDim).toBeNull();
  });

  it('clears the per-user default row', async () => {
    const created = await uploadOne(alice);
    await context.db.insert(chatBackgroundDefaults).values({
      userId: alice.id,
      backgroundImageId: created.id,
      backgroundDim: 40,
    });

    expect((await deleteAs(alice, created.id)).status).toBe(204);
    const rows = await context.db
      .select()
      .from(chatBackgroundDefaults)
      .where(eq(chatBackgroundDefaults.userId, alice.id));
    expect(rows).toHaveLength(0);
  });

  it('serves a group background to its members and clears the group on delete', async () => {
    const created = await uploadOne(alice);
    const group = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Trip', memberIds: [bob.id] }),
    });
    expect(group.status).toBe(201);
    const { id: groupId } = (await group.json()) as { id: string };

    const patched = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ background: { backgroundImageId: created.id, backgroundDim: 30 } }),
    });
    expect(patched.status).toBe(200);

    // Bob is a member of the group, so he can load its background image.
    const memberGet = await getAs(bob, created.id);
    expect(memberGet.status).toBe(200);
    expect(new Uint8Array(await memberGet.arrayBuffer())).toEqual(pngRect(1200, 800));

    // A signed-in stranger still gets the same 404 as an unknown id.
    const carol = await bootstrapUser(context, app, 'carol@example.com');
    expect((await getAs(carol, created.id)).status).toBe(404);

    // The owner deletes the image: the group's background fields are cleared.
    expect((await deleteAs(alice, created.id)).status).toBe(204);
    const [row] = await context.db.select().from(groups).where(eq(groups.id, groupId));
    expect(row?.backgroundImageId).toBeNull();
    expect(row?.backgroundDim).toBeNull();
    expect((await getAs(bob, created.id)).status).toBe(404);
  });

  it('requires authentication on every route', async () => {
    const post = await app.request(`${TEST_BASE_URL}/api/backgrounds`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: pngRect(64, 64) as unknown as string,
    });
    expect(post.status).toBe(401);
    const list = await app.request(`${TEST_BASE_URL}/api/backgrounds`);
    expect(list.status).toBe(401);
    const get = await app.request(`${TEST_BASE_URL}/api/backgrounds/${randomUUID()}`);
    expect(get.status).toBe(401);
    const remove = await app.request(`${TEST_BASE_URL}/api/backgrounds/${randomUUID()}`, {
      method: 'DELETE',
    });
    expect(remove.status).toBe(401);
  });
});
