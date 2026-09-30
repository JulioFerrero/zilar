import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensureWritableDir } from './startup';

describe('ensureWritableDir', () => {
  it('creates a missing directory and does not exit', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'galena-startup-'));
    try {
      const dir = join(parent, 'stickers');
      const onError = vi.fn();
      const exit = vi.fn();
      const { mkdir, access, constants } = await import('node:fs/promises');
      await ensureWritableDir(dir, 'STICKER_STORAGE_DIR', {
        mkdir: (target, options) => mkdir(target, options),
        access: (target, mode) => access(target, mode),
        writeAccess: constants.W_OK,
        onError,
        exit,
      });
      expect(onError).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('fails clearly when the directory is not writable', async () => {
    const onError = vi.fn();
    const exit = vi.fn();
    await ensureWritableDir('/definitely/not/here', 'STICKER_STORAGE_DIR', {
      mkdir: vi.fn(async () => {
        throw new Error('EACCES');
      }),
      access: vi.fn(async () => {}),
      writeAccess: 2,
      onError,
      exit,
    });
    expect(onError).toHaveBeenCalledWith(
      'STICKER_STORAGE_DIR (/definitely/not/here) is not writable: create the directory or fix its permissions',
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('fails clearly when the access check fails', async () => {
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
