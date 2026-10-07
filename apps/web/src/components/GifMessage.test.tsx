import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Attachment } from '@zilar/chat-core';
import { GifMessage, isGifVideoAttachment } from '@/components/GifMessage';

const TRUSTED = new Set(['files.zilar.test', 'upload.zilar.test']);

function gifVideo(name = 'gif-abc123.mp4'): Attachment {
  return {
    kind: 'file',
    url: 'https://files.zilar.test/get/1/gif-abc123.mp4',
    name,
    size: 1024,
    mime: 'video/mp4',
  };
}

describe('isGifVideoAttachment', () => {
  it('matches GIF-origin videos on trusted hosts only', () => {
    expect(isGifVideoAttachment(gifVideo(), TRUSTED)).toBe(true);
    expect(isGifVideoAttachment({ ...gifVideo(), mime: 'video/webm' }, TRUSTED)).toBe(true);
    expect(
      isGifVideoAttachment({ ...gifVideo('photo.png'), mime: 'image/png', kind: 'image' }, TRUSTED),
    ).toBe(false);
    expect(
      isGifVideoAttachment({ ...gifVideo('notes.pdf'), mime: 'application/pdf' }, TRUSTED),
    ).toBe(false);
    expect(isGifVideoAttachment({ ...gifVideo('clip.mp4') }, TRUSTED)).toBe(false);
  });

  it('accepts same-origin /api/ paths without a host entry', () => {
    expect(isGifVideoAttachment({ ...gifVideo(), url: '/api/gifs/media/token-1' }, new Set())).toBe(
      true,
    );
  });

  it('rejects absolute external URLs even with a gif- name and video mime', () => {
    const attacker = {
      ...gifVideo('gif-x'),
      url: 'https://attacker.test/x.mp4',
    };
    expect(isGifVideoAttachment(attacker, TRUSTED)).toBe(false);
    expect(isGifVideoAttachment(attacker, new Set())).toBe(false);
    expect(isGifVideoAttachment({ ...attacker, url: 'javascript:alert(1)' }, TRUSTED)).toBe(false);
  });
});

describe('GifMessage', () => {
  it('renders a looping muted inline video', () => {
    render(<GifMessage chatId="c-ana" attachment={gifVideo()} />);
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.loop).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
  });

  it('falls back to a tile when the video breaks', () => {
    render(<GifMessage chatId="c-ana" attachment={gifVideo()} />);
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    fireEvent.error(video as HTMLVideoElement);
    expect(screen.getByText('Video unavailable')).toBeTruthy();
  });

  it('loads a same-origin upload through the file route', () => {
    const url = `${window.location.origin}/upload/ana/gif-abc123.mp4`;
    const expected = `/api/files?chat=${encodeURIComponent('c-ana')}&url=${encodeURIComponent(url)}`;

    render(<GifMessage chatId="c-ana" attachment={{ ...gifVideo(), url }} />);

    expect(document.querySelector('video')?.getAttribute('src')).toBe(expected);
  });
});
