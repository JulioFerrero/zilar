import { describe, expect, it } from 'vitest';

import { StickersApiError } from '../../lib/stickers-api';
import {
  editorStickerCount,
  formErrorFor,
  formatPreparedSize,
  lookupFailureKind,
  rowErrorFor,
  runDeletePack,
  runSavePack,
  takeFittingImages,
  type SavePackApi,
} from './pack-editor';

describe('editorStickerCount', () => {
  it('adds the visible saved stickers and every new row', () => {
    expect(editorStickerCount(3, [])).toBe(3);
    expect(
      editorStickerCount(2, [
        {
          key: 'a',
          uri: 'u',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          bytes: 1,
          emoji: '',
          status: 'ready',
        },
        {
          key: 'b',
          uri: 'u',
          mimeType: 'image/png',
          width: 0,
          height: 0,
          bytes: 0,
          emoji: '',
          status: 'failed-prepare',
          error: 'bad',
        },
      ]),
    ).toBe(4);
  });
});

describe('takeFittingImages', () => {
  it('takes as many as fit and flags the skipped rest', () => {
    expect(takeFittingImages([1, 2, 3], 5)).toEqual({ taken: [1, 2, 3], skipped: false });
    expect(takeFittingImages([1, 2, 3], 2)).toEqual({ taken: [1, 2], skipped: true });
    expect(takeFittingImages([1], 0)).toEqual({ taken: [], skipped: true });
  });
});

describe('rowErrorFor', () => {
  it('maps every upload code to the brief sentence', () => {
    expect(rowErrorFor(new StickersApiError(413, 'sticker_too_large', 'big'))).toBe(
      'This image is too big. A sticker can be up to 512 KB and 512 px.',
    );
    expect(rowErrorFor(new StickersApiError(400, 'sticker_empty', 'empty'))).toBe(
      'This image is empty.',
    );
    expect(rowErrorFor(new StickersApiError(400, 'sticker_not_image', 'not image'))).toBe(
      'This file type is not supported. Use PNG, JPEG, WebP or GIF.',
    );
    expect(rowErrorFor(new StickersApiError(400, 'pack_full', 'full'))).toBe(
      'This pack is full. A pack holds up to 120 stickers.',
    );
    expect(rowErrorFor(new StickersApiError(500, 'internal_error', 'boom'))).toBe(
      'The upload failed. Try again.',
    );
    expect(rowErrorFor(new Error('down'))).toBe('The upload failed. Try again.');
  });
});

describe('formErrorFor', () => {
  it('maps every save code to the brief sentence', () => {
    expect(formErrorFor(new StickersApiError(400, 'pack_limit', 'many'))).toBe(
      'You have reached the limit of 100 packs.',
    );
    expect(formErrorFor(new StickersApiError(400, 'imported_private', 'private'))).toBe(
      'Imported packs are for personal use and cannot be shared.',
    );
    expect(formErrorFor(new StickersApiError(400, 'pack_full', 'full'))).toBe(
      'This pack is full. A pack holds up to 120 stickers.',
    );
    expect(formErrorFor(new StickersApiError(500, 'internal_error', 'boom'))).toBe(
      'Could not save the pack. Try again.',
    );
    expect(formErrorFor(new Error('down'))).toBe('Could not save the pack. Try again.');
  });
});

describe('formatPreparedSize', () => {
  it('formats the row size line', () => {
    expect(formatPreparedSize(512, 380, 94 * 1024)).toBe('512 x 380 px, 94 KB');
  });
});

describe('lookupFailureKind', () => {
  it('separates not-found and forbidden from other failures', () => {
    expect(lookupFailureKind(new StickersApiError(404, 'not_found', 'gone'))).toBe('not-found');
    expect(lookupFailureKind(new StickersApiError(403, 'forbidden', 'no'))).toBe('forbidden');
    expect(lookupFailureKind(new StickersApiError(500, 'internal_error', 'boom'))).toBe('other');
    expect(lookupFailureKind(new Error('down'))).toBe('other');
  });
});

function saveApi(overrides?: Partial<SavePackApi>): SavePackApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async createStickerPack() {
      calls.push('create');
      return { id: 'pack-new' };
    },
    async patchStickerPack() {
      calls.push('patch');
      return {};
    },
    async deletePackSticker(_packId, stickerId) {
      calls.push(`delete:${stickerId}`);
    },
    async uploadStickerFile(_packId, file) {
      calls.push(`upload:${file.uri}`);
      return { id: `sticker-for-${file.uri}` };
    },
    ...overrides,
  };
}

