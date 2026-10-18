// T-2005: the transcript cache is keyed by the audio's path, not the URL the
// client happened to use. Two URLs that differ only by query string or
// fragment must share one cache entry, and the internal fetch drops both.

import { describe, expect, it } from 'vitest';
import { toInternalUploadUrl, voiceTranscriptUrlHash } from './routes';

const config = {
  PUBLIC_URL: 'https://chat.example.com',
  xmpp: { apiUrl: 'http://ejabberd:5280' },
};

describe('voice transcript cache key', () => {
  it('shares one key for URLs that differ only by query string', () => {
    const first = voiceTranscriptUrlHash('https://chat.example.com/upload/a/b.webm?1');
    const second = voiceTranscriptUrlHash('https://chat.example.com/upload/a/b.webm?2');

    expect(first).toBe(second);
  });

  it('ignores the fragment too', () => {
    const plain = voiceTranscriptUrlHash('https://chat.example.com/upload/a/b.webm');
    const withFragment = voiceTranscriptUrlHash('https://chat.example.com/upload/a/b.webm#t=5');

    expect(plain).toBe(withFragment);
  });

  it('keeps different upload paths apart', () => {
    const first = voiceTranscriptUrlHash('https://chat.example.com/upload/a/b.webm');
    const second = voiceTranscriptUrlHash('https://chat.example.com/upload/a/c.webm');

    expect(first).not.toBe(second);
  });
});

describe('internal upload URL', () => {
  it('drops the query string and fragment', () => {
    expect(toInternalUploadUrl('https://chat.example.com/upload/a/b.webm?1#t=5', config)).toBe(
      'http://ejabberd:5280/upload/a/b.webm',
    );
  });

  it('still refuses another origin and a path outside /upload/', () => {
    expect(toInternalUploadUrl('https://other.example.com/upload/a/b.webm', config)).toBeNull();
    expect(toInternalUploadUrl('https://chat.example.com/notes/b.webm', config)).toBeNull();
  });
});
