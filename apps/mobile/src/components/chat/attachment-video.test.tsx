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
  useVideoPlayer: () => ({ loop: false, muted: false, play: () => {}, pause: () => {} }),
  VideoView: 'VideoView',
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('lucide-react-native', () => ({
  Play: 'Play',
  Video: 'Video',
}));

vi.mock('@/lib/colors', () => ({
  ICON: '#d4d4d4',
}));

vi.mock('./attachment-message', () => ({
  isLoadableMediaUrl: (url: string, hosts: ReadonlySet<string>) =>
    hosts.has('upload.zilar.test') && url.includes('upload.zilar.test'),
}));

const TRUSTED = new Set(['upload.zilar.test']);

describe('attachment video (T-0150)', () => {
  it('renders the inline player for a trusted video', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentVideo, {
        attachment: {
          kind: 'file',
          url: 'https://upload.zilar.test/get/clip.mp4',
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
    expect(html).toContain('<Video');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('shows Retry on a failed video upload', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentVideo, {
        attachment: {
          kind: 'file',
          url: 'https://upload.zilar.test/get/clip.mp4',
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

  // `renderToStaticMarkup` never runs effects, so the initial render is the
  // pre-play frame: a GIF-origin video shows the tap-to-play badge before
  // the autoplay effect fires (and always with reduced motion). A regular
  // video never shows the badge — it plays with sound on tap.
  it('shows the tap-to-play badge on a GIF-origin video before autoplay', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentVideo, {
        attachment: {
          kind: 'file',
          url: 'https://upload.zilar.test/get/gif-abc123.mp4',
          name: 'gif-abc123.mp4',
          size: 1_000_000,
          mime: 'video/mp4',
        },
        trustedHosts: TRUSTED,
      }),
    );
    expect(html).toContain('VideoView');
    expect(html).toContain('GIF');
    expect(html).toContain('<Play');
  });

  it('shows no badge on a regular video', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentVideo, {
        attachment: {
          kind: 'file',
          url: 'https://upload.zilar.test/get/clip.mp4',
          name: 'clip.mp4',
          size: 1_000_000,
          mime: 'video/mp4',
        },
        trustedHosts: TRUSTED,
      }),
    );
    expect(html).toContain('VideoView');
    expect(html).not.toContain('GIF');
  });
});