describe('runSavePack', () => {
  it('creates first, then uploads each image in order', async () => {
    const api = saveApi();
    const rows: string[] = [];
    const outcome = await runSavePack({
      api,
      target: { kind: 'create' },
      title: 'Cats',
      visibility: 'private',
      initialTitle: '',
      initialVisibility: 'private',
      removedIds: [],
      pending: [
        { key: 'a', uri: 'file:///a.webp', mimeType: 'image/webp', emoji: '' },
        { key: 'b', uri: 'file:///b.png', mimeType: 'image/png', emoji: '🐱' },
      ],
      onRow: (key, status) => {
        rows.push(`${key}:${status}`);
      },
      onProgress: () => {},
      onRemovedFlushed: () => {},
    });

    expect(outcome).toMatchObject({ ok: true, packId: 'pack-new' });
    expect(api.calls).toEqual(['create', 'upload:file:///a.webp', 'upload:file:///b.png']);
    expect(rows).toEqual(['a:uploading', 'a:uploaded', 'b:uploading', 'b:uploaded']);
  });

  it('patches, deletes, then uploads in edit mode', async () => {
    const api = saveApi();
    const outcome = await runSavePack({
      api,
      target: { kind: 'edit', packId: 'pack-1' },
      title: 'Renamed',
      visibility: 'server',
      initialTitle: 'Old',
      initialVisibility: 'private',
      removedIds: ['sticker-gone'],
      pending: [{ key: 'a', uri: 'file:///a.webp', mimeType: 'image/webp', emoji: '' }],
      onRow: () => {},
      onProgress: () => {},
      onRemovedFlushed: () => {},
    });

    expect(outcome).toMatchObject({ ok: true, packId: 'pack-1' });
    expect(api.calls).toEqual(['patch', 'delete:sticker-gone', 'upload:file:///a.webp']);
  });

  it('skips the patch when nothing changed', async () => {
    const api = saveApi();
    await runSavePack({
      api,
      target: { kind: 'edit', packId: 'pack-1' },
      title: 'Same',
      visibility: 'private',
      initialTitle: 'Same',
      initialVisibility: 'private',
      removedIds: [],
      pending: [],
      onRow: () => {},
      onProgress: () => {},
      onRemovedFlushed: () => {},
    });
    expect(api.calls).toEqual([]);
  });

  it('keeps the created pack id on a partial upload failure', async () => {
    const created: Array<{ id: string }> = [];
    const api = saveApi({
      async uploadStickerFile(_packId, file) {
        if (file.uri === 'file:///bad.webp') {
          throw new StickersApiError(400, 'pack_full', 'full');
        }
        return { id: `sticker-for-${file.uri}` };
      },
    });
    const errors = new Map<string, string>();
    const outcome = await runSavePack({
      api,
      target: { kind: 'create' },
      title: 'Cats',
      visibility: 'private',
      initialTitle: '',
      initialVisibility: 'private',
      removedIds: [],
      pending: [
        { key: 'a', uri: 'file:///good.webp', mimeType: 'image/webp', emoji: '' },
        { key: 'b', uri: 'file:///bad.webp', mimeType: 'image/webp', emoji: '' },
      ],
      onRow: (key, status, error) => {
        if (status === 'uploadFailed') {
          errors.set(key, error ?? '');
        }
      },
      onProgress: () => {},
      onRemovedFlushed: () => {},
      onCreated: (pack) => {
        created.push(pack);
      },
    });

    expect(outcome).toEqual({
      ok: false,
      partial: true,
      created: { id: 'pack-new', title: 'Cats', visibility: 'private' },
    });
    expect(created).toEqual([{ id: 'pack-new', title: 'Cats', visibility: 'private' }]);
    expect(errors.get('b')).toBe('This pack is full. A pack holds up to 120 stickers.');
    // A retry resumes into the same pack instead of minting a second one.
    const retryApi = saveApi();
    const retry = await runSavePack({
      api: retryApi,
      target: {
        kind: 'create',
        createdPackId: created[0]?.id,
        createdTitle: 'Cats',
        createdVisibility: 'private',
      },
      title: 'Cats',
      visibility: 'private',
      initialTitle: '',
      initialVisibility: 'private',
      removedIds: [],
      pending: [{ key: 'b', uri: 'file:///bad.webp', mimeType: 'image/webp', emoji: '' }],
      onRow: () => {},
      onProgress: () => {},
      onRemovedFlushed: () => {},
    });
    expect(retry).toMatchObject({ ok: true, packId: 'pack-new' });
    expect(retryApi.calls).toEqual(['upload:file:///bad.webp']);
  });

  it('treats a 404 delete as success so a retry after a partial save converges', async () => {
    const api = saveApi({
      async deletePackSticker(_packId, stickerId) {
        if (stickerId === 'sticker-gone') {
          throw new StickersApiError(404, 'not_found', 'gone');
        }
      },
    });
    let flushed = 0;
    const outcome = await runSavePack({
      api,
      target: { kind: 'edit', packId: 'pack-1' },
      title: 'Same',
      visibility: 'private',
      initialTitle: 'Same',
      initialVisibility: 'private',
      removedIds: ['sticker-gone'],
      pending: [{ key: 'a', uri: 'file:///a.webp', mimeType: 'image/webp', emoji: '' }],
      onRow: () => {},
      onProgress: () => {},
      onRemovedFlushed: () => {
        flushed += 1;
      },
    });
    expect(outcome).toMatchObject({ ok: true, packId: 'pack-1' });
    expect(flushed).toBe(1);
  });

  it('maps a create refusal to the form sentence', async () => {
    const api = saveApi({
      async createStickerPack() {
        throw new StickersApiError(400, 'pack_limit', 'many');
      },
    });
    const outcome = await runSavePack({
      api,
      target: { kind: 'create' },
      title: 'Cats',
      visibility: 'private',
      initialTitle: '',
      initialVisibility: 'private',
      removedIds: [],
      pending: [{ key: 'a', uri: 'file:///a.webp', mimeType: 'image/webp', emoji: '' }],
      onRow: () => {},
      onProgress: () => {},
      onRemovedFlushed: () => {},
    });
    expect(outcome).toEqual({
      ok: false,
      partial: false,
      formError: 'You have reached the limit of 100 packs.',
    });
  });

  it('returns the created pack on a partial failure so the retry keeps one pack', async () => {
    const api = saveApi({
      async uploadStickerFile(_packId, file) {
        if (file.uri === 'file:///bad.webp') {
          throw new StickersApiError(500, 'internal_error', 'boom');
        }
        return { id: `sticker-for-${file.uri}` };
      },
    });
    const outcome = await runSavePack({
      api,
      target: { kind: 'create' },
      title: 'Cats',
      visibility: 'private',
      initialTitle: '',
      initialVisibility: 'private',
      removedIds: [],
      pending: [
        { key: 'a', uri: 'file:///good.webp', mimeType: 'image/webp', emoji: '' },
        { key: 'b', uri: 'file:///bad.webp', mimeType: 'image/webp', emoji: '' },
      ],
      onRow: () => {},
      onProgress: () => {},
      onRemovedFlushed: () => {},
    });
    expect(outcome).toEqual({
      ok: false,
      partial: true,
      created: { id: 'pack-new', title: 'Cats', visibility: 'private' },
    });
  });

  it('deletes a removed upload on the create-mode retry instead of orphaning it', async () => {
    const api = saveApi();
    const outcome = await runSavePack({
      api,
      target: {
        kind: 'create',
        createdPackId: 'pack-new',
        createdTitle: 'Cats',
        createdVisibility: 'private',
      },
      title: 'Cats',
      visibility: 'private',
      initialTitle: '',
      initialVisibility: 'private',
      removedIds: ['sticker-for-file:///good.webp'],
      pending: [],
      onRow: () => {},
      onProgress: () => {},
      onRemovedFlushed: () => {},
    });
    expect(outcome).toMatchObject({ ok: true, packId: 'pack-new' });
    expect(api.calls).toEqual(['delete:sticker-for-file:///good.webp']);
  });
});

describe('runDeletePack', () => {
  it('returns true when the pack is deleted', async () => {
    let deleted = '';
    const ok = await runDeletePack(
      {
        async deleteStickerPack(packId: string) {
          deleted = packId;
          return { warning: 'gone' };
        },
      },
      'pack-1',
    );
    expect(ok).toBe(true);
    expect(deleted).toBe('pack-1');
  });

  it('returns false when the delete fails', async () => {
    const ok = await runDeletePack(
      {
        async deleteStickerPack() {
          throw new StickersApiError(500, 'internal_error', 'boom');
        },
      },
      'pack-1',
    );
    expect(ok).toBe(false);
  });
});
