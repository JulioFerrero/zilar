import { describe, expect, it } from 'vitest';
import { sanitizeMediaItems } from './pins';

const FOREIGN = 'https://evil.example/a.png';
const TRUSTED = 'https://media.zilar.test/a.png';

const isTrusted = (url: string): boolean => url.startsWith('https://media.zilar.test/');

type Row = { kind: string; url?: string | undefined };

function item(overrides: Partial<Row> = {}): Row {
  return { kind: 'image', url: FOREIGN, ...overrides };
}

describe('sanitizeMediaItems', () => {
  it('drops the url of an image on a foreign host', () => {
    const [sanitised] = sanitizeMediaItems([item()], isTrusted);

    expect(sanitised?.url).toBeUndefined();
    expect(sanitised?.kind).toBe('image');
  });

  it('keeps the url of an image on a trusted host', () => {
    const rows = [item({ url: TRUSTED })];

    expect(sanitizeMediaItems(rows, isTrusted)).toEqual(rows);
  });

  it('keeps a file item on a foreign host', () => {
    const rows = [item({ kind: 'file' })];

    expect(sanitizeMediaItems(rows, isTrusted)).toEqual(rows);
  });

  it('drops every image url when there is no trust function', () => {
    const rows = sanitizeMediaItems([item({ url: TRUSTED }), item({ kind: 'gif' })], undefined);

    expect(rows.every((row) => row.url === undefined)).toBe(true);
  });

  it('resolves a relative url before the trust check', () => {
    const resolve = (url: string): string => `https://api.zilar.test${url}`;
    const [sanitised] = sanitizeMediaItems(
      [item({ url: '/api/media/1' })],
      (url) => url === 'https://api.zilar.test/api/media/1',
      resolve,
    );

    expect(sanitised?.url).toBe('https://api.zilar.test/api/media/1');
  });
});
