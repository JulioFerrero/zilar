import type { Attachment } from '@zilar/protocol';

import { gradientImage } from '../lib/image-presets';

/**
 * Demo attachments for mock mode (T-0150): two generated gradient images
 * plus a generic file, so the attachment flow works without a server. The
 * URLs are `gradient:` placeholders (never fetched); the file entry shows
 * the file-row path. All three pass `AttachmentSchema`.
 */
export function mockDemoAttachments(): Attachment[] {
  return [
    {
      kind: 'image',
      url: gradientImage('sunset'),
      name: 'sunset.png',
      size: 245_760,
      mime: 'image/png',
      width: 1200,
      height: 800,
    },
    {
      kind: 'image',
      url: gradientImage('garden'),
      name: 'garden.png',
      size: 184_320,
      mime: 'image/png',
      width: 1200,
      height: 900,
    },
    {
      kind: 'file',
      url: 'https://files.zilar.test/demo/tickets.pdf',
      name: 'tickets.pdf',
      size: 2_411_724,
      mime: 'application/pdf',
    },
  ];
}
