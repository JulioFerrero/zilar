import type { Attachment } from '@galena/protocol';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AttachmentFileRow,
  AttachmentImage,
  AttachmentViewer,
  isLoadableMediaUrl,
} from './attachment-message';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('expo-image', () => ({
  Image: 'Image',
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));

vi.mock('react-native-gesture-handler', () => ({
  PinchGestureHandler: 'PinchGestureHandler',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/lib/depth', () => ({
  raisedPill: { borderWidth: 1 },
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

const TRUSTED = new Set(['upload.galena.test', 'galena.test']);

function image(overrides: Partial<Attachment> = {}): Attachment {
  return {
    kind: 'image',
    url: 'https://upload.galena.test/get/stage.png',
    name: 'stage.png',
    size: 245_760,
    mime: 'image/png',
    width: 640,
    height: 420,
    ...overrides,
  };
}

function file(overrides: Partial<Attachment> = {}): Attachment {
  return {
    kind: 'file',
    url: 'https://upload.galena.test/get/tickets.pdf',
    name: 'tickets.pdf',
    size: 2_411_724,
    mime: 'application/pdf',
    ...overrides,
  };
}

describe('attachment rendering (T-0150)', () => {
  it('loads a trusted image and never an untrusted one', () => {
    expect(isLoadableMediaUrl(image().url, TRUSTED)).toBe(true);
    expect(isLoadableMediaUrl('https://evil.test/x.png', TRUSTED)).toBe(false);
    expect(isLoadableMediaUrl('javascript:alert(1)', TRUSTED)).toBe(false);
    expect(isLoadableMediaUrl('data:image/png;base64,xx', TRUSTED)).toBe(false);
    expect(isLoadableMediaUrl('/relative/path.png', TRUSTED)).toBe(false);
  });

  it('renders the trusted image with its name', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentImage, { attachment: image(), trustedHosts: TRUSTED }),
    );
    expect(html).toContain('<Image');
    expect(html).toContain('stage.png');
  });

  it('renders an untrusted image as a file row with the untrusted line', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentImage, {
        attachment: image({ url: 'https://evil.test/x.png' }),
        trustedHosts: TRUSTED,
      }),
    );
    expect(html).not.toContain('<Image');
    expect(html).toContain('Not loaded: untrusted address');
    expect(html).toContain('stage.png');
  });

  it('shows the uploading overlay with progress on the local preview', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentImage, {
        attachment: image({ url: '' }),
        trustedHosts: TRUSTED,
        localUri: 'file:///cache/photo.jpg',
        uploading: true,
        progress: 0.5,
      }),
    );
    expect(html).toContain('<Image');
    expect(html).toContain('Uploading');
    expect(html).toContain('50%');
  });

  it('shows Retry on a failed image upload', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentImage, {
        attachment: image(),
        trustedHosts: TRUSTED,
        failed: true,
        onRetry: () => {},
      }),
    );
    expect(html).toContain('Retry upload');
    expect(html).toContain('Upload failed');
  });

  it('renders a file row with name, size and MIME', () => {
    const html = renderToStaticMarkup(createElement(AttachmentFileRow, { attachment: file() }));
    expect(html).toContain('tickets.pdf');
    expect(html).toContain('2.3 MB');
    expect(html).toContain('application/pdf');
  });

  it('renders the untrusted file row without size or MIME', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentFileRow, {
        attachment: file({ url: 'https://evil.test/x.pdf' }),
        trusted: false,
        onOpen: () => {},
      }),
    );
    expect(html).toContain('Not loaded: untrusted address');
    expect(html).not.toContain('application/pdf');
  });

  it('shows Retry on a failed file upload and no open control', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentFileRow, {
        attachment: file(),
        failed: true,
        onRetry: () => {},
        onOpen: () => {},
      }),
    );
    expect(html).toContain('Retry upload');
    expect(html).toContain('Upload failed');
  });

  it('renders nothing without an open control while uploading', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentFileRow, {
        attachment: file(),
        uploading: true,
        progress: 0.25,
        onOpen: () => {},
      }),
    );
    expect(html).toContain('Uploading');
    expect(html).not.toContain('Open tickets.pdf');
  });

  it('renders the viewer with a close button and the image', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentViewer, {
        url: 'https://upload.galena.test/get/stage.png',
        name: 'stage.png',
        onClose: () => {},
      }),
    );
    expect(html).toContain('Close viewer');
    expect(html).toContain('<Image');
  });

  it('renders a demo gradient placeholder with the file name, never the untrusted row', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentImage, {
        attachment: image({ url: 'gradient:sunset' }),
        trustedHosts: TRUSTED,
      }),
    );
    expect(html).toContain('LinearGradient');
    expect(html).toContain('stage.png');
    expect(html).not.toContain('Not loaded: untrusted address');
  });

  it('renders nothing when the viewer is closed', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentViewer, { url: undefined, name: 'x', onClose: () => {} }),
    );
    expect(html).toBe('');
  });
});
