import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../db/schema';
import { createApp } from '../app';
import { stickers } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  TEST_BASE_URL,
  type SignedInUser,
  type TestContext,
} from '../test-support';
import type { TelegramClient, TelegramStickerSet } from './telegram-import';
import { TelegramImportError } from './telegram-import';

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function stickerSet(entries: TelegramStickerSet['stickers'], overrides = {}): TelegramStickerSet {
  return {
    name: 'FunCats',
    title: 'Fun Cats',
    isCustomEmoji: false,
    stickers: entries,
    ...overrides,
  };
}

function fakeClient(
  set: TelegramStickerSet,
  files: Record<string, Uint8Array> = {},
): TelegramClient & { fileCalls: string[] } {
  const fileCalls: string[] = [];
  return {
    fileCalls,
    getMe: async () => ({ ok: true }),
    getStickerSet: async () => set,
    downloadFile: async (fileId: string) => {
      fileCalls.push(fileId);
      const bytes = files[fileId];
      if (bytes === undefined) {
        throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
      }
      return bytes;
    },
  };
}

describe('telegram sticker import', () => {
  let context: TestContext;
  let storageDir: string;
  let owner: SignedInUser;
  let stranger: SignedInUser;

  function appWith(client: TelegramClient, token = 'test-bot-token') {
    return createApp({
      db: context.db,
      logger: context.logger,
      config: { ...context.config, TELEGRAM_BOT_TOKEN: token },
      auth: context.auth,
      adminClient: context.adminClient,
      stickerStorageDir: storageDir,
      telegramClient: client,
    });
  }

  function appWithFake(client: TelegramClient, token = 'test-bot-token') {
    return appWith(client, token);
  }

  beforeEach(async () => {
    context = await createTestContext();
    storageDir = await mkdtemp(join(tmpdir(), 'zilar-tg-import-'));
    owner = await bootstrapUser(context, appWith(fakeClient(stickerSet([]))), 'owner@example.com');
    stranger = await contactOf(
      context,
      appWith(fakeClient(stickerSet([]))),
      owner.id,
      'stranger@example.com',
    );
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true }).catch(() => {});
    await context.close();
  });

  async function importRequest(
    app: ReturnType<typeof createApp>,
    user: SignedInUser,
    body: unknown,
  ): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/sticker-packs/import/telegram`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('imports static stickers into a private pack with emoji', async () => {
    const client = fakeClient(
      stickerSet([
        { sourceId: 'u-1', fileId: 'f-1', emoji: '🐱', animated: false },
        { sourceId: 'u-2', fileId: 'f-2', emoji: '😂', animated: false },
        { sourceId: 'u-3', fileId: 'f-3', emoji: null, animated: true },
      ]),
      { 'f-1': pngBytes(100, 100), 'f-2': pngBytes(200, 120) },
    );
    const app = appWithFake(client);
    const response = await importRequest(app, owner, { input: 'https://t.me/addstickers/FunCats' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      pack: {
        id: string;
        title: string;
        visibility: string;
        importedFrom: string;
        stickers: Array<{ emoji: string | null }>;
      };
      imported: number;
      skippedAnimated: number;
      skippedInvalid: number;
    };
    expect(body.imported).toBe(2);
    expect(body.skippedAnimated).toBe(1);
    expect(body.skippedInvalid).toBe(0);
    expect(body.pack.title).toBe('Fun Cats');
    expect(body.pack.visibility).toBe('private');
    expect(body.pack.importedFrom).toBe('telegram:FunCats');
    expect(body.pack.stickers.map((sticker) => sticker.emoji)).toEqual(['🐱', '😂']);
  });

  it('skips invalid files and counts them', async () => {
    const client = fakeClient(
      stickerSet([
        { sourceId: 'u-1', fileId: 'f-1', emoji: '🐱', animated: false },
        { sourceId: 'u-2', fileId: 'f-2', emoji: null, animated: false },
      ]),
      { 'f-1': pngBytes(100, 100), 'f-2': new TextEncoder().encode('<svg>not a sticker</svg>') },
    );
    const response = await importRequest(appWithFake(client), owner, { input: 'FunCats' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { imported: number; skippedInvalid: number };
    expect(body.imported).toBe(1);
    expect(body.skippedInvalid).toBe(1);
  });

  it('re-runs fill gaps only (source_id), never duplicates', async () => {
    const files = { 'f-1': pngBytes(100, 100), 'f-2': pngBytes(200, 120) };
    const client = fakeClient(
      stickerSet([
        { sourceId: 'u-1', fileId: 'f-1', emoji: '🐱', animated: false },
        { sourceId: 'u-2', fileId: 'f-2', emoji: '😂', animated: false },
      ]),
      files,
    );
    const app = appWithFake(client);
    const first = (await (await importRequest(app, owner, { input: 'FunCats' })).json()) as {
      pack: { id: string };
      imported: number;
    };
    expect(first.imported).toBe(2);
    const second = (await (await importRequest(app, owner, { input: 'FunCats' })).json()) as {
      pack: { id: string };
      imported: number;
    };
    expect(second.pack.id).toBe(first.pack.id);
    expect(second.imported).toBe(0);
    const rows = await context.db.select().from(stickers).where(eq(stickers.packId, first.pack.id));
    expect(rows).toHaveLength(2);
  });

  it('refuses custom emoji sets with a clear message', async () => {
    const client = fakeClient(stickerSet([], { isCustomEmoji: true }));
    const response = await importRequest(appWithFake(client), owner, { input: 'FunCats' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('custom_emoji_unsupported');
  });

  it('rejects hostile input before any Telegram request', async () => {
    const client = fakeClient(stickerSet([]));
    const response = await importRequest(appWithFake(client), owner, {
      input: '../../etc/passwd',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_request');
  });

  it('answers 501 import_unavailable without the token', async () => {
    const client = fakeClient(stickerSet([]));
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      stickerStorageDir: storageDir,
      telegramClient: client,
    });
    const response = await importRequest(app, owner, { input: 'FunCats' });
    expect(response.status).toBe(501);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('import_unavailable');
  });

  it('answers 404 pack_not_found for unknown packs without Telegram text', async () => {
    const client: TelegramClient = {
      getMe: async () => ({ ok: true }),
      getStickerSet: async () => {
        throw new TelegramImportError('pack_not_found', 'That Telegram sticker pack was not found');
      },
      downloadFile: async () => new Uint8Array(),
    };
    const response = await importRequest(appWithFake(client), owner, { input: 'NopeNope' });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('pack_not_found');
  });

  it('reports try_later when Telegram rate limits', async () => {
    const client: TelegramClient = {
      getMe: async () => ({ ok: true }),
      getStickerSet: async () => {
        throw new TelegramImportError('try_later', 'Telegram is busy, try again later');
      },
      downloadFile: async () => new Uint8Array(),
    };
    const response = await importRequest(appWithFake(client), owner, { input: 'FunCats' });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('try_later');
  });

  it('rate limits 3 imports per hour per user', async () => {
    let now = Date.now();
    const client = fakeClient(stickerSet([]));
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: { ...context.config, TELEGRAM_BOT_TOKEN: 'test-bot-token' },
      auth: context.auth,
      adminClient: context.adminClient,
      stickerStorageDir: storageDir,
      telegramClient: client,
      telegramImportNow: () => now,
    });
    for (let index = 0; index < 3; index += 1) {
      const response = await importRequest(app, owner, { input: 'FunCats' });
      expect(response.status).toBe(200);
    }
    const limited = await importRequest(app, owner, { input: 'FunCats' });
    expect(limited.status).toBe(429);
    now += 61 * 60 * 1000;
    const after = await importRequest(app, owner, { input: 'FunCats' });
    expect(after.status).toBe(200);
  });

  it('rejects switching an imported pack to server visibility', async () => {
    const client = fakeClient(
      stickerSet([{ sourceId: 'u-1', fileId: 'f-1', emoji: '🐱', animated: false }]),
      { 'f-1': pngBytes(100, 100) },
    );
    const app = appWithFake(client);
    const imported = (await (await importRequest(app, owner, { input: 'FunCats' })).json()) as {
      pack: { id: string };
    };
    const patch = await app.request(`${TEST_BASE_URL}/api/sticker-packs/${imported.pack.id}`, {
      method: 'PATCH',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'server' }),
    });
    expect(patch.status).toBe(400);
    const body = (await patch.json()) as { error: { code: string } };
    expect(body.error.code).toBe('imported_private');
  });

  it('audits the import with ids and counts only', async () => {
    const client = fakeClient(
      stickerSet([{ sourceId: 'u-1', fileId: 'f-1', emoji: '🐱', animated: false }]),
      { 'f-1': pngBytes(100, 100) },
    );
    const response = await importRequest(appWithFake(client), owner, { input: 'FunCats' });
    expect(response.status).toBe(200);
    const rows = await context.db.select().from(auditLog);
    const entry = rows.find((row) => row.action === 'sticker_pack.imported');
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry?.detail)).not.toContain('Fun Cats');
    expect(entry?.detail).toMatchObject({ imported: 1 });
  });

  it('isolates imported packs per user (same 404, separate packs)', async () => {
    const client = fakeClient(
      stickerSet([{ sourceId: 'u-1', fileId: 'f-1', emoji: '🐱', animated: false }]),
      { 'f-1': pngBytes(100, 100) },
    );
    const app = appWithFake(client);
    const owned = (await (await importRequest(app, owner, { input: 'FunCats' })).json()) as {
      pack: { id: string };
    };

    // A stranger cannot read or change the owner's imported pack: PATCH and
    // DELETE answer the same 404 as an unknown id, and the panel hides it.
    const patch = await app.request(`${TEST_BASE_URL}/api/sticker-packs/${owned.pack.id}`, {
      method: 'PATCH',
      headers: { cookie: stranger.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    expect(patch.status).toBe(404);
    const deleted = await app.request(`${TEST_BASE_URL}/api/sticker-packs/${owned.pack.id}`, {
      method: 'DELETE',
      headers: { cookie: stranger.cookie },
    });
    expect(deleted.status).toBe(404);
    const panel = (await (
      await app.request(`${TEST_BASE_URL}/api/sticker-packs`, {
        headers: { cookie: stranger.cookie },
      })
    ).json()) as { packs: Array<{ id: string }> };
    expect(panel.packs.map((pack) => pack.id)).not.toContain(owned.pack.id);

    // The stranger importing the same Telegram name gets their own pack.
    const theirs = (await (await importRequest(app, stranger, { input: 'FunCats' })).json()) as {
      pack: { id: string; importedFrom: string };
    };
    expect(theirs.pack.id).not.toBe(owned.pack.id);
    expect(theirs.pack.importedFrom).toBe('telegram:FunCats');
  });

  it('completes with a summary when local stickers already fill the pack', async () => {
    // 2 imported + 118 local = a full pack of 120: the re-run queues
    // nothing and answers a summary, never a 400.
    const client = fakeClient(
      stickerSet([
        { sourceId: 'u-1', fileId: 'f-1', emoji: '🐱', animated: false },
        { sourceId: 'u-2', fileId: 'f-2', emoji: '😂', animated: false },
        { sourceId: 'u-3', fileId: 'f-3', emoji: null, animated: false },
      ]),
      { 'f-1': pngBytes(64, 64), 'f-2': pngBytes(64, 64), 'f-3': pngBytes(64, 64) },
    );
    const app = appWithFake(client);
    const first = (await (await importRequest(app, owner, { input: 'FunCats' })).json()) as {
      pack: { id: string };
      imported: number;
    };
    expect(first.imported).toBe(3);

    // Local stickers, like uploads from the pack editor: no `source_id`.
    await context.db.insert(stickers).values(
      Array.from({ length: 117 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        packId: first.pack.id,
        position: 100 + index,
        emoji: null,
        mime: 'image/png' as const,
        width: 64,
        height: 64,
        bytes: 33,
        storageKey: `local-${index}.png`,
        sourceId: null,
      })),
    );
    const rerun = await importRequest(app, owner, { input: 'FunCats' });
    expect(rerun.status).toBe(200);
    const summary = (await rerun.json()) as {
      pack: { id: string };
      imported: number;
      skippedAnimated: number;
      skippedInvalid: number;
      partial?: boolean;
    };
    expect(summary.pack.id).toBe(first.pack.id);
    expect(summary.imported).toBe(0);
    expect(summary.partial).toBeUndefined();
    expect(client.fileCalls).toHaveLength(3);
  });

  it('writes no file and counts nothing when a concurrent import won the same sticker', async () => {
    let current = stickerSet([]);
    const client = fakeClient(current, { 'f-1': pngBytes(64, 64) });
    client.getStickerSet = async () => current;
    const app = appWithFake(client);
    const created = (await (await importRequest(app, owner, { input: 'Racy' })).json()) as {
      pack: { id: string };
    };
    current = stickerSet([{ sourceId: 'u-1', fileId: 'f-1', emoji: null, animated: false }]);
    const download = client.downloadFile;
    client.downloadFile = async (fileId: string) => {
      await context.db.insert(stickers).values({
        id: '20000000-0000-4000-8000-000000000001',
        packId: created.pack.id,
        position: 0,
        emoji: null,
        mime: 'image/png',
        width: 64,
        height: 64,
        bytes: 33,
        storageKey: 'winner.png',
        sourceId: 'u-1',
      });
      return download(fileId);
    };
    const response = await importRequest(app, owner, { input: 'Racy' });
    expect(response.status).toBe(200);
    const summary = (await response.json()) as { imported: number; skippedInvalid: number };
    expect(summary.imported).toBe(0);
    expect(summary.skippedInvalid).toBe(0);
    expect(await readdir(storageDir)).toEqual([]);
    const rows = await context.db
      .select()
      .from(stickers)
      .where(eq(stickers.packId, created.pack.id));
    expect(rows).toHaveLength(1);
  });

  it('ends a mid-batch full pack with the summary instead of a 400', async () => {
    // 6 queued stickers = batches of 4 + 2. A concurrent writer fills 2
    // slots during the first batch's downloads, so the first batch lands
    // exactly on 120 and the second batch meets a full pack: the import
    // answers 200 with the first batch's inserts reported.
    const entries = Array.from({ length: 8 }, (_, index) => ({
      sourceId: `u-${index}`,
      fileId: `f-${index}`,
      emoji: null as string | null,
      animated: false,
    }));
    const files: Record<string, Uint8Array> = {};
    for (let index = 0; index < 8; index += 1) {
      files[`f-${index}`] = pngBytes(64, 64);
    }
    // The pack is created by an empty import first, so the 8 Telegram
    // stickers are all still pending when the measured import runs.
    let current = stickerSet([]);
    const client = fakeClient(current, files);
    client.getStickerSet = async () => current;
    const app = appWithFake(client);
    const created = (await (await importRequest(app, owner, { input: 'Racy' })).json()) as {
      pack: { id: string };
    };
    current = stickerSet(entries);
    await context.db.insert(stickers).values(
      Array.from({ length: 114 }, (_, index) => ({
        id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        packId: created.pack.id,
        position: index,
        emoji: null,
        mime: 'image/png' as const,
        width: 64,
        height: 64,
        bytes: 33,
        storageKey: `prefill-${index}.png`,
        sourceId: null,
      })),
    );
    const originalDownload = client.downloadFile;
    let filled = false;
    client.downloadFile = async (fileId: string) => {
      if (!filled) {
        filled = true;
        await context.db.insert(stickers).values(
          Array.from({ length: 2 }, (_, index) => ({
            id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            packId: created.pack.id,
            position: 1000 + index,
            emoji: null,
            mime: 'image/png' as const,
            width: 64,
            height: 64,
            bytes: 33,
            storageKey: `filler-${index}.png`,
            sourceId: null,
          })),
        );
      }
      return originalDownload(fileId);
    };
    const response = await importRequest(app, owner, { input: 'Racy' });
    expect(response.status).toBe(200);
    const summary = (await response.json()) as {
      pack: { id: string };
      imported: number;
      skippedAnimated: number;
      skippedInvalid: number;
    };
    expect(summary.pack.id).toBe(created.pack.id);
    expect(summary.imported).toBe(4);
    const rows = await context.db
      .select()
      .from(stickers)
      .where(eq(stickers.packId, created.pack.id));
    expect(rows).toHaveLength(120);
  });

  it('does not burn the hourly budget on garbage input', async () => {
    const client = fakeClient(stickerSet([]));
    const app = appWithFake(client);
    for (const input of ['../../etc/passwd', '', 'https://evil.test/x'] as const) {
      const bad = await importRequest(app, owner, { input });
      expect(bad.status).toBe(400);
    }
    const valid = await importRequest(app, owner, { input: 'FunCats' });
    expect(valid.status).toBe(200);
    for (let index = 0; index < 2; index += 1) {
      expect((await importRequest(app, owner, { input: 'FunCats' })).status).toBe(200);
    }
    expect((await importRequest(app, owner, { input: 'FunCats' })).status).toBe(429);
  });

  it('skips an oversized Telegram file and imports the good ones', async () => {
    const client = fakeClient(
      stickerSet([
        { sourceId: 'u-1', fileId: 'f-1', emoji: '🐱', animated: false },
        { sourceId: 'u-2', fileId: 'f-2', emoji: null, animated: false },
      ]),
      { 'f-1': pngBytes(64, 64) },
    );
    const originalDownload = client.downloadFile;
    client.downloadFile = async (fileId: string) => {
      if (fileId === 'f-2') {
        throw new TelegramImportError(
          'file_too_large',
          'A Telegram file was larger than the 1 MiB limit',
        );
      }
      return originalDownload(fileId);
    };
    const response = await importRequest(appWithFake(client), owner, { input: 'FunCats' });
    expect(response.status).toBe(200);
    const summary = (await response.json()) as { imported: number; skippedInvalid: number };
    expect(summary.imported).toBe(1);
    expect(summary.skippedInvalid).toBe(1);
  });

  it('never lets the bot token reach the logs on a failed import', async () => {
    const client: TelegramClient = {
      getMe: async () => ({ ok: true }),
      getStickerSet: async () => {
        throw new TelegramImportError('try_later', 'Telegram is busy, try again later');
      },
      downloadFile: async () => new Uint8Array(),
    };
    const response = await importRequest(appWithFake(client), owner, { input: 'FunCats' });
    expect(response.status).toBe(503);
    const bodyText = await response.text();
    expect(bodyText).not.toContain('test-bot-token');
    expect(context.logOutput()).not.toContain('test-bot-token');
  });

  it('considers at most 200 stickers and imports at most 120', async () => {
    const entries = Array.from({ length: 210 }, (_, index) => ({
      sourceId: `u-${index}`,
      fileId: `f-${index}`,
      emoji: null as string | null,
      animated: false,
    }));
    const files: Record<string, Uint8Array> = {};
    for (let index = 0; index < 210; index += 1) {
      files[`f-${index}`] = pngBytes(64, 64);
    }
    const client = fakeClient(stickerSet(entries), files);
    const response = await importRequest(appWithFake(client), owner, { input: 'FunCats' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      pack: { id: string };
      imported: number;
      partial?: boolean;
    };
    expect(body.imported).toBe(120);
    expect(body.partial).toBeUndefined();
    expect(client.fileCalls).toHaveLength(120);
    const rows = await context.db.select().from(stickers).where(eq(stickers.packId, body.pack.id));
    expect(rows).toHaveLength(120);
  });

  it('reports partial when the request budget runs out, and a re-run fills the gaps', async () => {
    // 12 stickers = 3 batches of 4: the clock jumps past the 30 s budget
    // during the second batch, so the third batch never starts (partial),
    // and a re-run with a fresh clock fills the last 4.
    const entries = Array.from({ length: 12 }, (_, index) => ({
      sourceId: `u-${index}`,
      fileId: `f-${index}`,
      emoji: null as string | null,
      animated: false,
    }));
    const files: Record<string, Uint8Array> = {};
    for (let index = 0; index < 12; index += 1) {
      files[`f-${index}`] = pngBytes(64, 64);
    }
    let now = 1_000_000;
    const client = fakeClient(stickerSet(entries), files);
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: { ...context.config, TELEGRAM_BOT_TOKEN: 'test-bot-token' },
      auth: context.auth,
      adminClient: context.adminClient,
      stickerStorageDir: storageDir,
      telegramClient: client,
      telegramImportNow: () => now,
    });
    const originalDownload = client.downloadFile;
    let downloads = 0;
    client.downloadFile = async (fileId: string) => {
      downloads += 1;
      if (downloads > 4) {
        now += 60_000;
      }
      return originalDownload(fileId);
    };
    const first = (await (await importRequest(app, owner, { input: 'FunCats' })).json()) as {
      pack: { id: string };
      imported: number;
      partial?: boolean;
    };
    expect(first.imported).toBe(8);
    expect(first.partial).toBe(true);

    now = 1_000_000;
    downloads = 0;
    const second = (await (await importRequest(app, owner, { input: 'FunCats' })).json()) as {
      pack: { id: string };
      imported: number;
      partial?: boolean;
    };
    expect(second.pack.id).toBe(first.pack.id);
    expect(second.imported).toBe(4);
    expect(second.partial).toBeUndefined();
    const rows = await context.db.select().from(stickers).where(eq(stickers.packId, first.pack.id));
    expect(rows).toHaveLength(12);
  });
});
