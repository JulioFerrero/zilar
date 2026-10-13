import { describe, expect, it } from 'vitest';

import { imageAttachmentRender } from './attachments';

describe('imageAttachmentRender', () => {
  it('shows the local preview while the bytes upload', () => {
    expect(imageAttachmentRender({ trusted: true, broken: false, hasLocalUri: true })).toBe(
      'local',
    );
    expect(imageAttachmentRender({ trusted: false, broken: true, hasLocalUri: true })).toBe(
      'local',
    );
  });

  it('auto-loads a trusted URL', () => {
    expect(imageAttachmentRender({ trusted: true, broken: false, hasLocalUri: false })).toBe(
      'image',
    );
  });

  it('labels an untrusted URL as untrusted', () => {
    expect(imageAttachmentRender({ trusted: false, broken: false, hasLocalUri: false })).toBe(
      'untrusted',
    );
  });

  it('reports a fetch failure on a trusted URL as a load failure, not untrusted', () => {
    expect(imageAttachmentRender({ trusted: true, broken: true, hasLocalUri: false })).toBe(
      'load-failed',
    );
  });
});
