import { mkdtemp, rm } from 'node:fs/promises';
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
    storageDir = await mkdtemp(join(tmpdir(), 'galena-tg-import-'));
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
    void stranger;
  });

  it('never lets the bot token reach the logs on a failed import', async () => {
    const client: TelegramClient = {
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
