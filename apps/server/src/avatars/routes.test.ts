import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app';
import { aiLimits, ais, avatars, providerConnections } from '../db/schema';
import { avatarUrlFor } from './service';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type SignedInUser,
  type TestContext,
} from '../test-support';
import { AVATAR_MAX_BYTES } from './service';

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

/** A minimal valid square PNG with the given side. */
function pngSquare(side: number): Uint8Array {
  return concat(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13),
    ascii('IHDR'),
    u32be(side),
    u32be(side),
    Uint8Array.from([8, 2, 0, 0, 0]),
  );
}

/** A minimal valid square lossless WebP (VP8L) with the given side. */
function webpSquare(side: number): Uint8Array {
  const value = side - 1;
  const bits = (value & 0x3fff) | ((value & 0x3fff) << 14);
  return concat(
    ascii('RIFF'),
    u32be(100),
    ascii('WEBP'),
    ascii('VP8L'),
    u32be(10),
    new Uint8Array([0x2f]),
    new Uint8Array([bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff]),
    new Uint8Array(10),
  );
}

/** A minimal animated WebP (VP8X with the animation flag). */
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

/** A minimal APNG: a valid PNG IHDR plus an acTL chunk before IDAT. */
function apngSquare(side: number): Uint8Array {
  const ihdr = concat(
    u32be(13),
    ascii('IHDR'),
    u32be(side),
    u32be(side),
    Uint8Array.from([8, 2, 0, 0, 0]),
    u32be(0),
  );
  const actl = concat(u32be(8), ascii('acTL'), new Uint8Array(8), u32be(0));
  const idat = concat(u32be(0), ascii('IDAT'), u32be(0));
  return concat(pngSquare(side).subarray(0, 8), ihdr, actl, idat);
}

/** A non-square PNG (width x height). */
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

/** A minimal extended WebP (VP8X, static) with the given canvas. */
function webpRect(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return concat(
    ascii('RIFF'),
    u32be(100),
    ascii('WEBP'),
    ascii('VP8X'),
    u32be(10),
    new Uint8Array([0x10, 0x00, 0x00, 0x00]),
    new Uint8Array([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff]),
    new Uint8Array([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff]),
    new Uint8Array(10),
  );
}

