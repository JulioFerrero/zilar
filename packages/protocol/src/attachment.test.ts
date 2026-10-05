import { describe, expect, it } from 'vitest';
import { AttachmentSchema, type Attachment } from './index';

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
    const result = AttachmentSchema.safeParse(image);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(image);
    }
  });

  it('accepts a valid file without dimensions', () => {
    const result = AttachmentSchema.safeParse(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(file);
    }
  });

  it('rejects a size over the 100 MB cap', () => {
    expect(AttachmentSchema.safeParse({ ...file, size: 100 * 1024 * 1024 + 1 }).success).toBe(
      false,
    );
  });

  it('rejects a url that is not a url', () => {
    expect(AttachmentSchema.safeParse({ ...file, url: 'not a url' }).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(AttachmentSchema.safeParse({ ...file, kind: 'video' }).success).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(AttachmentSchema.safeParse({ ...file, extra: true }).success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(AttachmentSchema.safeParse({ ...file, name: '' }).success).toBe(false);
  });

  it('rejects a non-integer size', () => {
    expect(AttachmentSchema.safeParse({ ...file, size: 1.5 }).success).toBe(false);
  });

  it('rejects image dimensions of zero', () => {
    expect(AttachmentSchema.safeParse({ ...image, width: 0 }).success).toBe(false);
    expect(AttachmentSchema.safeParse({ ...image, height: 0 }).success).toBe(false);
  });
});
