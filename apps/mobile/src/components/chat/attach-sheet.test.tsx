import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { AttachSheet, PreviewFallbackIcon, isImageName } from './attach-sheet';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('@/lib/depth', () => ({
  well: { borderWidth: 1 },
}));

vi.mock('lucide-react-native', () => ({
  Camera: 'Camera',
  FileText: 'FileText',
  Image: 'Image',
  Paperclip: 'Paperclip',
}));

vi.mock('@/lib/colors', () => ({
  ICON: '#d4d4d4',
}));

describe('attach sheet (T-0150)', () => {
  function sheet(overrides: Record<string, unknown> = {}): string {
    return renderToStaticMarkup(
      createElement(AttachSheet, {
        open: true,
        busy: false,
        onPick: () => {},
        onClose: () => {},
        ...overrides,
      }),
    );
  }

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      createElement(AttachSheet, { open: false, busy: false, onPick: () => {}, onClose: () => {} }),
    );
    expect(html).toBe('');
  });

  it('offers library, camera and file choices', () => {
    const html = sheet();
    expect(html).toContain('Photo or video');
    expect(html).toContain('Take a photo');
    expect(html).toContain('File');
  });

  it('shows the picked preview with name and size', () => {
    const html = sheet({
      preview: { uri: 'file:///cache/photo.jpg', name: 'photo.jpg', size: 245_760 },
      onCancelPick: () => {},
    });
    expect(html).toContain('photo.jpg');
    expect(html).toContain('240 KB');
    expect(html).toContain('Remove attachment');
  });

  it('shows a plain explanation on error', () => {
    const html = sheet({ error: 'That file is larger than 50 MB.' });
    expect(html).toContain('That file is larger than 50 MB.');
  });

  it('draws the sheet with lucide icons and no emoji', () => {
    const html = sheet({
      demoAttachments: [
        {
          kind: 'image',
          name: 'photo.jpg',
          url: 'https://files.example/photo.jpg',
          size: 120_000,
          mime: 'image/jpeg',
        },
        {
          kind: 'file',
          name: 'doc.pdf',
          url: 'https://files.example/doc.pdf',
          size: 44_000,
          mime: 'application/pdf',
        },
      ],
      onPickDemo: () => {},
    });
    expect(html).toContain('<Paperclip');
    expect(html).toContain('<Image');
    expect(html).toContain('<Camera');
    expect(html).toContain('<FileText');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('shows the image fallback icon for image names and the file icon otherwise', () => {
    expect(isImageName('pic.png')).toBe(true);
    expect(isImageName('PHOTO.JPG')).toBe(true);
    expect(isImageName('doc.pdf')).toBe(false);
    expect(isImageName('no-extension')).toBe(false);
    const imageIcon = renderToStaticMarkup(
      createElement(PreviewFallbackIcon, { name: 'pic.png', iconColor: '#d4d4d4' }),
    );
    expect(imageIcon).toContain('<Image');
    expect(imageIcon).not.toContain('<FileText');
    const fileIcon = renderToStaticMarkup(
      createElement(PreviewFallbackIcon, { name: 'doc.pdf', iconColor: '#d4d4d4' }),
    );
    expect(fileIcon).toContain('<FileText');
    expect(fileIcon).not.toContain('<Image');
  });
});
