import { describe, expect, it } from 'vitest';
import {
  initialMediaRetryState,
  isMediaRetryUnavailable,
  mediaRetryAdvance,
  mediaRetryAtUrl,
  mediaRetryOnError,
  mediaRetryOnLoad,
  type MediaRetryState,
} from './use-media-retry';

const URL = 'https://chat.zilar.app/upload/abc/photo.png';
const PREVIEW = 'file:///cache/photo.jpg';

function exhaust(state: MediaRetryState, url: string): MediaRetryState {
  let current = state;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    current = mediaRetryOnError(current, url, true);
    current = mediaRetryAdvance(current, url);
  }
  return mediaRetryOnError(current, url, true);
}

describe('media retry state', () => {
  it('keeps the captured preview across a URL swap', () => {
    const initial = initialMediaRetryState(URL, PREVIEW);
    const swapped = mediaRetryAtUrl(initial, 'https://chat.zilar.app/upload/abc/other.png');

    expect(swapped.url).toBe('https://chat.zilar.app/upload/abc/other.png');
    expect(swapped.preview).toBe(PREVIEW);
    expect(swapped.remaining).toBe(4);
    expect(swapped.nonce).toBe(0);
  });

  it('captures a local URL as the preview', () => {
    expect(initialMediaRetryState('blob:https://chat.zilar.app/123', undefined).preview).toBe(
      'blob:https://chat.zilar.app/123',
    );
    expect(initialMediaRetryState(URL, undefined).preview).toBeUndefined();
  });

  it('reports unavailable only once no preview is left to show', () => {
    const withoutPreview = exhaust(initialMediaRetryState(URL, undefined), URL);
    expect(withoutPreview.failed).toBe(true);
    expect(isMediaRetryUnavailable(withoutPreview)).toBe(true);

    const withPreview = exhaust(initialMediaRetryState(URL, PREVIEW), URL);
    expect(withPreview.failed).toBe(true);
    expect(withPreview.preview).toBe(PREVIEW);
    expect(isMediaRetryUnavailable(withPreview)).toBe(false);
  });

  it('keeps the preview when a local preview URL loads', () => {
    const local = 'blob:https://chat.zilar.app/123';
    const state = mediaRetryOnLoad(initialMediaRetryState(local, undefined), local);
    expect(state.preview).toBe(local);
  });

  it('drops the preview when the remote image loads', () => {
    const state = mediaRetryOnLoad(initialMediaRetryState(URL, PREVIEW), URL);
    expect(state.loaded).toBe(true);
    expect(state.preview).toBeUndefined();
  });

  it('follows 1, 2, 4 and 8 second delays, then fails', () => {
    let state = initialMediaRetryState(URL, undefined);
    const delays: Array<number | undefined> = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      state = mediaRetryOnError(state, URL, true);
      delays.push(state.pending);
      state = mediaRetryAdvance(state, URL);
    }

    expect(delays).toEqual([1000, 2000, 4000, 8000]);

    const spent = mediaRetryOnError(state, URL, true);
    expect(spent.failed).toBe(true);
    expect(spent.pending).toBeUndefined();
  });

  it('does not retry a non-retryable source', () => {
    const state = mediaRetryOnError(initialMediaRetryState(URL, undefined), URL, false);
    expect(state.failed).toBe(true);
    expect(state.pending).toBeUndefined();
    expect(state.remaining).toBe(4);
  });

  it('schedules only once per load error', () => {
    const first = mediaRetryOnError(initialMediaRetryState(URL, undefined), URL, true);
    expect(mediaRetryOnError(first, URL, true)).toBe(first);
  });
});
