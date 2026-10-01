import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { AttachmentVideo } from './attachment-video';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('expo-video', () => ({
  useVideoPlayer: () => ({ loop: false, muted: false }),
  VideoView: 'VideoView',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('./attachment-message', () => ({
  isLoadableMediaUrl: (url: string, hosts: ReadonlySet<string>) =>
    hosts.has('upload.galena.test') && url.includes('upload.galena.test'),
}));

const TRUSTED = new Set(['upload.galena.test']);

describe('attachment video (T-0150)', () => {
  it('renders the inline player for a trusted video', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentVideo, {
        attachment: {
          kind: 'file',
          url: 'https://upload.galena.test/get/clip.mp4',
          name: 'clip.mp4',
          size: 1_000_000,
          mime: 'video/mp4',
        },
        trustedHosts: TRUSTED,
      }),
    );
    expect(html).toContain('VideoView');
  });

  it('renders the untrusted line and no player for a hostile URL', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentVideo, {
        attachment: {
          kind: 'file',
          url: 'https://evil.test/x.mp4',
          name: 'clip.mp4',
          size: 1_000_000,
          mime: 'video/mp4',
        },
        trustedHosts: TRUSTED,
      }),
    );
    expect(html).not.toContain('VideoView');
    expect(html).toContain('Not loaded: untrusted address');
  });

  it('shows Retry on a failed video upload', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentVideo, {
        attachment: {
          kind: 'file',
          url: 'https://upload.galena.test/get/clip.mp4',
          name: 'clip.mp4',
          size: 1_000_000,
          mime: 'video/mp4',
        },
        trustedHosts: TRUSTED,
        failed: true,
        onRetry: () => {},
      }),
    );
    expect(html).toContain('Retry upload');
  });
});
