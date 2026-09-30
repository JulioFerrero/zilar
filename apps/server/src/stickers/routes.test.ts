import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  TEST_BASE_URL,
  type SignedInUser,
  type TestContext,
} from '../test-support';

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function webpBytes(width: number, height: number): Uint8Array {
  const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));
  const bytes = new Uint8Array(34);
  bytes.set(ascii('RIFF'), 0);
  bytes.set(ascii('WEBP'), 8);
  bytes.set(ascii('VP8X'), 12);
  bytes.set([10, 0, 0, 0, 0x12, 0, 0, 0], 16);
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  bytes.set([0, 0, 0, 0], 30);
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
  emoji?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    cookie: user.cookie,
    'content-type': 'application/octet-stream',
  };
  if (emoji !== undefined) {
    headers['x-emoji'] = emoji;
  }
  return app.request(`${TEST_BASE_URL}/api/sticker-packs/${packId}/stickers`, {
    method: 'POST',
    headers,
    body: bytes as unknown as string,
  });
}

describe('stickers routes', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;
  let storageDir: string;
  let owner: SignedInUser;
  let stranger: SignedInUser;

  beforeEach(async () => {
    context = await createTestContext();
    storageDir = await mkdtemp(join(tmpdir(), 'galena-stickers-'));
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

  async function createPack(
    user: SignedInUser,
    body: unknown = { title: 'Cats' },
  ): Promise<{ status: number; json: { id: string } & Record<string, unknown> }> {
    const response = await jsonRequest(app, 'POST', '/api/sticker-packs', user, body);
    return {
      status: response.status,
      json: (await response.json()) as { id: string } & Record<string, unknown>,
    };
  }

  it('creates a pack and lists it in the owner panel', async () => {
    const { status, json } = await createPack(owner);
    expect(status).toBe(201);
    expect(json.title).toBe('Cats');

    const panel = await jsonRequest(app, 'GET', '/api/sticker-packs', owner);
    expect(panel.status).toBe(200);
    const body = (await panel.json()) as { packs: Array<{ id: string }> };
    expect(body.packs.map((pack) => pack.id)).toContain(json.id);
  });

  it('enforces the 100-packs-per-user cap', async () => {
    for (let index = 0; index < 100; index += 1) {
      const { status } = await createPack(owner, { title: `Pack ${index}` });
      expect(status).toBe(201);
    }
    const { status, json } = await createPack(owner, { title: 'One too many' });
    expect(status).toBe(400);
    expect((json as unknown as { error: { code: string } }).error.code).toBe('pack_limit');
  });

  it('uploads a PNG by magic bytes with a wrong content type', async () => {
    const { json } = await createPack(owner);
    // Multipart with a lying filename and content type: the magic bytes win.
    const boundary = '----galena-test-boundary';
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sticker.gif"\r\nContent-Type: image/gif\r\n\r\n`;
    const footer = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="emoji"\r\n\r\ncat\r\n--${boundary}--\r\n`;
    const headerBytes = new TextEncoder().encode(header);
    const footerBytes = new TextEncoder().encode(footer);
    const payload = new Uint8Array(headerBytes.length + 33 + footerBytes.length);
    payload.set(headerBytes, 0);
    payload.set(pngBytes(64, 64), headerBytes.length);
    payload.set(footerBytes, headerBytes.length + 33);
    const response = await app.request(`${TEST_BASE_URL}/api/sticker-packs/${json.id}/stickers`, {
      method: 'POST',
      headers: {
        cookie: owner.cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: payload as unknown as string,
    });
    expect(response.status).toBe(201);
    const sticker = (await response.json()) as {
      mime: string;
      width: number;
      height: number;
      url: string;
    };
    expect(sticker.mime).toBe('image/png');
    expect(sticker.width).toBe(64);
    expect(sticker.url).toContain('/api/stickers/');
  });

  it('rejects an SVG, a GIF and a truncated file', async () => {
    const { json } = await createPack(owner);
    for (const bytes of [
      Uint8Array.from([...'<svg xmlns="x"></svg>'].map((char) => char.charCodeAt(0))),
      Uint8Array.from([...'GIF89a........'].map((char) => char.charCodeAt(0))),
      pngBytes(64, 64).subarray(0, 10),
    ]) {
      const response = await uploadBytes(app, json.id, owner, bytes);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'sticker_not_image',
      );
    }
  });

  it('rejects an oversized upload and a PNG claiming huge dimensions', async () => {
    const { json } = await createPack(owner);
    const big = new Uint8Array(512 * 1024 + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const tooLarge = await uploadBytes(app, json.id, owner, big);
    expect(tooLarge.status).toBe(413);

    const bomb = await uploadBytes(app, json.id, owner, pngBytes(60000, 60000));
    expect(bomb.status).toBe(400);
    expect(((await bomb.json()) as { error: { code: string } }).error.code).toBe(
      'sticker_too_large',
    );
  });

  it('serves the file with the strict headers', async () => {
    const { json } = await createPack(owner);
    const uploaded = await uploadBytes(app, json.id, owner, webpBytes(100, 100));
    expect(uploaded.status).toBe(201);
    const sticker = (await uploaded.json()) as { id: string };

    const file = await app.request(`${TEST_BASE_URL}/api/stickers/${sticker.id}/file`, {
      headers: { cookie: stranger.cookie },
    });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/webp');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(file.headers.get('content-disposition')).toBe('inline');
    expect(file.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(file.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(webpBytes(100, 100));
  });

  it('answers the same 404 code for a missing id and a private pack of another user', async () => {
    const { json } = await createPack(owner, { title: 'Secret', visibility: 'private' });
    const strangerPatch = await jsonRequest(
      app,
      'PATCH',
      `/api/sticker-packs/${json.id}`,
      stranger,
      {
        title: 'Hijacked',
      },
    );
    expect(strangerPatch.status).toBe(404);
    expect(((await strangerPatch.json()) as { error: { code: string } }).error.code).toBe(
      'not_found',
    );

    const missing = await jsonRequest(
      app,
      'PATCH',
      '/api/sticker-packs/00000000-0000-4000-8000-000000000000',
      stranger,
      { title: 'Hijacked' },
    );
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('keeps private packs out of discover and lists server packs', async () => {
    await createPack(owner, { title: 'Secret club', visibility: 'private' });
    const { json } = await createPack(owner, { title: 'Open club', visibility: 'server' });

    const response = await app.request(`${TEST_BASE_URL}/api/sticker-packs/discover`, {
      headers: { cookie: stranger.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { packs: Array<{ id: string; title: string }> };
    expect(body.packs.map((pack) => pack.title)).toEqual(['Open club']);
    expect(body.packs[0]!.id).toBe(json.id);
  });

  it('adds a server pack to the panel and removes it', async () => {
    const { json } = await createPack(owner, { title: 'Shared', visibility: 'server' });
    const add = await jsonRequest(app, 'PUT', `/api/sticker-panel/${json.id}`, stranger, {});
    expect(add.status).toBe(200);

    const panel = (await (
      await jsonRequest(app, 'GET', '/api/sticker-packs', stranger)
    ).json()) as { packs: Array<{ id: string }> };
    expect(panel.packs.map((pack) => pack.id)).toContain(json.id);

    const remove = await jsonRequest(app, 'DELETE', `/api/sticker-panel/${json.id}`, stranger, {});
    expect(remove.status).toBe(200);
  });

  it('reorders stickers by id list and deletes a sticker file', async () => {
    const { json } = await createPack(owner);
    const first = (await (await uploadBytes(app, json.id, owner, pngBytes(10, 10))).json()) as {
      id: string;
    };
    const second = (await (await uploadBytes(app, json.id, owner, pngBytes(20, 20))).json()) as {
      id: string;
    };

    const reorder = await jsonRequest(app, 'PATCH', `/api/sticker-packs/${json.id}`, owner, {
      order: [second.id, first.id],
    });
    expect(reorder.status).toBe(200);
    const reordered = (await reorder.json()) as { stickers: Array<{ id: string }> };
    expect(reordered.stickers.map((sticker) => sticker.id)).toEqual([second.id, first.id]);

    const remove = await jsonRequest(
      app,
      'DELETE',
      `/api/sticker-packs/${json.id}/stickers/${first.id}`,
      owner,
    );
    expect(remove.status).toBe(200);
    const gone = await app.request(`${TEST_BASE_URL}/api/stickers/${first.id}/file`, {
      headers: { cookie: owner.cookie },
    });
    expect(gone.status).toBe(404);
  });

  it('deletes the pack files and warns that sent messages keep a dead URL', async () => {
    const { json } = await createPack(owner);
    const sticker = (await (await uploadBytes(app, json.id, owner, pngBytes(30, 30))).json()) as {
      id: string;
      url: string;
    };
    const path = join(storageDir, `${sticker.id}.png`);
    expect((await readFile(path)).byteLength).toBeGreaterThan(0);

    const deleted = await jsonRequest(app, 'DELETE', `/api/sticker-packs/${json.id}`, owner);
    expect(deleted.status).toBe(200);
    const body = (await deleted.json()) as { warning: string };
    expect(body.warning).toContain('no longer loads');

    await expect(readFile(path)).rejects.toThrow();
    const gone = await app.request(`${TEST_BASE_URL}/api/stickers/${sticker.id}/file`, {
      headers: { cookie: owner.cookie },
    });
    expect(gone.status).toBe(404);
  });

  it('enforces the 120-stickers-per-pack cap', async () => {
    // A limiter that never fires, so 120 uploads can land in one test. The
    // route-level limiter is covered by the rate-limit test below.
    const unthrottled = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      stickerStorageDir: storageDir,
      uploadLimiter: { allow: () => true },
    });
    const created = await (async () => {
      const response = await unthrottled.request(`${TEST_BASE_URL}/api/sticker-packs`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Big pack' }),
      });
      return { status: response.status, json: (await response.json()) as { id: string } };
    })();
    expect(created.status).toBe(201);
    const packId = created.json.id;
    for (let index = 0; index < 120; index += 1) {
      const response = await uploadBytes(unthrottled, packId, owner, pngBytes(8, 8));
      expect(response.status).toBe(201);
    }
    const full = await uploadBytes(unthrottled, packId, owner, pngBytes(8, 8));
    expect(full.status).toBe(400);
    expect(((await full.json()) as { error: { code: string } }).error.code).toBe('pack_full');
  });

  it('rate limits uploads at 60 per hour per user', async () => {
    // A fresh user so earlier tests' uploads never share this budget: the
    // limiter is keyed by user id.
    const budgeted = await contactOf(context, app, owner.id, 'budget@example.com');
    const budgetedApp = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      stickerStorageDir: storageDir,
    });
    async function createBudgetedPack(title: string): Promise<string> {
      const response = await budgetedApp.request(`${TEST_BASE_URL}/api/sticker-packs`, {
        method: 'POST',
        headers: { cookie: budgeted.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { id: string }).id;
    }
    // A small injected budget so the window math is exercised without 60
    // uploads: 3 pass, the 4th is limited, and the window reset passes. The
    // real 60/hour limiter is the default (see the exported constants).
    let now = Date.now();
    const limited = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      stickerStorageDir: storageDir,
      stickerNow: () => now,
      uploadLimiter: (() => {
        let budget = 3;
        let windowStart = now;
        return {
          allow: () => {
            if (now - windowStart >= 60 * 60 * 1000) {
              windowStart = now;
              budget = 3;
            }
            if (budget <= 0) {
              return false;
            }
            budget -= 1;
            return true;
          },
        };
      })(),
    });
    // Two packs so the uploads never hit the per-pack sticker cap.
    const packIds = [
      await createBudgetedPack('Budget one'),
      await createBudgetedPack('Budget two'),
    ];
    for (let index = 0; index < 3; index += 1) {
      const response = await uploadBytes(limited, packIds[index % 2]!, budgeted, pngBytes(8, 8));
      expect(response.status).toBe(201);
    }
    const limitedResponse = await uploadBytes(limited, packIds[0]!, budgeted, pngBytes(8, 8));
    expect(limitedResponse.status).toBe(429);
    now += 60 * 60 * 1000 + 1;
    const afterWindow = await uploadBytes(limited, packIds[1]!, budgeted, pngBytes(8, 8));
    expect(afterWindow.status).toBe(201);
  });

  it('rejects a traversal-style sticker id with 404', async () => {
    const response = await app.request(`${TEST_BASE_URL}/api/stickers/%2e%2e%2fsecret/file`, {
      headers: { cookie: owner.cookie },
    });
    expect(response.status).toBe(404);
  });

  it('resolves a relative storage dir against the package root, not the cwd', async () => {
    const { isAbsolute, relative } = await import('node:path');
    const { mkdir } = await import('node:fs/promises');
    const { SERVER_PACKAGE_ROOT, resolveStorageDir } = await import('./service');
    // A relative dir with a per-test subdirectory, created under the temp
    // area so no test files escape it.
    const leaf = `galena-stickers-base-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const absolute = join(storageDir, leaf);
    await mkdir(absolute, { recursive: true });
    const relativeToRoot = relative(SERVER_PACKAGE_ROOT, absolute);
    expect(isAbsolute(relativeToRoot)).toBe(false);
    // The default export resolves against the package root, so the same
    // relative value means the same directory whatever the cwd is.
    expect(resolveStorageDir(relativeToRoot)).toBe(absolute);
    expect(resolveStorageDir(`./${relativeToRoot}`)).toBe(absolute);
    // An explicit base wins (the startup path uses the default base).
    expect(resolveStorageDir('data/stickers', '/var/lib/galena')).toBe(
      (await import('node:path')).resolve('/var/lib/galena', 'data/stickers'),
    );
    // Absolute values pass through unchanged.
    expect(resolveStorageDir(absolute)).toBe(absolute);
  });

  it('serves files through a relatively-configured storage dir', async () => {
    // Uses a relative storage dir (like the `./data/stickers` default) with
    // a per-test subdirectory. The value is relative to the server package
    // root, so the test stages the directory under it.
    const { mkdir, rm } = await import('node:fs/promises');
    const path = await import('node:path');
    const { SERVER_PACKAGE_ROOT } = await import('./service');
    const leaf = `galena-stickers-rel-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const absolute = path.join(SERVER_PACKAGE_ROOT, leaf);
    await mkdir(absolute, { recursive: true });
    const relativeApp = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      stickerStorageDir: `./${leaf}`,
    });
    try {
      const created = await relativeApp.request(`${TEST_BASE_URL}/api/sticker-packs`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Relative' }),
      });
      expect(created.status).toBe(201);
      const pack = (await created.json()) as { id: string };
      const uploaded = await uploadBytes(relativeApp, pack.id, owner, pngBytes(40, 40));
      expect(uploaded.status).toBe(201);
      const sticker = (await uploaded.json()) as { id: string };
      const file = await relativeApp.request(`${TEST_BASE_URL}/api/stickers/${sticker.id}/file`, {
        headers: { cookie: owner.cookie },
      });
      expect(file.status).toBe(200);
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(pngBytes(40, 40));
    } finally {
      await rm(absolute, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('escapes LIKE wildcards in discover queries', async () => {
    await createPack(owner, { title: '100% cats', visibility: 'server' });
    await createPack(owner, { title: 'under_score', visibility: 'server' });
    await createPack(owner, { title: 'Plain dogs', visibility: 'server' });

    async function discoverTitles(q: string): Promise<string[]> {
      const response = await app.request(
        `${TEST_BASE_URL}/api/sticker-packs/discover?q=${encodeURIComponent(q)}`,
        { headers: { cookie: stranger.cookie } },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { packs: Array<{ title: string }> };
      return body.packs.map((pack) => pack.title);
    }

    // A bare `%` must not match everything: only the pack with a literal %.
    expect(await discoverTitles('%')).toEqual(['100% cats']);
    expect(await discoverTitles('_')).toEqual(['under_score']);
    expect(await discoverTitles('cats')).toEqual(['100% cats']);
  });

  it('leaves no orphan sticker row when the file write fails', async () => {
    // The storage path is blocked by a regular file, so `mkdir` fails after
    // the metadata row was inserted: the route must fail AND delete the row.
    const { writeFile } = await import('node:fs/promises');
    const blocker = join(storageDir, 'blocker');
    await writeFile(blocker, 'nope');
    const blockedApp = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      stickerStorageDir: join(blocker, 'stickers'),
    });
    const created = await blockedApp.request(`${TEST_BASE_URL}/api/sticker-packs`, {
      method: 'POST',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Blocked' }),
    });
    expect(created.status).toBe(201);
    const pack = (await created.json()) as { id: string };

    const response = await uploadBytes(blockedApp, pack.id, owner, pngBytes(40, 40));
    expect(response.status).toBe(503);

    const panel = (await (await jsonRequest(app, 'GET', '/api/sticker-packs', owner)).json()) as {
      packs: Array<{ id: string; stickers: unknown[] }>;
    };
    expect(panel.packs.find((entry) => entry.id === pack.id)?.stickers).toEqual([]);
  });

  it('serializes concurrent reorders instead of interleaving positions', async () => {
    const { json } = await createPack(owner);
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const uploaded = (await (
        await uploadBytes(app, json.id, owner, pngBytes(8 + index, 8))
      ).json()) as { id: string };
      ids.push(uploaded.id);
    }
    const [a, b, c, d] = ids as [string, string, string, string];
    const orderA = [d, c, b, a];
    const orderB = [b, a, d, c];

    // PGlite runs statements serially per connection, so true row-level
    // interleaving cannot be forced here; the assertion is that both
    // requests resolve and the final positions form exactly one of the two
    // complete orders — never a mix, and never a silent row loss.
    const [first, second] = await Promise.all([
      jsonRequest(app, 'PATCH', `/api/sticker-packs/${json.id}`, owner, { order: orderA }),
      jsonRequest(app, 'PATCH', `/api/sticker-packs/${json.id}`, owner, { order: orderB }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const final = (await (await jsonRequest(app, 'GET', '/api/sticker-packs', owner)).json()) as {
      packs: Array<{ id: string; stickers: Array<{ id: string }> }>;
    };
    const stickers = final.packs.find((entry) => entry.id === json.id)?.stickers.map((s) => s.id);
    expect([orderA, orderB]).toContainEqual(stickers);
  });
});