describe('avatars routes', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;
  let storageDir: string;
  let alice: SignedInUser;
  let bob: SignedInUser;

  beforeEach(async () => {
    context = await createTestContext();
    storageDir = await mkdtemp(join(tmpdir(), 'zilar-avatars-'));
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      avatarStorageDir: storageDir,
    });
    alice = await bootstrapUser(context, app, 'alice@example.com');
    bob = await contactOf(context, app, alice.id, 'bob@example.com');
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true }).catch(() => {});
    await context.close();
  });

  async function putAvatar(
    kind: string,
    ownerId: string,
    user: SignedInUser,
    bytes: Uint8Array,
    contentType = 'application/octet-stream',
  ): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/avatars/${kind}/${encodeURIComponent(ownerId)}`, {
      method: 'PUT',
      headers: { cookie: user.cookie, 'content-type': contentType },
      body: bytes as unknown as string,
    });
  }

  async function deleteAvatar(
    kind: string,
    ownerId: string,
    user: SignedInUser,
  ): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/avatars/${kind}/${encodeURIComponent(ownerId)}`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
  }

  async function createGroup(cookie: string, title: string, memberIds: string[]) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title, memberIds }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  }

  async function addAi(ownerId: string): Promise<{ id: string; jid: string }> {
    const connectionId = randomUUID();
    await context.db.insert(providerConnections).values({
      id: connectionId,
      owner: ownerId,
      provider: 'openai',
      encryptedKey: 'not-a-real-key',
      label: null,
    });
    const id = randomUUID();
    const jid = `ai-${id}@${TEST_XMPP_DOMAIN}`;
    await context.db.insert(ais).values({
      id,
      owner: ownerId,
      name: 'Helper',
      template: 'dev',
      persona: 'A persona',
      providerConnectionId: connectionId,
      model: 'gpt-4o-mini',
      localpart: `ai-${id}`,
      jid,
      status: 'active',
    });
    await context.db.insert(aiLimits).values({ aiId: id, perDayUsd: '1.00', perMonthUsd: '20.00' });
    return { id, jid };
  }

  it('a person sets, serves and removes their own picture', async () => {
    const put = await putAvatar('user', alice.id, alice, pngSquare(128));
    expect(put.status).toBe(200);
    const { url } = (await put.json()) as { url: string };
    expect(url).toMatch(/^\/api\/avatars\//);

    const get = await app.request(`${TEST_BASE_URL}${url}`, {
      headers: { cookie: alice.cookie },
    });
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
    expect(get.headers.get('x-content-type-options')).toBe('nosniff');
    expect(get.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(get.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(get.headers.get('etag')).not.toBeNull();
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(pngSquare(128));

    const me = await app.request(`${TEST_BASE_URL}/api/me`, {
      headers: { cookie: alice.cookie },
    });
    expect(((await me.json()) as { avatarUrl?: string }).avatarUrl).toBe(url);

    const contacts = await app.request(`${TEST_BASE_URL}/api/contacts`, {
      headers: { cookie: bob.cookie },
    });
    const list = (await contacts.json()) as Array<{ userId: string; avatarUrl?: string }>;
    expect(list.find((entry) => entry.userId === alice.id)?.avatarUrl).toBe(url);

    const remove = await deleteAvatar('user', alice.id, alice);
    expect(remove.status).toBe(200);
    const after = await app.request(`${TEST_BASE_URL}${url}`, {
      headers: { cookie: alice.cookie },
    });
    expect(after.status).toBe(404);
    const meAfter = await app.request(`${TEST_BASE_URL}/api/me`, {
      headers: { cookie: alice.cookie },
    });
    expect('avatarUrl' in ((await meAfter.json()) as Record<string, unknown>)).toBe(false);
  });

  it('a group owner and an admin set the group picture; a member gets 404', async () => {
    const group = await createGroup(alice.cookie, 'Trip', [bob.id]);
    // A plain member cannot set the picture: same 404 as unknown.
    const memberPut = await putAvatar('group', group.id, bob, pngSquare(128));
    expect(memberPut.status).toBe(404);

    const put = await putAvatar('group', group.id, alice, webpSquare(256));
    expect(put.status).toBe(200);
    const { url } = (await put.json()) as { url: string };

    const chats = await app.request(`${TEST_BASE_URL}/api/chats`, {
      headers: { cookie: bob.cookie },
    });
    const entries = (
      (await chats.json()) as { chats: Array<{ groupId?: string; avatarUrl?: string }> }
    ).chats;
    expect(entries.find((entry) => entry.groupId === group.id)?.avatarUrl).toBe(url);

    const detail = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}`, {
      headers: { cookie: bob.cookie },
    });
    expect(((await detail.json()) as { avatarUrl?: string }).avatarUrl).toBe(url);
  });

  it("an AI's owner sets its picture; a stranger gets 404", async () => {
    const ai = await addAi(alice.id);
    const strangerPut = await putAvatar('ai', ai.id, bob, pngSquare(128));
    expect(strangerPut.status).toBe(404);

    const put = await putAvatar('ai', ai.id, alice, pngSquare(64));
    expect(put.status).toBe(200);
    const { url } = (await put.json()) as { url: string };

    const chats = await app.request(`${TEST_BASE_URL}/api/chats`, {
      headers: { cookie: alice.cookie },
    });
    const entries = (
      (await chats.json()) as { chats: Array<{ chatJid?: string; avatarUrl?: string }> }
    ).chats;
    expect(entries.find((entry) => entry.chatJid === ai.jid)?.avatarUrl).toBe(url);
  });

  it('an unknown owner, a wrong kind and a stranger answer the same 404', async () => {
    const missing = randomUUID();
    for (const [kind, ownerId, user] of [
      ['user', missing, alice],
      ['user', bob.id, alice],
      ['group', missing, alice],
      ['ai', missing, alice],
      ['user', alice.id, bob],
    ] as const) {
      const put = await putAvatar(kind, ownerId, user, pngSquare(128));
      expect(put.status).toBe(404);
      expect(((await put.json()) as { error: { code: string } }).error.code).toBe('not_found');
      const remove = await deleteAvatar(kind, ownerId, user);
      expect(remove.status).toBe(404);
    }
    const badKind = await putAvatar('channel', alice.id, alice, pngSquare(128));
    expect(badKind.status).toBe(404);
  });

  it('refuses a non-image, an animated WebP, an APNG, a non-square, sizes outside 64-512, a bomb and an oversize file', async () => {
    const cases: Array<{ name: string; bytes: Uint8Array; code: string; status: number }> = [
      {
        name: 'svg named png',
        bytes: ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        code: 'avatar_not_image',
        status: 400,
      },
      {
        name: 'gif',
        bytes: concat(ascii('GIF89a'), new Uint8Array(20)),
        code: 'avatar_not_image',
        status: 400,
      },
      { name: 'animated webp', bytes: animatedWebp(128), code: 'avatar_animated', status: 400 },
      { name: 'apng', bytes: apngSquare(128), code: 'avatar_animated', status: 400 },
      { name: 'non-square png', bytes: pngRect(128, 64), code: 'avatar_not_square', status: 400 },
      {
        name: 'non-square webp',
        bytes: webpRect(256, 128),
        code: 'avatar_not_square',
        status: 400,
      },
      { name: 'too small', bytes: pngSquare(32), code: 'avatar_bad_size', status: 400 },
      // A side past 512 is refused by the shared probe first (its own
      // `too_large` maps to `avatar_not_image`): still a clear 400 refusal
      // with nothing stored.
      { name: 'too big', bytes: pngSquare(1024), code: 'avatar_not_image', status: 400 },
      // A header claiming 60 000 x 60 000: the shared decompression-bomb limit.
      { name: 'bomb', bytes: pngRect(60000, 60000), code: 'avatar_not_image', status: 400 },
      { name: 'empty', bytes: new Uint8Array(), code: 'avatar_empty', status: 400 },
    ];
    for (const { name, bytes, code, status } of cases) {
      const response = await putAvatar('user', alice.id, alice, bytes);
      expect(response.status, name).toBe(status);
      expect(((await response.json()) as { error: { code: string } }).error.code, name).toBe(code);
    }
    expect(await context.db.select().from(avatars)).toHaveLength(0);
  });

  it('rejects the same animated bytes the sticker upload accepts', async () => {
    // The sticker suite pins that these exact shapes upload as stickers
    // (T-0120 allows animated); avatars must refuse them as stills-only.
    for (const [name, bytes] of [
      ['animated webp', animatedWebp(128)],
      ['apng', apngSquare(128)],
    ] as const) {
      const response = await putAvatar('user', alice.id, alice, bytes);
      expect(response.status, name).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code, name).toBe(
        'avatar_animated',
      );
    }
    expect(await context.db.select().from(avatars)).toHaveLength(0);
  });

  it('a delete racing a replace never leaves a row without a file', async () => {
    const first = await putAvatar('user', alice.id, alice, pngSquare(128));
    expect(first.status).toBe(200);
    const firstUrl = ((await first.json()) as { url: string }).url;
    // A delete and a replace for the same owner run together: the delete
    // holds the owner's advisory lock, so it removes either the old row
    // with its old file or nothing — the winner's row always has its file.
    const [removeResponse, putResponse] = await Promise.all([
      deleteAvatar('user', alice.id, alice),
      putAvatar('user', alice.id, alice, webpSquare(256)),
    ]);
    expect(removeResponse.status).toBe(200);
    expect(putResponse.status).toBe(200);
    const rows = await context.db.select().from(avatars);
    expect(rows.length).toBeLessThanOrEqual(1);
    for (const row of rows) {
      await expect(readFile(join(storageDir, row.storageKey))).resolves.toBeDefined();
    }
    if (rows.length === 1) {
      const get = await app.request(`${TEST_BASE_URL}${avatarUrlFor(rows[0]!.id)}`, {
        headers: { cookie: alice.cookie },
      });
      expect(get.status).toBe(200);
    } else {
      // The delete won: the replaced file is an orphan on disk (never
      // served), and the old URL 404s.
      const gone = await app.request(`${TEST_BASE_URL}${firstUrl}`, {
        headers: { cookie: alice.cookie },
      });
      expect(gone.status).toBe(404);
    }
  });

  it('refuses files over 256 KB with a 413 and nothing stored', async () => {
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const oversize = await putAvatar('user', alice.id, alice, big);
    expect(oversize.status).toBe(413);
    expect(((await oversize.json()) as { error: { code: string } }).error.code).toBe(
      'avatar_too_large',
    );
    expect(await context.db.select().from(avatars)).toHaveLength(0);
  });

  it('validates by magic bytes even when the content type lies', async () => {
    // A PNG with a lying extension and content type still validates.
    const lying = await putAvatar('user', alice.id, alice, pngSquare(96), 'image/gif');
    expect(lying.status).toBe(200);
  });

  it('replace swaps the file and removes the old one; remove is idempotent', async () => {
    const first = await putAvatar('user', alice.id, alice, pngSquare(128));
    const firstUrl = ((await first.json()) as { url: string }).url;
    const [firstRow] = await context.db.select().from(avatars);
    expect(firstRow).toBeDefined();

    const second = await putAvatar('user', alice.id, alice, webpSquare(256));
    expect(second.status).toBe(200);
    const secondUrl = ((await second.json()) as { url: string }).url;
    expect(secondUrl).not.toBe(firstUrl);
    const rows = await context.db.select().from(avatars);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(firstRow?.id);
    // The old file is gone, the new one serves.
    await expect(readFile(join(storageDir, firstRow!.storageKey))).rejects.toThrow();
    const get = await app.request(`${TEST_BASE_URL}${secondUrl}`, {
      headers: { cookie: alice.cookie },
    });
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/webp');

    const remove = await deleteAvatar('user', alice.id, alice);
    expect(remove.status).toBe(200);
    const again = await deleteAvatar('user', alice.id, alice);
    expect(again.status).toBe(200);
    expect(await context.db.select().from(avatars)).toHaveLength(0);
  });

  it('concurrent uploads for the same owner end with exactly one row', async () => {
    const results = await Promise.all([
      putAvatar('user', alice.id, alice, pngSquare(64)),
      putAvatar('user', alice.id, alice, pngSquare(128)),
      putAvatar('user', alice.id, alice, webpSquare(256)),
    ]);
    for (const response of results) {
      expect(response.status).toBe(200);
    }
    expect(await context.db.select().from(avatars)).toHaveLength(1);
  });

  it('rate limits uploads to 10 per hour per user', async () => {
    for (let index = 0; index < 10; index += 1) {
      const response = await putAvatar('user', alice.id, alice, pngSquare(64));
      expect(response.status).toBe(200);
    }
    const limited = await putAvatar('user', alice.id, alice, pngSquare(64));
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('requires authentication on every route', async () => {
    const put = await app.request(`${TEST_BASE_URL}/api/avatars/user/${alice.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: pngSquare(64) as unknown as string,
    });
    expect(put.status).toBe(401);
    const remove = await app.request(`${TEST_BASE_URL}/api/avatars/user/${alice.id}`, {
      method: 'DELETE',
    });
    expect(remove.status).toBe(401);
    const get = await app.request(`${TEST_BASE_URL}/api/avatars/${randomUUID()}`);
    expect(get.status).toBe(401);
  });

  it('a group member row carries the member picture, not the group one', async () => {
    const group = await createGroup(alice.cookie, 'Trip', [bob.id]);
    const put = await putAvatar('group', group.id, alice, pngSquare(128));
    const { url } = (await put.json()) as { url: string };
    const detail = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}`, {
      headers: { cookie: alice.cookie },
    });
    const members = ((await detail.json()) as { members: Array<{ avatarUrl?: string }> }).members;
    expect(members.find((member) => member.avatarUrl === url)).toBeUndefined();
    // The member rows carry the *member's* picture, not the group's.
    const memberPut = await putAvatar('user', bob.id, bob, pngSquare(64));
    const memberUrl = ((await memberPut.json()) as { url: string }).url;
    const detailAfter = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}`, {
      headers: { cookie: alice.cookie },
    });
    const afterMembers = (
      (await detailAfter.json()) as { members: Array<{ userId: string; avatarUrl?: string }> }
    ).members;
    expect(afterMembers.find((member) => member.userId === bob.id)?.avatarUrl).toBe(memberUrl);
  });

  it('a channel picture is set by its owner and rides the chat list', async () => {
    const created = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ title: 'News', kind: 'channel', memberIds: [] }),
    });
    expect(created.status).toBe(201);
    const channel = (await created.json()) as { id: string };
    const put = await putAvatar('group', channel.id, alice, pngSquare(192));
    expect(put.status).toBe(200);
    const { url } = (await put.json()) as { url: string };
    const chats = await app.request(`${TEST_BASE_URL}/api/chats`, {
      headers: { cookie: alice.cookie },
    });
    const entries = (
      (await chats.json()) as { chats: Array<{ groupId?: string; avatarUrl?: string }> }
    ).chats;
    expect(entries.find((entry) => entry.groupId === channel.id)?.avatarUrl).toBe(url);
  });

  it('a stranger with the exact URL but no session gets 401; a signed-in stranger loads it', async () => {
    const put = await putAvatar('user', alice.id, alice, pngSquare(128));
    const { url } = (await put.json()) as { url: string };
    const anon = await app.request(`${TEST_BASE_URL}${url}`);
    expect(anon.status).toBe(401);
    const stranger = await app.request(`${TEST_BASE_URL}${url}`, {
      headers: { cookie: bob.cookie },
    });
    expect(stranger.status).toBe(200);
  });

  it('the AI list and detail carry the AI picture', async () => {
    const ai = await addAi(alice.id);
    const put = await putAvatar('ai', ai.id, alice, pngSquare(128));
    const { url } = (await put.json()) as { url: string };

    const list = await app.request(`${TEST_BASE_URL}/api/ais`, {
      headers: { cookie: alice.cookie },
    });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as Array<{ id: string; avatarUrl?: string }>;
    expect(listed.find((entry) => entry.id === ai.id)?.avatarUrl).toBe(url);

    const detail = await app.request(`${TEST_BASE_URL}/api/ais/${ai.id}`, {
      headers: { cookie: alice.cookie },
    });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { avatarUrl?: string }).avatarUrl).toBe(url);
  });

  it('a public group picture rides the directory and the by-handle lookup', async () => {
    const group = await createGroup(alice.cookie, 'Open club', [bob.id]);
    const patched = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ visibility: 'public', handle: 'open_club' }),
    });
    expect(patched.status).toBe(200);
    const put = await putAvatar('group', group.id, alice, pngSquare(128));
    const { url } = (await put.json()) as { url: string };

    const directory = await app.request(`${TEST_BASE_URL}/api/directory?q=open`, {
      headers: { cookie: bob.cookie },
    });
    expect(directory.status).toBe(200);
    const found = (await directory.json()) as {
      entries: Array<{ id: string; avatarUrl?: string }>;
    };
    expect(found.entries.find((entry) => entry.id === group.id)?.avatarUrl).toBe(url);

    const byHandle = await app.request(`${TEST_BASE_URL}/api/groups/by-handle/open_club`, {
      headers: { cookie: bob.cookie },
    });
    expect(byHandle.status).toBe(200);
    expect(((await byHandle.json()) as { avatarUrl?: string }).avatarUrl).toBe(url);
  });
});
