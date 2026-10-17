import { describe, expect, it } from 'vitest';

import { toShareDraft } from './share-intent';

describe('toShareDraft', () => {
  it('reads a text-only share as trimmed text with no files', () => {
    const result = toShareDraft({
      type: 'text',
      text: '  hello from another app  ',
      files: null,
      webUrl: null,
    });

    expect(result).toEqual({ ok: true, draft: { text: 'hello from another app', files: [] } });
  });

  it('maps two files, treating a null size as unknown and a bad mime as octet-stream', () => {
    const result = toShareDraft({
      type: 'file',
      text: null,
      webUrl: null,
      files: [
        {
          path: 'file:///cache/one.txt',
          fileName: ' one.txt ',
          mimeType: 'text/plain',
          size: null,
          width: null,
          height: null,
          duration: null,
        },
        {
          path: 'content://media/external/two',
          fileName: 'two',
          mimeType: 'not a mime',
          size: 2048,
          width: null,
          height: null,
          duration: null,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      draft: {
        files: [
          {
            uri: 'file:///cache/one.txt',
            name: 'one.txt',
            mimeType: 'text/plain',
            size: undefined,
          },
          {
            uri: 'content://media/external/two',
            name: 'two',
            mimeType: 'application/octet-stream',
            size: 2048,
          },
        ],
      },
    });
  });

  it('refuses a file whose path is not file:// or content://', () => {
    const result = toShareDraft({
      type: 'file',
      text: null,
      webUrl: null,
      files: [
        {
          path: 'http://example.com/one.txt',
          fileName: 'one.txt',
          mimeType: 'text/plain',
          size: 12,
          width: null,
          height: null,
          duration: null,
        },
      ],
    });

    expect(result).toEqual({ ok: false, message: 'That file cannot be shared.' });
  });

  it('refuses more than 10 files', () => {
    const files = Array.from({ length: 11 }, (_, index) => ({
      path: `file:///cache/${index}.txt`,
      fileName: `${index}.txt`,
      mimeType: 'text/plain',
      size: 1,
      width: null,
      height: null,
      duration: null,
    }));

    const result = toShareDraft({ type: 'file', text: null, webUrl: null, files });

    expect(result).toEqual({ ok: false, message: 'You can share up to 10 files at once.' });
  });
});
