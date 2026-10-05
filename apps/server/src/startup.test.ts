import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ensureWritableDir,
  warnOnContainerLayerStorage,
  warnOnEmptyStorageDir,
  warnOnGifConfig,
} from './startup';
import { bootstrapUser, createTestContext } from './test-support';

describe('ensureWritableDir', () => {
  it('logs one warning when the directory is created', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'zilar-startup-'));
    try {
      const dir = join(parent, 'stickers');
      const onError = vi.fn();
      const exit = vi.fn();
      const onCreated = vi.fn();
      const { mkdir, access, constants } = await import('node:fs/promises');
      await ensureWritableDir(dir, 'STICKER_STORAGE_DIR', {
        mkdir: (target, options) => mkdir(target, options),
        access: (target, mode) => access(target, mode),
        writeAccess: constants.W_OK,
        onError,
        exit,
        onCreated,
      });
      expect(onError).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(onCreated).toHaveBeenCalledWith(dir);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('does not log when the directory already exists', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'zilar-startup-'));
    try {
      const onError = vi.fn();
      const exit = vi.fn();
      const onCreated = vi.fn();
      const { mkdir, access, constants } = await import('node:fs/promises');
      await ensureWritableDir(parent, 'STICKER_STORAGE_DIR', {
        mkdir: (target, options) => mkdir(target, options),
        access: (target, mode) => access(target, mode),
        writeAccess: constants.W_OK,
        onError,
        exit,
        onCreated,
      });
      expect(onError).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(onCreated).not.toHaveBeenCalled();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe('warnOnEmptyStorageDir', () => {
  it('warns once when the database has stickers but the dir holds no files', async () => {
    const context = await createTestContext();
    try {
      // Seed one sticker row through the real routes into a temp dir, then
      // check a *different* empty temp dir: the database has sticker rows
      // while the resolved dir holds no files — the moved-base case.
      const seedDir = await mkdtemp(join(tmpdir(), 'zilar-startup-seed-'));
      try {
        const { createApp } = await import('./app');
        const seedApp = createApp({
          db: context.db,
          logger: context.logger,
          config: context.config,
          auth: context.auth,
          adminClient: context.adminClient,
          stickerStorageDir: seedDir,
        });
        const owner = await bootstrapUser(context, seedApp, 'owner@example.com');
        const created = await seedApp.request('http://localhost:3000/api/sticker-packs', {
          method: 'POST',
          headers: { cookie: owner.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Empty dir' }),
        });
        expect(created.status).toBe(201);
        const pack = (await created.json()) as { id: string };
        const bytes = new Uint8Array(33);
        bytes.set([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
        ]);
        new DataView(bytes.buffer).setUint32(16, 40);
        new DataView(bytes.buffer).setUint32(20, 40);
        const uploaded = await seedApp.request(
          `http://localhost:3000/api/sticker-packs/${pack.id}/stickers`,
          {
            method: 'POST',
            headers: { cookie: owner.cookie, 'content-type': 'application/octet-stream' },
            body: bytes as unknown as string,
          },
        );
        expect(uploaded.status).toBe(201);
      } finally {
        await rm(seedDir, { recursive: true, force: true });
      }
      const dir = await mkdtemp(join(tmpdir(), 'zilar-startup-empty-'));
      try {
        const warn = vi.fn();
        await warnOnEmptyStorageDir({ db: context.db, storageDir: dir, warn });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(dir));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } finally {
      await context.close();
    }
  });

  it('stays quiet when the database has no stickers, or the dir holds files', async () => {
    const context = await createTestContext();
    try {
      const empty = await mkdtemp(join(tmpdir(), 'zilar-startup-norows-'));
      try {
        const warn = vi.fn();
        await warnOnEmptyStorageDir({ db: context.db, storageDir: empty, warn });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        await rm(empty, { recursive: true, force: true });
      }
    } finally {
      await context.close();
    }
  });

  it('stays quiet when the dir holds the uploaded sticker files', async () => {
    const context = await createTestContext();
    try {
      const dir = await mkdtemp(join(tmpdir(), 'zilar-startup-withfile-'));
      try {
        const { createApp } = await import('./app');
        const seedApp = createApp({
          db: context.db,
          logger: context.logger,
          config: context.config,
          auth: context.auth,
          adminClient: context.adminClient,
          stickerStorageDir: dir,
        });
        const owner = await bootstrapUser(context, seedApp, 'owner@example.com');
        const created = await seedApp.request('http://localhost:3000/api/sticker-packs', {
          method: 'POST',
          headers: { cookie: owner.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'With file' }),
        });
        expect(created.status).toBe(201);
        const pack = (await created.json()) as { id: string };
        const bytes = new Uint8Array(33);
        bytes.set([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
        ]);
        new DataView(bytes.buffer).setUint32(16, 40);
        new DataView(bytes.buffer).setUint32(20, 40);
        const uploaded = await seedApp.request(
          `http://localhost:3000/api/sticker-packs/${pack.id}/stickers`,
          {
            method: 'POST',
            headers: { cookie: owner.cookie, 'content-type': 'application/octet-stream' },
            body: bytes as unknown as string,
          },
        );
        expect(uploaded.status).toBe(201);
        const warn = vi.fn();
        await warnOnEmptyStorageDir({ db: context.db, storageDir: dir, warn });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } finally {
      await context.close();
    }
  });
});

describe('ensureWritableDir failures', () => {
  it('fails clearly when the mkdir fails', async () => {
    const onError = vi.fn();
    const exit = vi.fn();
    await ensureWritableDir('/definitely/not/here', 'STICKER_STORAGE_DIR', {
      mkdir: vi.fn(async () => {
        throw new Error('EACCES');
      }),
      access: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
      writeAccess: 2,
      onError,
      exit,
    });
    expect(onError).toHaveBeenCalledWith(
      'STICKER_STORAGE_DIR (/definitely/not/here) is not writable: create the directory or fix its permissions',
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('fails clearly when the final access check fails', async () => {
    const onError = vi.fn();
    const exit = vi.fn();
    await ensureWritableDir('/readonly/mount', 'STICKER_STORAGE_DIR', {
      mkdir: vi.fn(async () => {}),
      access: vi.fn(async () => {
        throw new Error('EACCES');
      }),
      writeAccess: 2,
      onError,
      exit,
    });
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('STICKER_STORAGE_DIR (/readonly/mount) is not writable'),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('warnOnContainerLayerStorage (T-0156)', () => {
  it('warns once per directory on the container layer in production', async () => {
    const warn = vi.fn();
    await warnOnContainerLayerStorage({
      dirs: [
        { envName: 'STICKER_STORAGE_DIR', dir: '/data/stickers' },
        { envName: 'AVATAR_STORAGE_DIR', dir: '/data/avatars' },
        // Same dir twice: warned once, not twice.
        { envName: 'STICKER_STORAGE_DIR', dir: '/data/stickers' },
      ],
      isProduction: true,
      warn,
      dirDevice: () => Promise.resolve(8),
      rootDevice: () => Promise.resolve(8),
    });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('STICKER_STORAGE_DIR (/data/stickers) is on the container layer'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('AVATAR_STORAGE_DIR (/data/avatars) is on the container layer'),
    );
  });

  it('stays quiet off production, on mounted volumes, or when stat fails', async () => {
    // Off production: never warns, whatever the devices say.
    const offProd = vi.fn();
    await warnOnContainerLayerStorage({
      dirs: [{ envName: 'STICKER_STORAGE_DIR', dir: '/data/stickers' }],
      isProduction: false,
      warn: offProd,
      dirDevice: () => Promise.resolve(8),
      rootDevice: () => Promise.resolve(8),
    });
    expect(offProd).not.toHaveBeenCalled();

    // Mounted volume (different device from /): quiet.
    const mounted = vi.fn();
    await warnOnContainerLayerStorage({
      dirs: [{ envName: 'STICKER_STORAGE_DIR', dir: '/data/stickers' }],
      isProduction: true,
      warn: mounted,
      dirDevice: () => Promise.resolve(99),
      rootDevice: () => Promise.resolve(8),
    });
    expect(mounted).not.toHaveBeenCalled();

    // stat fails (dir missing, container down): skipped, never warns.
    const failing = vi.fn();
    await warnOnContainerLayerStorage({
      dirs: [{ envName: 'STICKER_STORAGE_DIR', dir: '/data/stickers' }],
      isProduction: true,
      warn: failing,
      dirDevice: () => Promise.reject(new Error('ENOENT')),
      rootDevice: () => Promise.resolve(8),
    });
    expect(failing).not.toHaveBeenCalled();
  });
});

describe('warnOnGifConfig (T-0156)', () => {
  it('warns once when the provider is set without a key', () => {
    const warn = vi.fn();
    warnOnGifConfig({ provider: 'giphy', apiKey: undefined, warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GIF_PROVIDER'));
    const serialised = JSON.stringify(warn.mock.calls);
    expect(serialised).not.toContain('giphy');
  });

  it('stays quiet when both are set, both are unset, or only the key is set', () => {
    for (const input of [
      { provider: 'giphy', apiKey: 'some-key' },
      { provider: undefined, apiKey: undefined },
      { provider: undefined, apiKey: 'some-key' },
    ]) {
      const warn = vi.fn();
      warnOnGifConfig({ ...input, warn });
      expect(warn).not.toHaveBeenCalled();
    }
  });
});
