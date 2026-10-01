import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Attachment } from '@galena/chat-core';
import { GifMessage, isGifVideoAttachment } from '@/components/GifMessage';

function gifVideo(name = 'gif-abc123.gif'): Attachment {
  return {
    kind: 'file',
    url: 'https://files.galena.test/get/1/gif-abc123.gif',
    name,
    size: 1024,
    mime: 'video/mp4',
  };
}

describe('isGifVideoAttachment', () => {
  it('matches GIF-origin videos only', () => {
    expect(isGifVideoAttachment(gifVideo())).toBe(true);
    expect(isGifVideoAttachment({ ...gifVideo(), mime: 'video/webm' })).toBe(true);
    expect(
      isGifVideoAttachment({ ...gifVideo('photo.png'), mime: 'image/png', kind: 'image' }),
    ).toBe(false);
    expect(isGifVideoAttachment({ ...gifVideo('notes.pdf'), mime: 'application/pdf' })).toBe(false);
    expect(isGifVideoAttachment({ ...gifVideo('clip.mp4') })).toBe(false);
  });
});

describe('GifMessage', () => {
  it('renders a looping muted inline video', () => {
    render(<GifMessage attachment={gifVideo()} />);
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.loop).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
  });

  it('falls back to a tile when the video breaks', () => {
    render(<GifMessage attachment={gifVideo()} />);
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    fireEvent.error(video as HTMLVideoElement);
    expect(screen.getByText('Video unavailable')).toBeTruthy();
  });
});
