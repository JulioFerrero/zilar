import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { AttachSheet } from './attach-sheet';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/lib/depth', () => ({
  well: { borderWidth: 1 },
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
});
