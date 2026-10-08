import { describe, expect, it } from 'vitest';
import { AttachmentSchema, type Attachment, decodeOrThrow, isValid } from './index';

const image: Attachment = {
  kind: 'image',
  url: 'https://upload.zilar.localhost/upload/abc/photo.png',
  name: 'holiday photo.png',
  size: 245_760,
  mime: 'image/png',
  width: 1280,
  height: 720,
};

const file: Attachment = {
  kind: 'file',
  url: 'https://upload.zilar.localhost/upload/abc/report.pdf',
  name: 'Q3 report.pdf',
  size: 2_400_000,
  mime: 'application/pdf',
};

describe('AttachmentSchema', () => {
  it('accepts a valid image', () => {
    expect(isValid(AttachmentSchema)(image)).toBe(true);
    expect(decodeOrThrow(AttachmentSchema)(image)).toEqual(image);
  });

  it('accepts a valid file without dimensions', () => {
    expect(isValid(AttachmentSchema)(file)).toBe(true);
    expect(decodeOrThrow(AttachmentSchema)(file)).toEqual(file);
  });

  it('rejects a size over the 100 MB cap', () => {
    expect(isValid(AttachmentSchema)({ ...file, size: 100 * 1024 * 1024 + 1 })).toBe(false);
  });

  it('rejects a url that is not a url', () => {
    expect(isValid(AttachmentSchema)({ ...file, url: 'not a url' })).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(isValid(AttachmentSchema)({ ...file, kind: 'video' })).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(isValid(AttachmentSchema)({ ...file, extra: true })).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(isValid(AttachmentSchema)({ ...file, name: '' })).toBe(false);
  });

  it('rejects a non-integer size', () => {
    expect(isValid(AttachmentSchema)({ ...file, size: 1.5 })).toBe(false);
  });

  it('rejects image dimensions of zero', () => {
    expect(isValid(AttachmentSchema)({ ...image, width: 0 })).toBe(false);
    expect(isValid(AttachmentSchema)({ ...image, height: 0 })).toBe(false);
  });
});
