import type { Attachment } from '@zilar/protocol';
import { describe, expect, it } from 'vitest';

import { mockDemoAttachments } from './attachments';
import { AttachmentSchema, isValid } from '@zilar/protocol';

describe('mock demo attachments (T-0150)', () => {
  it('ships two generated images and a file that pass AttachmentSchema', () => {
    const demos = mockDemoAttachments();
    expect(demos).toHaveLength(3);
    for (const attachment of demos) {
      expect(isValid(AttachmentSchema)(attachment)).toBe(true);
    }
    expect(demos.filter((item) => item.kind === 'image')).toHaveLength(2);
    expect(demos.filter((item) => item.kind === 'file')).toHaveLength(1);
  });

  it('uses gradient placeholders for images (never fetched)', () => {
    const demos = mockDemoAttachments();
    for (const item of demos.filter(
      (entry): entry is Attachment & { kind: 'image' } => entry.kind === 'image',
    )) {
      expect(item.url.startsWith('gradient:')).toBe(true);
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
    }
  });
});
